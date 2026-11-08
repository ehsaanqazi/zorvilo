//! OAuth 2.0 token acquisition.
//!
//! * Client Credentials and Password grants: direct token-endpoint POST.
//! * Authorization Code (+ PKCE): opens the system browser and receives the
//!   redirect on a loopback listener (RFC 8252), then exchanges the code.
//! * Refresh: exchanges a refresh token.
//!
//! The implicit grant is deprecated (OAuth 2.0 Security BCP) and cannot be
//! completed natively because the token arrives in the URL fragment, which a
//! loopback server never sees; it is reported as unsupported.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use zorvilo_core::{ClientAuthMethod, OAuth2Auth, OAuth2Grant};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TokenResponse {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

impl TokenResponse {
    /// Absolute expiry in ms since epoch (0 = unknown).
    pub fn expires_at_ms(&self) -> i64 {
        self.expires_in.map(|s| zorvilo_core::ids::now_ms() + s * 1000).unwrap_or(0)
    }
}

fn http_client(verify_tls: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(!verify_tls)
        .build()
        .map_err(|e| e.to_string())
}

async fn token_request(cfg: &OAuth2Auth, mut form: Vec<(&str, String)>, verify_tls: bool) -> Result<TokenResponse, String> {
    if cfg.token_url.trim().is_empty() {
        return Err("Token URL is required".into());
    }
    let client = http_client(verify_tls)?;
    if !cfg.scope.trim().is_empty() {
        form.push(("scope", cfg.scope.trim().to_string()));
    }
    if !cfg.audience.trim().is_empty() {
        form.push(("audience", cfg.audience.trim().to_string()));
    }
    let mut rb = client.post(cfg.token_url.trim()).header("Accept", "application/json");
    match cfg.client_auth {
        ClientAuthMethod::Header if !cfg.client_secret.is_empty() => {
            rb = rb.basic_auth(cfg.client_id.trim(), Some(cfg.client_secret.clone()));
        }
        _ => {
            form.push(("client_id", cfg.client_id.trim().to_string()));
            if !cfg.client_secret.is_empty() {
                form.push(("client_secret", cfg.client_secret.clone()));
            }
        }
    }
    let body = {
        let mut ser = url::form_urlencoded::Serializer::new(String::new());
        for (k, v) in &form {
            ser.append_pair(k, v);
        }
        ser.finish()
    };
    let resp = rb
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: TokenResponse = serde_json::from_str(&text).unwrap_or_else(|_| {
        // some providers answer form-encoded
        let mut t = TokenResponse::default();
        for (k, v) in url::form_urlencoded::parse(text.as_bytes()) {
            match k.as_ref() {
                "access_token" => t.access_token = v.into_owned(),
                "refresh_token" => t.refresh_token = Some(v.into_owned()),
                "token_type" => t.token_type = Some(v.into_owned()),
                "expires_in" => t.expires_in = v.parse().ok(),
                "error" => t.error = Some(v.into_owned()),
                _ => {}
            }
        }
        t
    });
    if let Some(err) = &parsed.error {
        return Err(format!("{err}: {}", parsed.error_description.clone().unwrap_or_default()));
    }
    if !status.is_success() || parsed.access_token.is_empty() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("token endpoint returned {status}: {snippet}"));
    }
    Ok(parsed)
}

pub async fn client_credentials(cfg: &OAuth2Auth, verify_tls: bool) -> Result<TokenResponse, String> {
    token_request(cfg, vec![("grant_type", "client_credentials".into())], verify_tls).await
}

pub async fn password_grant(cfg: &OAuth2Auth, verify_tls: bool) -> Result<TokenResponse, String> {
    token_request(
        cfg,
        vec![
            ("grant_type", "password".into()),
            ("username", cfg.username.clone()),
            ("password", cfg.password.clone()),
        ],
        verify_tls,
    )
    .await
}

