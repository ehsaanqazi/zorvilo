//! Local secret storage.
//!
//! Keys used: `var:<variable id>` (secret variable values), `git:token`,
//! `proxy:password`. Secrets live in a private file inside the app data
//! directory (owner read/write only) — the OS keychain is never touched, so
//! the app never triggers a system credential/keychain access prompt.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct SecretStore {
    /// `None` = in-memory only (tests).
    file: Option<PathBuf>,
    memory: Mutex<BTreeMap<String, String>>,
}

impl SecretStore {
    /// File-backed store at `path` (created on first write).
    pub fn open(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let map = load_file(&path);
        Self { file: Some(path), memory: Mutex::new(map) }
    }

    /// In-memory only store (tests).
    pub fn memory_only() -> Self {
        Self { file: None, memory: Mutex::new(BTreeMap::new()) }
    }

    pub fn is_persistent(&self) -> bool {
        self.file.is_some()
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.memory.lock().ok().and_then(|m| m.get(key).cloned())
    }

    pub fn set(&self, key: &str, value: &str) {
        let Ok(mut m) = self.memory.lock() else { return };
        if m.get(key).map(|v| v == value).unwrap_or(false) {
            return;
        }
        m.insert(key.to_string(), value.to_string());
        self.persist(&m);
    }

    pub fn delete(&self, key: &str) {
        let Ok(mut m) = self.memory.lock() else { return };
        if m.remove(key).is_some() {
            self.persist(&m);
        }
    }

    fn persist(&self, map: &BTreeMap<String, String>) {
        let Some(path) = &self.file else { return };
        if let Err(e) = write_file(path, map) {
            tracing::warn!(error = %e, "could not write the secrets file");
        }
    }
}

fn load_file(path: &Path) -> BTreeMap<String, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "secrets file is unreadable — starting empty");
            BTreeMap::new()
        }),
        Err(_) => BTreeMap::new(),
    }
}

fn write_file(path: &Path, map: &BTreeMap<String, String>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    let data = serde_json::to_vec(map).map_err(std::io::Error::other)?;
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(&data)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

/// Storage key for a secret variable value.
pub fn var_key(variable_id: &str) -> String {
    format!("var:{variable_id}")
}
