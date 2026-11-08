//! Variable engine: `{{name}}` templates, scope precedence and dynamic values.
//!
//! Precedence (highest wins) — preserved from the legacy application and
//! extended with folder scope:
//!
//! ```text
//! request > folder (nearest first) > collection > environment > global
//! ```
//!
//! Script-local values set with `pm.variables.set()` sit above `request` for
//! the duration of one execution.

use std::collections::HashMap;
use std::sync::LazyLock;

use rand::Rng;
use regex::Regex;

use crate::models::{ApiRequest, Variable};

static VAR_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*(\$?[\w.-]+)\s*\}\}").expect("valid regex"));

const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VariableScope {
    Local,
    Request,
    Folder,
    Collection,
    Environment,
    Global,
    Dynamic,
}

impl VariableScope {
    pub fn label(self) -> &'static str {
        match self {
            VariableScope::Local => "Local",
            VariableScope::Request => "Request",
            VariableScope::Folder => "Folder",
            VariableScope::Collection => "Collection",
            VariableScope::Environment => "Environment",
            VariableScope::Global => "Global",
            VariableScope::Dynamic => "Dynamic",
        }
    }
}

/// A resolved variable value plus where it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct VarInfo {
    pub value: String,
    pub scope: VariableScope,
    pub secret: bool,
}

/// Flattened name -> value lookup, built once per execution.
#[derive(Debug, Clone, Default)]
pub struct VariableMap {
    values: HashMap<String, VarInfo>,
}

impl VariableMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply a layer; later layers override earlier ones, so call from the
    /// lowest precedence (globals) to the highest (request/local).
    pub fn layer(&mut self, vars: &[Variable], scope: VariableScope) -> &mut Self {
        for v in vars {
            if v.enabled && !v.key.is_empty() {
                self.values.insert(v.key.clone(), VarInfo { value: v.value.clone(), scope, secret: v.secret });
            }
        }
        self
    }

    pub fn layer_pairs<'a>(
        &mut self,
        pairs: impl IntoIterator<Item = (&'a String, &'a String)>,
        scope: VariableScope,
    ) -> &mut Self {
        for (k, v) in pairs {
            self.values.insert(k.clone(), VarInfo { value: v.clone(), scope, secret: false });
        }
        self
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>, scope: VariableScope) {
        self.values.insert(key.into(), VarInfo { value: value.into(), scope, secret: false });
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(|v| v.value.as_str())
    }

    pub fn info(&self, key: &str) -> Option<VarInfo> {
        if let Some(v) = self.values.get(key) {
            return Some(v.clone());
        }
        if is_dynamic_variable(key) {
            return Some(VarInfo {
                value: format!("generated at send time, e.g. {}", dynamic_value(key).unwrap_or_default()),
                scope: VariableScope::Dynamic,
                secret: false,
            });
        }
        None
    }

    pub fn contains(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// All names with info, sorted by name (for autocomplete).
    pub fn entries(&self) -> Vec<(String, VarInfo)> {
        let mut out: Vec<_> = self.values.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    /// Secret values currently in scope (for log/history redaction).
    pub fn secret_values(&self) -> Vec<String> {
        self.values.values().filter(|v| v.secret && v.value.len() >= 4).map(|v| v.value.clone()).collect()
    }
}

/// Inputs for building a scoped variable map.
#[derive(Default)]
pub struct ScopeLayers<'a> {
    pub globals: &'a [Variable],
    pub environment: Option<&'a [Variable]>,
    pub collection: Option<&'a [Variable]>,
    /// folder chain ordered from the root folder down to the nearest folder
    pub folders: Vec<&'a [Variable]>,
    pub request: Option<&'a [Variable]>,
}

pub fn build_variable_map(layers: &ScopeLayers<'_>) -> VariableMap {
    let mut map = VariableMap::new();
    map.layer(layers.globals, VariableScope::Global);
    if let Some(env) = layers.environment {
        map.layer(env, VariableScope::Environment);
    }
    if let Some(col) = layers.collection {
        map.layer(col, VariableScope::Collection);
    }
    for folder in &layers.folders {
        map.layer(folder, VariableScope::Folder);
    }
    if let Some(req) = layers.request {
        map.layer(req, VariableScope::Request);
    }
    map
}

// ---------------------------------------------------------------- dynamic variables

