//! Turn a variable-resolved request into a wire-level request spec.

use base64::Engine as _;
use zorvilo_core::jsonc::strip_json_comments;
use zorvilo_core::path_params::url_from_path_params;
use zorvilo_core::url_utils::{split_url, with_scheme};
use zorvilo_core::{
    ApiRequest, AppSettings, BodyType, FormKind, NetworkSafety, ProxySettings, RequestSettings,
};

use crate::error::{HttpError, HttpResult};

/// Transport options for one request.
#[derive(Debug, Clone)]
pub struct SendOptions {
    pub timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    /// TLS certificate verification (true unless explicitly disabled).
    pub verify_tls: bool,
    pub proxy: Option<ProxySettings>,
    pub ca_cert_path: Option<String>,
    pub client_identity_path: Option<String>,
    pub cookies: bool,
    pub network: NetworkSafety,
}

impl Default for SendOptions {
    fn default() -> Self {
        Self::from_settings(&AppSettings::default(), &RequestSettings::default())
    }
}

impl SendOptions {
    pub fn from_settings(settings: &AppSettings, req: &RequestSettings) -> Self {
        let non_empty = |s: &str| (!s.trim().is_empty()).then(|| s.trim().to_string());
        Self {
            timeout_ms: if req.timeout_ms > 0 { req.timeout_ms } else { settings.request_timeout_ms.max(1) },
            connect_timeout_ms: settings.connect_timeout_ms.max(1),
            follow_redirects: req.follow_redirects && settings.follow_redirects,
            max_redirects: if req.max_redirects > 0 { req.max_redirects } else { settings.max_redirects },
            verify_tls: settings.tls.verify && req.verify_ssl,
            proxy: settings.proxy.enabled.then(|| settings.proxy.clone()),
            ca_cert_path: non_empty(&settings.tls.ca_cert_path),
            client_identity_path: non_empty(&settings.tls.client_identity_path),
            cookies: settings.cookies_enabled,
            network: settings.network_safety.clone(),
        }
    }
}

/// A fully built request, ready for authentication and sending.
#[derive(Debug, Clone)]
pub struct HttpRequestSpec {
    pub method: String,
    pub url: url::Url,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub options: SendOptions,
}

impl HttpRequestSpec {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    pub fn has_header(&self, name: &str) -> bool {
        self.header(name).is_some()
    }
    /// `Headers.set` semantics: replace any existing (case-insensitive) value.
    pub fn set_header(&mut self, name: &str, value: impl Into<String>) {
        set_header(&mut self.headers, name, value.into());
    }
    pub fn remove_header(&mut self, name: &str) {
        self.headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
    }
}

pub fn set_header(headers: &mut Vec<(String, String)>, name: &str, value: String) {
    if let Some(pos) = headers.iter().position(|(k, _)| k.eq_ignore_ascii_case(name)) {
        headers[pos].1 = value;
        let mut i = pos + 1;
        while i < headers.len() {
            if headers[i].0.eq_ignore_ascii_case(name) {
                headers.remove(i);
            } else {
                i += 1;
            }
        }
    } else {
        headers.push((name.to_string(), value));
    }
}

/// Methods that carry no request body.
pub fn method_allows_body(method: &str) -> bool {
    !matches!(method.to_ascii_uppercase().as_str(), "GET" | "HEAD")
}

/// Final request URL: path params substituted, scheme added, query from the params table.
pub fn build_url(request: &ApiRequest) -> HttpResult<url::Url> {
    let raw = url_from_path_params(request.url.trim(), &request.path_params);
    if raw.trim().is_empty() {
        return Err(HttpError::EmptyUrl);
    }
    let raw = with_scheme(&raw);
    let (base, query) = split_url(&raw);
    let mut url = url::Url::parse(&base).map_err(|e| HttpError::InvalidUrl(format!("{base}: {e}")))?;
    let enabled: Vec<_> = request.params.iter().filter(|p| p.enabled && !p.key.is_empty()).collect();
    if enabled.is_empty() && request.params.is_empty() && !query.is_empty() {
        // no params table (e.g. imported raw URL) — keep the URL's own query
        url.set_query(Some(&query));
    } else if !enabled.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for p in enabled {
            pairs.append_pair(&p.key, &p.value);
        }
    }
    Ok(url)
}

