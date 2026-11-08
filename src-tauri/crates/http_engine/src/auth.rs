//! Authentication: API key, Bearer, Basic, Digest, JWT, OAuth 2.0 token
//! attachment and AWS Signature Version 4.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use hmac::{Hmac, Mac};
use md5::Md5;
use sha2::{Digest, Sha256, Sha384, Sha512};
use zorvilo_core::{AddTo, AuthConfig, AuthType, AwsAuth, JwtAuth};

use crate::build::HttpRequestSpec;
use crate::error::{HttpError, HttpResult};

/// Apply auth to headers / query before sending. Digest is answered later,
/// in response to the server's 401 challenge.
pub fn apply_auth(spec: &mut HttpRequestSpec, auth: &AuthConfig) -> HttpResult<()> {
    match auth.auth_type {
        AuthType::ApiKey => {
            let k = auth.api_key.key.trim();
            if k.is_empty() {
                return Ok(());
            }
            match auth.api_key.add_to {
                AddTo::Header => spec.set_header(k, auth.api_key.value.clone()),
                AddTo::Query => {
                    spec.url.query_pairs_mut().append_pair(k, &auth.api_key.value);
                }
            }
        }
        AuthType::Bearer => {
            let prefix = if auth.bearer.prefix.trim().is_empty() { "Bearer" } else { auth.bearer.prefix.trim() };
            spec.set_header("Authorization", format!("{prefix} {}", auth.bearer.token).trim().to_string());
        }
        AuthType::Basic => {
            spec.set_header("Authorization", basic_header(&auth.basic.username, &auth.basic.password));
        }
        AuthType::Jwt => {
            let token = sign_jwt(&auth.jwt, chrono::Utc::now().timestamp())?;
            match auth.jwt.add_to {
                AddTo::Header => {
                    let prefix = if auth.jwt.header_prefix.trim().is_empty() { "Bearer" } else { auth.jwt.header_prefix.trim() };
                    spec.set_header("Authorization", format!("{prefix} {token}"));
                }
                AddTo::Query => {
                    let name = if auth.jwt.query_param.trim().is_empty() { "token" } else { auth.jwt.query_param.trim() };
                    spec.url.query_pairs_mut().append_pair(name, &token);
                }
            }
        }
        AuthType::OAuth2 => {
            if !auth.oauth2.access_token.trim().is_empty() {
                let prefix = if auth.oauth2.header_prefix.trim().is_empty() { "Bearer" } else { auth.oauth2.header_prefix.trim() };
                spec.set_header("Authorization", format!("{prefix} {}", auth.oauth2.access_token.trim()));
            }
        }
        AuthType::Aws => sign_aws_v4(spec, &auth.aws, chrono::Utc::now())?,
        AuthType::Digest | AuthType::None | AuthType::Inherit => {}
    }
    Ok(())
}

pub fn basic_header(user: &str, pass: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("{user}:{pass}")))
}

// ---------------------------------------------------------------- JWT

fn hmac_sign(alg: &str, key: &[u8], data: &[u8]) -> HttpResult<Vec<u8>> {
    let bad = |_| HttpError::Auth("invalid HMAC key".into());
    Ok(match alg {
        "HS256" => {
            let mut m = Hmac::<Sha256>::new_from_slice(key).map_err(bad)?;
            m.update(data);
            m.finalize().into_bytes().to_vec()
        }
        "HS384" => {
            let mut m = Hmac::<Sha384>::new_from_slice(key).map_err(bad)?;
            m.update(data);
            m.finalize().into_bytes().to_vec()
        }
        "HS512" => {
            let mut m = Hmac::<Sha512>::new_from_slice(key).map_err(bad)?;
            m.update(data);
            m.finalize().into_bytes().to_vec()
        }
        other => return Err(HttpError::Auth(format!("unsupported JWT algorithm {other} (HS256/HS384/HS512 are supported)"))),
    })
}

/// Sign a JWT with an HMAC algorithm. `now` is Unix seconds.
pub fn sign_jwt(cfg: &JwtAuth, now: i64) -> HttpResult<String> {
    let alg = if cfg.algorithm.trim().is_empty() { "HS256".to_string() } else { cfg.algorithm.trim().to_uppercase() };
    let payload_src = if cfg.payload.trim().is_empty() { "{}" } else { cfg.payload.as_str() };
    let mut payload: serde_json::Value = serde_json::from_str(&zorvilo_core::jsonc::strip_json_comments(payload_src))
        .map_err(|e| HttpError::Auth(format!("JWT payload is not valid JSON: {e}")))?;
    if let Some(obj) = payload.as_object_mut() {
        if cfg.auto_iat {
            obj.insert("iat".into(), now.into());
        }
        if cfg.expires_in_secs > 0 {
            obj.insert("exp".into(), (now + cfg.expires_in_secs as i64).into());
        }
    }
    let header = serde_json::json!({ "alg": alg, "typ": "JWT" });
    let data = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap_or_default()),
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap_or_default())
    );
    let key = if cfg.secret_base64 {
        STANDARD
            .decode(cfg.secret.trim())
            .map_err(|e| HttpError::Auth(format!("JWT secret is not valid base64: {e}")))?
    } else {
        cfg.secret.as_bytes().to_vec()
    };
    let sig = hmac_sign(&alg, &key, data.as_bytes())?;
    Ok(format!("{data}.{}", URL_SAFE_NO_PAD.encode(sig)))
}

