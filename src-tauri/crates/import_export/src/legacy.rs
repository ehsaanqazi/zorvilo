//! Migration from the legacy web app.
//!
//! The legacy app stored data in browser IndexedDB, which a native app
//! cannot read. Supported migration inputs, all produced by the legacy app
//! itself:
//!
//! * **Workspace bundle** (`Workspaces → Export`, `__zorvilo: "workspace-bundle"`)
//! * **Git repository files** (`__zorvilo: "collection" | "environment"`) —
//!   point the new app at the same repo, or import the files directly
//! * **History / saved responses exports** (`__zorvilo: "history" | "saved-responses"`)
//!
//! Records keep their original ids. Unknown fields are preserved in each
//! model's `extra` map. Invalid records are reported, never silently dropped.

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use zorvilo_core::{ids::new_id, ApiRequest, Collection, Environment, Folder, HistoryEntry, SavedResponse, Workspace};

use crate::{ImportError, ImportResult};

#[derive(Debug, Clone, Default)]
pub struct LegacyImport {
    pub workspace: Option<Workspace>,
    pub collections: Vec<Collection>,
    pub folders: Vec<Folder>,
    pub requests: Vec<ApiRequest>,
    pub environments: Vec<Environment>,
    pub history: Vec<HistoryEntry>,
    pub saved_responses: Vec<SavedResponse>,
    pub report: ImportReport,
}

#[derive(Debug, Clone, Default)]
pub struct ImportReport {
    pub imported: usize,
    pub failed: Vec<String>,
    pub warnings: Vec<String>,
    /// records that carried fields this version doesn't know (kept verbatim)
    pub records_with_unknown_fields: usize,
}

impl ImportReport {
    pub fn summary(&self) -> String {
        let mut s = format!("{} records imported", self.imported);
        if !self.failed.is_empty() {
            s.push_str(&format!(", {} failed", self.failed.len()));
        }
        if self.records_with_unknown_fields > 0 {
            s.push_str(&format!(", {} with extra fields preserved", self.records_with_unknown_fields));
        }
        s
    }
}

fn decode_list<T: serde::de::DeserializeOwned>(
    value: Option<&Value>,
    label: &str,
    report: &mut ImportReport,
    has_extra: impl Fn(&T) -> bool,
) -> Vec<T> {
    let mut out = Vec::new();
    let Some(Value::Array(items)) = value else { return out };
    for (i, item) in items.iter().enumerate() {
        match serde_json::from_value::<T>(item.clone()) {
            Ok(v) => {
                if has_extra(&v) {
                    report.records_with_unknown_fields += 1;
                }
                report.imported += 1;
                out.push(v);
            }
            Err(e) => {
                let id = item.get("id").and_then(Value::as_str).unwrap_or("?");
                report.failed.push(format!("{label} #{i} (id {id}): {e}"));
            }
        }
    }
    out
}

/// Parse any legacy Zorvilo export.
pub fn import_legacy(json: &Value) -> ImportResult<LegacyImport> {
    let tag = json.get("__zorvilo").or_else(|| json.get("__yaakLite")).and_then(Value::as_str).unwrap_or("");
    let mut out = LegacyImport::default();
    match tag {
        "workspace-bundle" => {
            out.workspace = match json.get("workspace").map(|w| serde_json::from_value::<Workspace>(w.clone())) {
                Some(Ok(w)) => {
                    out.report.imported += 1;
                    Some(w)
                }
                Some(Err(e)) => {
                    out.report.failed.push(format!("workspace: {e}"));
                    None
                }
                None => None,
            };
            out.collections = decode_list(json.get("collections"), "collection", &mut out.report, |c: &Collection| !c.extra.is_empty());
            out.folders = decode_list(json.get("folders"), "folder", &mut out.report, |f: &Folder| !f.extra.is_empty());
            out.requests = decode_list(json.get("requests"), "request", &mut out.report, |r: &ApiRequest| !r.extra.is_empty());
            out.environments = decode_list(json.get("environments"), "environment", &mut out.report, |e: &Environment| !e.extra.is_empty());
        }
        "collection" => {
            if let Some(c) = json.get("collection") {
                match serde_json::from_value::<Collection>(c.clone()) {
                    Ok(c) => {
                        out.report.imported += 1;
                        out.collections.push(c);
                    }
                    Err(e) => return Err(ImportError::Invalid(format!("collection: {e}"))),
                }
            }
            out.folders = decode_list(json.get("folders"), "folder", &mut out.report, |f: &Folder| !f.extra.is_empty());
            out.requests = decode_list(json.get("requests"), "request", &mut out.report, |r: &ApiRequest| !r.extra.is_empty());
        }
        "environment" => match json.get("environment").map(|e| serde_json::from_value::<Environment>(e.clone())) {
            Some(Ok(e)) => {
                out.report.imported += 1;
                out.environments.push(e);
            }
            Some(Err(e)) => return Err(ImportError::Invalid(format!("environment: {e}"))),
            None => return Err(ImportError::Invalid("environment file without an environment".into())),
        },
        "history" => out.history = decode_list(json.get("entries"), "history entry", &mut out.report, |_| false),
        "saved-responses" => out.saved_responses = decode_list(json.get("responses"), "saved response", &mut out.report, |_| false),
        _ => return Err(ImportError::Invalid("not a Zorvilo export".into())),
    }
    validate(&mut out);
    Ok(out)
}

