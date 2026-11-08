//! HTTP / GraphQL execution (scripts, variables, auth, sending) and OAuth 2.0.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tokio_util::sync::CancellationToken;
use zorvilo_core::{ApiRequest, Collection, Environment, Folder, OAuth2Auth, ResponseData, Variable};
use zorvilo_runner::{execute, ExecutionInput};
use zorvilo_scripting::TestResult;

use super::{settings_from, CmdResult};
use crate::state::{lock, AppState};

/// Everything Rust needs to run a request, captured by the UI at send time.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestContext {
    pub request: ApiRequest,
    pub collection: Option<Collection>,
    /// folder chain, root folder first
    pub folder_chain: Vec<Folder>,
    pub environment: Option<Environment>,
    pub globals: Vec<Variable>,
    pub settings: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteArgs {
    pub op_id: String,
    #[serde(flatten)]
    pub context: RequestContext,
    #[serde(default)]
    pub iteration: u32,
    #[serde(default)]
    pub iteration_count: u32,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VariableChangesOut {
    environment: Vec<(String, Option<String>)>,
    globals: Vec<(String, Option<String>)>,
    collection: Vec<(String, Option<String>)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentOut {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body_preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteOutput {
    response: ResponseData,
    tests: Vec<TestResult>,
    logs: Vec<String>,
    script_error: Option<String>,
    changes: VariableChangesOut,
    sent: SentOut,
    /// `pm.execution.setNextRequest`: absent = not called; `{ name: null }` = stop the run
    next_request: Option<NextRequest>,
    script_ms: f64,
}

#[derive(Serialize)]
pub struct NextRequest {
    name: Option<String>,
}

#[tauri::command]
pub async fn execute_request(state: State<'_, AppState>, args: ExecuteArgs) -> CmdResult<ExecuteOutput> {
    let ExecuteArgs { op_id, context, iteration, iteration_count } = args;
    let cancel = CancellationToken::new();
    let generation = state.next_generation();
    if let Some((_, prev)) = lock(&state.inflight).insert(op_id.clone(), (generation, cancel.clone())) {
        prev.cancel();
    }
    let input = ExecutionInput {
        request: context.request,
        collection: context.collection,
        folder_chain: context.folder_chain,
        environment: context.environment,
        globals: context.globals,
        settings: settings_from(&context.settings),
        iteration,
        iteration_count: iteration_count.max(1),
    };
    let result = execute(&state.engine, input, cancel.clone()).await;
    {
        let mut inflight = lock(&state.inflight);
        // only remove our own entry (a newer send for the same op may have replaced it)
        if inflight.get(&op_id).map(|(g, _)| *g == generation).unwrap_or(false) {
            inflight.remove(&op_id);
        }
    }
    if cancel.is_cancelled() {
        return Err("Request cancelled".into());
    }
    Ok(ExecuteOutput {
        response: result.response,
        tests: result.tests,
        logs: result.logs,
        script_error: result.script_error,
        changes: VariableChangesOut {
            environment: result.changes.environment,
            globals: result.changes.globals,
            collection: result.changes.collection,
        },
        sent: SentOut {
            method: result.sent.method,
            url: result.sent.url,
            headers: result.sent.headers,
            body_preview: result.sent.body_preview,
        },
        next_request: result.next_request.map(|name| NextRequest { name }),
        script_ms: result.script_ms,
    })
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, op_id: String) {
    if let Some((_, token)) = lock(&state.inflight).remove(&op_id) {
        token.cancel();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenOut {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
}

/// Run an OAuth 2.0 grant (client credentials, password, authorization code
/// with PKCE via the system browser and a loopback redirect, or refresh).
#[tauri::command]
pub async fn oauth2_get_token(auth: OAuth2Auth, verify_tls: Option<bool>, refresh: Option<bool>) -> CmdResult<TokenOut> {
    let verify = verify_tls.unwrap_or(true);
    let token = if refresh.unwrap_or(false) {
        zorvilo_http::oauth2::refresh(&auth, verify).await?
    } else {
        // give the browser sign-in (authorization code) five minutes, then stop listening
        let cancel = CancellationToken::new();
        let timer = cancel.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            timer.cancel();
        });
        let result = zorvilo_http::oauth2::obtain_token(&auth, verify, cancel.clone()).await;
        cancel.cancel();
        result?
    };
    Ok(TokenOut {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type,
        expires_in: token.expires_in,
        scope: token.scope,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_args_accept_the_ui_payload() {
        let args: ExecuteArgs = serde_json::from_value(serde_json::json!({
            "opId": "op1",
            "request": {"id": "r", "method": "POST", "url": "https://x.test", "body": {"type": "json", "content": "{}"}},
            "collection": null,
            "folderChain": [],
            "environment": null,
            "globals": [{"id": "g", "key": "a", "value": "b", "enabled": true, "secret": false, "scope": "global", "ownerId": ""}],
            "settings": {"theme": "system", "fontSize": 13, "requestTimeoutMs": 30000, "defaultHeaders": [],
                          "proxy": {"enabled": false, "url": "", "username": "", "noProxy": ""},
                          "tls": {"verify": true, "caCertPath": "", "clientIdentityPath": ""},
                          "cookiesEnabled": true, "closeDraftBehavior": "ask", "maxHistoryEntries": 1000},
            "iteration": 0,
            "iterationCount": 1
        }))
        .unwrap();
        assert_eq!(args.op_id, "op1");
        assert_eq!(args.context.globals.len(), 1);
        let s = super::super::settings_from(&args.context.settings);
        assert_eq!(s.request_timeout_ms, 30_000);
        assert!(s.tls.verify && s.cookies_enabled);
    }
}
