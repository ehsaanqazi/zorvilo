//! Application data directory layout.

use std::path::{Path, PathBuf};

use crate::error::StorageResult;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub db_file: PathBuf,
    /// full response bodies referenced from history
    pub responses_dir: PathBuf,
    /// default Git working tree
    pub repo_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl AppPaths {
    /// Platform data dir: `~/Library/Application Support/dev.Zorvilo.Zorvilo`,
    /// `%APPDATA%\Zorvilo\Zorvilo\data`, `~/.local/share/zorvilo`.
    /// `ZORVILO_DATA_DIR` overrides it (useful for portable installs and tests).
    pub fn resolve() -> StorageResult<Self> {
        if let Ok(dir) = std::env::var("ZORVILO_DATA_DIR") {
            if !dir.trim().is_empty() {
                return Self::at(Path::new(dir.trim()));
            }
        }
        let root = directories::ProjectDirs::from("dev", "Zorvilo", "Zorvilo")
            .map(|d| d.data_dir().to_path_buf())
            .unwrap_or_else(|| std::env::temp_dir().join("zorvilo"));
        Self::at(&root)
    }

    pub fn at(root: &Path) -> StorageResult<Self> {
        let p = Self {
            root: root.to_path_buf(),
            db_file: root.join("zorvilo.sqlite3"),
            responses_dir: root.join("responses"),
            repo_dir: root.join("repo"),
            backups_dir: root.join("backups"),
            exports_dir: root.join("exports"),
            logs_dir: root.join("logs"),
        };
        for d in [&p.root, &p.responses_dir, &p.backups_dir, &p.exports_dir, &p.logs_dir] {
            std::fs::create_dir_all(d)?;
        }
        Ok(p)
    }

    /// Path for a stored response body. Ids are sanitised so a crafted id can
    /// never escape the responses directory.
    pub fn response_body_path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        self.responses_dir.join(format!("{safe}.bin"))
    }

    pub fn pending_restore_marker(&self) -> PathBuf {
        self.root.join("restore.pending")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_path_is_sanitised() {
        let dir = std::env::temp_dir().join(format!("zorvilo-paths-{}", std::process::id()));
        let p = AppPaths::at(&dir).unwrap();
        let path = p.response_body_path("../../etc/passwd");
        assert!(path.starts_with(&p.responses_dir));
        let _ = std::fs::remove_dir_all(dir);
    }
}
