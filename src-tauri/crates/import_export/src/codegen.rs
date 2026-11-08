//! "Copy as …" code generation. Callers pass a request whose variables are
//! already resolved and whose auth is the effective (inherited) auth.

use zorvilo_core::{ApiRequest, AppSettings, AuthType, BodyType, FormKind};
use zorvilo_http::auth::apply_auth;
use zorvilo_http::build::build_spec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeFormat {
    Curl,
    Fetch,
    Python,
    PowerShell,
}

impl CodeFormat {
    pub const ALL: [CodeFormat; 4] = [CodeFormat::Curl, CodeFormat::Fetch, CodeFormat::Python, CodeFormat::PowerShell];
    pub fn label(self) -> &'static str {
        match self {
            CodeFormat::Curl => "cURL",
            CodeFormat::Fetch => "JavaScript (fetch)",
            CodeFormat::Python => "Python (requests)",
            CodeFormat::PowerShell => "PowerShell",
        }
    }
}

struct Parts {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    multipart: Option<Vec<(String, String, bool)>>,
    binary_file: Option<String>,
    digest: Option<(String, String)>,
}

fn parts(request: &ApiRequest, settings: &AppSettings) -> Result<Parts, String> {
    let mut spec = build_spec(request, settings).map_err(|e| e.to_string())?;
    let digest = (request.auth.auth_type == AuthType::Digest)
        .then(|| (request.auth.digest.username.clone(), request.auth.digest.password.clone()));
    if digest.is_none() {
        apply_auth(&mut spec, &request.auth).map_err(|e| e.to_string())?;
    }
    let mut body = None;
    let mut multipart = None;
    let mut binary_file = None;
    match request.body.body_type {
        BodyType::Multipart => {
            spec.remove_header("content-type");
            multipart = Some(
                request
                    .body
                    .multipart
                    .iter()
                    .filter(|i| i.enabled && !i.key.is_empty())
                    .flat_map(|i| match i.kind {
                        FormKind::Text => vec![(i.key.clone(), i.value.clone(), false)],
                        FormKind::File => {
                            let files = i.all_files();
                            if files.is_empty() {
                                vec![(i.key.clone(), "file".to_string(), true)]
                            } else {
                                files.into_iter().map(|f| (i.key.clone(), f.file_path.unwrap_or(f.file_name), true)).collect()
                            }
                        }
                    })
                    .collect(),
            );
        }
        BodyType::Binary => {
            binary_file = Some(
                request.body.binary.as_ref().map(|b| b.file_path.clone().unwrap_or(b.file_name.clone())).unwrap_or_else(|| "file.bin".into()),
            );
        }
        _ => {
            body = spec.body.as_ref().map(|b| String::from_utf8_lossy(b).into_owned()).filter(|b| !b.is_empty());
        }
    }
    Ok(Parts { method: spec.method, url: spec.url.to_string(), headers: spec.headers, body, multipart, binary_file, digest })
}