pub async fn refresh(cfg: &OAuth2Auth, verify_tls: bool) -> Result<TokenResponse, String> {
    if cfg.refresh_token.trim().is_empty() {
        return Err("no refresh token available".into());
    }
    token_request(cfg, vec![("grant_type", "refresh_token".into()), ("refresh_token", cfg.refresh_token.trim().into())], verify_tls).await
}

/// PKCE verifier (43–128 unreserved chars) and S256 challenge.
pub fn pkce_pair() -> (String, String) {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    let verifier: String = (0..64).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

const DONE_PAGE: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nZorvilo received the authorization response. You can close this tab and return to the app.";

/// Run the authorization-code flow in the system browser.
pub async fn authorization_code(cfg: &OAuth2Auth, verify_tls: bool, cancel: CancellationToken) -> Result<TokenResponse, String> {
    if cfg.grant_type == OAuth2Grant::Implicit {
        return Err("The implicit grant is not supported natively (deprecated by the OAuth 2.0 Security BCP). Use Authorization Code with PKCE.".into());
    }
    if cfg.auth_url.trim().is_empty() {
        return Err("Authorization URL is required".into());
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", cfg.callback_port))
        .await
        .map_err(|e| format!("could not open loopback callback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let state: String = hex::encode(rand::random::<[u8; 16]>());
    let (verifier, challenge) = pkce_pair();

    let mut auth_url = url::Url::parse(cfg.auth_url.trim()).map_err(|e| format!("invalid authorization URL: {e}"))?;
    {
        let mut q = auth_url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", cfg.client_id.trim());
        q.append_pair("redirect_uri", &redirect_uri);
        q.append_pair("state", &state);
        if !cfg.scope.trim().is_empty() {
            q.append_pair("scope", cfg.scope.trim());
        }
        if !cfg.audience.trim().is_empty() {
            q.append_pair("audience", cfg.audience.trim());
        }
        if cfg.use_pkce {
            q.append_pair("code_challenge", &challenge);
            q.append_pair("code_challenge_method", "S256");
        }
    }
    webbrowser::open(auth_url.as_str()).map_err(|e| format!("could not open the system browser: {e}"))?;

    let wait = async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/").to_string();
            let _ = stream.write_all(DONE_PAGE.as_bytes()).await;
            let _ = stream.shutdown().await;
            if !path.starts_with("/callback") {
                continue; // favicon etc.
            }
            let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
            let mut code = None;
            let mut got_state = None;
            let mut error = None;
            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "code" => code = Some(v.into_owned()),
                    "state" => got_state = Some(v.into_owned()),
                    "error" => error = Some(v.into_owned()),
                    "error_description" => {
                        error = Some(format!("{} ({v})", error.clone().unwrap_or_default()));
                    }
                    _ => {}
                }
            }
            if let Some(e) = error {
                return Err(format!("authorization failed: {e}"));
            }
            if got_state.as_deref() != Some(state.as_str()) {
                return Err("authorization response state mismatch (possible CSRF) — aborted".into());
            }
            return code.ok_or_else(|| "authorization response had no code".to_string());
        }
    };
    let code = tokio::select! {
        _ = cancel.cancelled() => return Err("authorization cancelled".into()),
        _ = tokio::time::sleep(Duration::from_secs(300)) => return Err("timed out waiting for the browser authorization (5 min)".into()),
        r = wait => r?,
    };

    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];
    if cfg.use_pkce {
        form.push(("code_verifier", verifier));
    }
    token_request(cfg, form, verify_tls).await
}

/// Obtain a token for whichever grant the config selects.
pub async fn obtain_token(cfg: &OAuth2Auth, verify_tls: bool, cancel: CancellationToken) -> Result<TokenResponse, String> {
    match cfg.grant_type {
        OAuth2Grant::ClientCredentials => client_credentials(cfg, verify_tls).await,
        OAuth2Grant::Password => password_grant(cfg, verify_tls).await,
        OAuth2Grant::AuthorizationCode | OAuth2Grant::Implicit => authorization_code(cfg, verify_tls, cancel).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_lengths() {
        let (v, c) = pkce_pair();
        assert_eq!(v.len(), 64);
        assert_eq!(c.len(), 43);
    }
}
