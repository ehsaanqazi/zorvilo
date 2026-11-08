//! Request execution pipeline and collection runner.
//!
//! [`pipeline::execute`] is the single code path used by request tabs, the
//! collection runner and replay: inheritance → pre-request scripts →
//! variable resolution → request construction → auth → send → test scripts.

pub mod pipeline;
pub mod runner;

pub use pipeline::{execute, ExecutionInput, ExecutionResult, VariableChanges};
pub use runner::{run_collection, RunConfig, RunEvent, RunItem, RunSummary};