/// Relationship checks: dangling parents are re-rooted and reported.
fn validate(data: &mut LegacyImport) {
    let col_ids: HashSet<String> = data.collections.iter().map(|c| c.id.clone()).collect();
    let folder_ids: HashSet<String> = data.folders.iter().map(|f| f.id.clone()).collect();
    for f in &mut data.folders {
        if let Some(p) = &f.parent_id {
            if !folder_ids.contains(p) {
                data.report.warnings.push(format!("folder “{}” referenced a missing parent folder — moved to the collection root", f.name));
                f.parent_id = None;
            }
        }
        if !col_ids.is_empty() && !col_ids.contains(&f.collection_id) {
            data.report.warnings.push(format!("folder “{}” references a collection that is not in this file", f.name));
        }
    }
    for r in &mut data.requests {
        if let Some(fid) = &r.folder_id {
            if !folder_ids.contains(fid) {
                data.report.warnings.push(format!("request “{}” referenced a missing folder — moved to the collection root", r.name));
                r.folder_id = None;
            }
        }
        if r.method.trim().is_empty() {
            r.method = "GET".into();
        }
    }
}

/// Give every record a fresh id (import as a copy) while keeping relationships.
pub fn reassign_ids(data: &mut LegacyImport, workspace_id: &str) {
    let mut map: HashMap<String, String> = HashMap::new();
    let remap = |old: &str, map: &mut HashMap<String, String>| -> String {
        map.entry(old.to_string()).or_insert_with(new_id).clone()
    };
    for c in &mut data.collections {
        c.id = remap(&c.id, &mut map);
        c.workspace_id = workspace_id.to_string();
    }
    for f in &mut data.folders {
        f.id = remap(&f.id, &mut map);
    }
    for f in &mut data.folders {
        f.collection_id = remap(&f.collection_id, &mut map);
        f.parent_id = f.parent_id.as_ref().map(|p| remap(p, &mut map));
        f.workspace_id = workspace_id.to_string();
    }
    for r in &mut data.requests {
        r.id = new_id();
        r.collection_id = remap(&r.collection_id, &mut map);
        r.folder_id = r.folder_id.as_ref().map(|p| remap(p, &mut map));
        r.workspace_id = workspace_id.to_string();
    }
    for e in &mut data.environments {
        e.id = new_id();
        e.workspace_id = workspace_id.to_string();
        e.is_active = false;
    }
}

/// Export a workspace in the legacy-compatible bundle format (round-trips).
pub fn export_workspace_bundle(
    workspace: &Workspace,
    collections: &[Collection],
    folders: &[Folder],
    requests: &[ApiRequest],
    environments: &[Environment],
    include_secrets: bool,
) -> Value {
    let strip = |vars: &[zorvilo_core::Variable]| -> Vec<zorvilo_core::Variable> {
        vars.iter()
            .map(|v| if v.secret && !include_secrets { zorvilo_core::Variable { value: String::new(), ..v.clone() } } else { v.clone() })
            .collect()
    };
    let collections: Vec<Collection> = collections.iter().map(|c| Collection { variables: strip(&c.variables), ..c.clone() }).collect();
    let environments: Vec<Environment> = environments.iter().map(|e| Environment { variables: strip(&e.variables), ..e.clone() }).collect();
    let requests: Vec<ApiRequest> = requests.iter().map(|r| ApiRequest { variables: strip(&r.variables), ..r.clone() }).collect();
    serde_json::json!({
        "__zorvilo": "workspace-bundle",
        "version": 1,
        "workspace": workspace,
        "collections": collections,
        "folders": folders,
        "requests": requests,
        "environments": environments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_round_trip_and_validation() {
        let ws = Workspace::default();
        let col = Collection { workspace_id: ws.id.clone(), ..Default::default() };
        let folder = Folder { collection_id: col.id.clone(), workspace_id: ws.id.clone(), ..Default::default() };
        let req = ApiRequest { collection_id: col.id.clone(), folder_id: Some("missing".into()), workspace_id: ws.id.clone(), ..Default::default() };
        let json = export_workspace_bundle(&ws, &[col.clone()], &[folder], &[req], &[], false);
        let mut text = json.to_string();
        // a record with a field from a future version, plus one broken record
        text = text.replacen("\"requests\":[", "\"requests\":[{\"id\":5,\"name\":[]},", 1);
        let parsed: Value = serde_json::from_str(&text).unwrap();
        let imp = import_legacy(&parsed).unwrap();
        assert_eq!(imp.collections[0].id, col.id, "ids are preserved");
        assert_eq!(imp.requests.len(), 1);
        assert_eq!(imp.report.failed.len(), 1);
        assert_eq!(imp.requests[0].folder_id, None, "dangling folder re-rooted");
        assert!(!imp.report.warnings.is_empty());
    }

    #[test]
    fn reassign_keeps_relationships() {
        let col = Collection::default();
        let f = Folder { collection_id: col.id.clone(), ..Default::default() };
        let r = ApiRequest { collection_id: col.id.clone(), folder_id: Some(f.id.clone()), ..Default::default() };
        let mut data = LegacyImport { collections: vec![col.clone()], folders: vec![f.clone()], requests: vec![r], ..Default::default() };
        reassign_ids(&mut data, "ws2");
        assert_ne!(data.collections[0].id, col.id);
        assert_eq!(data.folders[0].collection_id, data.collections[0].id);
        assert_eq!(data.requests[0].folder_id.as_deref(), Some(data.folders[0].id.as_str()));
    }
}
