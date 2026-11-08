//! Trash: soft-deleted collections, folders, requests and environments (30 days).

use tauri::State;
use zorvilo_core::{TrashEntry, TrashKind, Workspace};
use zorvilo_storage::{Database, Table};

use super::CmdResult;
use crate::state::AppState;

#[tauri::command(async)]
pub fn trash_list(state: State<'_, AppState>, workspace_id: String) -> CmdResult<Vec<TrashEntry>> {
    state.with_db(|db| db.load_trash(&workspace_id).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn trash_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.with_db(|db| Database::delete(db.connection(), Table::Trash, &id).map_err(|e| e.to_string()))
}

#[tauri::command(async)]
pub fn trash_empty(state: State<'_, AppState>, workspace_id: String) -> CmdResult<()> {
    state.with_db(|db| {
        db.connection()
            .execute("DELETE FROM trash WHERE workspace_id = ?1", [&workspace_id])
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

/// Put a trashed entity back. Returns the workspace it was restored into.
///
/// Rules: a deleted workspace re-homes the entity into `active_workspace_id`;
/// folders/requests need their collection to exist; a missing parent folder
/// re-roots the entity at the collection root; environments come back inactive.
#[tauri::command(async)]
pub fn trash_restore(state: State<'_, AppState>, id: String, active_workspace_id: String) -> CmdResult<String> {
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        let entry: TrashEntry = db.get(Table::Trash, &id).map_err(|e| e.to_string())?.ok_or("This item is no longer in the trash.")?;
        let workspace_exists = db.get::<Workspace>(Table::Workspaces, &entry.workspace_id).map_err(|e| e.to_string())?.is_some();
        let target = if workspace_exists { entry.workspace_id.clone() } else { active_workspace_id.clone() };
        let p = entry.payload.clone();

        // validation needs reads, so do it before opening the transaction
        match entry.kind {
            TrashKind::Folder => {
                let root = p.folders.as_ref().and_then(|f| f.first()).ok_or("The trash entry is empty.")?;
                if !db.exists(Table::Collections, &root.collection_id) {
                    return Err("Cannot restore: the parent collection was deleted.".into());
                }
            }
            TrashKind::Request => {
                let r = p.requests.as_ref().and_then(|r| r.first()).ok_or("The trash entry is empty.")?;
                if !db.exists(Table::Collections, &r.collection_id) {
                    return Err("Cannot restore: the parent collection was deleted.".into());
                }
            }
            _ => {}
        }
        let parent_ok = |db: &Database, parent: &Option<String>| parent.as_deref().map(|id| db.exists(Table::Folders, id)).unwrap_or(true);
        let folder_parent_ok = p.folders.as_ref().and_then(|f| f.first()).map(|f| parent_ok(db, &f.parent_id)).unwrap_or(true);
        let request_folder_ok = p.requests.as_ref().and_then(|r| r.first()).map(|r| parent_ok(db, &r.folder_id)).unwrap_or(true);

        let tx = db.connection().transaction().map_err(|e| e.to_string())?;
        let e = |e: zorvilo_storage::StorageError| e.to_string();
        match entry.kind {
            TrashKind::Collection => {
                let mut c = p.collection.ok_or("The trash entry is empty.")?;
                c.workspace_id = target.clone();
                Database::put_collection(&tx, &c, &secrets).map_err(e)?;
                for mut f in p.folders.unwrap_or_default() {
                    f.workspace_id = target.clone();
                    Database::put_folder(&tx, &f, &secrets).map_err(e)?;
                }
                for mut r in p.requests.unwrap_or_default() {
                    r.workspace_id = target.clone();
                    Database::put_request(&tx, &r, &secrets).map_err(e)?;
                }
            }
            TrashKind::Folder => {
                for (i, mut f) in p.folders.unwrap_or_default().into_iter().enumerate() {
                    if i == 0 && !folder_parent_ok {
                        f.parent_id = None;
                    }
                    Database::put_folder(&tx, &f, &secrets).map_err(e)?;
                }
                for r in p.requests.unwrap_or_default() {
                    Database::put_request(&tx, &r, &secrets).map_err(e)?;
                }
            }
            TrashKind::Request => {
                let mut r = p.requests.and_then(|r| r.into_iter().next()).ok_or("The trash entry is empty.")?;
                if !request_folder_ok {
                    r.folder_id = None;
                }
                Database::put_request(&tx, &r, &secrets).map_err(e)?;
            }
            TrashKind::Environment => {
                let mut env = p.environment.ok_or("The trash entry is empty.")?;
                env.is_active = false;
                Database::put_environment(&tx, &env, &secrets).map_err(e)?;
            }
        }
        Database::delete(&tx, Table::Trash, &entry.id).map_err(e)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(target)
    })
}