pub const DYNAMIC_VARIABLES: &[&str] = &[
    "$uuid",
    "$guid",
    "$timestamp",
    "$isoTimestamp",
    "$isoDate",
    "$date",
    "$randomInt",
    "$randomBoolean",
    "$randomAlphaNumeric",
    "$randomString",
];

pub fn is_dynamic_variable(name: &str) -> bool {
    DYNAMIC_VARIABLES.contains(&name)
}

fn random_alnum(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

/// Fresh value for a dynamic variable.
pub fn dynamic_value(name: &str) -> Option<String> {
    let now = chrono::Utc::now();
    Some(match name {
        "$uuid" | "$guid" => uuid::Uuid::new_v4().to_string(),
        "$timestamp" => now.timestamp().to_string(),
        "$isoTimestamp" => now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "$isoDate" | "$date" => now.format("%Y-%m-%d").to_string(),
        "$randomInt" => rand::thread_rng().gen_range(0..=1000).to_string(),
        "$randomBoolean" => rand::thread_rng().gen_bool(0.5).to_string(),
        "$randomAlphaNumeric" => random_alnum(10),
        "$randomString" => random_alnum(16),
        _ => return None,
    })
}

// ---------------------------------------------------------------- templates

/// Replace `{{name}}` placeholders; nested references resolve up to a fixed depth.
pub fn resolve_template(text: &str, vars: &VariableMap) -> String {
    if !text.contains("{{") {
        return text.to_string();
    }
    let mut out = text.to_string();
    for _ in 0..MAX_DEPTH {
        let mut replaced = false;
        let next = VAR_PATTERN
            .replace_all(&out, |caps: &regex::Captures<'_>| {
                let name = &caps[1];
                if let Some(v) = dynamic_value(name) {
                    replaced = true;
                    return v;
                }
                match vars.get(name) {
                    Some(v) => {
                        replaced = true;
                        v.to_string()
                    }
                    None => caps[0].to_string(),
                }
            })
            .into_owned();
        out = next;
        if !replaced || !out.contains("{{") {
            break;
        }
    }
    out
}

/// Names referenced in a template that have no value in scope.
pub fn find_unresolved(text: &str, vars: &VariableMap) -> Vec<String> {
    let mut missing = Vec::new();
    for caps in VAR_PATTERN.captures_iter(text) {
        let name = caps[1].to_string();
        if !vars.contains(&name) && !is_dynamic_variable(&name) && !missing.contains(&name) {
            missing.push(name);
        }
    }
    missing
}

/// A `{{var}}` token occurrence (byte offsets) — used for highlighting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VarToken {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

pub fn find_tokens(text: &str) -> Vec<VarToken> {
    VAR_PATTERN
        .captures_iter(text)
        .filter_map(|c| {
            let m = c.get(0)?;
            Some(VarToken { start: m.start(), end: m.end(), name: c[1].to_string() })
        })
        .collect()
}

/// Deep-resolve all string fields of a request that can carry variables.
pub fn resolve_request(request: &ApiRequest, vars: &VariableMap) -> ApiRequest {
    let r = |s: &str| resolve_template(s, vars);
    let mut out = request.clone();
    out.url = r(&request.url);
    for list in [&mut out.path_params, &mut out.params, &mut out.headers, &mut out.cookies] {
        for kv in list.iter_mut() {
            kv.key = r(&kv.key);
            kv.value = r(&kv.value);
        }
    }
    let a = &mut out.auth;
    a.api_key.key = r(&a.api_key.key);
    a.api_key.value = r(&a.api_key.value);
    a.bearer.token = r(&a.bearer.token);
    a.basic.username = r(&a.basic.username);
    a.basic.password = r(&a.basic.password);
    a.digest.username = r(&a.digest.username);
    a.digest.password = r(&a.digest.password);
    a.jwt.secret = r(&a.jwt.secret);
    a.jwt.payload = r(&a.jwt.payload);
    a.oauth2.access_token = r(&a.oauth2.access_token);
    a.oauth2.client_id = r(&a.oauth2.client_id);
    a.oauth2.client_secret = r(&a.oauth2.client_secret);
    a.oauth2.token_url = r(&a.oauth2.token_url);
    a.oauth2.auth_url = r(&a.oauth2.auth_url);
    a.oauth2.scope = r(&a.oauth2.scope);
    a.oauth2.username = r(&a.oauth2.username);
    a.oauth2.password = r(&a.oauth2.password);
    a.oauth2.refresh_token = r(&a.oauth2.refresh_token);
    a.aws.access_key = r(&a.aws.access_key);
    a.aws.secret_key = r(&a.aws.secret_key);
    a.aws.session_token = r(&a.aws.session_token);
    a.aws.region = r(&a.aws.region);
    a.aws.service = r(&a.aws.service);

    let b = &mut out.body;
    b.content = r(&b.content);
    b.graphql.query = r(&b.graphql.query);
    b.graphql.variables = r(&b.graphql.variables);
    b.graphql.operation_name = r(&b.graphql.operation_name);
    for kv in b.form_url_encoded.iter_mut() {
        kv.key = r(&kv.key);
        kv.value = r(&kv.value);
    }
    for item in b.multipart.iter_mut() {
        item.key = r(&item.key);
        if item.kind == crate::models::FormKind::Text {
            item.value = r(&item.value);
        }
    }
    out
}

