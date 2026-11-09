//! Local-first persistence.
//!
//! * [`database::Database`] — SQLite with versioned migrations. Entities are
//!   stored as JSON documents (the same camelCase shape as the legacy
//!   IndexedDB records and Git files) next to indexed relational columns.
//! * [`secrets::SecretStore`] — private local file (never the OS keychain)
//!   for secret variable values, Git tokens and OAuth tokens.
//! * [`paths::AppPaths`] — data directory layout.

pub mod database;
pub mod error;
pub mod migrations;
pub mod paths;
pub mod secrets;

pub use database::{Database, Snapshot, Table, WorkspaceData};
pub use error::{StorageError, StorageResult};
pub use paths::AppPaths;
pub use secrets::SecretStore;
