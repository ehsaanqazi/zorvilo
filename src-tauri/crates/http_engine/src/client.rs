//! The reqwest-backed executor.

use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine as _;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use tokio_util::sync::CancellationToken;
use zorvilo_core::{ids::now_ms, ResponseData, ResponseTiming, UserPass};

use crate::auth::{digest_authorization, parse_digest_challenge, random_cnonce};
use crate::build::HttpRequestSpec;
use crate::error::{HttpError, HttpResult};
use crate::network::check_destination;
use crate::response::is_textual;

/// Shared HTTP engine. Cheap to clone; holds the cookie jar.
#[derive(Clone)]
pub struct HttpEngine {
    jar: Arc<reqwest::cookie::Jar>,
}

impl Default for HttpEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        let text = s.to_string();
        if !msg.contains(&text) {
            msg.push_str(": ");
            msg.push_str(&text);
        }
        source = s.source();
    }
    msg
}

impl HttpEngine {
    pub fn new() -> Self {
        Self { jar: Arc::new(reqwest::cookie::Jar::default()) }
    }

    /// Cookies the jar would send to `url` (for the cookie viewer / pm.cookies).
    pub fn cookies_for(&self, url: &str) -> Vec<(String, String)> {
        use reqwest::cookie::CookieStore;
        let Ok(u) = url::Url::parse(url) else { return Vec::new() };
        let Some(header) = self.jar.cookies(&u) else { return Vec::new() };
        header
            .to_str()
            .unwrap_or("")
            .split(';')
            .filter_map(|p| {
                let p = p.trim();
                let i = p.find('=')?;
                Some((p[..i].to_string(), p[i + 1..].to_string()))
            })
            .collect()
    }

    fn client(&self, spec: &HttpRequestSpec, pinned: &[std::net::SocketAddr]) -> HttpResult<reqwest::Client> {
        let o = &spec.options;
        let mut b = reqwest::Client::builder()
            .redirect(if o.follow_redirects { Policy::limited(o.max_redirects as usize) } else { Policy::none() })
            .connect_timeout(Duration::from_millis(o.connect_timeout_ms))
            .timeout(Duration::from_millis(o.timeout_ms))
            .user_agent(concat!("Zorvilo/", env!("CARGO_PKG_VERSION")))
            .danger_accept_invalid_certs(!o.verify_tls);
        if o.cookies {
            b = b.cookie_provider(self.jar.clone());
        }
        if let Some(proxy) = &o.proxy {
            let mut p = reqwest::Proxy::all(proxy.url.trim()).map_err(|e| HttpError::Proxy(e.to_string()))?;
            if !proxy.no_proxy.trim().is_empty() {
                p = p.no_proxy(reqwest::NoProxy::from_string(proxy.no_proxy.trim()));
            }
            b = b.proxy(p);
        }
        if let Some(path) = &o.ca_cert_path {
            let pem = std::fs::read(path).map_err(|source| HttpError::File { path: path.clone(), source })?;
            let cert = reqwest::Certificate::from_pem(&pem).map_err(|e| HttpError::Tls(format!("CA certificate: {e}")))?;
            b = b.add_root_certificate(cert);
        }
        if let Some(path) = &o.client_identity_path {
            let pem = std::fs::read(path).map_err(|source| HttpError::File { path: path.clone(), source })?;
            let id = reqwest::Identity::from_pem(&pem).map_err(|e| HttpError::Tls(format!("client certificate: {e}")))?;
            b = b.identity(id);
        }
        if !pinned.is_empty() {
            if let Some(host) = spec.url.host_str() {
                b = b.resolve_to_addrs(host, pinned);
            }
        }
        b.build().map_err(|e| HttpError::Transport(error_chain(&e)))
    }

    fn header_map(headers: &[(String, String)]) -> HttpResult<HeaderMap> {
        let mut map = HeaderMap::new();
        for (k, v) in headers {
            let name = HeaderName::from_bytes(k.trim().as_bytes()).map_err(|_| HttpError::InvalidHeader(format!("name “{k}”")))?;
            let value = HeaderValue::from_str(v).map_err(|_| HttpError::InvalidHeader(format!("value for “{k}”")))?;
            map.append(name, value);
        }
        Ok(map)
    }

    async fn execute_once(
        &self,
        client: &reqwest::Client,
        spec: &HttpRequestSpec,
    ) -> HttpResult<(reqwest::Response, f64)> {
        let method = reqwest::Method::from_bytes(spec.method.as_bytes())
            .map_err(|_| HttpError::InvalidMethod(spec.method.clone()))?;
        let mut rb = client.request(method, spec.url.clone()).headers(Self::header_map(&spec.headers)?);
        if let Some(body) = &spec.body {
            rb = rb.body(body.clone());
        }
        let start = Instant::now();
        let resp = rb.send().await.map_err(|e| map_reqwest(e, spec.options.timeout_ms))?;
        Ok((resp, start.elapsed().as_secs_f64() * 1000.0))
    }

