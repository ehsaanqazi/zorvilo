//! Import / export.
//!
//! * [`postman`] — Postman Collection v2.0/v2.1 and environment import/export.
//! * [`curl`] — cURL command parsing (import) and generation.
//! * [`codegen`] — "copy as" cURL / fetch / Python requests / PowerShell.
//! * [`legacy`] — migration of data exported from the legacy web app
//!   (workspace bundles, Git collection/environment files, history and saved
//!   response exports), with validation and a report.
//!
//! All inputs are untrusted: sizes are bounded, JSON is parsed defensively
//! and nothing touches the filesystem here (callers decide where to write).

pub mod codegen;
pub mod curl;
pub mod detect;
pub mod legacy;
pub mod postman;

pub use detect::{detect_import, ImportKind};

/// Upper bound for any imported document.
pub const MAX_IMPORT_BYTES: usize = 100 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("file is too large ({0} bytes; limit is 100 MB)")]
    TooLarge(usize),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
}

pub type ImportResult<T> = Result<T, ImportError>;

/// Parse JSON with the size limit applied.
pub fn parse_json(text: &str) -> ImportResult<serde_json::Value> {
    if text.len() > MAX_IMPORT_BYTES {
        return Err(ImportError::TooLarge(text.len()));
    }
    Ok(serde_json::from_str(text)?)
}
