//! Zorvilo core: domain models and pure (I/O free) request logic.
//!
//! Everything in this crate is deterministic apart from id/time/random
//! generation, which keeps it trivially unit-testable and shareable between
//! the UI, the HTTP engine, the collection runner and the Git layer.

pub mod error;
pub mod ids;
pub mod inheritance;
pub mod jsonc;
pub mod models;
pub mod path_params;
pub mod serde_helpers;
pub mod settings;
pub mod url_utils;
pub mod util;
pub mod variables;

pub use error::{CoreError, CoreResult};
pub use models::*;
pub use settings::*;