/// Body bytes and implied content type.
pub fn build_body(request: &ApiRequest) -> HttpResult<(Option<Vec<u8>>, Option<String>)> {
    let b = &request.body;
    let implied = b.body_type.content_type().map(str::to_string);
    Ok(match b.body_type {
        BodyType::None => (None, None),
        BodyType::Json => (Some(strip_json_comments(&b.content).into_bytes()), implied),
        BodyType::Xml | BodyType::Html | BodyType::Text | BodyType::Raw | BodyType::JavaScript => {
            (Some(b.content.clone().into_bytes()), implied)
        }
        BodyType::GraphQl => {
            let vars_src = if b.graphql.variables.trim().is_empty() { "{}" } else { b.graphql.variables.as_str() };
            let variables: serde_json::Value = serde_json::from_str(&strip_json_comments(vars_src))
                .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
            let mut payload = serde_json::Map::new();
            payload.insert("query".into(), serde_json::Value::String(b.graphql.query.clone()));
            payload.insert("variables".into(), variables);
            if !b.graphql.operation_name.trim().is_empty() {
                payload.insert("operationName".into(), serde_json::Value::String(b.graphql.operation_name.trim().into()));
            }
            (Some(serde_json::to_vec(&payload).unwrap_or_default()), implied)
        }
        BodyType::FormUrlEncoded => {
            let mut ser = url::form_urlencoded::Serializer::new(String::new());
            for kv in b.form_url_encoded.iter().filter(|kv| kv.enabled && !kv.key.is_empty()) {
                ser.append_pair(&kv.key, &kv.value);
            }
            (Some(ser.finish().into_bytes()), implied)
        }
        BodyType::Multipart => {
            let (bytes, ct) = build_multipart(request)?;
            (Some(bytes), Some(ct))
        }
        BodyType::Binary => match &b.binary {
            None => (None, None),
            Some(bin) => {
                let bytes = read_file_or_base64(bin.file_path.as_deref(), &bin.base64)?;
                let ct = if bin.content_type.trim().is_empty() {
                    guess_mime(&bin.file_name).to_string()
                } else {
                    bin.content_type.clone()
                };
                (Some(bytes), Some(ct))
            }
        },
    })
}

fn read_file_or_base64(path: Option<&str>, b64: &str) -> HttpResult<Vec<u8>> {
    if let Some(p) = path.filter(|p| !p.trim().is_empty()) {
        return std::fs::read(p).map_err(|source| HttpError::File { path: p.to_string(), source });
    }
    Ok(base64::engine::general_purpose::STANDARD.decode(b64.trim()).unwrap_or_default())
}

fn quote(s: &str) -> String {
    s.replace('"', "%22").replace('\r', "%0D").replace('\n', "%0A")
}

fn build_multipart(request: &ApiRequest) -> HttpResult<(Vec<u8>, String)> {
    let boundary = format!("----ZorviloBoundary{:016x}", rand::random::<u64>());
    let mut out: Vec<u8> = Vec::new();
    for item in request.body.multipart.iter().filter(|i| i.enabled && !i.key.is_empty()) {
        match item.kind {
            FormKind::Text => {
                out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
                out.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", quote(&item.key)).as_bytes(),
                );
                out.extend_from_slice(item.value.as_bytes());
                out.extend_from_slice(b"\r\n");
            }
            FormKind::File => {
                for f in item.all_files() {
                    let has_path = f.file_path.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
                    if !has_path && f.file_base64.is_empty() {
                        continue; // imported placeholder without bytes
                    }
                    let bytes = read_file_or_base64(f.file_path.as_deref(), &f.file_base64)?;
                    let name = if f.file_name.is_empty() { "file".to_string() } else { f.file_name.clone() };
                    let ct = f.content_type.clone().filter(|c| !c.is_empty()).unwrap_or_else(|| guess_mime(&name).into());
                    out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
                    out.extend_from_slice(
                        format!(
                            "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {ct}\r\n\r\n",
                            quote(&item.key),
                            quote(file_base_name(&name))
                        )
                        .as_bytes(),
                    );
                    out.extend_from_slice(&bytes);
                    out.extend_from_slice(b"\r\n");
                }
            }
        }
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((out, format!("multipart/form-data; boundary={boundary}")))
}

fn file_base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Best-effort MIME type from a file extension.
pub fn guess_mime(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "js" => "application/javascript",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        _ => "application/octet-stream",
    }
}

