//! Postman Collection v2.0 / v2.1 and environment import/export
//! (a port of the legacy importer/exporter with the same semantics).

use serde_json::{json, Map, Value};
use zorvilo_core::path_params::path_params_from_url;
use zorvilo_core::url_utils::{split_url, url_from_params};
use zorvilo_core::{
    AddTo, ApiRequest, AuthConfig, AuthType, BinaryBody, BodyConfig, BodyType, Collection, Environment, Folder,
    FormDataFile, FormDataItem, FormKind, KeyValue, Protocol, Variable, HTTP_METHODS,
};

use crate::{ImportError, ImportResult};

pub const SCHEMA_V21: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

#[derive(Debug, Clone, Default)]
pub struct CollectionImport {
    pub collection: Collection,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub warnings: Vec<String>,
}

fn as_array(v: Option<&Value>) -> Vec<&Value> {
    match v {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.iter().collect(),
        Some(other) => vec![other],
    }
}

fn s(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn to_key_values(items: Option<&Value>) -> Vec<KeyValue> {
    as_array(items)
        .into_iter()
        .filter(|i| i.is_object())
        .map(|i| KeyValue {
            key: s(i.get("key")),
            value: s(i.get("value")),
            enabled: i.get("disabled").and_then(Value::as_bool) != Some(true),
            description: description_text(i.get("description")),
            ..Default::default()
        })
        .collect()
}

fn to_variables(items: Option<&Value>) -> Vec<Variable> {
    as_array(items)
        .into_iter()
        .filter(|i| i.is_object())
        .map(|i| Variable {
            key: if i.get("key").is_some() { s(i.get("key")) } else { s(i.get("id")) },
            value: s(i.get("value")),
            enabled: i.get("disabled").and_then(Value::as_bool) != Some(true) && i.get("enabled").and_then(Value::as_bool) != Some(false),
            secret: i.get("type").and_then(Value::as_str) == Some("secret"),
            ..Default::default()
        })
        .collect()
}

/// v2.1 encodes auth params as `[{key, value}]`; v2.0 as plain objects.
fn auth_params(raw: Option<&Value>) -> Map<String, Value> {
    let mut out = Map::new();
    match raw {
        Some(Value::Array(a)) => {
            for p in a {
                if let Some(k) = p.get("key").and_then(Value::as_str) {
                    out.insert(k.to_string(), Value::String(s(p.get("value"))));
                }
            }
        }
        Some(Value::Object(o)) => {
            for (k, v) in o {
                out.insert(k.clone(), Value::String(s(Some(v))));
            }
        }
        _ => {}
    }
    out
}

fn to_auth(raw: Option<&Value>) -> AuthConfig {
    let mut auth = AuthConfig::of(AuthType::None);
    let Some(raw) = raw.filter(|r| r.is_object()) else { return auth };
    let kind = raw.get("type").and_then(Value::as_str).unwrap_or("");
    let p = auth_params(raw.get(kind));
    let g = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match kind {
        "apikey" => {
            auth.auth_type = AuthType::ApiKey;
            auth.api_key.key = g("key");
            auth.api_key.value = g("value");
            auth.api_key.add_to = if g("in") == "query" { AddTo::Query } else { AddTo::Header };
        }
        "bearer" => {
            auth.auth_type = AuthType::Bearer;
            auth.bearer.token = g("token");
        }
        "basic" => {
            auth.auth_type = AuthType::Basic;
            auth.basic.username = g("username");
            auth.basic.password = g("password");
        }
        "digest" => {
            auth.auth_type = AuthType::Digest;
            auth.digest.username = g("username");
            auth.digest.password = g("password");
        }
        "oauth2" => {
            auth.auth_type = AuthType::OAuth2;
            auth.oauth2.access_token = g("accessToken");
            auth.oauth2.auth_url = g("authUrl");
            auth.oauth2.token_url = g("accessTokenUrl");
            auth.oauth2.client_id = g("clientId");
            auth.oauth2.client_secret = g("clientSecret");
            auth.oauth2.scope = g("scope");
        }
        "jwt" => {
            auth.auth_type = AuthType::Jwt;
            auth.jwt.secret = g("secret");
            let payload = g("payload");
            auth.jwt.payload = if payload.is_empty() { "{}".into() } else { payload };
            let alg = g("algorithm");
            if !alg.is_empty() {
                auth.jwt.algorithm = alg;
            }
        }
        "awsv4" => {
            auth.auth_type = AuthType::Aws;
            auth.aws.access_key = g("accessKey");
            auth.aws.secret_key = g("secretKey");
            auth.aws.session_token = g("sessionToken");
            let region = g("region");
            auth.aws.region = if region.is_empty() { "us-east-1".into() } else { region };
            auth.aws.service = g("service");
        }
        "inherit" => auth.auth_type = AuthType::Inherit,
        _ => {}
    }
    auth
}

fn url_parts(raw: Option<&Value>) -> (String, Vec<KeyValue>, Vec<KeyValue>) {
    match raw {
        Some(Value::String(u)) => (u.clone(), Vec::new(), Vec::new()),
        Some(obj @ Value::Object(_)) => {
            let params = to_key_values(obj.get("query"));
            let path_params = to_key_values(obj.get("variable"));
            if let Some(r) = obj.get("raw").and_then(Value::as_str).filter(|r| !r.is_empty()) {
                return (split_url(r).0, params, path_params);
            }
            let protocol = obj.get("protocol").and_then(Value::as_str).map(|p| format!("{p}://")).unwrap_or_default();
            let host = as_array(obj.get("host")).iter().map(|h| s(Some(h))).collect::<Vec<_>>().join(".");
            let port = obj.get("port").map(|p| format!(":{}", s(Some(p)))).unwrap_or_default();
            let path = as_array(obj.get("path")).iter().map(|p| s(Some(p))).collect::<Vec<_>>().join("/");
            let path = if path.is_empty() { String::new() } else { format!("/{path}") };
            (format!("{protocol}{host}{port}{path}"), params, path_params)
        }
        _ => (String::new(), Vec::new(), Vec::new()),
    }
}

fn looks_like_json(t: &str) -> bool {
    let t = t.trim();
    (t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']'))
}

