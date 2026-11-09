//! Process-wide application state shared by all Tauri commands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tokio_util::sync::CancellationToken;
use zorvilo_http::HttpEngine;
use zorvilo_realtime::RealtimeHandle;
use zorvilo_storage::{AppPaths, Database, SecretStore};

/// Secret-store key holding the Git access token.
pub const GIT_TOKEN_KEY: &str = "git:token";

pub struct LiveConnection {
    pub generation: u64,
    pub socket_io: bool,
    pub handle: RealtimeHandle,
}

pub struct AppState {
    pub paths: AppPaths,
    /// `None` when the database could not be opened (the UI shows the recovery screen).
    db: Mutex<Option<Database>>,
    pub db_error: Mutex<Option<String>>,
    pub secrets: Arc<SecretStore>,
    pub engine: HttpEngine,
    /// In-flight HTTP executions by operation id.
    pub inflight: Mutex<HashMap<String, (u64, CancellationToken)>>,
    /// Live realtime connections by connection (tab) id.
    pub realtime: Mutex<HashMap<String, LiveConnection>>,
    generation: AtomicU64,
    /// Serialises Git operations (one working tree).
    pub git_lock: tokio::sync::Mutex<()>,
    pub startup_notes: Vec<String>,
    pending_links: Mutex<Vec<String>>,
}

impl AppState {
    pub fn new(paths: AppPaths, startup_notes: Vec<String>) -> Self {
        let secrets = Arc::new(SecretStore::open(paths.secrets_file.clone()));
        let (db, db_error) = match Database::open(&paths.db_file) {
            Ok(db) => (Some(db), None),
            Err(e) => {
                tracing::error!(error = %e, "could not open database");
                (None, Some(e.to_string()))
            }
        };
        Self {
            paths,
            db: Mutex::new(db),
            db_error: Mutex::new(db_error),
            secrets,
            engine: HttpEngine::new(),
            inflight: Mutex::new(HashMap::new()),
            realtime: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(1),
            git_lock: tokio::sync::Mutex::new(()),
            startup_notes,
            pending_links: Mutex::new(Vec::new()),
        }
    }

    pub fn set_pending_links(&self, links: Vec<String>) {
        lock(&self.pending_links).extend(links);
    }

    pub fn take_pending_links(&self) -> Vec<String> {
        std::mem::take(&mut *lock(&self.pending_links))
    }

    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::Relaxed)
    }

    /// Run `f` with the open database.
    pub fn with_db<T>(&self, f: impl FnOnce(&mut Database) -> Result<T, String>) -> Result<T, String> {
        let mut guard = lock(&self.db);
        match guard.as_mut() {
            Some(db) => f(db),
            None => Err(lock(&self.db_error).clone().unwrap_or_else(|| "database is not open".into())),
        }
    }

    /// Move an unreadable database aside and start with a fresh one.
    pub fn reset_database(&self) -> Result<(), String> {
        let mut guard = lock(&self.db);
        *guard = None;
        let file = &self.paths.db_file;
        if file.exists() {
            let aside = file.with_extension(format!("corrupt-{}.sqlite3", zorvilo_core::ids::now_ms()));
            std::fs::rename(file, &aside).map_err(|e| format!("could not move the database aside: {e}"))?;
            for ext in ["sqlite3-wal", "sqlite3-shm"] {
                let _ = std::fs::remove_file(file.with_extension(ext));
            }
        }
        let db = Database::open(file).map_err(|e| e.to_string())?;
        *guard = Some(db);
        *lock(&self.db_error) = None;
        Ok(())
    }
}

/// Lock a mutex, recovering from poisoning (a panicked command must not brick the app).
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}
