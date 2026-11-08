//! OS credential storage.
//!
//! Keys used: `var:<variable id>` (secret variable values), `git:token`,
//! `proxy:password`. When no OS keychain is reachable (e.g. a Linux box
//! without a Secret Service), values are kept in memory for the session only
//! — they are never written to disk in plaintext.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub struct SecretStore {
    service: String,
    available: AtomicBool,
    memory: Mutex<HashMap<String, String>>,
}

impl SecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        let store = Self { service: service.into(), available: AtomicBool::new(true), memory: Mutex::new(HashMap::new()) };
        store.probe();
        store
    }

    /// In-memory only store (tests, or when the user disables the keychain).
    pub fn memory_only() -> Self {
        Self { service: "zorvilo-test".into(), available: AtomicBool::new(false), memory: Mutex::new(HashMap::new()) }
    }

    fn probe(&self) {
        let ok = keyring::Entry::new(&self.service, "probe")
            .and_then(|e| {
                e.set_password("ok")?;
                let v = e.get_password()?;
                let _ = e.delete_credential();
                Ok(v == "ok")
            })
            .unwrap_or(false);
        if !ok {
            tracing::warn!("OS credential store unavailable — secrets will only be kept in memory this session");
        }
        self.available.store(ok, Ordering::Relaxed);
    }

    pub fn is_persistent(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    pub fn get(&self, key: &str) -> Option<String> {
        if let Some(v) = self.memory.lock().ok().and_then(|m| m.get(key).cloned()) {
            return Some(v);
        }
        if !self.is_persistent() {
            return None;
        }
        let v = keyring::Entry::new(&self.service, key).ok()?.get_password().ok()?;
        if let Ok(mut m) = self.memory.lock() {
            m.insert(key.to_string(), v.clone());
        }
        Some(v)
    }

    pub fn set(&self, key: &str, value: &str) {
        if let Ok(mut m) = self.memory.lock() {
            if m.get(key).map(|v| v == value).unwrap_or(false) {
                return; // unchanged — skip the (slow) keychain write
            }
            m.insert(key.to_string(), value.to_string());
        }
        if self.is_persistent() {
            if let Err(e) = keyring::Entry::new(&self.service, key).and_then(|e| e.set_password(value)) {
                tracing::warn!(error = %e, "could not write secret to OS keychain");
            }
        }
    }

    pub fn delete(&self, key: &str) {
        if let Ok(mut m) = self.memory.lock() {
            m.remove(key);
        }
        if self.is_persistent() {
            if let Ok(e) = keyring::Entry::new(&self.service, key) {
                let _ = e.delete_credential();
            }
        }
    }
}

/// Keychain key for a secret variable value.
pub fn var_key(variable_id: &str) -> String {
    format!("var:{variable_id}")
}
