//! Repository file layout — identical to the legacy app so existing repos
//! keep working:
//!
//! ```text
//! workspaces/<ws-slug>-<id8>/workspace.json
//! workspaces/<ws-slug>-<id8>/collections/<slug>-<id8>.json
//! workspaces/<ws-slug>-<id8>/environments/<slug>-<id8>.json
//! collections/*.json, environments/*.json        (legacy single-workspace layout, read only)
//! ```

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zorvilo_core::util::slugify;
use zorvilo_core::{ApiRequest, AuthConfig, Collection, Environment, Folder, Variable, Workspace};

#[derive(Debug, Clone, Default)]
pub struct RepoData {
    pub workspaces: Vec<Workspace>,
    pub collections: Vec<Collection>,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub environments: Vec<Environment>,
}

#[derive(Serialize, Deserialize)]
struct CollectionFile {
    #[serde(rename = "__zorvilo")]
    tag: String,
    version: u32,
    collection: Collection,
    #[serde(default)]
    folders: Vec<Folder>,
    #[serde(default)]
    requests: Vec<ApiRequest>,
}

#[derive(Serialize, Deserialize)]
struct EnvironmentFile {
    #[serde(rename = "__zorvilo")]
    tag: String,
    version: u32,
    environment: Environment,
}

fn id8(id: &str) -> String {
    id.chars().take(8).collect()
}

pub fn workspace_dir(ws: &Workspace) -> String {
    format!("workspaces/{}-{}", slugify(&ws.name), id8(&ws.id))
}

/// Secret variable values never leave the machine.
pub fn redact_vars(vars: &[Variable]) -> Vec<Variable> {
    vars.iter().map(|v| if v.secret { Variable { value: String::new(), ..v.clone() } } else { v.clone() }).collect()
}

fn literal(s: &str) -> bool {
    !s.trim().is_empty() && !s.contains("{{")
}

fn blank_if_literal(s: &mut String) {
    if literal(s) {
        s.clear();
    }
}

/// Blank literal credentials in an auth config (values that are `{{variables}}` are kept).
pub fn redact_auth(auth: &AuthConfig) -> AuthConfig {
    let mut a = auth.clone();
    blank_if_literal(&mut a.api_key.value);
    blank_if_literal(&mut a.bearer.token);
    blank_if_literal(&mut a.basic.password);
    blank_if_literal(&mut a.digest.password);
    blank_if_literal(&mut a.jwt.secret);
    blank_if_literal(&mut a.oauth2.client_secret);
    blank_if_literal(&mut a.oauth2.access_token);
    blank_if_literal(&mut a.oauth2.refresh_token);
    blank_if_literal(&mut a.oauth2.password);
    blank_if_literal(&mut a.aws.secret_key);
    blank_if_literal(&mut a.aws.session_token);
    a
}

/// Fill credentials that were redacted in the repo from the local copy.
pub fn restore_auth(incoming: &AuthConfig, local: Option<&AuthConfig>) -> AuthConfig {
    let Some(l) = local else { return incoming.clone() };
    let mut a = incoming.clone();
    fn fill(dst: &mut String, src: &str) {
        if dst.is_empty() && !src.is_empty() {
            *dst = src.to_string();
        }
    }
    fill(&mut a.api_key.value, &l.api_key.value);
    fill(&mut a.bearer.token, &l.bearer.token);
    fill(&mut a.basic.password, &l.basic.password);
    fill(&mut a.digest.password, &l.digest.password);
    fill(&mut a.jwt.secret, &l.jwt.secret);
    fill(&mut a.oauth2.client_secret, &l.oauth2.client_secret);
    fill(&mut a.oauth2.access_token, &l.oauth2.access_token);
    fill(&mut a.oauth2.refresh_token, &l.oauth2.refresh_token);
    fill(&mut a.oauth2.password, &l.oauth2.password);
    fill(&mut a.aws.secret_key, &l.aws.secret_key);
    fill(&mut a.aws.session_token, &l.aws.session_token);
    a
}

/// Restore locally-known secret variable values into redacted incoming variables.
pub fn merge_secret_vars(incoming: &[Variable], local: Option<&[Variable]>) -> Vec<Variable> {
    let Some(local) = local else { return incoming.to_vec() };
    incoming
        .iter()
        .map(|v| {
            if !v.secret || !v.value.is_empty() {
                return v.clone();
            }
            match local.iter().find(|l| l.key == v.key && l.secret) {
                Some(l) => Variable { value: l.value.clone(), ..v.clone() },
                None => v.clone(),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Default)]
pub struct WriteSummary {
    pub written: usize,
    pub removed: usize,
}

fn json_files_under(root: &Path, rel: &str, out: &mut Vec<String>) {
    let dir = root.join(rel);
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let child = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue; // never follow links out of the repo
        }
        if ft.is_dir() {
            json_files_under(root, &child, out);
        } else if name.ends_with(".json") {
            out.push(child);
        }
    }
}