fn to_body(raw: Option<&Value>) -> BodyConfig {
    let mut body = BodyConfig::default();
    let Some(raw) = raw.filter(|r| r.is_object()) else { return body };
    match raw.get("mode").and_then(Value::as_str).unwrap_or("") {
        "raw" => {
            let language = raw.pointer("/options/raw/language").and_then(Value::as_str).unwrap_or("");
            body.content = s(raw.get("raw"));
            body.body_type = match language {
                "json" => BodyType::Json,
                "xml" => BodyType::Xml,
                "html" => BodyType::Html,
                "text" => BodyType::Text,
                "javascript" => BodyType::JavaScript,
                _ if looks_like_json(&body.content) => BodyType::Json,
                _ => BodyType::Raw,
            };
        }
        "urlencoded" => {
            body.body_type = BodyType::FormUrlEncoded;
            body.form_url_encoded = to_key_values(raw.get("urlencoded"));
        }
        "formdata" => {
            body.body_type = BodyType::Multipart;
            body.multipart = as_array(raw.get("formdata"))
                .into_iter()
                .map(|f| {
                    let kind = if f.get("type").and_then(Value::as_str) == Some("file") { FormKind::File } else { FormKind::Text };
                    let srcs: Vec<String> = match f.get("src") {
                        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
                        Some(Value::String(x)) => vec![x.clone()],
                        _ => Vec::new(),
                    };
                    FormDataItem {
                        key: s(f.get("key")),
                        value: s(f.get("value")),
                        enabled: f.get("disabled").and_then(Value::as_bool) != Some(true),
                        kind,
                        // Postman exports carry a path, not bytes: keep it as a native file reference
                        files: (kind == FormKind::File).then(|| {
                            srcs.iter()
                                .map(|p| FormDataFile { file_name: p.clone(), file_path: (!p.is_empty()).then(|| p.clone()), ..Default::default() })
                                .collect()
                        }),
                        ..Default::default()
                    }
                })
                .collect();
        }
        "graphql" => {
            body.body_type = BodyType::GraphQl;
            body.graphql.query = s(raw.pointer("/graphql/query"));
            let vars = raw.pointer("/graphql/variables");
            body.graphql.variables = match vars {
                Some(Value::String(v)) => v.clone(),
                Some(Value::Null) | None => "{}".into(),
                Some(other) => serde_json::to_string_pretty(other).unwrap_or_else(|_| "{}".into()),
            };
        }
        "file" => {
            body.body_type = BodyType::Binary;
            let src = s(raw.pointer("/file/src"));
            body.binary = Some(BinaryBody { file_name: src.clone(), file_path: (!src.is_empty()).then_some(src), ..Default::default() });
        }
        _ => {}
    }
    body
}