/// Build the wire-level request from an already variable-resolved request.
/// Authentication is applied separately by [`crate::auth::apply_auth`].
pub fn build_spec(request: &ApiRequest, settings: &AppSettings) -> HttpResult<HttpRequestSpec> {
    let method = if request.method.trim().is_empty() { "GET".to_string() } else { request.method.trim().to_uppercase() };
    if !method.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(HttpError::InvalidMethod(method));
    }
    let url = build_url(request)?;

    let mut headers: Vec<(String, String)> = Vec::new();
    for h in settings.default_headers.iter().filter(|h| h.enabled && !h.key.is_empty()) {
        set_header(&mut headers, h.key.trim(), h.value.clone());
    }
    for h in request.headers.iter().filter(|h| h.enabled && !h.key.is_empty()) {
        set_header(&mut headers, h.key.trim(), h.value.clone());
    }
    let cookies: Vec<String> = request
        .cookies
        .iter()
        .filter(|c| c.enabled && !c.key.is_empty())
        .map(|c| format!("{}={}", c.key, c.value))
        .collect();
    if !cookies.is_empty() {
        set_header(&mut headers, "Cookie", cookies.join("; "));
    }

    let mut body = None;
    if method_allows_body(&method) {
        let (bytes, implied) = build_body(request)?;
        if let Some(ct) = implied {
            let user_ct = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-type")).map(|(_, v)| v.clone());
            match user_ct {
                None => set_header(&mut headers, "Content-Type", ct),
                // a multipart content type without our boundary would break the body
                Some(u) if request.body.body_type == BodyType::Multipart && !u.contains("boundary=") => {
                    set_header(&mut headers, "Content-Type", ct)
                }
                Some(_) => {}
            }
        }
        body = bytes;
    }

    Ok(HttpRequestSpec {
        method,
        url,
        headers,
        body,
        options: SendOptions::from_settings(settings, &request.settings),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zorvilo_core::{FormDataItem, KeyValue};

    fn req(url: &str) -> ApiRequest {
        ApiRequest { url: url.into(), ..Default::default() }
    }

    #[test]
    fn url_uses_params_table_and_path_params() {
        let mut r = req("api.test/users/:id?ignored=1");
        r.path_params = vec![KeyValue::new("id", "42")];
        r.params = vec![KeyValue::new("q", "a b"), KeyValue { enabled: false, ..KeyValue::new("off", "1") }];
        let u = build_url(&r).unwrap();
        assert_eq!(u.as_str(), "https://api.test/users/42?q=a+b");
    }

    #[test]
    fn raw_query_kept_without_params_table() {
        let u = build_url(&req("http://x.io/a?b=1")).unwrap();
        assert_eq!(u.as_str(), "http://x.io/a?b=1");
    }

    #[test]
    fn json_body_sets_content_type_and_strips_comments() {
        let mut r = req("http://x.io");
        r.method = "POST".into();
        r.body.body_type = BodyType::Json;
        r.body.content = "{ // c\n \"a\": 1, }".into();
        let s = build_spec(&r, &AppSettings::default()).unwrap();
        assert_eq!(s.header("content-type"), Some("application/json"));
        let v: serde_json::Value = serde_json::from_slice(s.body.as_ref().unwrap()).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn get_has_no_body() {
        let mut r = req("http://x.io");
        r.body.body_type = BodyType::Json;
        r.body.content = "{}".into();
        assert!(build_spec(&r, &AppSettings::default()).unwrap().body.is_none());
    }

    #[test]
    fn multipart_text_parts() {
        let mut r = req("http://x.io");
        r.method = "POST".into();
        r.body.body_type = BodyType::Multipart;
        r.body.multipart = vec![FormDataItem { key: "a".into(), value: "1".into(), ..Default::default() }];
        let s = build_spec(&r, &AppSettings::default()).unwrap();
        let ct = s.header("content-type").unwrap().to_string();
        assert!(ct.starts_with("multipart/form-data; boundary="));
        let body = String::from_utf8(s.body.unwrap()).unwrap();
        assert!(body.contains("name=\"a\"\r\n\r\n1\r\n"));
        assert!(body.trim_end().ends_with("--"));
    }

    #[test]
    fn graphql_payload() {
        let mut r = req("http://x.io/graphql");
        r.method = "POST".into();
        r.body.body_type = BodyType::GraphQl;
        r.body.graphql.query = "{ me { id } }".into();
        r.body.graphql.variables = "{\"a\":1,}".into();
        r.body.graphql.operation_name = "Me".into();
        let s = build_spec(&r, &AppSettings::default()).unwrap();
        let v: serde_json::Value = serde_json::from_slice(s.body.as_ref().unwrap()).unwrap();
        assert_eq!(v["variables"]["a"], 1);
        assert_eq!(v["operationName"], "Me");
    }

    #[test]
    fn headers_set_semantics_and_cookies() {
        let mut settings = AppSettings::default();
        settings.default_headers = vec![KeyValue::new("X-A", "default")];
        let mut r = req("http://x.io");
        r.headers = vec![KeyValue::new("x-a", "req")];
        r.cookies = vec![KeyValue::new("s", "1"), KeyValue::new("t", "2")];
        let s = build_spec(&r, &settings).unwrap();
        assert_eq!(s.header("X-A"), Some("req"));
        assert_eq!(s.headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("x-a")).count(), 1);
        assert_eq!(s.header("cookie"), Some("s=1; t=2"));
    }

    #[test]
    fn tls_verification_defaults_on() {
        let r = req("http://x.io");
        assert!(build_spec(&r, &AppSettings::default()).unwrap().options.verify_tls);
    }
}