fn write_if_changed(path: &Path, content: &str) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).map(|c| c == content).unwrap_or(false) {
        return Ok(false);
    }
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, content)?;
    Ok(true)
}

/// Serialise every workspace into the working tree and remove files for
/// entities that no longer exist.
pub fn write_all(root: &Path, data: &RepoData, redact_credentials: bool) -> std::io::Result<WriteSummary> {
    let mut summary = WriteSummary::default();
    let mut wanted: HashSet<String> = HashSet::new();
    for ws in &data.workspaces {
        let dir = workspace_dir(ws);
        let ws_path = format!("{dir}/workspace.json");
        if write_if_changed(&root.join(&ws_path), &serde_json::to_string_pretty(ws)?)? {
            summary.written += 1;
        }
        wanted.insert(ws_path);

        for c in data.collections.iter().filter(|c| c.workspace_id == ws.id) {
            let mut collection = Collection { variables: redact_vars(&c.variables), ..c.clone() };
            if redact_credentials {
                collection.auth = redact_auth(&collection.auth);
            }
            let folders: Vec<Folder> = data
                .folders
                .iter()
                .filter(|f| f.collection_id == c.id)
                .map(|f| {
                    let mut f = Folder { variables: redact_vars(&f.variables), ..f.clone() };
                    if redact_credentials {
                        f.auth = redact_auth(&f.auth);
                    }
                    f
                })
                .collect();
            let requests: Vec<ApiRequest> = data
                .requests
                .iter()
                .filter(|r| r.collection_id == c.id)
                .map(|r| {
                    let mut r = ApiRequest { variables: redact_vars(&r.variables), ..r.clone() };
                    if redact_credentials {
                        r.auth = redact_auth(&r.auth);
                    }
                    r
                })
                .collect();
            let file = CollectionFile { tag: "collection".into(), version: 1, collection, folders, requests };
            let path = format!("{dir}/collections/{}-{}.json", slugify(&c.name), id8(&c.id));
            if write_if_changed(&root.join(&path), &serde_json::to_string_pretty(&file)?)? {
                summary.written += 1;
            }
            wanted.insert(path);
        }
        for e in data.environments.iter().filter(|e| e.workspace_id == ws.id) {
            let file = EnvironmentFile {
                tag: "environment".into(),
                version: 1,
                environment: Environment { variables: redact_vars(&e.variables), ..e.clone() },
            };
            let path = format!("{dir}/environments/{}-{}.json", slugify(&e.name), id8(&e.id));
            if write_if_changed(&root.join(&path), &serde_json::to_string_pretty(&file)?)? {
                summary.written += 1;
            }
            wanted.insert(path);
        }
    }
    let mut existing = Vec::new();
    json_files_under(root, "workspaces", &mut existing);
    json_files_under(root, "collections", &mut existing);
    json_files_under(root, "environments", &mut existing);
    if root.join("workspace.json").exists() {
        existing.push("workspace.json".into());
    }
    for path in existing {
        if !wanted.contains(&path) {
            std::fs::remove_file(root.join(&path))?;
            summary.removed += 1;
        }
    }
    Ok(summary)
}

/// Read every workspace/collection/environment file in the working tree.
pub fn read_all(root: &Path) -> (RepoData, Vec<String>) {
    let mut data = RepoData::default();
    let mut warnings = Vec::new();
    let mut paths = Vec::new();
    json_files_under(root, "workspaces", &mut paths);
    json_files_under(root, "collections", &mut paths);
    json_files_under(root, "environments", &mut paths);
    paths.sort();
    for path in paths {
        let full: PathBuf = root.join(&path);
        let Ok(raw) = std::fs::read_to_string(&full) else { continue };
        if raw.len() > 64 * 1024 * 1024 {
            warnings.push(format!("{path}: skipped (larger than 64 MB)"));
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                warnings.push(format!("{path}: invalid JSON ({e})"));
                continue;
            }
        };
        let tag = value.get("__zorvilo").and_then(|t| t.as_str()).unwrap_or("");
        if path.ends_with("/workspace.json") && tag.is_empty() {
            match serde_json::from_value::<Workspace>(value) {
                Ok(ws) if !ws.id.is_empty() => data.workspaces.push(ws),
                Ok(_) => warnings.push(format!("{path}: workspace without id")),
                Err(e) => warnings.push(format!("{path}: {e}")),
            }
            continue;
        }
        match tag {
            "collection" => match serde_json::from_value::<CollectionFile>(value) {
                Ok(f) => {
                    data.collections.push(f.collection);
                    data.folders.extend(f.folders);
                    data.requests.extend(f.requests);
                }
                Err(e) => warnings.push(format!("{path}: {e}")),
            },
            "environment" => match serde_json::from_value::<EnvironmentFile>(value) {
                Ok(f) => data.environments.push(f.environment),
                Err(e) => warnings.push(format!("{path}: {e}")),
            },
            _ => warnings.push(format!("{path}: not a Zorvilo file — ignored")),
        }
    }
    (data, warnings)
}