fn description_text(raw: Option<&Value>) -> String {
    match raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o.get("content").and_then(Value::as_str).unwrap_or("").to_string(),
        _ => String::new(),
    }
}

fn events(item: &Value) -> (String, String) {
    let (mut pre, mut test) = (String::new(), String::new());
    for ev in as_array(item.get("event")) {
        let exec = ev.pointer("/script/exec");
        let script = match exec {
            Some(Value::String(s)) => s.clone(),
            _ => as_array(exec).iter().map(|l| s(Some(l))).collect::<Vec<_>>().join("\n"),
        };
        match ev.get("listen").and_then(Value::as_str) {
            Some("prerequest") => pre = script,
            Some("test") => test = script,
            _ => {}
        }
    }
    (pre, test)
}

pub fn import_collection(json: &Value, workspace_id: &str) -> ImportResult<CollectionImport> {
    if json.pointer("/info/name").is_none() && !json.get("item").map(Value::is_array).unwrap_or(false) {
        return Err(ImportError::Invalid("not a valid Postman collection (missing info/item)".into()));
    }
    let (col_pre, col_test) = events(json);
    let collection = Collection {
        workspace_id: workspace_id.to_string(),
        name: json.pointer("/info/name").and_then(Value::as_str).unwrap_or("Imported Collection").to_string(),
        description: description_text(json.pointer("/info/description")),
        variables: to_variables(json.get("variable")),
        auth: to_auth(json.get("auth")),
        pre_request_script: col_pre,
        test_script: col_test,
        ..Default::default()
    };
    let mut out = CollectionImport { collection, ..Default::default() };
    let mut order = 0.0;
    walk(&as_array(json.get("item")), None, workspace_id, &mut out, &mut order, 0);
    Ok(out)
}

fn walk(items: &[&Value], parent: Option<String>, ws: &str, out: &mut CollectionImport, order: &mut f64, depth: usize) {
    if depth > 64 {
        out.warnings.push("folder nesting deeper than 64 levels was truncated".into());
        return;
    }
    for item in items {
        if !item.is_object() {
            continue;
        }
        if item.get("item").map(Value::is_array).unwrap_or(false) {
            let (pre, test) = events(item);
            let folder = Folder {
                workspace_id: ws.to_string(),
                collection_id: out.collection.id.clone(),
                parent_id: parent.clone(),
                name: item.get("name").and_then(Value::as_str).unwrap_or("Folder").to_string(),
                description: description_text(item.get("description")),
                auth: item.get("auth").map(|a| to_auth(Some(a))).unwrap_or_else(AuthConfig::inherit),
                pre_request_script: pre,
                test_script: test,
                sort_order: *order,
                ..Default::default()
            };
            *order += 1.0;
            let id = folder.id.clone();
            out.folders.push(folder);
            walk(&as_array(item.get("item")), Some(id), ws, out, order, depth + 1);
        } else if let Some(req) = item.get("request") {
            let (url, params, path_vals) = url_parts(if req.is_string() { Some(req) } else { req.get("url") });
            let (pre, test) = events(item);
            let method_raw = req.get("method").and_then(Value::as_str).unwrap_or("GET").to_uppercase();
            let method = if HTTP_METHODS.contains(&method_raw.as_str()) || !method_raw.is_empty() { method_raw } else { "GET".into() };
            let body = to_body(req.get("body"));
            let protocol = if body.body_type == BodyType::GraphQl { Protocol::GraphQl } else { Protocol::Http };
            let name = item.get("name").and_then(Value::as_str).unwrap_or("Request").to_string();
            if body.body_type == BodyType::Multipart || body.body_type == BodyType::Binary {
                out.warnings.push(format!("“{name}”: file attachments reference local paths — re-select them if the files moved"));
            }
            out.requests.push(ApiRequest {
                workspace_id: ws.to_string(),
                collection_id: out.collection.id.clone(),
                folder_id: parent.clone(),
                name,
                description: description_text(req.get("description")),
                protocol,
                method,
                url: url_from_params(&url, &params),
                path_params: path_params_from_url(&url, &path_vals),
                params,
                headers: to_key_values(req.get("header")),
                // Postman semantics: no explicit auth → inherit from the parent
                auth: req.get("auth").map(|a| to_auth(Some(a))).unwrap_or_else(AuthConfig::inherit),
                body,
                pre_request_script: pre,
                test_script: test,
                sort_order: *order,
                ..Default::default()
            });
            *order += 1.0;
        }
    }
}

