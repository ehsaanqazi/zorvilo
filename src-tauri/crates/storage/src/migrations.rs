//! Versioned schema migrations (tracked with `PRAGMA user_version`).

use rusqlite::Connection;

use crate::error::StorageResult;

/// Ordered migrations. Never edit a shipped migration — append a new one.
pub const MIGRATIONS: &[(i64, &str)] = &[(
    1,
    r#"
CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    data        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    name          TEXT NOT NULL,
    sort_order    REAL NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_workspace ON collections(workspace_id);

CREATE TABLE IF NOT EXISTS folders (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    parent_id     TEXT,
    name          TEXT NOT NULL,
    sort_order    REAL NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_folders_collection ON folders(collection_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

CREATE TABLE IF NOT EXISTS requests (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    folder_id     TEXT,
    name          TEXT NOT NULL,
    method        TEXT NOT NULL,
    url           TEXT NOT NULL,
    protocol      TEXT NOT NULL,
    favorite      INTEGER NOT NULL DEFAULT 0,
    sort_order    REAL NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_workspace ON requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests(folder_id);

CREATE TABLE IF NOT EXISTS environments (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_environments_workspace ON environments(workspace_id);

CREATE TABLE IF NOT EXISTS global_variables (
    id        TEXT PRIMARY KEY,
    key       TEXT NOT NULL,
    position  INTEGER NOT NULL,
    data      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tabs (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    sort_order    REAL NOT NULL DEFAULT 0,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tabs_workspace ON tabs(workspace_id);

CREATE TABLE IF NOT EXISTS history (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    request_id    TEXT,
    method        TEXT NOT NULL,
    url           TEXT NOT NULL,
    status        INTEGER NOT NULL,
    favorite      INTEGER NOT NULL DEFAULT 0,
    timestamp     INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_workspace_time ON history(workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_request ON history(request_id);

CREATE TABLE IF NOT EXISTS saved_responses (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_responses_request ON saved_responses(request_id);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    data  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trash (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    kind          TEXT NOT NULL,
    deleted_at    INTEGER NOT NULL,
    data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trash_workspace ON trash(workspace_id);
CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash(deleted_at);

CREATE TABLE IF NOT EXISTS git_meta (
    id    TEXT PRIMARY KEY,
    data  TEXT NOT NULL
);
"#,
)];

pub fn current_version(conn: &Connection) -> StorageResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Apply all pending migrations, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> StorageResult<i64> {
    let mut version = current_version(conn)?;
    for (target, sql) in MIGRATIONS {
        if *target <= version {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {target}"))?;
        tx.commit()?;
        version = *target;
        tracing::info!(version, "applied database migration");
    }
    Ok(version)
}