// ---------------------------------------------------------------- Digest

/// Parse a `WWW-Authenticate: Digest …` challenge.
pub fn parse_digest_challenge(header: &str) -> Option<Vec<(String, String)>> {
    let h = header.trim();
    if h.len() < 7 || !h[..7].eq_ignore_ascii_case("digest ") {
        return None;
    }
    let rest = &h[7..];
    let mut out = Vec::new();
    let chars: Vec<char> = rest.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && (chars[i] == ',' || chars[i].is_whitespace()) {
            i += 1;
        }
        let ks = i;
        while i < chars.len() && chars[i] != '=' && chars[i] != ',' {
            i += 1;
        }
        let key: String = chars[ks..i].iter().collect::<String>().trim().to_lowercase();
        if i >= chars.len() || chars[i] != '=' {
            continue;
        }
        i += 1;
        let value = if i < chars.len() && chars[i] == '"' {
            i += 1;
            let mut v = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 1;
                }
                v.push(chars[i]);
                i += 1;
            }
            i += 1;
            v
        } else {
            let vs = i;
            while i < chars.len() && chars[i] != ',' {
                i += 1;
            }
            chars[vs..i].iter().collect::<String>().trim().to_string()
        };
        if !key.is_empty() {
            out.push((key, value));
        }
    }
    Some(out)
}

fn get<'a>(c: &'a [(String, String)], k: &str) -> Option<&'a str> {
    c.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
}

fn digest_hash(alg: &str, data: &str) -> String {
    if alg.starts_with("SHA-256") {
        hex::encode(Sha256::digest(data.as_bytes()))
    } else {
        hex::encode(Md5::digest(data.as_bytes()))
    }
}

/// Build the Authorization header answering a Digest challenge (RFC 7616; MD5 and SHA-256).
pub fn digest_authorization(
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
    challenge: &[(String, String)],
    nc: u32,
    cnonce: &str,
) -> String {
    let realm = get(challenge, "realm").unwrap_or("");
    let nonce = get(challenge, "nonce").unwrap_or("");
    let opaque = get(challenge, "opaque");
    let alg = get(challenge, "algorithm").unwrap_or("MD5").to_uppercase();
    let qop = get(challenge, "qop")
        .map(|q| q.split(',').map(|s| s.trim().to_string()).any(|s| s == "auth"))
        .unwrap_or(false);

    let mut ha1 = digest_hash(&alg, &format!("{username}:{realm}:{password}"));
    if alg.ends_with("-SESS") {
        ha1 = digest_hash(&alg, &format!("{ha1}:{nonce}:{cnonce}"));
    }
    let ha2 = digest_hash(&alg, &format!("{method}:{uri}"));
    let nc_s = format!("{nc:08x}");
    let (response, extra) = if qop {
        (
            digest_hash(&alg, &format!("{ha1}:{nonce}:{nc_s}:{cnonce}:auth:{ha2}")),
            format!(", qop=auth, nc={nc_s}, cnonce=\"{cnonce}\""),
        )
    } else {
        (digest_hash(&alg, &format!("{ha1}:{nonce}:{ha2}")), String::new())
    };
    let mut out = format!(
        "Digest username=\"{username}\", realm=\"{realm}\", nonce=\"{nonce}\", uri=\"{uri}\", response=\"{response}\"{extra}"
    );
    if let Some(o) = opaque {
        out.push_str(&format!(", opaque=\"{o}\""));
    }
    out.push_str(&format!(", algorithm={}", get(challenge, "algorithm").unwrap_or("MD5")));
    out
}

pub fn random_cnonce() -> String {
    hex::encode(rand::random::<[u8; 8]>())
}

// ---------------------------------------------------------------- AWS SigV4

const AWS_UNRESERVED: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

fn aws_encode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, AWS_UNRESERVED).to_string()
}

fn hmac256(key: &[u8], data: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    m.update(data.as_bytes());
    m.finalize().into_bytes().to_vec()
}

