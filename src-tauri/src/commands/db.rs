//! Persistence commands: the UI's stores load from and write to SQLite here.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use zorvilo_core::{
    ApiRequest, Collection, Environment, Folder, GitMeta, HistoryEntry, SavedResponse, TabRecord, TrashEntry, Variable,
    Workspace, GLOBAL_GIT_META_ID, TRASH_RETENTION_MS,
};
use zorvilo_storage::{Database, SecretStore, Table};

use super::CmdResult;
use crate::state::{AppState, GIT_TOKEN_KEY};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapData {
    settings: Option<Value>,
    ui: Option<Value>,
    workspaces: Vec<Workspace>,
    git_meta: Option<Value>,
    warnings: Vec<String>,
}

/// Git config as the UI sees it: the persisted record plus the token from the keychain.
pub fn git_meta_for_ui(db: &Database, secrets: &SecretStore) -> Option<Value> {
    let meta: GitMeta = db.load_git_meta()?;
    let mut v = serde_json::to_value(&meta).ok()?;
    v["token"] = Value::String(secrets.get(GIT_TOKEN_KEY).unwrap_or_default());
    v["workspaceId"] = Value::String(String::new());
    Some(v)
}

#[tauri::command(async)]
pub fn db_bootstrap(state: State<'_, AppState>) -> CmdResult<BootstrapData> {
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        let (workspaces, warnings) = db.load_workspaces().map_err(|e| e.to_string())?;
        Ok(BootstrapData {
            settings: db.get_setting::<Value>("app").map_err(|e| e.to_string())?,
            ui: db.get_setting::<Value>("ui").map_err(|e| e.to_string())?,
            workspaces,
            git_meta: git_meta_for_ui(db, &secrets),
            warnings,
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePayload {
    collections: Vec<Collection>,
    folders: Vec<Folder>,
    requests: Vec<ApiRequest>,
    environments: Vec<Environment>,
    /// global variables in the UI's `ScopedVariable` shape
    globals: Vec<Value>,
    tabs: Vec<TabRecord>,
    history: Vec<HistoryEntry>,
    responses: Vec<SavedResponse>,
    warnings: Vec<String>,
}

#[tauri::command(async)]
pub fn db_load_workspace(state: State<'_, AppState>, workspace_id: String) -> CmdResult<WorkspacePayload> {
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        let data = db.load_workspace(&workspace_id, &secrets).map_err(|e| e.to_string())?;
        let globals = db
            .load_globals(&secrets)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|v| {
                let mut val = serde_json::to_value(v).unwrap_or(Value::Null);
                val["scope"] = json!("global");
                val["ownerId"] = json!("");
                val
            })
            .collect();
        Ok(WorkspacePayload {
            collections: data.collections,
            folders: data.folders,
            requests: data.requests,
            environments: data.environments,
            globals,
            tabs: data.tabs,
            history: data.history,
            responses: data.saved_responses,
            warnings: data.warnings,
        })
    })
}

/// One queued write from the UI.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum DbWrite {
    Put { table: String, value: Value },
    Delete { table: String, id: String },
    Setting { key: String, value: Value },
}

fn table_of(name: &str) -> Option<Table> {
    Some(match name {
        "workspaces" => Table::Workspaces,
        "collections" => Table::Collections,
        "folders" => Table::Folders,
        "requests" => Table::Requests,
        "environments" => Table::Environments,
        "tabs" => Table::Tabs,
        "history" => Table::History,
        "responses" => Table::SavedResponses,
        "trash" => Table::Trash,
        "variables" => Table::GlobalVariables,
        _ => return None,
    })
}

fn decode<T: serde::de::DeserializeOwned>(table: &str, value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("invalid {table} record: {e}"))
}

