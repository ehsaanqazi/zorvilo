//! Sandboxed, Postman-compatible JavaScript scripting.
//!
//! Engine choice: **Boa** (pure Rust). It needs no C toolchain, builds on all
//! three desktop platforms, exposes loop-iteration and recursion limits, and
//! supports modern syntax (async/await, arrow functions, classes). QuickJS
//! bindings are faster but require a C compiler and have weaker Windows build
//! ergonomics; script workloads here are small, so portability won.
//!
//! Isolation model:
//! * every script runs in a fresh `Context` on a dedicated thread;
//! * no filesystem, process, timers or module loading are exposed;
//! * the only host function is `__yaak_send` (pm.sendRequest), registered
//!   only when allowed in settings;
//! * a wall-clock timeout plus loop-iteration/recursion limits stop runaway
//!   scripts; on timeout the result is discarded and the thread is left to
//!   hit the loop limit and exit.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use boa_engine::{js_string, Context, JsNativeError, JsResult, JsString, JsValue, NativeFunction, Source};
use serde::{Deserialize, Serialize};

const PRELUDE: &str = include_str!("js/prelude.js");

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptVariables {
    pub request: BTreeMap<String, String>,
    pub folder: BTreeMap<String, String>,
    pub collection: BTreeMap<String, String>,
    pub environment: BTreeMap<String, String>,
    pub globals: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResponse {
    pub code: u16,
    pub status: String,
    pub response_time: f64,
    pub size: u64,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptInfo {
    /// "prerequest" | "test"
    pub event_name: String,
    pub request_name: String,
    pub request_id: String,
    pub iteration: u32,
    pub iteration_count: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptContext {
    pub request: ScriptRequest,
    pub variables: ScriptVariables,
    pub response: Option<ScriptResponse>,
    pub info: ScriptInfo,
    pub cookies: Vec<(String, String)>,
    pub environment_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    pub skipped: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestMutation {
    pub url: Option<String>,
    pub method: Option<String>,
    /// ["add" | "set" | "remove", name, value]
    pub header_ops: Vec<(String, String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Mutations {
    pub environment: Vec<(String, Option<String>)>,
    pub globals: Vec<(String, Option<String>)>,
    pub collection: Vec<(String, Option<String>)>,
    pub request: RequestMutation,
}

impl Mutations {
    pub fn is_empty(&self) -> bool {
        self.environment.is_empty() && self.globals.is_empty() && self.collection.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptOutcome {
    pub logs: Vec<String>,
    pub tests: Vec<TestResult>,
    pub error: Option<String>,
    pub mutations: Mutations,
    /// pm.variables.set() values (local scope, highest precedence)
    pub locals: BTreeMap<String, String>,
    pub next_request_set: bool,
    pub next_request: Option<String>,
    #[serde(skip)]
    pub duration_ms: f64,
}

impl ScriptOutcome {
    fn failed(msg: impl Into<String>) -> Self {
        Self { error: Some(msg.into()), ..Default::default() }
    }
}

#[derive(Debug, Clone)]
pub struct ScriptLimits {
    pub timeout_ms: u64,
    pub loop_iteration_limit: u64,
    pub recursion_limit: usize,
    pub allow_send_request: bool,
    pub send_request_timeout_ms: u64,
    pub verify_tls: bool,
}

impl Default for ScriptLimits {
    fn default() -> Self {
        Self {
            timeout_ms: 5000,
            loop_iteration_limit: 10_000_000,
            recursion_limit: 400,
            allow_send_request: true,
            send_request_timeout_ms: 10_000,
            verify_tls: true,
        }
    }
}

thread_local! {
    static SEND_TIMEOUT_MS: Cell<u64> = const { Cell::new(10_000) };
    static SEND_VERIFY_TLS: Cell<bool> = const { Cell::new(true) };
}

#[derive(Deserialize)]
struct SendSpec {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

/// Blocking HTTP call backing `pm.sendRequest` (runs on the script thread).
fn perform_send(payload: &str) -> String {
    let fail = |m: String| serde_json::json!({ "error": m }).to_string();
    let spec: SendSpec = match serde_json::from_str(payload) {
        Ok(s) => s,
        Err(e) => return fail(format!("invalid request: {e}")),
    };
    let url = if spec.url.starts_with("http://") || spec.url.starts_with("https://") {
        spec.url.clone()
    } else {
        format!("https://{}", spec.url)
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(SEND_TIMEOUT_MS.with(|c| c.get())))
        .danger_accept_invalid_certs(!SEND_VERIFY_TLS.with(|c| c.get()))
        .build()
    {
        Ok(c) => c,
        Err(e) => return fail(e.to_string()),
    };
    let method = match reqwest::Method::from_bytes(spec.method.as_bytes()) {
        Ok(m) => m,
        Err(_) => return fail(format!("invalid method {}", spec.method)),
    };
    let mut rb = client.request(method, &url);
    for (k, v) in &spec.headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(b) = spec.body {
        rb = rb.body(b);
    }
    let start = Instant::now();
    match rb.send() {
        Err(e) => fail(e.to_string()),
        Ok(resp) => {
            let code = resp.status().as_u16();
            let status = resp.status().canonical_reason().unwrap_or("").to_string();
            let headers: Vec<(String, String)> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
                .collect();
            let body = resp.text().unwrap_or_default();
            serde_json::json!({
                "code": code,
                "status": status,
                "headers": headers,
                "size": body.len(),
                "body": body,
                "responseTime": start.elapsed().as_secs_f64() * 1000.0,
            })
            .to_string()
        }
    }
}

fn native_send(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let arg = args.first().cloned().unwrap_or_else(JsValue::undefined);
    if arg.is_undefined() {
        return Err(JsNativeError::typ().with_message("__yaak_send expects a JSON string").into());
    }
    let payload = arg.to_string(ctx)?.to_std_string_escaped();
    let out = perform_send(&payload);
    Ok(JsValue::from(JsString::from(out.as_str())))
}

fn run_in_boa(source: &str, ctx_json: &str, limits: &ScriptLimits) -> Result<String, String> {
    let mut context = Context::default();
    context.runtime_limits_mut().set_loop_iteration_limit(limits.loop_iteration_limit);
    context.runtime_limits_mut().set_recursion_limit(limits.recursion_limit);

    if limits.allow_send_request {
        SEND_TIMEOUT_MS.with(|c| c.set(limits.send_request_timeout_ms));
        SEND_VERIFY_TLS.with(|c| c.set(limits.verify_tls));
        context
            .register_global_callable(js_string!("__yaak_send"), 1, NativeFunction::from_fn_ptr(native_send))
            .map_err(|e| format!("failed to install pm.sendRequest: {e}"))?;
    }

    let literal = serde_json::to_string(ctx_json).map_err(|e| e.to_string())?;
    let prelude = PRELUDE.replacen("__CTX_JSON__", &literal, 1);
    context
        .eval(Source::from_bytes(prelude.as_bytes()))
        .map_err(|e| format!("script runtime failed to initialise: {e}"))?;

    let wrapped = format!(
        "var __p = (async function () {{\n{source}\n}})();\n__p.then(undefined, function (e) {{ __state.error = __fmtErr(e); }});\n"
    );
    let syntax_or_sync_error = context.eval(Source::from_bytes(wrapped.as_bytes())).err().map(|e| e.to_string());
    let _ = context.run_jobs();

    let result = context
        .eval(Source::from_bytes(b"__yaak_result()".as_slice()))
        .map_err(|e| format!("could not collect script results: {e}"))?;
    let mut json = result.to_string(&mut context).map_err(|e| e.to_string())?.to_std_string_escaped();
    if let Some(err) = syntax_or_sync_error {
        // surface parse errors (the async wrapper never ran)
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&json) {
            if v.get("error").map(|e| e.is_null()).unwrap_or(true) {
                v["error"] = serde_json::Value::String(err);
                json = v.to_string();
            }
        }
    }
    Ok(json)
}

/// Execute one user script with the given context and limits.
pub fn run_script(source: &str, ctx: &ScriptContext, limits: &ScriptLimits) -> ScriptOutcome {
    if source.trim().is_empty() {
        return ScriptOutcome::default();
    }
    let ctx_json = match serde_json::to_string(ctx) {
        Ok(j) => j,
        Err(e) => return ScriptOutcome::failed(format!("could not serialise script context: {e}")),
    };
    let (tx, rx) = mpsc::channel();
    let source_owned = source.to_string();
    let limits_owned = limits.clone();
    let start = Instant::now();
    let spawned = std::thread::Builder::new()
        .name("zorvilo-script".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(move || {
            let r = run_in_boa(&source_owned, &ctx_json, &limits_owned);
            let _ = tx.send(r);
        });
    if let Err(e) = spawned {
        return ScriptOutcome::failed(format!("could not start script thread: {e}"));
    }
    // allow pm.sendRequest time on top of the script budget
    let budget = limits.timeout_ms + if limits.allow_send_request { limits.send_request_timeout_ms } else { 0 };
    let mut outcome = match rx.recv_timeout(Duration::from_millis(budget.max(100))) {
        Ok(Ok(json)) => serde_json::from_str::<ScriptOutcome>(&json)
            .unwrap_or_else(|e| ScriptOutcome::failed(format!("invalid script result: {e}"))),
        Ok(Err(e)) => ScriptOutcome::failed(e),
        Err(mpsc::RecvTimeoutError::Timeout) => ScriptOutcome::failed(format!("Script timed out after {} ms", limits.timeout_ms)),
        Err(mpsc::RecvTimeoutError::Disconnected) => ScriptOutcome::failed("Script crashed (runtime limit exceeded or internal error)"),
    };
    outcome.duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    outcome
}

/// Apply header operations from a pre-request script to a header list.
pub fn apply_header_ops(headers: &mut Vec<(String, String)>, ops: &[(String, String, String)]) {
    for (op, name, value) in ops {
        match op.as_str() {
            "add" => headers.push((name.clone(), value.clone())),
            "set" => {
                headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
                headers.push((name.clone(), value.clone()));
            }
            "remove" => headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name)),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with_response(body: &str) -> ScriptContext {
        let mut ctx = ScriptContext::default();
        ctx.request.url = "https://api.test/users".into();
        ctx.request.method = "GET".into();
        ctx.info.event_name = "test".into();
        ctx.variables.environment.insert("token".into(), "abc".into());
        ctx.response = Some(ScriptResponse {
            code: 200,
            status: "OK".into(),
            response_time: 12.0,
            size: body.len() as u64,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: body.into(),
        });
        ctx
    }

    fn limits() -> ScriptLimits {
        ScriptLimits { allow_send_request: false, ..Default::default() }
    }

    #[test]
    fn legacy_compatible_test_script() {
        // scripts in the style supported by the legacy Web Worker sandbox
        let script = r#"
            pm.test("status is 200", function () { pm.response.to.have.status(200); });
            pm.test("has id", function () {
                var json = pm.response.json();
                pm.expect(json).to.have.property('id');
                pm.expect(json.id).to.equal(7);
                pm.expect(json.tags).to.include('a');
                pm.expect(json.n).to.be.above(1).and.below(10);
            });
            pm.test("fails", function () { pm.expect(1).to.eql(2); });
            pm.environment.set("userId", pm.response.json().id);
            pm.globals.unset("old");
            console.log("done", { ok: true });
        "#;
        let out = run_script(script, &ctx_with_response(r#"{"id":7,"tags":["a"],"n":5}"#), &limits());
        assert_eq!(out.error, None, "{out:?}");
        assert_eq!(out.tests.len(), 3);
        assert!(out.tests[0].passed && out.tests[1].passed && !out.tests[2].passed);
        assert_eq!(out.mutations.environment, vec![("userId".to_string(), Some("7".to_string()))]);
        assert_eq!(out.mutations.globals, vec![("old".to_string(), None)]);
        assert_eq!(out.logs, vec![r#"done {"ok":true}"#.to_string()]);
    }

    #[test]
    fn pre_request_mutations() {
        let mut ctx = ScriptContext::default();
        ctx.request.url = "https://a.test".into();
        ctx.request.method = "GET".into();
        let script = r#"
            pm.request.url = "https://b.test";
            pm.request.method = "post";
            pm.request.headers.add({ key: "X-Trace", value: "1" });
            pm.variables.set("local", "yes");
        "#;
        let out = run_script(script, &ctx, &limits());
        assert_eq!(out.error, None);
        assert_eq!(out.mutations.request.url.as_deref(), Some("https://b.test"));
        assert_eq!(out.mutations.request.method.as_deref(), Some("POST"));
        assert_eq!(out.mutations.request.header_ops.len(), 1);
        assert_eq!(out.locals.get("local").map(String::as_str), Some("yes"));
    }

    #[test]
    fn errors_are_reported() {
        let out = run_script("throw new Error('boom')", &ScriptContext::default(), &limits());
        assert!(out.error.unwrap().contains("boom"));
        let out = run_script("this is not js(", &ScriptContext::default(), &limits());
        assert!(out.error.is_some());
    }

    #[test]
    fn infinite_loop_is_stopped() {
        let l = ScriptLimits { loop_iteration_limit: 100_000, timeout_ms: 3000, ..limits() };
        let out = run_script("while (true) {}", &ScriptContext::default(), &l);
        assert!(out.error.is_some());
    }

    #[test]
    fn variables_precedence_and_replace_in() {
        let mut ctx = ScriptContext::default();
        ctx.variables.globals.insert("a".into(), "g".into());
        ctx.variables.environment.insert("a".into(), "e".into());
        ctx.variables.request.insert("b".into(), "r".into());
        let out = run_script(
            r#"pm.test("p", function(){ pm.expect(pm.variables.get("a")).to.equal("e"); pm.expect(pm.variables.replaceIn("{{a}}-{{b}}")).to.equal("e-r"); });"#,
            &ctx,
            &limits(),
        );
        assert!(out.tests[0].passed, "{out:?}");
    }

    #[test]
    fn legacy_tests_object() {
        let out = run_script("tests['code ok'] = responseCode.code === 200;", &ctx_with_response("{}"), &limits());
        assert_eq!(out.tests.len(), 1);
        assert!(out.tests[0].passed);
    }

    #[test]
    fn header_ops() {
        let mut h = vec![("A".to_string(), "1".to_string())];
        apply_header_ops(&mut h, &[("set".into(), "a".into(), "2".into()), ("add".into(), "B".into(), "3".into())]);
        assert_eq!(h, vec![("a".to_string(), "2".to_string()), ("B".to_string(), "3".to_string())]);
    }
}