pub fn import_environment(json: &Value, workspace_id: &str) -> ImportResult<Environment> {
    if json.get("name").is_none() && !json.get("values").map(Value::is_array).unwrap_or(false) {
        return Err(ImportError::Invalid("not a valid Postman environment file".into()));
    }
    Ok(Environment {
        workspace_id: workspace_id.to_string(),
        name: json.get("name").and_then(Value::as_str).unwrap_or("Imported Environment").to_string(),
        variables: to_variables(json.get("values")),
        ..Default::default()
    })
}

// ---------------------------------------------------------------- export

fn kv_arr(pairs: &[(&str, &str)]) -> Value {
    Value::Array(pairs.iter().map(|(k, v)| json!({ "key": k, "value": v, "type": "string" })).collect())
}

pub fn export_auth(a: &AuthConfig) -> Option<Value> {
    Some(match a.auth_type {
        AuthType::ApiKey => json!({"type": "apikey", "apikey": kv_arr(&[("key", a.api_key.key.as_str()), ("value", a.api_key.value.as_str()), ("in", if a.api_key.add_to == AddTo::Query { "query" } else { "header" })])}),
        AuthType::Bearer => json!({"type": "bearer", "bearer": kv_arr(&[("token", a.bearer.token.as_str())])}),
        AuthType::Basic => json!({"type": "basic", "basic": kv_arr(&[("username", a.basic.username.as_str()), ("password", a.basic.password.as_str())])}),
        AuthType::Digest => json!({"type": "digest", "digest": kv_arr(&[("username", a.digest.username.as_str()), ("password", a.digest.password.as_str())])}),
        AuthType::OAuth2 => json!({"type": "oauth2", "oauth2": kv_arr(&[
            ("accessToken", a.oauth2.access_token.as_str()), ("authUrl", a.oauth2.auth_url.as_str()), ("accessTokenUrl", a.oauth2.token_url.as_str()),
            ("clientId", a.oauth2.client_id.as_str()), ("clientSecret", a.oauth2.client_secret.as_str()), ("scope", a.oauth2.scope.as_str())])}),
        AuthType::Jwt => json!({"type": "jwt", "jwt": kv_arr(&[("secret", a.jwt.secret.as_str()), ("payload", a.jwt.payload.as_str()), ("algorithm", a.jwt.algorithm.as_str())])}),
        AuthType::Aws => json!({"type": "awsv4", "awsv4": kv_arr(&[
            ("accessKey", a.aws.access_key.as_str()), ("secretKey", a.aws.secret_key.as_str()), ("sessionToken", a.aws.session_token.as_str()),
            ("region", a.aws.region.as_str()), ("service", a.aws.service.as_str())])}),
        AuthType::None => json!({"type": "noauth"}),
        AuthType::Inherit => return None,
    })
}

fn kv_export(items: &[KeyValue]) -> Vec<Value> {
    items
        .iter()
        .filter(|i| !i.key.is_empty())
        .map(|i| {
            let mut o = Map::new();
            o.insert("key".into(), json!(i.key));
            o.insert("value".into(), json!(i.value));
            if !i.enabled {
                o.insert("disabled".into(), json!(true));
            }
            if !i.description.is_empty() {
                o.insert("description".into(), json!(i.description));
            }
            Value::Object(o)
        })
        .collect()
}