/// Apply a batch of writes atomically. Records that fail to decode are
/// skipped and reported; the rest of the batch still commits.
pub fn apply_writes(db: &mut Database, secrets: &SecretStore, writes: Vec<DbWrite>) -> CmdResult<Vec<String>> {
    let mut warnings = Vec::new();
    let tx = db.connection().transaction().map_err(|e| e.to_string())?;
    let mut global_position = 0i64;
    for w in writes {
        let result: Result<(), String> = match w {
            DbWrite::Setting { key, value } => Database::put_setting(&tx, &key, &value).map_err(|e| e.to_string()),
            DbWrite::Put { table, value } => {
                let t = table.as_str();
                (|| -> Result<(), String> {
                    let e = |e: zorvilo_storage::StorageError| e.to_string();
                    match t {
                        "workspaces" => Database::put_workspace(&tx, &decode::<Workspace>(t, value)?).map_err(e),
                        "collections" => Database::put_collection(&tx, &decode::<Collection>(t, value)?, secrets).map_err(e),
                        "folders" => Database::put_folder(&tx, &decode::<Folder>(t, value)?, secrets).map_err(e),
                        "requests" => Database::put_request(&tx, &decode::<ApiRequest>(t, value)?, secrets).map_err(e),
                        "environments" => Database::put_environment(&tx, &decode::<Environment>(t, value)?, secrets).map_err(e),
                        "tabs" => Database::put_tab(&tx, &decode::<TabRecord>(t, value)?).map_err(e),
                        "history" => Database::put_history(&tx, &decode::<HistoryEntry>(t, value)?).map_err(e),
                        "responses" => Database::put_saved_response(&tx, &decode::<SavedResponse>(t, value)?).map_err(e),
                        "trash" => Database::put_trash(&tx, &decode::<TrashEntry>(t, value)?).map_err(e),
                        "variables" => {
                            global_position += 1;
                            Database::put_global(&tx, &decode::<Variable>(t, value)?, global_position, secrets).map_err(e)
                        }
                        "gitMeta" => {
                            if let Some(token) = value.get("token").and_then(Value::as_str) {
                                if token.is_empty() {
                                    secrets.delete(GIT_TOKEN_KEY);
                                } else {
                                    secrets.set(GIT_TOKEN_KEY, token);
                                }
                            }
                            let mut meta: GitMeta = decode(t, value)?;
                            meta.id = GLOBAL_GIT_META_ID.into();
                            Database::put_git_meta(&tx, &meta).map_err(e)
                        }
                        other => Err(format!("unknown table {other}")),
                    }
                })()
            }
            DbWrite::Delete { table, id } => match table_of(&table) {
                Some(Table::GlobalVariables) => {
                    secrets.delete(&zorvilo_storage::secrets::var_key(&id));
                    Database::delete(&tx, Table::GlobalVariables, &id).map_err(|e| e.to_string())
                }
                Some(t) => Database::delete(&tx, t, &id).map_err(|e| e.to_string()),
                None if table == "gitMeta" => tx
                    .execute("DELETE FROM git_meta WHERE id = ?1", [GLOBAL_GIT_META_ID])
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                None => Err(format!("unknown table {table}")),
            },
        };
        if let Err(e) = result {
            tracing::warn!(error = %e, "write skipped");
            warnings.push(e);
        }
    }
    tx.commit().map_err(|e| format!("could not save changes: {e}"))?;
    Ok(warnings)
}

#[tauri::command(async)]
pub fn db_apply(state: State<'_, AppState>, writes: Vec<DbWrite>) -> CmdResult<Vec<String>> {
    let secrets = state.secrets.clone();
    state.with_db(|db| apply_writes(db, &secrets, writes))
}

/// Fetch one record (secret values unsealed for variable-bearing records).
#[tauri::command(async)]
pub fn db_get(state: State<'_, AppState>, table: String, id: String) -> CmdResult<Option<Value>> {
    let t = table_of(&table).ok_or_else(|| format!("unknown table {table}"))?;
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        let value: Option<Value> = db.get(t, &id).map_err(|e| e.to_string())?;
        let Some(mut value) = value else { return Ok(None) };
        if let Some(vars) = value.get_mut("variables") {
            if let Ok(mut list) = serde_json::from_value::<Vec<Variable>>(vars.clone()) {
                Database::unseal_variables(&mut list, &secrets);
                *vars = serde_json::to_value(list).unwrap_or(Value::Null);
            }
        }
        Ok(Some(value))
    })
}

