//! Git sync: one repository shared by all workspaces, using the same file
//! layout as the legacy app (`workspaces/<slug>-<id8>/…`). Secret variable
//! values are never written to the working tree.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use zorvilo_core::GitMeta;
use zorvilo_git::layout::{plan_merge, read_all, write_all, LocalView, RepoData};
use zorvilo_git::repo::{ChangedFile, FileStatus};
use zorvilo_git::{GitAuth, GitRepo, PullOutcome};
use zorvilo_storage::{Database, SecretStore};

use super::CmdResult;
use crate::state::{AppState, GIT_TOKEN_KEY};

/// Everything a Git operation needs, read from the database + keychain.
struct GitCtx {
    dir: PathBuf,
    remote: String,
    branch: String,
    auth: GitAuth,
    author_name: String,
    author_email: String,
}

fn ctx(state: &AppState) -> CmdResult<GitCtx> {
    let meta: GitMeta = state.with_db(|db| Ok(db.load_git_meta()))?.unwrap_or_default();
    let token = state.secrets.get(GIT_TOKEN_KEY).unwrap_or_default();
    Ok(GitCtx {
        dir: if meta.dir.trim().is_empty() { state.paths.repo_dir.clone() } else { PathBuf::from(meta.dir.trim()) },
        remote: meta.repo_url.trim().to_string(),
        branch: if meta.branch.trim().is_empty() { "main".into() } else { meta.branch.trim().to_string() },
        // token-only auth: GitHub/GitLab accept any username with a PAT
        auth: GitAuth { username: if meta.username.trim().is_empty() { "x-access-token".into() } else { meta.username.trim().to_string() }, token },
        // commits always use the built-in identity — no personal name/email is read or stored
        author_name: "Zorvilo".into(),
        author_email: "zorvilo@localhost".into(),
    })
}

fn err(e: zorvilo_git::GitError) -> String {
    let msg = e.to_string();
    if msg.to_ascii_lowercase().contains("auth") || msg.contains("401") || msg.contains("403") {
        format!("Git authentication failed — check the username/token in Git settings. ({msg})")
    } else {
        msg
    }
}

fn open_or_init(c: &GitCtx) -> CmdResult<GitRepo> {
    let repo = if GitRepo::is_repo(&c.dir) { GitRepo::open(&c.dir).map_err(err)? } else { GitRepo::init(&c.dir, &c.branch).map_err(err)? };
    if !c.remote.is_empty() && repo.remote_url().as_deref() != Some(c.remote.as_str()) {
        repo.set_remote(&c.remote).map_err(err)?;
    }
    Ok(repo)
}

fn open(c: &GitCtx) -> CmdResult<GitRepo> {
    if !GitRepo::is_repo(&c.dir) {
        return Err("No repository yet — clone or initialise one first.".into());
    }
    GitRepo::open(&c.dir).map_err(err)
}

/// Load every workspace's syncable data (secrets unsealed for merge-back).
fn load_repo_data(db: &Database, secrets: &SecretStore) -> CmdResult<RepoData> {
    let (workspaces, _) = db.load_workspaces().map_err(|e| e.to_string())?;
    let mut data = RepoData { workspaces: workspaces.clone(), ..Default::default() };
    for ws in &workspaces {
        let w = db.load_workspace(&ws.id, secrets).map_err(|e| e.to_string())?;
        data.collections.extend(w.collections);
        data.folders.extend(w.folders);
        // drafts (no collection) never go to Git
        data.requests.extend(w.requests.into_iter().filter(|r| !r.collection_id.is_empty()));
        data.environments.extend(w.environments);
    }
    Ok(data)
}

fn write_tree(state: &AppState, dir: &Path) -> CmdResult<()> {
    let secrets = state.secrets.clone();
    let data = state.with_db(|db| load_repo_data(db, &secrets))?;
    write_all(dir, &data, false).map_err(|e| format!("could not write repository files: {e}"))?;
    Ok(())
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    /// number of records created, updated or removed locally
    imported: usize,
    /// workspaces present in the repository
    workspace_ids: Vec<String>,
    warnings: Vec<String>,
}