fn export_body(r: &ApiRequest) -> Option<Value> {
    let b = &r.body;
    Some(match b.body_type {
        BodyType::None => return None,
        BodyType::Json | BodyType::Xml | BodyType::Html | BodyType::Text | BodyType::Raw | BodyType::JavaScript => {
            let lang = match b.body_type {
                BodyType::Json => "json",
                BodyType::Xml => "xml",
                BodyType::Html => "html",
                BodyType::JavaScript => "javascript",
                _ => "text",
            };
            json!({"mode": "raw", "raw": b.content, "options": {"raw": {"language": lang}}})
        }
        BodyType::GraphQl => json!({"mode": "graphql", "graphql": {"query": b.graphql.query, "variables": b.graphql.variables}}),
        BodyType::FormUrlEncoded => json!({"mode": "urlencoded", "urlencoded": kv_export(&b.form_url_encoded)}),
        BodyType::Multipart => {
            let mut parts = Vec::new();
            for i in &b.multipart {
                let off = !i.enabled;
                let mut push = |mut o: Map<String, Value>| {
                    if off {
                        o.insert("disabled".into(), json!(true));
                    }
                    parts.push(Value::Object(o));
                };
                if i.kind == FormKind::Text {
                    push(json!({"key": i.key, "value": i.value, "type": "text"}).as_object().cloned().unwrap_or_default());
                } else {
                    let files = i.all_files();
                    if files.is_empty() {
                        push(json!({"key": i.key, "type": "file", "src": ""}).as_object().cloned().unwrap_or_default());
                    }
                    for f in files {
                        let src = f.file_path.clone().unwrap_or(f.file_name.clone());
                        push(json!({"key": i.key, "type": "file", "src": src}).as_object().cloned().unwrap_or_default());
                    }
                }
            }
            json!({"mode": "formdata", "formdata": parts})
        }
        BodyType::Binary => {
            let src = b.binary.as_ref().map(|x| x.file_path.clone().unwrap_or(x.file_name.clone())).unwrap_or_default();
            json!({"mode": "file", "file": {"src": src}})
        }
    })
}

/// Postman rebuilds the URL from structured fields; `raw` must agree exactly.
fn export_url(r: &ApiRequest) -> Value {
    let base = split_url(&r.url).0.trim().to_string();
    let path_params = path_params_from_url(&r.url, &r.path_params);
    let query = kv_export(&r.params.iter().filter(|p| !p.key.is_empty() || !p.value.is_empty()).cloned().collect::<Vec<_>>());
    let (protocol, after) = match base.find("://") {
        Some(i) if base[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) => {
            (Some(base[..i].to_lowercase()), base[i + 3..].to_string())
        }
        _ => (None, base.clone()),
    };
    let (authority, pathname) = match after.find('/') {
        Some(i) => (after[..i].to_string(), after[i + 1..].to_string()),
        None => (after.clone(), String::new()),
    };
    let (host, port) = match authority.rfind(':') {
        Some(i) if !authority[i + 1..].is_empty() && authority[i + 1..].chars().all(|c| c.is_ascii_digit()) => {
            (authority[..i].to_string(), Some(authority[i + 1..].to_string()))
        }
        _ => (authority.clone(), None),
    };
    let qs: Vec<String> = r.params.iter().filter(|p| p.enabled && !p.key.is_empty()).map(|p| format!("{}={}", p.key, p.value)).collect();
    let raw = if qs.is_empty() { base.clone() } else { format!("{base}?{}", qs.join("&")) };
    let mut o = Map::new();
    o.insert("raw".into(), json!(raw));
    if let Some(p) = protocol {
        o.insert("protocol".into(), json!(p));
    }
    let host_parts: Vec<String> = if host.contains("{{") { vec![host.clone()] } else { host.split('.').filter(|s| !s.is_empty()).map(str::to_string).collect() };
    o.insert("host".into(), json!(host_parts));
    if let Some(p) = port {
        o.insert("port".into(), json!(p));
    }
    if !pathname.is_empty() {
        o.insert("path".into(), json!(pathname.split('/').collect::<Vec<_>>()));
    }
    if !query.is_empty() {
        o.insert("query".into(), Value::Array(query));
    }
    if !path_params.is_empty() {
        o.insert("variable".into(), Value::Array(kv_export(&path_params)));
    }
    Value::Object(o)
}