fn sh(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
fn js(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}
fn ps(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub fn generate(format: CodeFormat, request: &ApiRequest, settings: &AppSettings) -> Result<String, String> {
    let p = parts(request, settings)?;
    Ok(match format {
        CodeFormat::Curl => {
            let mut lines = vec![format!("curl -X {} {}", p.method, sh(&p.url))];
            if let Some((u, pw)) = &p.digest {
                lines.push(format!("--digest -u {}", sh(&format!("{u}:{pw}"))));
            }
            for (k, v) in &p.headers {
                lines.push(format!("-H {}", sh(&format!("{k}: {v}"))));
            }
            if let Some(m) = &p.multipart {
                for (k, v, file) in m {
                    lines.push(format!("-F {}", sh(&if *file { format!("{k}=@{v}") } else { format!("{k}={v}") })));
                }
            } else if let Some(f) = &p.binary_file {
                lines.push(format!("--data-binary @{}", sh(f)));
            } else if let Some(b) = &p.body {
                lines.push(format!("--data-raw {}", sh(b)));
            }
            lines.join(" \\\n  ")
        }
        CodeFormat::Fetch => {
            let headers: Vec<String> = p.headers.iter().map(|(k, v)| format!("    {}: {},", js(k), js(v))).collect();
            let mut pre = String::new();
            let body = if let Some(m) = &p.multipart {
                pre.push_str("const formData = new FormData();\n");
                for (k, v, file) in m {
                    if *file {
                        pre.push_str(&format!("formData.append({}, fileInput.files[0]); // {}\n", js(k), v));
                    } else {
                        pre.push_str(&format!("formData.append({}, {});\n", js(k), js(v)));
                    }
                }
                Some("formData".to_string())
            } else if let Some(f) = &p.binary_file {
                Some(format!("/* Blob or File for {f} */ null"))
            } else {
                p.body.as_deref().map(js)
            };
            let digest_note = if p.digest.is_some() { "// Digest auth is not supported by fetch — answer the 401 challenge manually\n" } else { "" };
            format!(
                "{digest_note}{pre}const response = await fetch({}, {{\n  method: {},\n  headers: {{\n{}\n  }},{}\n}});\nconsole.log(await response.text());",
                js(&p.url),
                js(&p.method),
                headers.join("\n"),
                body.map(|b| format!("\n  body: {b},")).unwrap_or_default()
            )
        }
        CodeFormat::Python => {
            let headers: Vec<String> = p.headers.iter().map(|(k, v)| format!("    {}: {},", js(k), js(v))).collect();
            let mut files_part = String::new();
            let mut data_arg = String::new();
            if let Some(m) = &p.multipart {
                let items: Vec<String> = m
                    .iter()
                    .map(|(k, v, file)| if *file { format!("    {}: open({}, \"rb\"),", js(k), js(v)) } else { format!("    {}: (None, {}),", js(k), js(v)) })
                    .collect();
                files_part = format!("files = {{\n{}\n}}\n", items.join("\n"));
                data_arg = ", files=files".into();
            } else if let Some(f) = &p.binary_file {
                data_arg = format!(", data=open({}, \"rb\")", js(f));
            } else if let Some(b) = &p.body {
                data_arg = format!(", data={}", js(b));
            }
            let (auth, import) = match &p.digest {
                Some((u, pw)) => (format!(", auth=HTTPDigestAuth({}, {})", js(u), js(pw)), "from requests.auth import HTTPDigestAuth\n"),
                None => (String::new(), ""),
            };
            format!(
                "import requests\n{import}\n{files_part}headers = {{\n{}\n}}\n\nresponse = requests.request({}, {}, headers=headers{data_arg}{auth})\nprint(response.text)",
                headers.join("\n"),
                js(&p.method),
                js(&p.url)
            )
        }
        CodeFormat::PowerShell => {
            let headers: Vec<String> = p.headers.iter().map(|(k, v)| format!("  {} = {}", ps(k), ps(v))).collect();
            let body_arg = if let Some(f) = &p.binary_file {
                format!(" -InFile {}", ps(f))
            } else if p.multipart.is_none() {
                p.body.as_deref().map(|b| format!(" -Body {}", ps(b))).unwrap_or_default()
            } else {
                String::new()
            };
            format!(
                "$headers = @{{\n{}\n}}\n\nInvoke-RestMethod -Method {} -Uri {} -Headers $headers{body_arg}",
                headers.join("\n"),
                p.method,
                ps(&p.url)
            )
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zorvilo_core::KeyValue;

    #[test]
    fn curl_round_trips_through_parser() {
        let mut r = ApiRequest { url: "https://api.test/items".into(), method: "POST".into(), ..Default::default() };
        r.auth.auth_type = AuthType::None;
        r.headers = vec![KeyValue::new("X-A", "it's")];
        r.body.body_type = BodyType::Json;
        r.body.content = r#"{"a":1}"#.into();
        let out = generate(CodeFormat::Curl, &r, &AppSettings::default()).unwrap();
        let parsed = crate::curl::parse_curl(&out).unwrap().request;
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.headers.iter().find(|h| h.key == "X-A").unwrap().value, "it's");
        assert_eq!(parsed.body.content, r#"{"a":1}"#);
    }

    #[test]
    fn all_formats_render() {
        let r = ApiRequest { url: "https://api.test".into(), ..Default::default() };
        for f in CodeFormat::ALL {
            assert!(!generate(f, &r, &AppSettings::default()).unwrap().is_empty());
        }
    }
}
