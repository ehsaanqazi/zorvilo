//! The request execution pipeline.

use std::collections::BTreeMap;

use tokio_util::sync::CancellationToken;
use zorvilo_core::inheritance::{effective_auth, pre_request_scripts, test_scripts};
use zorvilo_core::variables::{build_variable_map, resolve_request, upsert_variables, ScopeLayers, VariableScope};
use zorvilo_core::{ApiRequest, AppSettings, AuthType, BodyType, Collection, Environment, Folder, KeyValue, ResponseData, Variable};
use zorvilo_http::auth::apply_auth;
use zorvilo_http::build::build_spec;
use zorvilo_http::HttpEngine;
use zorvilo_scripting::{
    apply_header_ops, run_script, ScriptContext, ScriptInfo, ScriptLimits, ScriptOutcome, ScriptRequest, ScriptResponse,
    ScriptVariables, TestResult,
};

/// Everything needed to execute one request, captured as a snapshot so the
/// UI can keep editing while the request is in flight.
#[derive(Debug, Clone, Default)]
pub struct ExecutionInput {
    pub request: ApiRequest,
    pub collection: Option<Collection>,
    /// folder chain, root → nearest
    pub folder_chain: Vec<Folder>,
    pub environment: Option<Environment>,
    pub globals: Vec<Variable>,
    pub settings: AppSettings,
    pub iteration: u32,
    pub iteration_count: u32,
}

/// Net variable writes made by scripts, to be applied to app state.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VariableChanges {
    pub environment: Vec<(String, Option<String>)>,
    pub globals: Vec<(String, Option<String>)>,
    pub collection: Vec<(String, Option<String>)>,
}

impl VariableChanges {
    pub fn is_empty(&self) -> bool {
        self.environment.is_empty() && self.globals.is_empty() && self.collection.is_empty()
    }
    pub fn extend(&mut self, other: &VariableChanges) {
        self.environment.extend(other.environment.iter().cloned());
        self.globals.extend(other.globals.iter().cloned());
        self.collection.extend(other.collection.iter().cloned());
    }
}

/// What actually went over the wire.
#[derive(Debug, Clone, Default)]
pub struct SentRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body_preview: String,
}

#[derive(Debug, Clone, Default)]
pub struct ExecutionResult {
    pub response: ResponseData,
    pub tests: Vec<TestResult>,
    pub logs: Vec<String>,
    pub script_error: Option<String>,
    pub changes: VariableChanges,
    pub sent: SentRequest,
    /// `pm.execution.setNextRequest`: None = not called, Some(None) = stop
    pub next_request: Option<Option<String>>,
    pub script_ms: f64,
}

impl ExecutionResult {
    pub fn tests_passed(&self) -> usize {
        self.tests.iter().filter(|t| t.passed && !t.skipped).count()
    }
    pub fn tests_failed(&self) -> usize {
        self.tests.iter().filter(|t| !t.passed).count()
    }
    /// Network success, HTTP < 400, no script error and no failed test.
    pub fn passed(&self) -> bool {
        self.response.error.is_none() && self.response.status < 400 && self.script_error.is_none() && self.tests_failed() == 0
    }
}

fn to_map(vars: &[Variable]) -> BTreeMap<String, String> {
    vars.iter().filter(|v| v.enabled && !v.key.is_empty()).map(|v| (v.key.clone(), v.value.clone())).collect()
}

struct VarState {
    environment: Option<Vec<Variable>>,
    globals: Vec<Variable>,
    collection: Vec<Variable>,
    locals: BTreeMap<String, String>,
    changes: VariableChanges,
}