#[tauri::command(async)]
pub fn db_delete_workspace(state: State<'_, AppState>, workspace_id: String) -> CmdResult<()> {
    state.with_db(|db| {
        let tx = db.connection().transaction().map_err(|e| e.to_string())?;
        Database::delete_workspace_cascade(&tx, &workspace_id).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn db_clear_history(state: State<'_, AppState>, workspace_id: String) -> CmdResult<()> {
    state.with_db(|db| Database::clear_history(db.connection(), &workspace_id, true).map_err(|e| e.to_string()))
}

/// Delete every record, keychain secret and the Git working tree.
#[tauri::command(async)]
pub fn db_wipe_all(state: State<'_, AppState>) -> CmdResult<()> {
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        // forget secret variable values that live in the keychain
        if let Ok(snapshot) = db.load_snapshot(&SecretStore::memory_only()) {
            let all_vars = snapshot
                .collections
                .iter()
                .flat_map(|c| c.variables.iter())
                .chain(snapshot.folders.iter().flat_map(|f| f.variables.iter()))
                .chain(snapshot.requests.iter().flat_map(|r| r.variables.iter()))
                .chain(snapshot.environments.iter().flat_map(|e| e.variables.iter()))
                .chain(snapshot.globals.iter());
            for v in all_vars.filter(|v| v.secret) {
                secrets.delete(&zorvilo_storage::secrets::var_key(&v.id));
            }
        }
        secrets.delete(GIT_TOKEN_KEY);
        Database::wipe_all(db.connection()).map_err(|e| e.to_string())
    })?;
    let repo = state.paths.repo_dir.clone();
    if repo.exists() {
        std::fs::remove_dir_all(&repo).map_err(|e| format!("could not remove the Git working tree: {e}"))?;
    }
    for dir in [&state.paths.responses_dir] {
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::create_dir_all(dir);
    }
    Ok(())
}

/// Recovery: move an unreadable database aside and start fresh.
#[tauri::command(async)]
pub fn db_reset(state: State<'_, AppState>) -> CmdResult<()> {
    state.reset_database()
}

/// Write a consistent copy of the database (`VACUUM INTO`) and return its path.
#[tauri::command(async)]
pub fn db_backup(state: State<'_, AppState>) -> CmdResult<String> {
    let dest = state.paths.backups_dir.join(format!("zorvilo-{}.sqlite3", chrono_stamp()));
    state.with_db(|db| Database::backup_to(db.connection(), &dest).map_err(|e| e.to_string()))?;
    Ok(dest.display().to_string())
}

fn chrono_stamp() -> String {
    zorvilo_core::ids::now_ms().to_string()
}

/// Startup housekeeping: drop trash older than the retention window.
pub fn purge_expired(state: &AppState) {
    let cutoff = zorvilo_core::ids::now_ms() - TRASH_RETENTION_MS;
    if let Err(e) = state.with_db(|db| Database::purge_trash_before(db.connection(), cutoff).map_err(|e| e.to_string())) {
        tracing::warn!(error = %e, "trash purge failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Records exactly as the React stores create them (lib/factories.ts).
    fn ui_request(id: &str, ws: &str, col: &str) -> Value {
        json!({
            "id": id, "workspaceId": ws, "collectionId": col, "folderId": null,
            "name": "Get users", "description": "", "protocol": "http", "method": "GET",
            "url": "{{base}}/users", "pathParams": [], "params": [],
            "headers": [{"id": "h1", "key": "Accept", "value": "application/json", "enabled": true, "description": ""}],
            "cookies": [],
            "auth": {"type": "inherit", "apiKey": {"key": "", "value": "", "addTo": "header"},
                     "bearer": {"token": "", "prefix": "Bearer"}, "basic": {"username": "", "password": ""},
                     "digest": {"username": "", "password": ""},
                     "oauth2": {"grantType": "client_credentials", "authUrl": "", "tokenUrl": "", "clientId": "",
                                "clientSecret": "", "scope": "", "accessToken": ""},
                     "jwt": {"secret": "", "payload": "{}", "algorithm": "HS256", "addTo": "header"},
                     "aws": {"accessKey": "", "secretKey": "", "region": "us-east-1", "service": "execute-api"}},
            "body": {"type": "none", "content": "", "graphql": {"query": "", "variables": "{}"},
                     "formUrlEncoded": [], "multipart": [], "binary": null},
            "preRequestScript": "", "testScript": "",
            "variables": [{"id": "rv1", "key": "token", "value": "s3cret", "enabled": true, "secret": true}],
            "settings": {"timeoutMs": 0, "followRedirects": true, "maxRedirects": 10, "verifySsl": true},
            "tags": [], "favorite": false, "sortOrder": 1731000000000.0, "createdAt": 1731000000000_i64, "updatedAt": 1731000000000_i64
        })
    }

    #[test]
    fn ui_records_round_trip_through_apply_and_load() {
        let mut db = Database::open_in_memory().unwrap();
        let secrets = SecretStore::memory_only();
        let ws = "w1";
        let writes: Vec<DbWrite> = serde_json::from_value(json!([
            {"op": "put", "table": "workspaces", "value": {"id": ws, "name": "My Workspace", "description": "", "createdAt": 1, "updatedAt": 1}},
            {"op": "put", "table": "collections", "value": {"id": "c1", "workspaceId": ws, "name": "API", "description": "",
                "variables": [], "auth": {"type": "none"}, "preRequestScript": "", "testScript": "", "sortOrder": 1, "createdAt": 1, "updatedAt": 1}},
            {"op": "put", "table": "folders", "value": {"id": "f1", "workspaceId": ws, "collectionId": "c1", "parentId": null,
                "name": "Users", "description": "", "sortOrder": 1, "createdAt": 1, "updatedAt": 1}},
            {"op": "put", "table": "requests", "value": ui_request("r1", ws, "c1")},
            {"op": "put", "table": "environments", "value": {"id": "e1", "workspaceId": ws, "name": "Dev",
                "variables": [{"id": "v1", "key": "base", "value": "http://localhost", "enabled": true, "secret": false}],
                "isActive": true, "createdAt": 1, "updatedAt": 1}},
            {"op": "put", "table": "variables", "value": {"id": "g1", "key": "g", "value": "1", "enabled": true, "secret": false, "scope": "global", "ownerId": ""}},
            {"op": "put", "table": "tabs", "value": {"id": "t1", "workspaceId": ws, "kind": "request", "requestId": "r1", "draft": null,
                "pinned": false, "sortOrder": 0, "createdAt": 1}},
            {"op": "put", "table": "history", "value": {"id": "h1", "workspaceId": ws, "requestId": "r1", "method": "GET", "url": "x",
                "status": 200, "statusText": "OK", "durationMs": 12.5, "sizeBytes": 10, "timestamp": 5, "favorite": false,
                "snapshot": ui_request("r1", ws, "c1")}},
            {"op": "put", "table": "responses", "value": {"id": "s1", "workspaceId": ws, "requestId": "r1", "requestName": "Get users",
                "name": "ok", "method": "GET", "url": "x", "createdAt": 3,
                "response": {"status": 200, "statusText": "OK", "headers": [["content-type", "application/json"]], "bodyText": "{}",
                             "bodyBase64": null, "contentType": "application/json", "sizeBytes": 2, "durationMs": 1.5, "timestamp": 3, "error": null}}},
            {"op": "put", "table": "trash", "value": {"id": "x1", "workspaceId": ws, "kind": "environment", "name": "Old", "deletedAt": 9,
                "payload": {"environment": {"id": "e2", "workspaceId": ws, "name": "Old", "variables": [], "isActive": false, "createdAt": 1, "updatedAt": 1}}}},
            {"op": "put", "table": "gitMeta", "value": {"id": "git-global", "workspaceId": "", "repoUrl": "https://example.com/r.git", "dir": "",
                "branch": "main", "username": "me", "token": "tok", "authorName": "A", "authorEmail": "a@b", "lastSyncAt": 0, "createdAt": 1}},
            {"op": "setting", "key": "ui", "value": {"activeWorkspaceId": ws}},
            {"op": "delete", "table": "tabs", "id": "missing"}
        ]))
        .unwrap();
        let warnings = apply_writes(&mut db, &secrets, writes).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");

        let data = db.load_workspace(ws, &secrets).unwrap();
        assert!(data.warnings.is_empty(), "{:?}", data.warnings);
        assert_eq!((data.collections.len(), data.folders.len(), data.requests.len()), (1, 1, 1));
        assert_eq!((data.environments.len(), data.tabs.len(), data.history.len(), data.saved_responses.len()), (1, 1, 1, 1));
        // secret variable value survives via the secret store, never stored in the row
        assert_eq!(data.requests[0].variables[0].value, "s3cret");
        let raw: String = db.connection().query_row("SELECT data FROM requests WHERE id = 'r1'", [], |r| r.get(0)).unwrap();
        assert!(!raw.contains("s3cret"));
        // git token goes to the keychain, not the database
        assert_eq!(secrets.get(GIT_TOKEN_KEY).as_deref(), Some("tok"));
        let meta: String = db.connection().query_row("SELECT data FROM git_meta", [], |r| r.get(0)).unwrap();
        assert!(!meta.contains("tok\""));
        assert_eq!(db.load_trash(ws).unwrap().len(), 1);
        assert_eq!(db.load_globals(&secrets).unwrap().len(), 1);
    }

    #[test]
    fn bad_records_are_reported_not_fatal() {
        let mut db = Database::open_in_memory().unwrap();
        let secrets = SecretStore::memory_only();
        let writes: Vec<DbWrite> = serde_json::from_value(json!([
            {"op": "put", "table": "workspaces", "value": {"id": "w", "name": 5}},
            {"op": "put", "table": "nope", "value": {}},
            {"op": "put", "table": "workspaces", "value": {"id": "w2", "name": "ok"}}
        ]))
        .unwrap();
        let warnings = apply_writes(&mut db, &secrets, writes).unwrap();
        assert_eq!(warnings.len(), 2);
        assert_eq!(db.load_workspaces().unwrap().0.len(), 1);
    }
}
