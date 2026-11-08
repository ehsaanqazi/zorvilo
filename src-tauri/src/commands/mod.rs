//! IPC commands exposed to the React UI.
//!
//! Every command returns `Result<T, String>`; the error string is shown to
//! the user as-is, so it must be human-readable and must never contain secrets.

pub mod db;
pub mod files;
pub mod git;
pub mod http;
pub mod import_export;
pub mod realtime;
pub mod system;
pub mod trash;
pub mod update;

use serde_json::Value;
use zorvilo_core::AppSettings;

pub type CmdResult<T> = Result<T, String>;

/// Decode the UI's settings object leniently: unknown fields are ignored and a
/// malformed value falls back to defaults instead of failing the operation.
pub fn settings_from(value: &Value) -> AppSettings {
    if value.is_null() {
        return AppSettings::default();
    }
    serde_json::from_value(value.clone()).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "settings object could not be decoded; using defaults");
        AppSettings::default()
    })
}

/// Run blocking work (SQLite, keychain, libgit2, file I/O) off the async runtime.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("background task failed: {e}"))?
}