impl VarState {
    fn apply(&mut self, out: &ScriptOutcome) {
        let m = &out.mutations;
        if !m.environment.is_empty() {
            match &mut self.environment {
                Some(env) => {
                    upsert_variables(env, &m.environment);
                    self.changes.environment.extend(m.environment.iter().cloned());
                }
                None => {
                    // no active environment: land the writes in globals so they aren't lost
                    upsert_variables(&mut self.globals, &m.environment);
                    self.changes.globals.extend(m.environment.iter().cloned());
                }
            }
        }
        if !m.globals.is_empty() {
            upsert_variables(&mut self.globals, &m.globals);
            self.changes.globals.extend(m.globals.iter().cloned());
        }
        if !m.collection.is_empty() {
            upsert_variables(&mut self.collection, &m.collection);
            self.changes.collection.extend(m.collection.iter().cloned());
        }
        for (k, v) in &out.locals {
            self.locals.insert(k.clone(), v.clone());
        }
    }
}

fn script_context(
    req: &ApiRequest,
    state: &VarState,
    folder_vars: &BTreeMap<String, String>,
    input: &ExecutionInput,
    event: &str,
    response: Option<&ResponseData>,
    cookies: Vec<(String, String)>,
) -> ScriptContext {
    let mut request_vars = to_map(&req.variables);
    // script-local values are visible through pm.variables
    for (k, v) in &state.locals {
        request_vars.insert(k.clone(), v.clone());
    }
    ScriptContext {
        request: ScriptRequest {
            url: req.url.clone(),
            method: req.method.clone(),
            headers: req.headers.iter().filter(|h| h.enabled && !h.key.is_empty()).map(|h| (h.key.clone(), h.value.clone())).collect(),
            body: if req.body.body_type == BodyType::GraphQl { req.body.graphql.query.clone() } else { req.body.content.clone() },
        },
        variables: ScriptVariables {
            request: request_vars,
            folder: folder_vars.clone(),
            collection: to_map(&state.collection),
            environment: state.environment.as_deref().map(to_map).unwrap_or_default(),
            globals: to_map(&state.globals),
        },
        response: response.map(|r| ScriptResponse {
            code: r.status,
            status: r.status_text.clone(),
            response_time: r.duration_ms,
            size: r.size_bytes,
            headers: r.headers.clone(),
            body: r.body_text.clone(),
        }),
        info: ScriptInfo {
            event_name: event.to_string(),
            request_name: req.name.clone(),
            request_id: req.id.clone(),
            iteration: input.iteration,
            iteration_count: input.iteration_count.max(1),
        },
        cookies,
        environment_name: input.environment.as_ref().map(|e| e.name.clone()).unwrap_or_default(),
    }
}

fn limits(settings: &AppSettings, verify_tls: bool) -> ScriptLimits {
    ScriptLimits {
        timeout_ms: settings.scripting.timeout_ms.max(100),
        loop_iteration_limit: settings.scripting.loop_iteration_limit.max(1000),
        allow_send_request: settings.scripting.allow_send_request,
        verify_tls,
        ..Default::default()
    }
}

async fn run_blocking(source: String, ctx: ScriptContext, limits: ScriptLimits) -> ScriptOutcome {
    match tokio::task::spawn_blocking(move || run_script(&source, &ctx, &limits)).await {
        Ok(o) => o,
        Err(e) => ScriptOutcome { error: Some(format!("script task failed: {e}")), ..Default::default() },
    }
}

