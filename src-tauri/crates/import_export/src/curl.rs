//! cURL command import — supports the flags emitted by Postman / browser
//! "copy as cURL": -X, -H, -d/--data*, -F, -u, -b, -L, -k, -I, -G,
//! --max-time, --digest, -A, -e, --url, --compressed.

use zorvilo_core::path_params::path_params_from_url;
use zorvilo_core::url_utils::{split_url, url_from_params};
use zorvilo_core::{ApiRequest, AuthConfig, AuthType, BodyType, FormDataFile, FormDataItem, FormKind, KeyValue, RequestSettings};

pub fn is_curl_command(text: &str) -> bool {
    let t = text.trim_start();
    t.len() > 5 && t[..4].eq_ignore_ascii_case("curl") && t[4..].starts_with(char::is_whitespace)
}

/// Split a shell command into tokens, honouring quotes, escapes and line continuations.
pub fn tokenize(command: &str) -> Vec<String> {
    // join continuations: backslash (sh), backtick (PowerShell), caret (cmd)
    let mut joined = String::with_capacity(command.len());
    let chars: Vec<char> = command.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if matches!(c, '\\' | '`' | '^') {
            let mut j = i + 1;
            if j < chars.len() && chars[j] == '\r' {
                j += 1;
            }
            if j < chars.len() && chars[j] == '\n' {
                joined.push(' ');
                i = j + 1;
                while i < chars.len() && (chars[i] == ' ' || chars[i] == '\t') {
                    i += 1;
                }
                continue;
            }
        }
        joined.push(c);
        i += 1;
    }

    let chars: Vec<char> = joined.chars().collect();
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                } else {
                    cur.push(ch);
                }
            }
            Some(_) => {
                if ch == '"' {
                    quote = None;
                } else if ch == '\\' && i + 1 < chars.len() && "\\\"$`".contains(chars[i + 1]) {
                    i += 1;
                    cur.push(chars[i]);
                } else {
                    cur.push(ch);
                }
            }
            None => {
                if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                    has = true;
                } else if ch == '$' && i + 1 < chars.len() && chars[i + 1] == '\'' {
                    // bash ANSI-C quoting $'...' — treat like single quotes with \n escapes
                    i += 2;
                    while i < chars.len() && chars[i] != '\'' {
                        if chars[i] == '\\' && i + 1 < chars.len() {
                            i += 1;
                            cur.push(match chars[i] {
                                'n' => '\n',
                                't' => '\t',
                                'r' => '\r',
                                other => other,
                            });
                        } else {
                            cur.push(chars[i]);
                        }
                        i += 1;
                    }
                    has = true;
                } else if ch == '\\' && i + 1 < chars.len() {
                    i += 1;
                    cur.push(chars[i]);
                    has = true;
                } else if ch.is_whitespace() {
                    if has || !cur.is_empty() {
                        tokens.push(std::mem::take(&mut cur));
                        has = false;
                    }
                } else {
                    cur.push(ch);
                    has = true;
                }
            }
        }
        i += 1;
    }
    if has || !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

fn looks_like_json(t: &str) -> bool {
    let t = t.trim();
    (t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']'))
}

fn looks_like_form(t: &str) -> bool {
    let t = t.trim();
    !t.is_empty()
        && t.split('&').all(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            it.next().is_some() && !k.is_empty() && !k.contains(char::is_whitespace)
        })
}

fn form_pairs(s: &str) -> Vec<KeyValue> {
    url::form_urlencoded::parse(s.as_bytes()).map(|(k, v)| KeyValue::new(k.into_owned(), v.into_owned())).collect()
}

#[derive(Debug, Clone)]
pub struct ParsedCurl {
    pub request: ApiRequest,
    pub suggested_name: String,
}

