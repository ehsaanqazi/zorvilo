//! SQLite database access (repositories).

use std::path::Path;

use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OpenFlags};
use serde::de::DeserializeOwned;
use serde::Serialize;
use zorvilo_core::{
    ApiRequest, AppSettings, Collection, Environment, Folder, GitMeta, HistoryEntry, SavedResponse, TabRecord,
    TrashEntry, Variable, Workspace,
};

use crate::error::StorageResult;
use crate::migrations;
use crate::secrets::{var_key, SecretStore};

/// Everything loaded at startup.
#[derive(Debug, Default, Clone)]
pub struct Snapshot {
    pub workspaces: Vec<Workspace>,
    pub collections: Vec<Collection>,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub environments: Vec<Environment>,
    pub globals: Vec<Variable>,
    pub tabs: Vec<TabRecord>,
    pub history: Vec<HistoryEntry>,
    pub saved_responses: Vec<SavedResponse>,
    pub trash: Vec<TrashEntry>,
    pub settings: Option<AppSettings>,
    pub ui_state: Option<serde_json::Value>,
    pub git_meta: Option<GitMeta>,
    /// rows that could not be decoded (kept in the DB, reported to the user)
    pub warnings: Vec<String>,
}

/// Records scoped to one workspace.
#[derive(Debug, Default, Clone)]
pub struct WorkspaceData {
    pub collections: Vec<Collection>,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub environments: Vec<Environment>,
    pub tabs: Vec<TabRecord>,
    pub history: Vec<HistoryEntry>,
    pub saved_responses: Vec<SavedResponse>,
    pub warnings: Vec<String>,
}

pub struct Database {
    conn: Connection,
}

fn sv_text(s: &str) -> SqlValue {
    SqlValue::Text(s.to_string())
}
fn sv_opt(s: Option<&str>) -> SqlValue {
    s.map(sv_text).unwrap_or(SqlValue::Null)
}

impl Database {
    pub fn open(path: &Path) -> StorageResult<Self> {
        let mut conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")?;
        migrations::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> StorageResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        migrations::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn connection(&mut self) -> &mut Connection {
        &mut self.conn
    }

    // ------------------------------------------------------------- generic helpers

    fn upsert(conn: &Connection, table: &str, cols: Vec<(&str, SqlValue)>) -> StorageResult<()> {
        let names: Vec<&str> = cols.iter().map(|(n, _)| *n).collect();
        let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
        let conflict = if names.contains(&"id") { "id" } else { "key" };
        let updates: Vec<String> = names.iter().filter(|n| **n != conflict).map(|n| format!("{n} = excluded.{n}")).collect();
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT({conflict}) DO UPDATE SET {}",
            names.join(", "),
            placeholders.join(", "),
            updates.join(", ")
        );
        conn.execute(&sql, params_from_iter(cols.into_iter().map(|(_, v)| v)))?;
        Ok(())
    }