/// Execute one request end to end. Never panics; failures land in the result.
pub async fn execute(engine: &HttpEngine, input: ExecutionInput, cancel: CancellationToken) -> ExecutionResult {
    let chain: Vec<&Folder> = input.folder_chain.iter().collect();
    let mut working = input.request.clone();
    working.auth = effective_auth(&input.request, &chain, input.collection.as_ref());

    let mut folder_vars = BTreeMap::new();
    for f in &chain {
        folder_vars.extend(to_map(&f.variables));
    }
    let mut state = VarState {
        environment: input.environment.as_ref().map(|e| e.variables.clone()),
        globals: input.globals.clone(),
        collection: input.collection.as_ref().map(|c| c.variables.clone()).unwrap_or_default(),
        locals: BTreeMap::new(),
        changes: VariableChanges::default(),
    };
    let mut result = ExecutionResult::default();
    let scripting = input.settings.scripting.enabled;
    let verify_tls = input.settings.tls.verify && input.request.settings.verify_ssl;
    let script_limits = limits(&input.settings, verify_tls);

    // ---- pre-request scripts (collection → folders → request)
    if scripting {
        for (label, source) in pre_request_scripts(&input.request, &chain, input.collection.as_ref()) {
            if cancel.is_cancelled() {
                result.response = ResponseData::error("request cancelled");
                return result;
            }
            let cookies = engine.cookies_for(&zorvilo_core::url_utils::with_scheme(&working.url));
            let ctx = script_context(&working, &state, &folder_vars, &input, "prerequest", None, cookies);
            let out = run_blocking(source, ctx, script_limits.clone()).await;
            result.script_ms += out.duration_ms;
            result.logs.extend(out.logs.iter().cloned());
            result.tests.extend(out.tests.iter().cloned());
            state.apply(&out);
            let rm = &out.mutations.request;
            if let Some(u) = &rm.url {
                working.url = u.clone();
            }
            if let Some(m) = &rm.method {
                working.method = m.clone();
            }
            if let Some(b) = &rm.body {
                working.body.content = b.clone();
            }
            if !rm.header_ops.is_empty() {
                let mut pairs: Vec<(String, String)> =
                    working.headers.iter().filter(|h| h.enabled).map(|h| (h.key.clone(), h.value.clone())).collect();
                apply_header_ops(&mut pairs, &rm.header_ops);
                working.headers = pairs.into_iter().map(|(k, v)| KeyValue::new(k, v)).collect();
            }
            if out.next_request_set {
                result.next_request = Some(out.next_request.clone());
            }
            if let Some(err) = out.error {
                result.script_error = Some(format!("{label}: {err}"));
                result.response = ResponseData::error(format!("Pre-request script failed ({label}): {err}"));
                result.changes = state.changes;
                return result;
            }
        }
    }

    // ---- variables (scripts may have changed them)
    let folder_layers: Vec<&[Variable]> = chain.iter().map(|f| f.variables.as_slice()).collect();
    let mut map = build_variable_map(&ScopeLayers {
        globals: &state.globals,
        environment: state.environment.as_deref(),
        collection: Some(state.collection.as_slice()),
        folders: folder_layers,
        request: Some(working.variables.as_slice()),
    });
    map.layer_pairs(state.locals.iter(), VariableScope::Local);
    let resolved = resolve_request(&working, &map);

    // ---- build + authenticate
    let mut spec = match build_spec(&resolved, &input.settings) {
        Ok(s) => s,
        Err(e) => {
            result.response = ResponseData::error(e.to_string());
            result.changes = state.changes;
            return result;
        }
    };
    let digest = (resolved.auth.auth_type == AuthType::Digest).then(|| resolved.auth.digest.clone());
    if let Err(e) = apply_auth(&mut spec, &resolved.auth) {
        result.response = ResponseData::error(e.to_string());
        result.changes = state.changes;
        return result;
    }
    let secrets = map.secret_values();
    result.sent = SentRequest {
        method: spec.method.clone(),
        url: spec.url.to_string(),
        headers: spec.headers.clone(),
        body_preview: spec
            .body
            .as_ref()
            .map(|b| zorvilo_core::variables::redact_secrets(&String::from_utf8_lossy(&b[..b.len().min(4096)]), &secrets))
            .unwrap_or_default(),
    };

    // ---- send
    result.response = engine.send(spec, digest, cancel.clone()).await;

    // ---- tests (collection → folders → request)
    if scripting && result.response.error.is_none() && !cancel.is_cancelled() {
        for (label, source) in test_scripts(&input.request, &chain, input.collection.as_ref()) {
            let cookies = engine.cookies_for(&result.sent.url);
            let ctx = script_context(&working, &state, &folder_vars, &input, "test", Some(&result.response), cookies);
            let out = run_blocking(source, ctx, script_limits.clone()).await;
            result.script_ms += out.duration_ms;
            result.logs.extend(out.logs.iter().cloned());
            result.tests.extend(out.tests.iter().cloned());
            state.apply(&out);
            if out.next_request_set {
                result.next_request = Some(out.next_request.clone());
            }
            if let Some(err) = out.error {
                result.script_error = Some(format!("{label}: {err}"));
                break;
            }
        }
    }
    // never echo secret values into the console
    result.logs = result.logs.iter().map(|l| zorvilo_core::variables::redact_secrets(l, &secrets)).collect();
    result.changes = state.changes;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Minimal one-shot HTTP server for tests (no external services).
    async fn serve_once(body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 16384];
            let n = s.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(resp.as_bytes()).await.unwrap();
            req
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn full_pipeline_with_scripts_and_inheritance() {
        let (base, server) = serve_once(r#"{"id":42}"#).await;
        let mut collection = Collection::default();
        collection.auth = zorvilo_core::AuthConfig::of(AuthType::Bearer);
        collection.auth.bearer.token = "{{token}}".into();
        collection.pre_request_script = "pm.environment.set('token', 'tok-123');".into();
        let env = Environment { name: "Dev".into(), variables: vec![Variable::new("base", base.clone())], ..Default::default() };
        let mut request = ApiRequest { url: "{{base}}/users/:id".into(), ..Default::default() };
        request.path_params = vec![KeyValue::new("id", "7")];
        request.test_script = "pm.test('id', function(){ pm.expect(pm.response.json().id).to.equal(42); }); pm.collectionVariables.set('last', '42');".into();
        request.pre_request_script = "pm.request.headers.add({key: 'X-Trace', value: pm.variables.get('token')});".into();

        let input = ExecutionInput {
            request,
            collection: Some(collection),
            environment: Some(env),
            settings: AppSettings { network_safety: zorvilo_core::NetworkSafety { warn_private: true, block_private: false }, ..Default::default() },
            ..Default::default()
        };
        let engine = HttpEngine::new();
        let result = execute(&engine, input, CancellationToken::new()).await;
        assert_eq!(result.response.error, None, "{:?}", result.response);
        assert_eq!(result.response.status, 200);
        assert_eq!(result.tests.len(), 1);
        assert!(result.passed(), "{:?}", result.tests);
        assert_eq!(result.changes.environment, vec![("token".to_string(), Some("tok-123".to_string()))]);
        assert_eq!(result.changes.collection, vec![("last".to_string(), Some("42".to_string()))]);
        assert!(result.response.warnings.iter().any(|w| w.contains("Internal destination")));
        let raw = server.await.unwrap();
        assert!(raw.starts_with("GET /users/7 "), "{raw}");
        assert!(raw.to_lowercase().contains("authorization: bearer tok-123"));
        assert!(raw.to_lowercase().contains("x-trace: tok-123"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pre_request_error_stops_send() {
        let request = ApiRequest { url: "http://127.0.0.1:9/never".into(), pre_request_script: "throw new Error('nope')".into(), ..Default::default() };
        let result = execute(&HttpEngine::new(), ExecutionInput { request, ..Default::default() }, CancellationToken::new()).await;
        assert!(result.response.error.unwrap().contains("Pre-request script failed"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn blocked_private_destination() {
        let request = ApiRequest { url: "http://127.0.0.1:9/x".into(), ..Default::default() };
        let mut settings = AppSettings::default();
        settings.network_safety.block_private = true;
        let result = execute(&HttpEngine::new(), ExecutionInput { request, settings, ..Default::default() }, CancellationToken::new()).await;
        assert!(result.response.error.unwrap().contains("blocked"));
    }
}
