use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportKind {
    PostmanCollection { version: String },
    PostmanEnvironment,
    WorkspaceBundle,
    ZorviloCollectionFile,
    ZorviloEnvironmentFile,
    History,
    SavedResponses,
    Unknown,
}

impl ImportKind {
    pub fn label(&self) -> String {
        match self {
            ImportKind::PostmanCollection { version } => format!("Postman collection v{version}"),
            ImportKind::PostmanEnvironment => "Postman environment".into(),
            ImportKind::WorkspaceBundle => "Zorvilo workspace bundle".into(),
            ImportKind::ZorviloCollectionFile => "Zorvilo collection file".into(),
            ImportKind::ZorviloEnvironmentFile => "Zorvilo environment file".into(),
            ImportKind::History => "Zorvilo history export".into(),
            ImportKind::SavedResponses => "Zorvilo saved responses export".into(),
            ImportKind::Unknown => "Unknown format".into(),
        }
    }
}

pub fn detect_import(json: &Value) -> ImportKind {
    let Some(obj) = json.as_object() else { return ImportKind::Unknown };
    match obj.get("__zorvilo").and_then(Value::as_str) {
        Some("workspace-bundle") => return ImportKind::WorkspaceBundle,
        Some("collection") => return ImportKind::ZorviloCollectionFile,
        Some("environment") => return ImportKind::ZorviloEnvironmentFile,
        Some("history") => return ImportKind::History,
        Some("saved-responses") => return ImportKind::SavedResponses,
        _ => {}
    }
    let schema = json.pointer("/info/schema").and_then(Value::as_str).unwrap_or("");
    if schema.contains("v2.1") {
        return ImportKind::PostmanCollection { version: "2.1".into() };
    }
    if schema.contains("v2.0") {
        return ImportKind::PostmanCollection { version: "2.0".into() };
    }
    if obj.contains_key("_postman_variable_scope") || (obj.contains_key("name") && obj.get("values").map(Value::is_array).unwrap_or(false)) {
        return ImportKind::PostmanEnvironment;
    }
    if obj.contains_key("info") && obj.get("item").map(Value::is_array).unwrap_or(false) {
        return ImportKind::PostmanCollection { version: "2.1".into() };
    }
    ImportKind::Unknown
}
