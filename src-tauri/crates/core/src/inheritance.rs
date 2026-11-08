//! Collection → folder → request inheritance (auth, variables, scripts).

use std::collections::HashMap;

use crate::models::{ApiRequest, AuthConfig, AuthType, Collection, Folder, Variable};

/// Folder chain for a request, ordered root → nearest.
pub fn folder_chain<'a>(folder_id: Option<&str>, folders: &'a HashMap<String, Folder>) -> Vec<&'a Folder> {
    let mut chain = Vec::new();
    let mut current = folder_id.map(str::to_string);
    let mut guard = 0;
    while let Some(id) = current {
        guard += 1;
        if guard > 256 {
            break; // cycle protection
        }
        match folders.get(&id) {
            Some(f) => {
                chain.push(f);
                current = f.parent_id.clone();
            }
            None => break,
        }
    }
    chain.reverse();
    chain
}

/// Resolve "Inherit from parent": nearest folder with explicit auth, then the
/// collection; a collection with `inherit` behaves as no auth.
pub fn effective_auth(request: &ApiRequest, chain: &[&Folder], collection: Option<&Collection>) -> AuthConfig {
    if request.auth.auth_type != AuthType::Inherit {
        return request.auth.clone();
    }
    for folder in chain.iter().rev() {
        if folder.auth.auth_type != AuthType::Inherit {
            return folder.auth.clone();
        }
    }
    match collection {
        Some(c) if c.auth.auth_type != AuthType::Inherit => c.auth.clone(),
        _ => AuthConfig::of(AuthType::None),
    }
}

/// Where the effective auth comes from, for display.
pub fn auth_source(request: &ApiRequest, chain: &[&Folder], collection: Option<&Collection>) -> String {
    if request.auth.auth_type != AuthType::Inherit {
        return "request".into();
    }
    for folder in chain.iter().rev() {
        if folder.auth.auth_type != AuthType::Inherit {
            return format!("folder “{}”", folder.name);
        }
    }
    match collection {
        Some(c) if !matches!(c.auth.auth_type, AuthType::Inherit | AuthType::None) => format!("collection “{}”", c.name),
        _ => "nothing (no auth)".into(),
    }
}

/// Pre-request scripts in execution order: collection, folders (root first), request.
pub fn pre_request_scripts(request: &ApiRequest, chain: &[&Folder], collection: Option<&Collection>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(c) = collection {
        out.push((format!("collection: {}", c.name), c.pre_request_script.clone()));
    }
    for f in chain {
        out.push((format!("folder: {}", f.name), f.pre_request_script.clone()));
    }
    out.push((format!("request: {}", request.name), request.pre_request_script.clone()));
    out.retain(|(_, s)| !s.trim().is_empty());
    out
}

/// Test scripts in execution order: collection, folders, request (Postman order).
pub fn test_scripts(request: &ApiRequest, chain: &[&Folder], collection: Option<&Collection>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(c) = collection {
        out.push((format!("collection: {}", c.name), c.test_script.clone()));
    }
    for f in chain {
        out.push((format!("folder: {}", f.name), f.test_script.clone()));
    }
    out.push((format!("request: {}", request.name), request.test_script.clone()));
    out.retain(|(_, s)| !s.trim().is_empty());
    out
}

/// Folder variable layers root → nearest.
pub fn folder_variables<'a>(chain: &[&'a Folder]) -> Vec<&'a [Variable]> {
    chain.iter().map(|f| f.variables.as_slice()).collect()
}

/// All folder ids in the subtree rooted at `root` (inclusive).
pub fn folder_subtree(root: &str, folders: &HashMap<String, Folder>) -> Vec<String> {
    let mut ids = vec![root.to_string()];
    let mut grew = true;
    while grew {
        grew = false;
        for f in folders.values() {
            if let Some(p) = &f.parent_id {
                if ids.contains(p) && !ids.contains(&f.id) {
                    ids.push(f.id.clone());
                    grew = true;
                }
            }
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_folder_auth_wins() {
        let col = Collection { auth: AuthConfig::of(AuthType::Basic), ..Default::default() };
        let parent = Folder { id: "p".into(), auth: AuthConfig::of(AuthType::Bearer), ..Default::default() };
        let child = Folder { id: "c".into(), parent_id: Some("p".into()), ..Default::default() };
        let mut map = HashMap::new();
        map.insert("p".to_string(), parent);
        map.insert("c".to_string(), child);
        let req = ApiRequest { folder_id: Some("c".into()), ..Default::default() };
        let chain = folder_chain(req.folder_id.as_deref(), &map);
        assert_eq!(chain.len(), 2);
        assert_eq!(effective_auth(&req, &chain, Some(&col)).auth_type, AuthType::Bearer);
        let no_chain: Vec<&Folder> = vec![];
        assert_eq!(effective_auth(&req, &no_chain, Some(&col)).auth_type, AuthType::Basic);
        assert_eq!(effective_auth(&req, &no_chain, None).auth_type, AuthType::None);
    }

    #[test]
    fn cycle_safe() {
        let mut map = HashMap::new();
        map.insert("a".to_string(), Folder { id: "a".into(), parent_id: Some("b".into()), ..Default::default() });
        map.insert("b".to_string(), Folder { id: "b".into(), parent_id: Some("a".into()), ..Default::default() });
        assert!(folder_chain(Some("a"), &map).len() <= 257);
    }
}