/// Parse a cURL command into a request. Returns None when it isn't one.
pub fn parse_curl(command: &str) -> Option<ParsedCurl> {
    if !is_curl_command(command) {
        return None;
    }
    let tokens: Vec<String> = tokenize(command.trim()).into_iter().skip(1).collect();
    let mut url = String::new();
    let mut method: Option<String> = None;
    let mut headers: Vec<KeyValue> = Vec::new();
    let mut cookies: Vec<KeyValue> = Vec::new();
    let mut data: Vec<String> = Vec::new();
    let mut form: Vec<(String, String)> = Vec::new();
    let mut user = String::new();
    let (mut digest, mut follow, mut verify, mut get) = (false, true, true, false);
    let mut timeout_ms = 0u64;

    let push_cookies = |raw: &str, cookies: &mut Vec<KeyValue>| {
        for pair in raw.split(';') {
            if let Some(eq) = pair.find('=') {
                if eq > 0 {
                    cookies.push(KeyValue::new(pair[..eq].trim(), pair[eq + 1..].trim()));
                }
            }
        }
    };

    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].as_str();
        let next = |i: &mut usize| -> String {
            *i += 1;
            tokens.get(*i).cloned().unwrap_or_default()
        };
        match t {
            "-X" | "--request" => method = Some(next(&mut i).to_uppercase()),
            "-H" | "--header" => {
                let raw = next(&mut i);
                if let Some(idx) = raw.find(':') {
                    if idx > 0 {
                        let key = raw[..idx].trim().to_string();
                        let value = raw[idx + 1..].trim().to_string();
                        if key.eq_ignore_ascii_case("cookie") {
                            push_cookies(&value, &mut cookies);
                        } else {
                            headers.push(KeyValue::new(key, value));
                        }
                    }
                }
            }
            "-b" | "--cookie" => {
                let raw = next(&mut i);
                push_cookies(&raw, &mut cookies);
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" | "--data-urlencode" => {
                let v = next(&mut i);
                data.push(v.strip_prefix('$').map(str::to_string).unwrap_or(v));
            }
            "--json" => {
                data.push(next(&mut i));
                headers.push(KeyValue::new("Content-Type", "application/json"));
            }
            "-F" | "--form" | "--form-string" => {
                let raw = next(&mut i);
                if let Some(eq) = raw.find('=') {
                    if eq > 0 {
                        form.push((raw[..eq].to_string(), raw[eq + 1..].to_string()));
                    }
                }
            }
            "-u" | "--user" => user = next(&mut i),
            "--digest" => digest = true,
            "-A" | "--user-agent" => {
                let v = next(&mut i);
                headers.push(KeyValue::new("User-Agent", v));
            }
            "-e" | "--referer" => {
                let v = next(&mut i);
                headers.push(KeyValue::new("Referer", v));
            }
            "--url" => url = next(&mut i),
            "-L" | "--location" => follow = true,
            "-k" | "--insecure" => verify = false,
            "-I" | "--head" => method = Some("HEAD".into()),
            "-G" | "--get" => get = true,
            "--max-time" | "-m" => {
                let v = next(&mut i);
                timeout_ms = (v.parse::<f64>().unwrap_or(0.0) * 1000.0).round() as u64;
            }
            "-o" | "--output" | "--connect-timeout" | "--retry" | "-w" | "--write-out" | "--proxy" | "-x" | "--cacert" | "--cert" | "--key" => {
                next(&mut i); // flags with an argument we don't map
            }
            _ => {
                if !t.starts_with('-') && url.is_empty() {
                    url = t.to_string();
                }
            }
        }
        i += 1;
    }
    if url.is_empty() {
        return None;
    }

    // query string → params table
    let (base, query) = split_url(&url);
    let mut params: Vec<KeyValue> = if query.is_empty() { Vec::new() } else { form_pairs(&query) };
    if get && !data.is_empty() {
        for part in data.drain(..) {
            params.extend(form_pairs(&part));
        }
    }

    let mut req = ApiRequest { auth: AuthConfig::of(AuthType::None), ..Default::default() };
    if !form.is_empty() {
        req.body.body_type = BodyType::Multipart;
        req.body.multipart = form
            .into_iter()
            .map(|(k, v)| match v.strip_prefix('@') {
                Some(path) => {
                    let path = path.split(';').next().unwrap_or(path).to_string();
                    FormDataItem {
                        key: k,
                        kind: FormKind::File,
                        files: Some(vec![FormDataFile {
                            file_name: path.rsplit(['/', '\\']).next().unwrap_or(&path).to_string(),
                            file_path: Some(path.clone()),
                            ..Default::default()
                        }]),
                        ..Default::default()
                    }
                }
                None => FormDataItem { key: k, value: v, ..Default::default() },
            })
            .collect();
    } else if !data.is_empty() {
        let body = data.join("&");
        let ct = headers.iter().find(|h| h.key.eq_ignore_ascii_case("content-type")).map(|h| h.value.to_lowercase());
        match ct.as_deref() {
            Some(c) if c.contains("json") => {
                req.body.body_type = BodyType::Json;
                req.body.content = body;
            }
            Some(c) if c.contains("x-www-form-urlencoded") => {
                req.body.body_type = BodyType::FormUrlEncoded;
                req.body.form_url_encoded = form_pairs(&body);
            }
            None if looks_like_json(&body) => {
                req.body.body_type = BodyType::Json;
                req.body.content = body;
            }
            None if looks_like_form(&body) => {
                req.body.body_type = BodyType::FormUrlEncoded;
                req.body.form_url_encoded = form_pairs(&body);
            }
            Some(c) if c.contains("xml") => {
                req.body.body_type = BodyType::Xml;
                req.body.content = body;
            }
            _ => {
                req.body.body_type = BodyType::Raw;
                req.body.content = body;
            }
        }
    }
    if !user.is_empty() {
        let (u, p) = match user.find(':') {
            Some(i) => (user[..i].to_string(), user[i + 1..].to_string()),
            None => (user.clone(), String::new()),
        };
        if digest {
            req.auth.auth_type = AuthType::Digest;
            req.auth.digest.username = u;
            req.auth.digest.password = p;
        } else {
            req.auth.auth_type = AuthType::Basic;
            req.auth.basic.username = u;
            req.auth.basic.password = p;
        }
    }
    let has_body = req.body.body_type != BodyType::None;
    req.method = method.unwrap_or_else(|| if get || !has_body { "GET".into() } else { "POST".into() });
    req.url = url_from_params(&base, &params);
    req.path_params = path_params_from_url(&base, &[]);
    req.params = params;
    req.headers = headers;
    req.cookies = cookies;
    req.settings = RequestSettings { timeout_ms, follow_redirects: follow, max_redirects: 10, verify_ssl: verify };

    let suggested_name = url::Url::parse(&zorvilo_core::url_utils::with_scheme(&base))
        .ok()
        .and_then(|u| u.host_str().map(|h| format!("{h}{}", if u.path() == "/" { "" } else { u.path() })))
        .unwrap_or_else(|| base.clone());
    req.name = suggested_name.clone();
    Some(ParsedCurl { request: req, suggested_name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chrome_style_post() {
        let cmd = r#"curl 'https://api.test/v1/items?x=1' \
  -H 'content-type: application/json' \
  -H 'Cookie: a=1; b=2' \
  --data-raw '{"name":"it'\''s"}' \
  --compressed"#;
        let p = parse_curl(cmd).unwrap();
        let r = p.request;
        assert_eq!(r.method, "POST");
        assert_eq!(r.url, "https://api.test/v1/items?x=1");
        assert_eq!(r.params.len(), 1);
        assert_eq!(r.cookies.len(), 2);
        assert_eq!(r.body.body_type, BodyType::Json);
        assert_eq!(r.body.content, r#"{"name":"it's"}"#);
        assert_eq!(p.suggested_name, "api.test/v1/items");
    }

    #[test]
    fn get_with_data_and_basic_auth() {
        let r = parse_curl("curl -G https://a.io/s -d q=hello -d n=2 -u user:pw -k").unwrap().request;
        assert_eq!(r.method, "GET");
        assert_eq!(r.url, "https://a.io/s?q=hello&n=2");
        assert_eq!(r.auth.auth_type, AuthType::Basic);
        assert!(!r.settings.verify_ssl);
    }

    #[test]
    fn multipart_files_and_digest() {
        let r = parse_curl(r#"curl -X PUT "https://a.io/up" -F "file=@/tmp/a.png" -F "k=v" --digest -u u:p"#).unwrap().request;
        assert_eq!(r.method, "PUT");
        assert_eq!(r.body.multipart.len(), 2);
        assert_eq!(r.body.multipart[0].kind, FormKind::File);
        assert_eq!(r.auth.auth_type, AuthType::Digest);
    }

    #[test]
    fn not_curl() {
        assert!(parse_curl("wget x").is_none());
        assert!(parse_curl("curl").is_none());
    }
}