/// Local state view used to compute a merge plan.
pub struct LocalView<'a> {
    pub workspaces: &'a HashMap<String, Workspace>,
    pub collections: &'a HashMap<String, Collection>,
    pub folders: &'a HashMap<String, Folder>,
    pub requests: &'a HashMap<String, ApiRequest>,
    pub environments: &'a HashMap<String, Environment>,
}

/// Changes to apply locally after reading the repository.
#[derive(Debug, Clone, Default)]
pub struct MergePlan {
    pub workspaces: Vec<Workspace>,
    pub collections: Vec<Collection>,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub environments: Vec<Environment>,
    pub delete_collections: Vec<String>,
    pub delete_folders: Vec<String>,
    pub delete_requests: Vec<String>,
    pub delete_environments: Vec<String>,
}

impl MergePlan {
    pub fn change_count(&self) -> usize {
        self.workspaces.len()
            + self.collections.len()
            + self.folders.len()
            + self.requests.len()
            + self.environments.len()
            + self.delete_collections.len()
            + self.delete_folders.len()
            + self.delete_requests.len()
            + self.delete_environments.len()
    }
}

/// Default: newer local edits win (per-record `updatedAt`).
/// `force`: the repository is the source of truth — records are overwritten
/// and local entities missing from the repo are deleted (only within
/// workspaces the repository knows about; local-only workspaces are untouched).
pub fn plan_merge(local: &LocalView<'_>, incoming: RepoData, force: bool) -> MergePlan {
    let mut plan = MergePlan::default();
    let repo_ws: HashSet<String> = incoming.workspaces.iter().map(|w| w.id.clone()).collect();
    let col_ids: HashSet<String> = incoming.collections.iter().map(|c| c.id.clone()).collect();
    let folder_ids: HashSet<String> = incoming.folders.iter().map(|f| f.id.clone()).collect();
    let req_ids: HashSet<String> = incoming.requests.iter().map(|r| r.id.clone()).collect();
    let env_ids: HashSet<String> = incoming.environments.iter().map(|e| e.id.clone()).collect();

    for w in incoming.workspaces {
        let l = local.workspaces.get(&w.id);
        if force || l.map(|l| l.updated_at <= w.updated_at && l != &w).unwrap_or(true) {
            plan.workspaces.push(w);
        }
    }
    for c in incoming.collections {
        let l = local.collections.get(&c.id);
        if force || l.map(|l| l.updated_at < c.updated_at).unwrap_or(true) {
            let merged = Collection {
                variables: merge_secret_vars(&c.variables, l.map(|l| l.variables.as_slice())),
                auth: restore_auth(&c.auth, l.map(|l| &l.auth)),
                ..c
            };
            if l != Some(&merged) {
                plan.collections.push(merged);
            }
        }
    }
    for f in incoming.folders {
        let l = local.folders.get(&f.id);
        if force || l.map(|l| l.updated_at < f.updated_at).unwrap_or(true) {
            let merged = Folder {
                variables: merge_secret_vars(&f.variables, l.map(|l| l.variables.as_slice())),
                auth: restore_auth(&f.auth, l.map(|l| &l.auth)),
                ..f
            };
            if l != Some(&merged) {
                plan.folders.push(merged);
            }
        }
    }
    for r in incoming.requests {
        let l = local.requests.get(&r.id);
        if force || l.map(|l| l.updated_at < r.updated_at).unwrap_or(true) {
            let merged = ApiRequest {
                variables: merge_secret_vars(&r.variables, l.map(|l| l.variables.as_slice())),
                auth: restore_auth(&r.auth, l.map(|l| &l.auth)),
                ..r
            };
            if l != Some(&merged) {
                plan.requests.push(merged);
            }
        }
    }
    for e in incoming.environments {
        let l = local.environments.get(&e.id);
        if force || l.map(|l| l.updated_at < e.updated_at).unwrap_or(true) {
            // the active flag is a local preference
            let merged = Environment {
                variables: merge_secret_vars(&e.variables, l.map(|l| l.variables.as_slice())),
                is_active: l.map(|l| l.is_active).unwrap_or(false),
                ..e
            };
            if l != Some(&merged) {
                plan.environments.push(merged);
            }
        }
    }
    if force && !repo_ws.is_empty() {
        for c in local.collections.values().filter(|c| repo_ws.contains(&c.workspace_id) && !col_ids.contains(&c.id)) {
            plan.delete_collections.push(c.id.clone());
        }
        for f in local.folders.values().filter(|f| repo_ws.contains(&f.workspace_id) && !folder_ids.contains(&f.id)) {
            plan.delete_folders.push(f.id.clone());
        }
        for r in local
            .requests
            .values()
            .filter(|r| repo_ws.contains(&r.workspace_id) && !r.collection_id.is_empty() && !req_ids.contains(&r.id))
        {
            plan.delete_requests.push(r.id.clone());
        }
        for e in local.environments.values().filter(|e| repo_ws.contains(&e.workspace_id) && !env_ids.contains(&e.id)) {
            plan.delete_environments.push(e.id.clone());
        }
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use zorvilo_core::AuthType;

    fn sample() -> RepoData {
        let ws = Workspace { name: "Team API".into(), ..Default::default() };
        let mut col = Collection { workspace_id: ws.id.clone(), name: "Users".into(), ..Default::default() };
        col.variables.push(Variable { key: "k".into(), value: "secret!".into(), secret: true, ..Default::default() });
        col.auth = AuthConfig::of(AuthType::Bearer);
        col.auth.bearer.token = "literal-token".into();
        let req = ApiRequest { workspace_id: ws.id.clone(), collection_id: col.id.clone(), ..Default::default() };
        let env = Environment { workspace_id: ws.id.clone(), name: "Dev".into(), ..Default::default() };
        RepoData { workspaces: vec![ws], collections: vec![col], folders: vec![], requests: vec![req], environments: vec![env] }
    }

    #[test]
    fn write_read_round_trip_with_redaction() {
        let dir = std::env::temp_dir().join(format!("zorvilo-layout-{}-{}", std::process::id(), zorvilo_core::ids::now_ms()));
        let data = sample();
        let s = write_all(&dir, &data, true).unwrap();
        assert_eq!(s.written, 3);
        let all = {
            let mut v = Vec::new();
            json_files_under(&dir, "workspaces", &mut v);
            v.iter().map(|p| std::fs::read_to_string(dir.join(p)).unwrap()).collect::<String>()
        };
        assert!(!all.contains("secret!"), "secret variable leaked");
        assert!(!all.contains("literal-token"), "credential leaked");
        let (back, warnings) = read_all(&dir);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(back.collections.len(), 1);
        assert_eq!(back.requests.len(), 1);
        // unchanged rewrite touches nothing
        assert_eq!(write_all(&dir, &data, true).unwrap().written, 0);
        // deleting an environment removes its file
        let mut fewer = data.clone();
        fewer.environments.clear();
        assert_eq!(write_all(&dir, &fewer, true).unwrap().removed, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn merge_keeps_newer_local_and_restores_secrets() {
        let data = sample();
        let local_col = data.collections[0].clone();
        let mut incoming = data.clone();
        incoming.collections[0].variables = redact_vars(&incoming.collections[0].variables);
        incoming.collections[0].auth = redact_auth(&incoming.collections[0].auth);
        incoming.collections[0].updated_at += 10;
        incoming.collections[0].name = "Renamed".into();
        let ws: HashMap<_, _> = data.workspaces.iter().map(|w| (w.id.clone(), w.clone())).collect();
        let cols: HashMap<_, _> = [(local_col.id.clone(), local_col)].into_iter().collect();
        let empty_f = HashMap::new();
        let empty_r = HashMap::new();
        let empty_e = HashMap::new();
        let view = LocalView { workspaces: &ws, collections: &cols, folders: &empty_f, requests: &empty_r, environments: &empty_e };
        let plan = plan_merge(&view, incoming, false);
        assert_eq!(plan.collections.len(), 1);
        assert_eq!(plan.collections[0].name, "Renamed");
        assert_eq!(plan.collections[0].variables[0].value, "secret!");
        assert_eq!(plan.collections[0].auth.bearer.token, "literal-token");
    }
}