fn export_headers(r: &ApiRequest) -> Vec<Value> {
    let mut headers = kv_export(&r.headers);
    let has_cookie = r.headers.iter().any(|h| h.enabled && h.key.eq_ignore_ascii_case("cookie"));
    let cookies: Vec<String> = r.cookies.iter().filter(|c| c.enabled && !c.key.is_empty()).map(|c| format!("{}={}", c.key, c.value)).collect();
    if !cookies.is_empty() && !has_cookie {
        headers.push(json!({"key": "Cookie", "value": cookies.join("; ")}));
    }
    headers
}

fn export_events(pre: &str, test: &str) -> Option<Value> {
    let mut ev = Vec::new();
    if !pre.trim().is_empty() {
        ev.push(json!({"listen": "prerequest", "script": {"type": "text/javascript", "exec": pre.split('\n').collect::<Vec<_>>()}}));
    }
    if !test.trim().is_empty() {
        ev.push(json!({"listen": "test", "script": {"type": "text/javascript", "exec": test.split('\n').collect::<Vec<_>>()}}));
    }
    (!ev.is_empty()).then_some(Value::Array(ev))
}

fn export_request_item(r: &ApiRequest) -> Value {
    let mut req = Map::new();
    req.insert("method".into(), json!(r.method));
    if !r.description.is_empty() {
        req.insert("description".into(), json!(r.description));
    }
    req.insert("header".into(), Value::Array(export_headers(r)));
    req.insert("url".into(), export_url(r));
    if let Some(a) = export_auth(&r.auth) {
        req.insert("auth".into(), a);
    }
    if let Some(b) = export_body(r) {
        req.insert("body".into(), b);
    }
    let mut item = Map::new();
    item.insert("name".into(), json!(r.name));
    if let Some(e) = export_events(&r.pre_request_script, &r.test_script) {
        item.insert("event".into(), e);
    }
    item.insert("request".into(), Value::Object(req));
    Value::Object(item)
}

pub fn export_variables(vars: &[Variable], include_secrets: bool) -> Vec<Value> {
    vars.iter()
        .filter(|v| !v.key.is_empty())
        .map(|v| {
            let value = if v.secret && !include_secrets { String::new() } else { v.value.clone() };
            let mut o = json!({"key": v.key, "value": value, "type": if v.secret { "secret" } else { "string" }});
            if !v.enabled {
                o["disabled"] = json!(true);
            }
            o
        })
        .collect()
}

/// Export a collection as Postman Collection v2.1. Secret variable values are
/// omitted unless `include_secrets` is set.
pub fn export_collection(c: &Collection, folders: &[Folder], requests: &[ApiRequest], include_secrets: bool) -> Value {
    fn children(
        parent: Option<&str>,
        folders: &[Folder],
        requests: &[ApiRequest],
        depth: usize,
    ) -> Vec<Value> {
        let mut fs: Vec<&Folder> = folders.iter().filter(|f| f.parent_id.as_deref() == parent).collect();
        fs.sort_by(|a, b| a.sort_order.total_cmp(&b.sort_order));
        let mut rs: Vec<&ApiRequest> = requests.iter().filter(|r| r.folder_id.as_deref() == parent).collect();
        rs.sort_by(|a, b| a.sort_order.total_cmp(&b.sort_order));
        let mut out = Vec::new();
        if depth < 64 {
            for f in fs {
                let mut o = Map::new();
                o.insert("name".into(), json!(f.name));
                if !f.description.is_empty() {
                    o.insert("description".into(), json!(f.description));
                }
                if let Some(a) = export_auth(&f.auth) {
                    o.insert("auth".into(), a);
                }
                if let Some(e) = export_events(&f.pre_request_script, &f.test_script) {
                    o.insert("event".into(), e);
                }
                o.insert("item".into(), Value::Array(children(Some(&f.id), folders, requests, depth + 1)));
                out.push(Value::Object(o));
            }
        }
        out.extend(rs.into_iter().map(export_request_item));
        out
    }
    let mut info = Map::new();
    info.insert("_postman_id".into(), json!(c.id));
    info.insert("name".into(), json!(c.name));
    if !c.description.is_empty() {
        info.insert("description".into(), json!(c.description));
    }
    info.insert("schema".into(), json!(SCHEMA_V21));
    let mut root = Map::new();
    root.insert("info".into(), Value::Object(info));
    if let Some(a) = export_auth(&c.auth) {
        root.insert("auth".into(), a);
    }
    if let Some(e) = export_events(&c.pre_request_script, &c.test_script) {
        root.insert("event".into(), e);
    }
    root.insert("item".into(), Value::Array(children(None, folders, requests, 0)));
    let vars = export_variables(&c.variables, include_secrets);
    if !vars.is_empty() {
        root.insert("variable".into(), Value::Array(vars));
    }
    Value::Object(root)
}