    fn load_table<T: DeserializeOwned>(&self, sql: &str, warnings: &mut Vec<String>, label: &str) -> StorageResult<Vec<T>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, data) = row?;
            match serde_json::from_str::<T>(&data) {
                Ok(v) => out.push(v),
                Err(e) => warnings.push(format!("{label} {id}: could not decode stored record ({e}); it was left untouched")),
            }
        }
        Ok(out)
    }

    fn json<T: Serialize>(v: &T) -> StorageResult<SqlValue> {
        Ok(SqlValue::Text(serde_json::to_string(v)?))
    }

    // ------------------------------------------------------------- secrets

    /// Move secret variable values to the keychain; the stored copy is blank.
    pub fn seal_variables(vars: &[Variable], secrets: &SecretStore) -> Vec<Variable> {
        vars.iter()
            .map(|v| {
                if v.secret {
                    if v.value.is_empty() {
                        secrets.delete(&var_key(&v.id));
                    } else {
                        secrets.set(&var_key(&v.id), &v.value);
                    }
                    Variable { value: String::new(), ..v.clone() }
                } else {
                    v.clone()
                }
            })
            .collect()
    }

    /// Restore secret values from the keychain.
    pub fn unseal_variables(vars: &mut [Variable], secrets: &SecretStore) {
        for v in vars.iter_mut().filter(|v| v.secret && v.value.is_empty()) {
            if let Some(val) = secrets.get(&var_key(&v.id)) {
                v.value = val;
            }
        }
    }

    // ------------------------------------------------------------- load

    pub fn load_snapshot(&self, secrets: &SecretStore) -> StorageResult<Snapshot> {
        let mut w = Vec::new();
        let mut snap = Snapshot {
            workspaces: self.load_table("SELECT id, data FROM workspaces ORDER BY rowid", &mut w, "workspace")?,
            collections: self.load_table("SELECT id, data FROM collections ORDER BY sort_order", &mut w, "collection")?,
            folders: self.load_table("SELECT id, data FROM folders ORDER BY sort_order", &mut w, "folder")?,
            requests: self.load_table("SELECT id, data FROM requests ORDER BY sort_order", &mut w, "request")?,
            environments: self.load_table("SELECT id, data FROM environments ORDER BY rowid", &mut w, "environment")?,
            globals: self.load_table("SELECT id, data FROM global_variables ORDER BY position", &mut w, "global variable")?,
            tabs: self.load_table("SELECT id, data FROM tabs ORDER BY sort_order", &mut w, "tab")?,
            history: self.load_table("SELECT id, data FROM history ORDER BY timestamp DESC", &mut w, "history entry")?,
            saved_responses: self.load_table("SELECT id, data FROM saved_responses ORDER BY created_at DESC", &mut w, "saved response")?,
            trash: self.load_table("SELECT id, data FROM trash ORDER BY deleted_at DESC", &mut w, "trash entry")?,
            ..Default::default()
        };
        snap.settings = self.get_setting::<AppSettings>("app")?;
        snap.ui_state = self.get_setting::<serde_json::Value>("ui")?;
        snap.git_meta = self
            .conn
            .query_row("SELECT data FROM git_meta WHERE id = ?1", params![zorvilo_core::GLOBAL_GIT_META_ID], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());

        for c in &mut snap.collections {
            Self::unseal_variables(&mut c.variables, secrets);
        }
        for f in &mut snap.folders {
            Self::unseal_variables(&mut f.variables, secrets);
        }
        for r in &mut snap.requests {
            Self::unseal_variables(&mut r.variables, secrets);
        }
        for e in &mut snap.environments {
            Self::unseal_variables(&mut e.variables, secrets);
        }
        Self::unseal_variables(&mut snap.globals, secrets);
        snap.warnings = w;
        Ok(snap)
    }

    fn load_where<T: DeserializeOwned>(
        &self,
        sql: &str,
        arg: &str,
        warnings: &mut Vec<String>,
        label: &str,
    ) -> StorageResult<Vec<T>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(params![arg], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, data) = row?;
            match serde_json::from_str::<T>(&data) {
                Ok(v) => out.push(v),
                Err(e) => warnings.push(format!("{label} {id}: could not decode stored record ({e}); it was left untouched")),
            }
        }
        Ok(out)
    }

    pub fn load_workspaces(&self) -> StorageResult<(Vec<Workspace>, Vec<String>)> {
        let mut w = Vec::new();
        let list = self.load_table("SELECT id, data FROM workspaces ORDER BY rowid", &mut w, "workspace")?;
        Ok((list, w))
    }

    pub fn load_globals(&self, secrets: &SecretStore) -> StorageResult<Vec<Variable>> {
        let mut w = Vec::new();
        let mut list: Vec<Variable> =
            self.load_table("SELECT id, data FROM global_variables ORDER BY position", &mut w, "global variable")?;
        Self::unseal_variables(&mut list, secrets);
        Ok(list)
    }

    /// Everything that belongs to one workspace (secrets unsealed).
    pub fn load_workspace(&self, workspace_id: &str, secrets: &SecretStore) -> StorageResult<WorkspaceData> {
        let mut w = Vec::new();
        let ws = workspace_id;
        let mut data = WorkspaceData {
            collections: self.load_where("SELECT id, data FROM collections WHERE workspace_id = ?1 ORDER BY sort_order", ws, &mut w, "collection")?,
            folders: self.load_where("SELECT id, data FROM folders WHERE workspace_id = ?1 ORDER BY sort_order", ws, &mut w, "folder")?,
            requests: self.load_where("SELECT id, data FROM requests WHERE workspace_id = ?1 ORDER BY sort_order", ws, &mut w, "request")?,
            environments: self.load_where("SELECT id, data FROM environments WHERE workspace_id = ?1 ORDER BY rowid", ws, &mut w, "environment")?,
            tabs: self.load_where("SELECT id, data FROM tabs WHERE workspace_id = ?1 ORDER BY sort_order", ws, &mut w, "tab")?,
            history: self.load_where("SELECT id, data FROM history WHERE workspace_id = ?1 ORDER BY timestamp DESC", ws, &mut w, "history entry")?,
            saved_responses: self.load_where(
                "SELECT id, data FROM saved_responses WHERE workspace_id = ?1 ORDER BY created_at DESC",
                ws,
                &mut w,
                "saved response",
            )?,
            warnings: Vec::new(),
        };
        for c in &mut data.collections {
            Self::unseal_variables(&mut c.variables, secrets);
        }
        for f in &mut data.folders {
            Self::unseal_variables(&mut f.variables, secrets);
        }
        for r in &mut data.requests {
            Self::unseal_variables(&mut r.variables, secrets);
        }
        for e in &mut data.environments {
            Self::unseal_variables(&mut e.variables, secrets);
        }
        data.warnings = w;
        Ok(data)
    }

    pub fn load_trash(&self, workspace_id: &str) -> StorageResult<Vec<TrashEntry>> {
        let mut w = Vec::new();
        self.load_where("SELECT id, data FROM trash WHERE workspace_id = ?1 ORDER BY deleted_at DESC", workspace_id, &mut w, "trash entry")
    }

    /// Fetch one record by id (secrets are *not* unsealed — use for existence checks / metadata).
    pub fn get<T: DeserializeOwned>(&self, table: Table, id: &str) -> StorageResult<Option<T>> {
        let raw: Option<String> = self
            .conn
            .query_row(&format!("SELECT data FROM {} WHERE id = ?1", table.name()), params![id], |r| r.get(0))
            .ok();
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn exists(&self, table: Table, id: &str) -> bool {
        self.conn
            .query_row(&format!("SELECT 1 FROM {} WHERE id = ?1", table.name()), params![id], |_| Ok(()))
            .is_ok()
    }

    pub fn load_git_meta(&self) -> Option<GitMeta> {
        self.conn
            .query_row("SELECT data FROM git_meta WHERE id = ?1", params![zorvilo_core::GLOBAL_GIT_META_ID], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn put_global(conn: &Connection, v: &Variable, position: i64, secrets: &SecretStore) -> StorageResult<()> {
        let sealed = Self::seal_variables(std::slice::from_ref(v), secrets).remove(0);
        Self::upsert(conn, "global_variables", vec![
            ("id", sv_text(&v.id)),
            ("key", sv_text(&v.key)),
            ("position", SqlValue::Integer(position)),
            ("data", Self::json(&sealed)?),
        ])
    }

    pub fn get_setting<T: DeserializeOwned>(&self, key: &str) -> StorageResult<Option<T>> {
        let raw: Option<String> =
            self.conn.query_row("SELECT data FROM settings WHERE key = ?1", params![key], |r| r.get(0)).ok();
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    // ------------------------------------------------------------- writes (used by the writer thread)

    pub fn put_workspace(conn: &Connection, w: &Workspace) -> StorageResult<()> {
        Self::upsert(conn, "workspaces", vec![
            ("id", sv_text(&w.id)),
            ("name", sv_text(&w.name)),
            ("updated_at", SqlValue::Integer(w.updated_at)),
            ("data", Self::json(w)?),
        ])
    }

    pub fn put_collection(conn: &Connection, c: &Collection, secrets: &SecretStore) -> StorageResult<()> {
        let sealed = Collection { variables: Self::seal_variables(&c.variables, secrets), ..c.clone() };
        Self::upsert(conn, "collections", vec![
            ("id", sv_text(&c.id)),
            ("workspace_id", sv_text(&c.workspace_id)),
            ("name", sv_text(&c.name)),
            ("sort_order", SqlValue::Real(c.sort_order)),
            ("updated_at", SqlValue::Integer(c.updated_at)),
            ("data", Self::json(&sealed)?),
        ])
    }

    pub fn put_folder(conn: &Connection, f: &Folder, secrets: &SecretStore) -> StorageResult<()> {
        let sealed = Folder { variables: Self::seal_variables(&f.variables, secrets), ..f.clone() };
        Self::upsert(conn, "folders", vec![
            ("id", sv_text(&f.id)),
            ("workspace_id", sv_text(&f.workspace_id)),
            ("collection_id", sv_text(&f.collection_id)),
            ("parent_id", sv_opt(f.parent_id.as_deref())),
            ("name", sv_text(&f.name)),
            ("sort_order", SqlValue::Real(f.sort_order)),
            ("updated_at", SqlValue::Integer(f.updated_at)),
            ("data", Self::json(&sealed)?),
        ])
    }

    pub fn put_request(conn: &Connection, r: &ApiRequest, secrets: &SecretStore) -> StorageResult<()> {
        let sealed = ApiRequest { variables: Self::seal_variables(&r.variables, secrets), ..r.clone() };
        let protocol = serde_json::to_value(r.protocol)?.as_str().unwrap_or("http").to_string();
        Self::upsert(conn, "requests", vec![
            ("id", sv_text(&r.id)),
            ("workspace_id", sv_text(&r.workspace_id)),
            ("collection_id", sv_text(&r.collection_id)),
            ("folder_id", sv_opt(r.folder_id.as_deref())),
            ("name", sv_text(&r.name)),
            ("method", sv_text(&r.method)),
            ("url", sv_text(&r.url)),
            ("protocol", SqlValue::Text(protocol)),
            ("favorite", SqlValue::Integer(r.favorite as i64)),
            ("sort_order", SqlValue::Real(r.sort_order)),
            ("updated_at", SqlValue::Integer(r.updated_at)),
            ("data", Self::json(&sealed)?),
        ])
    }

    pub fn put_environment(conn: &Connection, e: &Environment, secrets: &SecretStore) -> StorageResult<()> {
        let sealed = Environment { variables: Self::seal_variables(&e.variables, secrets), ..e.clone() };
        Self::upsert(conn, "environments", vec![
            ("id", sv_text(&e.id)),
            ("workspace_id", sv_text(&e.workspace_id)),
            ("name", sv_text(&e.name)),
            ("is_active", SqlValue::Integer(e.is_active as i64)),
            ("updated_at", SqlValue::Integer(e.updated_at)),
            ("data", Self::json(&sealed)?),
        ])
    }

    pub fn set_globals(conn: &Connection, vars: &[Variable], secrets: &SecretStore) -> StorageResult<()> {
        conn.execute("DELETE FROM global_variables", [])?;
        for (i, v) in Self::seal_variables(vars, secrets).iter().enumerate() {
            Self::upsert(conn, "global_variables", vec![
                ("id", sv_text(&v.id)),
                ("key", sv_text(&v.key)),
                ("position", SqlValue::Integer(i as i64)),
                ("data", Self::json(v)?),
            ])?;
        }
        Ok(())
    }

    pub fn put_tab(conn: &Connection, t: &TabRecord) -> StorageResult<()> {
        Self::upsert(conn, "tabs", vec![
            ("id", sv_text(&t.id)),
            ("workspace_id", sv_text(&t.workspace_id)),
            ("sort_order", SqlValue::Real(t.sort_order)),
            ("data", Self::json(t)?),
        ])
    }

    pub fn replace_tabs(conn: &Connection, tabs: &[TabRecord]) -> StorageResult<()> {
        conn.execute("DELETE FROM tabs", [])?;
        for t in tabs {
            Self::put_tab(conn, t)?;
        }
        Ok(())
    }

    pub fn put_history(conn: &Connection, h: &HistoryEntry) -> StorageResult<()> {
        Self::upsert(conn, "history", vec![
            ("id", sv_text(&h.id)),
            ("workspace_id", sv_text(&h.workspace_id)),
            ("request_id", sv_opt(h.request_id.as_deref())),
            ("method", sv_text(&h.method)),
            ("url", sv_text(&h.url)),
            ("status", SqlValue::Integer(h.status as i64)),
            ("favorite", SqlValue::Integer(h.favorite as i64)),
            ("timestamp", SqlValue::Integer(h.timestamp)),
            ("data", Self::json(h)?),
        ])
    }

    pub fn put_saved_response(conn: &Connection, s: &SavedResponse) -> StorageResult<()> {
        Self::upsert(conn, "saved_responses", vec![
            ("id", sv_text(&s.id)),
            ("workspace_id", sv_text(&s.workspace_id)),
            ("request_id", sv_text(&s.request_id)),
            ("created_at", SqlValue::Integer(s.created_at)),
            ("data", Self::json(s)?),
        ])
    }

    pub fn put_trash(conn: &Connection, t: &TrashEntry) -> StorageResult<()> {
        let kind = serde_json::to_value(t.kind)?.as_str().unwrap_or("request").to_string();
        Self::upsert(conn, "trash", vec![
            ("id", sv_text(&t.id)),
            ("workspace_id", sv_text(&t.workspace_id)),
            ("kind", SqlValue::Text(kind)),
            ("deleted_at", SqlValue::Integer(t.deleted_at)),
            ("data", Self::json(t)?),
        ])
    }

    pub fn put_setting(conn: &Connection, key: &str, value: &serde_json::Value) -> StorageResult<()> {
        Self::upsert(conn, "settings", vec![("key", sv_text(key)), ("data", SqlValue::Text(value.to_string()))])
    }

    pub fn put_git_meta(conn: &Connection, g: &GitMeta) -> StorageResult<()> {
        Self::upsert(conn, "git_meta", vec![("id", sv_text(&g.id)), ("data", Self::json(g)?)])
    }

    pub fn delete(conn: &Connection, table: Table, id: &str) -> StorageResult<()> {
        conn.execute(&format!("DELETE FROM {} WHERE id = ?1", table.name()), params![id])?;
        Ok(())
    }

    /// Remove a workspace and everything it owns.
    pub fn delete_workspace_cascade(conn: &Connection, id: &str) -> StorageResult<()> {
        for t in ["collections", "folders", "requests", "environments", "tabs", "history", "saved_responses", "trash"] {
            conn.execute(&format!("DELETE FROM {t} WHERE workspace_id = ?1"), params![id])?;
        }
        conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_history(conn: &Connection, workspace_id: &str, keep_favorites: bool) -> StorageResult<()> {
        if keep_favorites {
            conn.execute("DELETE FROM history WHERE workspace_id = ?1 AND favorite = 0", params![workspace_id])?;
        } else {
            conn.execute("DELETE FROM history WHERE workspace_id = ?1", params![workspace_id])?;
        }
        Ok(())
    }

    pub fn purge_history_before(conn: &Connection, before_ms: i64) -> StorageResult<usize> {
        Ok(conn.execute("DELETE FROM history WHERE timestamp < ?1 AND favorite = 0", params![before_ms])?)
    }

    pub fn purge_trash_before(conn: &Connection, before_ms: i64) -> StorageResult<usize> {
        Ok(conn.execute("DELETE FROM trash WHERE deleted_at < ?1", params![before_ms])?)
    }

    pub fn wipe_all(conn: &Connection) -> StorageResult<()> {
        conn.execute_batch(
            "DELETE FROM workspaces; DELETE FROM collections; DELETE FROM folders; DELETE FROM requests;
             DELETE FROM environments; DELETE FROM global_variables; DELETE FROM tabs; DELETE FROM history;
             DELETE FROM saved_responses; DELETE FROM settings; DELETE FROM trash; DELETE FROM git_meta;",
        )?;
        Ok(())
    }

    /// Consistent online backup (`VACUUM INTO`).
    pub fn backup_to(conn: &Connection, dest: &Path) -> StorageResult<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy().to_string()])?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    Workspaces,
    Collections,
    Folders,
    Requests,
    Environments,
    Tabs,
    History,
    SavedResponses,
    Trash,
    GlobalVariables,
}

impl Table {
    pub fn name(self) -> &'static str {
        match self {
            Table::Workspaces => "workspaces",
            Table::Collections => "collections",
            Table::Folders => "folders",
            Table::Requests => "requests",
            Table::Environments => "environments",
            Table::Tabs => "tabs",
            Table::History => "history",
            Table::SavedResponses => "saved_responses",
            Table::Trash => "trash",
            Table::GlobalVariables => "global_variables",
        }
    }
}

/// If a restore was requested, swap the backup in before the DB is opened.
pub fn apply_pending_restore(paths: &crate::paths::AppPaths) -> StorageResult<Option<String>> {
    let marker = paths.pending_restore_marker();
    if !marker.exists() {
        return Ok(None);
    }
    let src = std::fs::read_to_string(&marker)?.trim().to_string();
    std::fs::remove_file(&marker)?;
    let src_path = Path::new(&src);
    if !src_path.exists() {
        return Ok(Some(format!("restore skipped: backup {src} no longer exists")));
    }
    // keep the current database as a safety copy
    if paths.db_file.exists() {
        let safety = paths.backups_dir.join(format!("pre-restore-{}.sqlite3", zorvilo_core::ids::now_ms()));
        std::fs::copy(&paths.db_file, safety)?;
    }
    for ext in ["-wal", "-shm"] {
        let p = paths.db_file.with_file_name(format!("{}{ext}", paths.db_file.file_name().unwrap_or_default().to_string_lossy()));
        let _ = std::fs::remove_file(p);
    }
    std::fs::copy(src_path, &paths.db_file)?;
    Ok(Some(format!("restored database from {src}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_and_round_trip() {
        let mut db = Database::open_in_memory().unwrap();
        let secrets = SecretStore::memory_only();
        let ws = Workspace::default();
        let mut env = Environment { workspace_id: ws.id.clone(), ..Default::default() };
        env.variables.push(Variable { key: "token".into(), value: "s3cret".into(), secret: true, ..Default::default() });
        let req = ApiRequest { workspace_id: ws.id.clone(), collection_id: "c".into(), ..Default::default() };
        {
            let conn = db.connection();
            Database::put_workspace(conn, &ws).unwrap();
            Database::put_environment(conn, &env, &secrets).unwrap();
            Database::put_request(conn, &req, &secrets).unwrap();
            Database::put_request(conn, &req, &secrets).unwrap(); // upsert
            Database::put_setting(conn, "app", &serde_json::to_value(AppSettings::default()).unwrap()).unwrap();
        }
        // the stored JSON never contains the secret
        let raw: String = db.connection().query_row("SELECT data FROM environments", [], |r| r.get(0)).unwrap();
        assert!(!raw.contains("s3cret"));

        let snap = db.load_snapshot(&secrets).unwrap();
        assert_eq!(snap.workspaces.len(), 1);
        assert_eq!(snap.requests.len(), 1);
        assert_eq!(snap.environments[0].variables[0].value, "s3cret");
        assert!(snap.settings.is_some());
        assert!(snap.warnings.is_empty());
    }

    #[test]
    fn corrupt_rows_are_reported_not_dropped() {
        let mut db = Database::open_in_memory().unwrap();
        db.connection()
            .execute("INSERT INTO workspaces (id, name, updated_at, data) VALUES ('x','x',0,'{not json')", [])
            .unwrap();
        let snap = db.load_snapshot(&SecretStore::memory_only()).unwrap();
        assert_eq!(snap.warnings.len(), 1);
        let count: i64 = db.connection().query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut db = Database::open_in_memory().unwrap();
        let v = migrations::migrate(db.connection()).unwrap();
        assert_eq!(v, migrations::MIGRATIONS.last().unwrap().0);
    }
}