    /// Execute a built + authenticated request. Never panics; failures are
    /// returned as a `ResponseData` with `error` set.
    pub async fn send(&self, spec: HttpRequestSpec, digest: Option<UserPass>, cancel: CancellationToken) -> ResponseData {
        let fut = self.send_inner(spec, digest);
        tokio::select! {
            _ = cancel.cancelled() => ResponseData::error(HttpError::Cancelled.to_string()),
            r = fut => match r {
                Ok(resp) => resp,
                Err(e) => ResponseData::error(e.to_string()),
            },
        }
    }

    async fn send_inner(&self, mut spec: HttpRequestSpec, digest: Option<UserPass>) -> HttpResult<ResponseData> {
        let mut warnings = Vec::new();
        if !spec.options.verify_tls && spec.url.scheme() == "https" {
            warnings.push("TLS certificate verification is disabled for this request".to_string());
        }

        // destination safety (skipped when a proxy resolves names for us)
        let started = Instant::now();
        let mut pinned = Vec::new();
        if spec.options.proxy.is_none() {
            if let Some(host) = spec.url.host_str().map(str::to_string) {
                let port = spec.url.port_or_known_default().unwrap_or(80);
                match check_destination(&host, port).await {
                    Ok(check) => {
                        if check.internal && spec.options.network.block_private {
                            return Err(HttpError::Blocked(check.warning.unwrap_or_default()));
                        }
                        if let (Some(w), true) = (check.warning, spec.options.network.warn_private) {
                            warnings.push(format!("Internal destination: {w}"));
                        }
                        pinned = check.pinned;
                    }
                    Err(e) => return Err(HttpError::Transport(e)),
                }
            }
        }
        let dns_ms = started.elapsed().as_secs_f64() * 1000.0;

        let client = self.client(&spec, &pinned)?;
        let (mut resp, mut headers_ms) = self.execute_once(&client, &spec).await?;

        // Digest: answer the 401 challenge and retry once
        if let Some(creds) = digest {
            if resp.status().as_u16() == 401 {
                let challenge = resp
                    .headers()
                    .get_all(reqwest::header::WWW_AUTHENTICATE)
                    .iter()
                    .filter_map(|v| v.to_str().ok())
                    .find_map(parse_digest_challenge);
                if let Some(challenge) = challenge {
                    let uri = match spec.url.query() {
                        Some(q) => format!("{}?{q}", spec.url.path()),
                        None => spec.url.path().to_string(),
                    };
                    let header = digest_authorization(
                        &creds.username,
                        &creds.password,
                        &spec.method,
                        &uri,
                        &challenge,
                        1,
                        &random_cnonce(),
                    );
                    spec.set_header("Authorization", header);
                    let (r2, ms2) = self.execute_once(&client, &spec).await?;
                    resp = r2;
                    headers_ms += ms2;
                }
            }
        }

        let status = resp.status();
        let version = format!("{:?}", resp.version());
        let final_url = resp.url().to_string();
        let headers: Vec<(String, String)> = resp
            .headers()
            .iter()
            .map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
            .collect();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body_start = Instant::now();
        let bytes = resp.bytes().await.map_err(|e| map_reqwest(e, spec.options.timeout_ms))?;
        let body_ms = body_start.elapsed().as_secs_f64() * 1000.0;

        let (body_text, body_base64) = if is_textual(&content_type) {
            (String::from_utf8_lossy(&bytes).into_owned(), None)
        } else {
            (
                format!("(binary {}, {} bytes)", if content_type.is_empty() { "response" } else { content_type.as_str() }, bytes.len()),
                Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
            )
        };

        Ok(ResponseData {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            headers,
            body_text,
            body_base64,
            content_type,
            size_bytes: bytes.len() as u64,
            duration_ms: headers_ms + body_ms,
            timestamp: now_ms(),
            error: None,
            final_url: Some(final_url),
            http_version: Some(version),
            warnings,
            timing: Some(ResponseTiming { dns_ms, headers_ms, body_ms }),
        })
    }
}

fn map_reqwest(e: reqwest::Error, timeout_ms: u64) -> HttpError {
    if e.is_timeout() {
        HttpError::Timeout(timeout_ms)
    } else if e.is_redirect() {
        HttpError::Transport(format!("too many redirects: {}", error_chain(&e)))
    } else if e.is_connect() {
        HttpError::Transport(format!("could not connect — {}", error_chain(&e)))
    } else {
        HttpError::Transport(error_chain(&e))
    }
}