pub fn export_environment(env: &Environment, include_secrets: bool) -> Value {
    json!({
        "id": env.id,
        "name": env.name,
        "values": env.variables.iter().map(|v| json!({
            "key": v.key,
            "value": if v.secret && !include_secrets { String::new() } else { v.value.clone() },
            "enabled": v.enabled,
            "type": if v.secret { "secret" } else { "default" },
        })).collect::<Vec<_>>(),
        "_postman_variable_scope": "environment",
        "_postman_exported_using": "zorvilo",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "info": {"name": "Demo", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
      "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}"}]},
      "variable": [{"key": "base", "value": "https://api.test"}, {"key": "pw", "value": "x", "type": "secret"}],
      "item": [
        {"name": "Users", "item": [
          {"name": "Get user", "event": [{"listen": "test", "script": {"exec": ["pm.test('ok', function(){", "});"]}}],
           "request": {"method": "GET", "header": [{"key": "Accept", "value": "application/json"}],
             "url": {"raw": "{{base}}/users/:id?verbose=1", "host": ["{{base}}"], "path": ["users", ":id"],
                     "query": [{"key": "verbose", "value": "1"}], "variable": [{"key": "id", "value": "7"}]}}}
        ]},
        {"name": "Create", "request": {"method": "POST", "url": "https://api.test/items",
          "auth": {"type": "basic", "basic": {"username": "u", "password": "p"}},
          "body": {"mode": "raw", "raw": "{\"a\":1}", "options": {"raw": {"language": "json"}}}}}
      ]
    }"#;

    #[test]
    fn import_postman_v21() {
        let json: Value = serde_json::from_str(SAMPLE).unwrap();
        let r = import_collection(&json, "ws").unwrap();
        assert_eq!(r.collection.name, "Demo");
        assert_eq!(r.collection.auth.auth_type, AuthType::Bearer);
        assert_eq!(r.collection.variables.len(), 2);
        assert!(r.collection.variables[1].secret);
        assert_eq!(r.folders.len(), 1);
        assert_eq!(r.requests.len(), 2);
        let get = &r.requests[0];
        assert_eq!(get.folder_id.as_deref(), Some(r.folders[0].id.as_str()));
        assert_eq!(get.url, "{{base}}/users/:id?verbose=1");
        assert_eq!(get.path_params[0].value, "7");
        assert_eq!(get.auth.auth_type, AuthType::Inherit);
        assert!(get.test_script.contains("pm.test"));
        // v2.0 style object auth params
        assert_eq!(r.requests[1].auth.basic.password, "p");
        assert_eq!(r.requests[1].body.body_type, BodyType::Json);
    }

    #[test]
    fn export_round_trip() {
        let json: Value = serde_json::from_str(SAMPLE).unwrap();
        let r = import_collection(&json, "ws").unwrap();
        let out = export_collection(&r.collection, &r.folders, &r.requests, false);
        assert_eq!(out["info"]["schema"], SCHEMA_V21);
        // secrets are not exported by default
        assert_eq!(out["variable"][1]["value"], "");
        let again = import_collection(&out, "ws").unwrap();
        assert_eq!(again.requests.len(), 2);
        assert_eq!(again.requests[0].url, "{{base}}/users/:id?verbose=1");
        assert_eq!(again.requests[0].path_params[0].value, "7");
        assert_eq!(again.requests[1].body.content, "{\"a\":1}");
    }

    #[test]
    fn environments() {
        let json: Value = serde_json::from_str(r#"{"name":"Dev","values":[{"key":"a","value":"1","enabled":true},{"key":"s","value":"x","type":"secret"}]}"#).unwrap();
        let env = import_environment(&json, "ws").unwrap();
        assert_eq!(env.variables.len(), 2);
        let out = export_environment(&env, false);
        assert_eq!(out["values"][1]["value"], "");
    }
}
