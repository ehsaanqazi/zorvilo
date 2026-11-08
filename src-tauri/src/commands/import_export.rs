//! Import (Postman, cURL, Zorvilo bundles), export and code generation.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use zorvilo_core::inheritance::effective_auth;
use zorvilo_core::variables::{build_variable_map, resolve_request, ScopeLayers};
use zorvilo_core::{ApiRequest, Collection, Environment, Folder, Workspace};
use zorvilo_import_export::codegen::{generate, CodeFormat};
use zorvilo_import_export::{detect_import, legacy, postman, ImportKind};
use zorvilo_storage::Table;

use super::http::RequestContext;
use super::{settings_from, CmdResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurlOut {
    request: ApiRequest,
    suggested_name: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ParsedImport {
    #[serde(rename_all = "camelCase")]
    Curl { request: ApiRequest, suggested_name: String },
    #[serde(rename_all = "camelCase")]
    PostmanCollection { version: String, collection: Collection, folders: Vec<Folder>, requests: Vec<ApiRequest>, warnings: Vec<String> },
    #[serde(rename_all = "camelCase")]
    PostmanEnvironment { environment: Environment },
    #[serde(rename_all = "camelCase")]
    WorkspaceBundle {
        collections: Vec<Collection>,
        folders: Vec<Folder>,
        requests: Vec<ApiRequest>,
        environments: Vec<Environment>,
        warnings: Vec<String>,
        failed: Vec<String>,
    },
}

const SUPPORTED: &str = "Supported: Postman Collection v2.0/v2.1, Postman Environment, workspace bundle, cURL.";

/// Parse pasted text or file content into importable records for `workspace_id`.
#[tauri::command(async)]
pub fn import_parse(text: String, workspace_id: String) -> CmdResult<ParsedImport> {
    if zorvilo_import_export::curl::is_curl_command(&text) {
        let parsed = zorvilo_import_export::curl::parse_curl(&text).ok_or("Could not parse this cURL command (no URL found).")?;
        let mut request = parsed.request;
        request.workspace_id = workspace_id;
        return Ok(ParsedImport::Curl { request, suggested_name: parsed.suggested_name });
    }
    let json = zorvilo_import_export::parse_json(&text).map_err(|_| format!("Not valid JSON or a cURL command. {SUPPORTED}"))?;
    match detect_import(&json) {
        ImportKind::PostmanCollection { version } => {
            let r = postman::import_collection(&json, &workspace_id).map_err(|e| e.to_string())?;
            Ok(ParsedImport::PostmanCollection { version, collection: r.collection, folders: r.folders, requests: r.requests, warnings: r.warnings })
        }
        ImportKind::PostmanEnvironment => {
            Ok(ParsedImport::PostmanEnvironment { environment: postman::import_environment(&json, &workspace_id).map_err(|e| e.to_string())? })
        }
        ImportKind::WorkspaceBundle | ImportKind::ZorviloCollectionFile | ImportKind::ZorviloEnvironmentFile => {
            let mut data = legacy::import_legacy(&json).map_err(|e| e.to_string())?;
            // bundles land in the active workspace, keeping their ids (re-import replaces)
            for c in &mut data.collections {
                c.workspace_id = workspace_id.clone();
            }
            for f in &mut data.folders {
                f.workspace_id = workspace_id.clone();
            }
            for r in &mut data.requests {
                r.workspace_id = workspace_id.clone();
            }
            for e in &mut data.environments {
                e.workspace_id = workspace_id.clone();
                e.is_active = false;
            }
            Ok(ParsedImport::WorkspaceBundle {
                collections: data.collections,
                folders: data.folders,
                requests: data.requests,
                environments: data.environments,
                warnings: data.report.warnings,
                failed: data.report.failed,
            })
        }
        _ => Err(format!("Unrecognized format. {SUPPORTED}")),
    }
}

/// cURL command → request (null when the text is not a cURL command).
#[tauri::command(async)]
pub fn parse_curl(text: String) -> Option<CurlOut> {
    zorvilo_import_export::curl::parse_curl(&text).map(|p| CurlOut { request: p.request, suggested_name: p.suggested_name })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionExportArgs {
    collection: Collection,
    #[serde(default)]
    folders: Vec<Folder>,
    #[serde(default)]
    requests: Vec<ApiRequest>,
    #[serde(default)]
    include_secrets: bool,
}

#[tauri::command(async)]
pub fn export_postman_collection(args: CollectionExportArgs) -> Value {
    postman::export_collection(&args.collection, &args.folders, &args.requests, args.include_secrets)
}

#[tauri::command(async)]
pub fn export_postman_environment(environment: Environment, include_secrets: Option<bool>) -> Value {
    postman::export_environment(&environment, include_secrets.unwrap_or(false))
}

/// Full-workspace bundle (round-trips through import), read from the database.
#[tauri::command(async)]
pub fn export_workspace_bundle(state: State<'_, AppState>, workspace_id: String, include_secrets: Option<bool>) -> CmdResult<Value> {
    let secrets = state.secrets.clone();
    state.with_db(|db| {
        let ws: Workspace = db.get(Table::Workspaces, &workspace_id).map_err(|e| e.to_string())?.ok_or("Workspace not found")?;
        let data = db.load_workspace(&workspace_id, &secrets).map_err(|e| e.to_string())?;
        let requests: Vec<ApiRequest> = data.requests.into_iter().filter(|r| !r.collection_id.is_empty()).collect();
        Ok(legacy::export_workspace_bundle(&ws, &data.collections, &data.folders, &requests, &data.environments, include_secrets.unwrap_or(false)))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodegenArgs {
    format: String,
    #[serde(flatten)]
    context: RequestContext,
}

/// "Copy as …": resolve variables and inherited auth, then generate code.
#[tauri::command(async)]
pub fn generate_code(args: CodegenArgs) -> CmdResult<String> {
    let format = match args.format.as_str() {
        "curl" => CodeFormat::Curl,
        "fetch" => CodeFormat::Fetch,
        "python" => CodeFormat::Python,
        "powershell" => CodeFormat::PowerShell,
        other => return Err(format!("unknown code format {other}")),
    };
    let c = args.context;
    let settings = settings_from(&c.settings);
    let chain: Vec<&Folder> = c.folder_chain.iter().collect();
    let mut request = c.request.clone();
    request.auth = effective_auth(&c.request, &chain, c.collection.as_ref());
    let layers = ScopeLayers {
        globals: c.globals.as_slice(),
        environment: c.environment.as_ref().map(|e| e.variables.as_slice()),
        collection: c.collection.as_ref().map(|col| col.variables.as_slice()),
        folders: c.folder_chain.iter().map(|f| f.variables.as_slice()).collect(),
        request: Some(c.request.variables.as_slice()),
    };
    let vars = build_variable_map(&layers);
    let resolved = resolve_request(&request, &vars);
    generate(format, &resolved, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_results_use_the_ui_shape() {
        let curl = import_parse("curl -X POST https://api.test/users -d '{\"a\":1}'".into(), "w".into()).unwrap();
        let v = serde_json::to_value(&curl).unwrap();
        assert_eq!(v["kind"], "curl");
        assert_eq!(v["request"]["method"], "POST");
        assert!(v["suggestedName"].is_string());

        let env = r#"{"name":"Dev","values":[{"key":"a","value":"1","enabled":true}],"_postman_variable_scope":"environment"}"#;
        let v = serde_json::to_value(import_parse(env.into(), "w".into()).unwrap()).unwrap();
        assert_eq!(v["kind"], "postman-environment");
        assert_eq!(v["environment"]["workspaceId"], "w");

        assert!(import_parse("not json".into(), "w".into()).is_err());
    }
}
