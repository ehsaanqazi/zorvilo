//! Git integration: native filesystem-backed repositories via libgit2.
//!
//! * [`repo`] — repository operations (init, clone, status, commit, fetch,
//!   pull with fast-forward/merge/conflict detection, push, branches,
//!   history, diff, conflict resolution).
//! * [`layout`] — the on-disk JSON layout shared with the legacy app
//!   (`workspaces/<slug>-<id8>/{workspace.json,collections/*.json,environments/*.json}`),
//!   including secret redaction and merge-back into local state.
//! * [`secret_scan`] — detects credentials in files before they are committed.

pub mod layout;
pub mod repo;
pub mod secret_scan;

pub use repo::{GitAuth, GitError, GitRepo, PullOutcome, RepoStatus};