/// Merge the working tree into the database. Default: newer local edits win;
/// `force`: the repository is the source of truth.
fn read_into_db(state: &AppState, dir: &Path, force: bool) -> CmdResult<ImportOutcome> {
    let (incoming, warnings) = read_all(dir);
    let workspace_ids = incoming.workspaces.iter().map(|w| w.id.clone()).collect();
    let secrets = state.secrets.clone();
    let imported = state.with_db(|db| {
        let local = load_repo_data(db, &secrets)?;
        let workspaces: HashMap<_, _> = local.workspaces.into_iter().map(|w| (w.id.clone(), w)).collect();
        let collections: HashMap<_, _> = local.collections.into_iter().map(|c| (c.id.clone(), c)).collect();
        let folders: HashMap<_, _> = local.folders.into_iter().map(|f| (f.id.clone(), f)).collect();
        let requests: HashMap<_, _> = local.requests.into_iter().map(|r| (r.id.clone(), r)).collect();
        let environments: HashMap<_, _> = local.environments.into_iter().map(|e| (e.id.clone(), e)).collect();
        let view = LocalView {
            workspaces: &workspaces,
            collections: &collections,
            folders: &folders,
            requests: &requests,
            environments: &environments,
        };
        let plan = plan_merge(&view, incoming, force);
        let count = plan.change_count();
        let tx = db.connection().transaction().map_err(|e| e.to_string())?;
        let e = |e: zorvilo_storage::StorageError| e.to_string();
        for w in &plan.workspaces {
            Database::put_workspace(&tx, w).map_err(e)?;
        }
        for c in &plan.collections {
            Database::put_collection(&tx, c, &secrets).map_err(e)?;
        }
        for f in &plan.folders {
            Database::put_folder(&tx, f, &secrets).map_err(e)?;
        }
        for r in &plan.requests {
            Database::put_request(&tx, r, &secrets).map_err(e)?;
        }
        for env in &plan.environments {
            Database::put_environment(&tx, env, &secrets).map_err(e)?;
        }
        use zorvilo_storage::Table;
        for (table, ids) in [
            (Table::Collections, &plan.delete_collections),
            (Table::Folders, &plan.delete_folders),
            (Table::Requests, &plan.delete_requests),
            (Table::Environments, &plan.delete_environments),
        ] {
            for id in ids {
                Database::delete(&tx, table, id).map_err(e)?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    })?;
    Ok(ImportOutcome { imported, workspace_ids, warnings })
}

fn touch_last_sync(state: &AppState) {
    let _ = state.with_db(|db| {
        let mut meta = db.load_git_meta().unwrap_or_default();
        meta.last_sync_at = zorvilo_core::ids::now_ms();
        Database::put_git_meta(db.connection(), &meta).map_err(|e| e.to_string())
    });
}

/// Run a Git job on the blocking pool while holding the Git lock.
async fn job<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppState) -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    let state = app.state::<AppState>();
    let _guard = state.git_lock.lock().await;
    let app2 = app.clone();
    super::blocking(move || f(&app2.state::<AppState>())).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFileOut {
    path: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOut {
    branch: String,
    changed_files: Vec<ChangedFileOut>,
    ahead: bool,
    ahead_count: usize,
    behind: usize,
    merging: bool,
    conflicts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    has_repo: bool,
    status: Option<StatusOut>,
    branches: Vec<String>,
    remote_url: Option<String>,
}

fn file_status(f: &ChangedFile) -> &'static str {
    match f.status {
        FileStatus::Added | FileStatus::Untracked => "added",
        FileStatus::Deleted => "deleted",
        FileStatus::Conflicted => "conflicted",
        FileStatus::Modified | FileStatus::Renamed => "modified",
    }
}

fn info(c: &GitCtx) -> CmdResult<GitInfo> {
    if !GitRepo::is_repo(&c.dir) {
        return Ok(GitInfo { has_repo: false, status: None, branches: Vec::new(), remote_url: None });
    }
    let repo = GitRepo::open(&c.dir).map_err(err)?;
    let s = repo.status().map_err(err)?;
    Ok(GitInfo {
        has_repo: true,
        status: Some(StatusOut {
            branch: s.branch.clone(),
            changed_files: s.changed.iter().map(|f| ChangedFileOut { path: f.path.clone(), status: file_status(f) }).collect(),
            ahead: s.ahead > 0,
            ahead_count: s.ahead,
            behind: s.behind,
            merging: s.merging,
            conflicts: s.conflicts.clone(),
        }),
        branches: repo.local_branches().unwrap_or_default(),
        remote_url: repo.remote_url(),
    })
}

/// Repository presence, status and branches. With `refresh_tree` the working
/// tree is first regenerated from the database so the status shows what a
/// commit would contain.
#[tauri::command]
pub async fn git_info(app: AppHandle, refresh_tree: Option<bool>) -> CmdResult<GitInfo> {
    job(app, move |state| {
        let c = ctx(state)?;
        if refresh_tree.unwrap_or(false) && GitRepo::is_repo(&c.dir) {
            write_tree(state, &c.dir)?;
        }
        info(&c)
    })
    .await
}

#[tauri::command]
pub async fn git_clone(app: AppHandle) -> CmdResult<ImportOutcome> {
    job(app, |state| {
        let c = ctx(state)?;
        if c.remote.is_empty() {
            return Err("Enter a repository URL first".into());
        }
        // clones always go into the app-managed working tree, never a user's own folder
        let mut c = c;
        c.dir = state.paths.repo_dir.clone();
        state.with_db(|db| {
            let mut meta = db.load_git_meta().unwrap_or_default();
            meta.dir = String::new();
            Database::put_git_meta(db.connection(), &meta).map_err(|e| e.to_string())
        })?;
        // the working tree is app-managed: start from a clean directory
        if c.dir.exists() {
            std::fs::remove_dir_all(&c.dir).map_err(|e| format!("could not clear the old working tree: {e}"))?;
        }
        GitRepo::clone(&c.remote, &c.dir, &c.auth, Some(&c.branch)).map_err(err)?;
        let out = read_into_db(state, &c.dir, false)?;
        touch_last_sync(state);
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn git_init(app: AppHandle) -> CmdResult<()> {
    job(app, |state| {
        let c = ctx(state)?;
        open_or_init(&c)?;
        write_tree(state, &c.dir)
    })
    .await
}

/// Write the current data and commit it. Returns the new commit id, or null when nothing changed.
#[tauri::command]
pub async fn git_commit(app: AppHandle, message: String) -> CmdResult<Option<String>> {
    job(app, move |state| {
        let c = ctx(state)?;
        let repo = open_or_init(&c)?;
        write_tree(state, &c.dir)?;
        let msg = if message.trim().is_empty() { "Update collections".to_string() } else { message };
        Ok(repo.commit_all(&msg, &c.author_name, &c.author_email).map_err(err)?.map(|oid| oid.to_string()))
    })
    .await
}

fn pull_or_abort(repo: &GitRepo, c: &GitCtx) -> CmdResult<()> {
    match repo.pull(&c.auth, &c.branch, &c.author_name, &c.author_email).map_err(err)? {
        PullOutcome::Conflicts(paths) => {
            let _ = repo.abort_merge();
            Err(format!(
                "Pull hit merge conflicts in {} — your local commit is kept. Use \"Pull latest\" to replace local data with the remote, or edit the conflicting items and sync again.",
                paths.join(", ")
            ))
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn git_pull(app: AppHandle) -> CmdResult<ImportOutcome> {
    job(app, |state| {
        let c = ctx(state)?;
        let repo = open(&c)?;
        if repo.is_merging() {
            repo.abort_merge().map_err(err)?;
        }
        pull_or_abort(&repo, &c)?;
        let out = read_into_db(state, &c.dir, false)?;
        touch_last_sync(state);
        Ok(out)
    })
    .await
}

/// Discard local changes: hard-reset to the remote branch and make the repository the source of truth.
#[tauri::command]
pub async fn git_reset_to_remote(app: AppHandle) -> CmdResult<ImportOutcome> {
    job(app, |state| {
        let c = ctx(state)?;
        let repo = open_or_init(&c)?;
        if repo.is_merging() {
            repo.abort_merge().map_err(err)?;
        }
        repo.reset_to_remote(&c.auth, &c.branch).map_err(err)?;
        let out = read_into_db(state, &c.dir, true)?;
        touch_last_sync(state);
        Ok(out)
    })
    .await
}

/// Discard all uncommitted changes: the working tree goes back to the last
/// commit and the app's data is replaced with that committed state.
#[tauri::command]
pub async fn git_discard_changes(app: AppHandle) -> CmdResult<ImportOutcome> {
    job(app, |state| {
        let c = ctx(state)?;
        let repo = open(&c)?;
        // the working tree mirrors the database; regenerate it so every edit is visible to git
        write_tree(state, &c.dir)?;
        repo.discard_local_changes().map_err(err)?;
        read_into_db(state, &c.dir, true)
    })
    .await
}

#[tauri::command]
pub async fn git_push(app: AppHandle) -> CmdResult<()> {
    job(app, |state| {
        let c = ctx(state)?;
        let repo = open_or_init(&c)?;
        repo.push(&c.auth, &c.branch).map_err(err)?;
        touch_last_sync(state);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_checkout(app: AppHandle, branch: String) -> CmdResult<ImportOutcome> {
    job(app, move |state| {
        let c = ctx(state)?;
        let repo = open(&c)?;
        let exists = repo.local_branches().unwrap_or_default().contains(&branch);
        repo.checkout_branch(&branch, !exists).map_err(err)?;
        read_into_db(state, &c.dir, true)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    committed: bool,
    pushed: bool,
    import: ImportOutcome,
    /// possible credentials found in files that were committed
    secret_warnings: Vec<String>,
}

/// Write → commit → pull (merge) → read back → push.
#[tauri::command]
pub async fn git_sync(app: AppHandle, message: Option<String>) -> CmdResult<SyncOutcome> {
    job(app, move |state| {
        let c = ctx(state)?;
        let repo = open_or_init(&c)?;
        if repo.is_merging() {
            repo.abort_merge().map_err(err)?;
        }
        write_tree(state, &c.dir)?;
        let status = repo.status().map_err(err)?;
        let files: Vec<String> = status.changed.iter().filter(|f| f.status != FileStatus::Deleted).map(|f| f.path.clone()).collect();
        let secret_warnings = zorvilo_git::secret_scan::scan_files(&c.dir, &files)
            .into_iter()
            .map(|f| format!("{}:{} looks like a {} ({})", f.file, f.line, f.kind, f.preview))
            .collect();
        let msg = message.filter(|m| !m.trim().is_empty()).unwrap_or_else(|| format!("Sync {}", zorvilo_core::util::format_timestamp(zorvilo_core::ids::now_ms())));
        let committed = repo.commit_all(&msg, &c.author_name, &c.author_email).map_err(err)?.is_some();
        let mut pushed = false;
        let import = if repo.remote_url().is_some() {
            pull_or_abort(&repo, &c)?;
            let import = read_into_db(state, &c.dir, false)?;
            repo.push(&c.auth, &c.branch).map_err(err)?;
            pushed = true;
            import
        } else {
            ImportOutcome::default()
        };
        touch_last_sync(state);
        Ok(SyncOutcome { committed, pushed, import, secret_warnings })
    })
    .await
}

/// Quiet fetch; returns how many remote commits are not yet pulled.
#[tauri::command]
pub async fn git_fetch(app: AppHandle) -> CmdResult<usize> {
    job(app, |state| {
        let c = ctx(state)?;
        if c.remote.is_empty() || !GitRepo::is_repo(&c.dir) {
            return Ok(0);
        }
        let repo = GitRepo::open(&c.dir).map_err(err)?;
        let (_ahead, behind) = repo.fetch(&c.auth, &c.branch).map_err(err)?;
        Ok(behind)
    })
    .await
}

#[derive(Serialize)]
pub struct RepoFile {
    path: String,
    base64: String,
}

/// Files for a ZIP backup: the whole repository (with history) when one
/// exists, otherwise the freshly written `workspaces/` tree.
#[tauri::command]
pub async fn git_backup_files(app: AppHandle) -> CmdResult<Vec<RepoFile>> {
    job(app, |state| {
        let c = ctx(state)?;
        let has_repo = GitRepo::is_repo(&c.dir);
        std::fs::create_dir_all(&c.dir).map_err(|e| e.to_string())?;
        write_tree(state, &c.dir)?;
        let root = if has_repo { c.dir.clone() } else { c.dir.join("workspaces") };
        let prefix = if has_repo { "" } else { "workspaces/" };
        let mut out = Vec::new();
        collect(&root, &root, prefix, &mut out)?;
        Ok(out)
    })
    .await
}

fn collect(root: &Path, dir: &Path, prefix: &str, out: &mut Vec<RepoFile>) -> CmdResult<()> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            collect(root, &path, prefix, out)?;
        } else {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            out.push(RepoFile { path: format!("{prefix}{rel}"), base64: base64::engine::general_purpose::STANDARD.encode(bytes) });
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLocalOutcome {
    dir: String,
    remote_url: String,
    branch: String,
    import: ImportOutcome,
}

/// Pick an existing repository folder on this machine, use it as the working
/// tree and import its collections. Null when the picker is cancelled.
#[tauri::command]
pub async fn git_open_local(app: AppHandle) -> CmdResult<Option<OpenLocalOutcome>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = {
        let app = app.clone();
        super::blocking(move || Ok(app.dialog().file().blocking_pick_folder())).await?
    };
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked.into_path().map_err(|e| format!("invalid folder: {e}"))?;
    job(app, move |state| {
        if !GitRepo::is_repo(&dir) {
            return Err(format!("{} is not a Git repository — choose the folder that contains .git", dir.display()));
        }
        let repo = GitRepo::open(&dir).map_err(err)?;
        let remote_url = repo.remote_url().unwrap_or_default();
        let branch = repo.current_branch();
        let dir_str = dir.display().to_string();
        state.with_db(|db| {
            let mut meta = db.load_git_meta().unwrap_or_default();
            meta.dir = dir_str.clone();
            meta.repo_url = remote_url.clone();
            meta.branch = branch.clone();
            Database::put_git_meta(db.connection(), &meta).map_err(|e| e.to_string())
        })?;
        let import = read_into_db(state, &dir, false)?;
        touch_last_sync(state);
        Ok(OpenLocalOutcome { dir: dir_str, remote_url, branch, import })
    })
    .await
    .map(Some)
}