/// Sign the request in place with AWS Signature Version 4.
pub fn sign_aws_v4(spec: &mut HttpRequestSpec, aws: &AwsAuth, now: chrono::DateTime<chrono::Utc>) -> HttpResult<()> {
    if aws.access_key.trim().is_empty() || aws.secret_key.trim().is_empty() {
        return Err(HttpError::Auth("AWS access key and secret key are required".into()));
    }
    let region = if aws.region.trim().is_empty() { "us-east-1" } else { aws.region.trim() };
    let service = if aws.service.trim().is_empty() { "execute-api" } else { aws.service.trim() };
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let payload_hash = hex::encode(Sha256::digest(spec.body.as_deref().unwrap_or(&[])));

    let host = match (spec.url.host_str(), spec.url.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_string(),
        _ => return Err(HttpError::Auth("URL has no host".into())),
    };
    spec.set_header("host", host);
    spec.set_header("x-amz-date", amz_date.clone());
    if service == "s3" {
        spec.set_header("x-amz-content-sha256", payload_hash.clone());
    }
    if !aws.session_token.trim().is_empty() {
        spec.set_header("x-amz-security-token", aws.session_token.trim().to_string());
    }

    // canonical URI: S3 encodes once, every other service twice
    let path = if spec.url.path().is_empty() { "/" } else { spec.url.path() };
    let canonical_uri = if service == "s3" {
        path.to_string()
    } else {
        path.split('/').map(aws_encode).collect::<Vec<_>>().join("/")
    };

    let mut query: Vec<(String, String)> =
        spec.url.query_pairs().map(|(k, v)| (aws_encode(&k), aws_encode(&v))).collect();
    query.sort();
    let canonical_query = query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");

    let mut signed: Vec<(String, String)> = spec
        .headers
        .iter()
        .filter(|(k, _)| {
            let k = k.to_ascii_lowercase();
            k == "host" || k == "content-type" || k.starts_with("x-amz-")
        })
        .map(|(k, v)| (k.to_ascii_lowercase(), v.split_whitespace().collect::<Vec<_>>().join(" ")))
        .collect();
    signed.sort();
    let canonical_headers: String = signed.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed_headers = signed.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");

    let canonical_request = format!(
        "{}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
        spec.method.to_uppercase()
    );
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let k_date = hmac256(format!("AWS4{}", aws.secret_key.trim()).as_bytes(), &date);
    let k_region = hmac256(&k_date, region);
    let k_service = hmac256(&k_region, service);
    let k_signing = hmac256(&k_service, "aws4_request");
    let signature = hex::encode(hmac256(&k_signing, &string_to_sign));
    spec.set_header(
        "Authorization",
        format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
            aws.access_key.trim()
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::SendOptions;

    #[test]
    fn jwt_hs256_matches_reference_vector() {
        let cfg = JwtAuth {
            secret: "your-256-bit-secret".into(),
            payload: r#"{"sub":"1234567890","name":"John Doe","iat":1516239022}"#.into(),
            ..Default::default()
        };
        let token = sign_jwt(&cfg, 0).unwrap();
        assert_eq!(
            token,
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        );
    }

    #[test]
    fn jwt_auto_claims() {
        let cfg = JwtAuth { secret: "s".into(), payload: "{}".into(), auto_iat: true, expires_in_secs: 60, ..Default::default() };
        let token = sign_jwt(&cfg, 1000).unwrap();
        let payload = token.split('.').nth(1).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        assert_eq!(v["iat"], 1000);
        assert_eq!(v["exp"], 1060);
    }

    #[test]
    fn digest_rfc2617_example() {
        let challenge = parse_digest_challenge(
            r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#,
        )
        .unwrap();
        let h = digest_authorization("Mufasa", "Circle Of Life", "GET", "/dir/index.html", &challenge, 1, "0a4f113b");
        assert!(h.contains("response=\"6629fae49393a05397450978507c4ef1\""), "{h}");
        assert!(h.contains("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\""));
    }

    #[test]
    fn aws_sigv4_get_vanilla() {
        // AWS SigV4 test suite: get-vanilla
        let mut spec = HttpRequestSpec {
            method: "GET".into(),
            url: url::Url::parse("https://example.amazonaws.com/").unwrap(),
            headers: vec![],
            body: None,
            options: SendOptions::default(),
        };
        let aws = AwsAuth {
            access_key: "AKIDEXAMPLE".into(),
            secret_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            session_token: String::new(),
            region: "us-east-1".into(),
            service: "service".into(),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2015-08-30T12:36:00Z").unwrap().with_timezone(&chrono::Utc);
        sign_aws_v4(&mut spec, &aws, now).unwrap();
        let auth = spec.header("authorization").unwrap();
        assert_eq!(
            auth,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    #[test]
    fn basic_and_bearer() {
        let mut spec = HttpRequestSpec {
            method: "GET".into(),
            url: url::Url::parse("https://x.io/").unwrap(),
            headers: vec![],
            body: None,
            options: SendOptions::default(),
        };
        let mut a = AuthConfig::of(AuthType::Basic);
        a.basic.username = "Aladdin".into();
        a.basic.password = "open sesame".into();
        apply_auth(&mut spec, &a).unwrap();
        assert_eq!(spec.header("authorization"), Some("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="));
        let mut b = AuthConfig::of(AuthType::ApiKey);
        b.api_key.key = "k".into();
        b.api_key.value = "v".into();
        b.api_key.add_to = AddTo::Query;
        apply_auth(&mut spec, &b).unwrap();
        assert_eq!(spec.url.query(), Some("k=v"));
    }
}
