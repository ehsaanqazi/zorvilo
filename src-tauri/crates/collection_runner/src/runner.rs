//! Sequential collection runner. Script variable writes carry over from one
//! request to the next (Postman semantics); concurrency is intentionally not
//! offered because it would break those semantics.

use std::time::Instant;

use tokio_util::sync::CancellationToken;
use zorvilo_core::variables::upsert_variables;
use zorvilo_core::{ApiRequest, AppSettings, Collection, Environment, Folder, Variable};
use zorvilo_http::HttpEngine;

use crate::pipeline::{execute, ExecutionInput, ExecutionResult, VariableChanges};

#[derive(Debug, Clone)]
pub struct RunItem {
    pub request: ApiRequest,
    /// folder chain root → nearest
    pub folder_chain: Vec<Folder>,
}

#[derive(Debug, Clone)]
pub struct RunConfig {
    pub items: Vec<RunItem>,
    pub collection: Option<Collection>,
    pub environment: Option<Environment>,
    pub globals: Vec<Variable>,
    pub settings: AppSettings,
    pub iterations: u32,
    pub delay_ms: u64,
    pub stop_on_failure: bool,
}

#[derive(Debug, Clone)]
pub enum RunEvent {
    Started { total: usize },
    RequestStarted { iteration: u32, index: usize, request_id: String, name: String },
    RequestFinished { iteration: u32, index: usize, request_id: String, name: String, result: Box<ExecutionResult> },
    Skipped { iteration: u32, index: usize, name: String, reason: String },
    Finished(RunSummary),
}

#[derive(Debug, Clone, Default)]
pub struct RunSummary {
    pub total: usize,
    pub executed: usize,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub tests_passed: usize,
    pub tests_failed: usize,
    pub duration_ms: f64,
    pub avg_response_ms: f64,
    pub cancelled: bool,
    /// accumulated script variable writes, to apply to app state
    pub changes: VariableChanges,
}

fn apply_changes(cfg: &mut RunConfig, c: &VariableChanges) {
    if let Some(env) = &mut cfg.environment {
        upsert_variables(&mut env.variables, &c.environment);
    }
    upsert_variables(&mut cfg.globals, &c.globals);
    if let Some(col) = &mut cfg.collection {
        upsert_variables(&mut col.variables, &c.collection);
    }
}

pub async fn run_collection(
    engine: &HttpEngine,
    mut cfg: RunConfig,
    cancel: CancellationToken,
    on_event: impl Fn(RunEvent) + Send + Sync,
) -> RunSummary {
    let iterations = cfg.iterations.max(1);
    let total = cfg.items.len() * iterations as usize;
    on_event(RunEvent::Started { total });
    let started = Instant::now();
    let mut summary = RunSummary { total, ..Default::default() };
    let mut response_ms_total = 0.0;
    let max_steps = total.saturating_mul(10).max(10);
    let mut steps = 0usize;

    'iterations: for iteration in 0..iterations {
        let mut index = 0usize;
        while index < cfg.items.len() {
            if cancel.is_cancelled() {
                summary.cancelled = true;
                break 'iterations;
            }
            steps += 1;
            if steps > max_steps {
                summary.cancelled = true;
                break 'iterations; // setNextRequest loop guard
            }
            let item = cfg.items[index].clone();
            let name = item.request.name.clone();
            if item.request.protocol.is_realtime() {
                summary.skipped += 1;
                on_event(RunEvent::Skipped { iteration, index, name, reason: "realtime requests are not run by the runner".into() });
                index += 1;
                continue;
            }
            on_event(RunEvent::RequestStarted { iteration, index, request_id: item.request.id.clone(), name: name.clone() });
            let input = ExecutionInput {
                request: item.request.clone(),
                collection: cfg.collection.clone(),
                folder_chain: item.folder_chain.clone(),
                environment: cfg.environment.clone(),
                globals: cfg.globals.clone(),
                settings: cfg.settings.clone(),
                iteration,
                iteration_count: iterations,
            };
            let result = execute(engine, input, cancel.clone()).await;
            summary.executed += 1;
            response_ms_total += result.response.duration_ms;
            summary.tests_passed += result.tests_passed();
            summary.tests_failed += result.tests_failed();
            let ok = result.passed();
            if ok {
                summary.passed += 1;
            } else {
                summary.failed += 1;
            }
            apply_changes(&mut cfg, &result.changes);
            summary.changes.extend(&result.changes);
            let next = result.next_request.clone();
            on_event(RunEvent::RequestFinished { iteration, index, request_id: item.request.id.clone(), name, result: Box::new(result) });

            if !ok && cfg.stop_on_failure {
                break 'iterations;
            }
            index = match next {
                None => index + 1,
                Some(None) => break, // setNextRequest(null) ends this iteration
                Some(Some(target)) => match cfg.items.iter().position(|i| i.request.name == target || i.request.id == target) {
                    Some(p) => p,
                    None => index + 1,
                },
            };
            if cfg.delay_ms > 0 && index < cfg.items.len() {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(cfg.delay_ms)) => {}
                    _ = cancel.cancelled() => { summary.cancelled = true; break 'iterations; }
                }
            }
        }
    }
    summary.duration_ms = started.elapsed().as_secs_f64() * 1000.0;
    summary.avg_response_ms = if summary.executed > 0 { response_ms_total / summary.executed as f64 } else { 0.0 };
    summary.skipped += total.saturating_sub(summary.executed + summary.skipped);
    on_event(RunEvent::Finished(summary.clone()));
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test(flavor = "multi_thread")]
    async fn variables_flow_between_requests_and_failures_count() {
        // the first request fails to connect but its pre-request script still sets a variable
        let a = ApiRequest {
            name: "a".into(),
            url: "http://127.0.0.1:9/a".into(),
            pre_request_script: "pm.environment.set('x', '1');".into(),
            ..Default::default()
        };
        let b = ApiRequest { name: "b".into(), url: "http://127.0.0.1:9/b".into(), ..Default::default() };
        let cfg = RunConfig {
            items: vec![RunItem { request: a, folder_chain: vec![] }, RunItem { request: b, folder_chain: vec![] }],
            collection: None,
            environment: Some(Environment::default()),
            globals: vec![],
            settings: AppSettings::default(),
            iterations: 2,
            delay_ms: 0,
            stop_on_failure: false,
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let summary = run_collection(&HttpEngine::new(), cfg, CancellationToken::new(), move |e| ev.lock().unwrap().push(e)).await;
        assert_eq!(summary.total, 4);
        assert_eq!(summary.executed, 4);
        assert_eq!(summary.failed, 4);
        assert_eq!(summary.changes.environment.len(), 2);
        assert!(matches!(events.lock().unwrap().last(), Some(RunEvent::Finished(_))));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cancellation_stops_the_run() {
        let a = ApiRequest { name: "a".into(), url: "http://127.0.0.1:9/a".into(), ..Default::default() };
        let cfg = RunConfig {
            items: vec![RunItem { request: a, folder_chain: vec![] }],
            collection: None,
            environment: None,
            globals: vec![],
            settings: AppSettings::default(),
            iterations: 5,
            delay_ms: 0,
            stop_on_failure: false,
        };
        let cancel = CancellationToken::new();
        cancel.cancel();
        let summary = run_collection(&HttpEngine::new(), cfg, cancel, |_| {}).await;
        assert!(summary.cancelled);
        assert_eq!(summary.executed, 0);
    }
}