/// Insert or update (or with `None`, remove) a variable by key — used to
/// apply script mutations to a scope.
pub fn upsert_variables(vars: &mut Vec<Variable>, changes: &[(String, Option<String>)]) {
    for (key, value) in changes {
        match value {
            None => vars.retain(|v| &v.key != key),
            Some(value) => {
                if let Some(v) = vars.iter_mut().find(|v| &v.key == key) {
                    v.value = value.clone();
                    v.enabled = true;
                } else {
                    vars.push(Variable::new(key.clone(), value.clone()));
                }
            }
        }
    }
}

/// Redact known secret values from free text (console logs, history).
pub fn redact_secrets(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_string();
    for s in secrets {
        if !s.is_empty() && out.contains(s.as_str()) {
            out = out.replace(s.as_str(), "••••••");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> Vec<Variable> {
        pairs.iter().map(|(k, v)| Variable::new(*k, *v)).collect()
    }

    #[test]
    fn precedence_request_over_collection_over_env_over_global() {
        let g = vars(&[("a", "global"), ("b", "global"), ("c", "global"), ("d", "global")]);
        let e = vars(&[("a", "env"), ("b", "env"), ("c", "env")]);
        let c = vars(&[("a", "col"), ("b", "col")]);
        let r = vars(&[("a", "req")]);
        let map = build_variable_map(&ScopeLayers {
            globals: &g,
            environment: Some(e.as_slice()),
            collection: Some(c.as_slice()),
            folders: vec![],
            request: Some(r.as_slice()),
        });
        assert_eq!(map.get("a"), Some("req"));
        assert_eq!(map.get("b"), Some("col"));
        assert_eq!(map.get("c"), Some("env"));
        assert_eq!(map.get("d"), Some("global"));
    }

    #[test]
    fn disabled_variables_are_ignored() {
        let mut g = vars(&[("a", "1")]);
        g[0].enabled = false;
        let map = build_variable_map(&ScopeLayers { globals: &g, ..Default::default() });
        assert!(map.get("a").is_none());
    }

    #[test]
    fn resolves_nested_and_keeps_unknown() {
        let g = vars(&[("host", "{{proto}}://api.test"), ("proto", "https")]);
        let map = build_variable_map(&ScopeLayers { globals: &g, ..Default::default() });
        assert_eq!(resolve_template("{{host}}/x/{{ missing }}", &map), "https://api.test/x/{{ missing }}");
        assert_eq!(find_unresolved("{{host}} {{missing}} {{$uuid}}", &map), vec!["missing".to_string()]);
    }

    #[test]
    fn dynamic_variables_generate_values() {
        let map = VariableMap::new();
        let out = resolve_template("{{$uuid}}", &map);
        assert_eq!(out.len(), 36);
        let ts = resolve_template("{{$timestamp}}", &map);
        assert!(ts.parse::<i64>().is_ok());
    }

    #[test]
    fn self_reference_terminates() {
        let g = vars(&[("a", "{{a}}x")]);
        let map = build_variable_map(&ScopeLayers { globals: &g, ..Default::default() });
        let out = resolve_template("{{a}}", &map);
        assert!(out.ends_with('x'));
    }

    #[test]
    fn upsert_and_remove() {
        let mut v = vars(&[("a", "1")]);
        upsert_variables(&mut v, &[("a".into(), Some("2".into())), ("b".into(), Some("3".into()))]);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].value, "2");
        upsert_variables(&mut v, &[("a".into(), None)]);
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn tokens_have_offsets() {
        let t = find_tokens("x{{a}}y{{ b }}");
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].start, 1);
        assert_eq!(t[1].name, "b");
    }
}
