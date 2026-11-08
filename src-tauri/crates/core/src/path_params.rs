//! Path variables (`/users/:id` and OpenAPI style `/users/{id}`).
//!
//! The URL owns the key list; only values are editable in the table.

use crate::models::KeyValue;
use crate::url_utils::{mask_vars, split_url};

#[derive(Debug, Clone)]
struct Placeholder {
    /// byte offset of ':' or '{'
    start: usize,
    end: usize,
    name: String,
    colon: bool,
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}
fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Scan a (variable-masked) path for placeholders: colon matches first,
/// then brace matches, mirroring the legacy two-pass behavior.
fn scan(masked: &str) -> Vec<Placeholder> {
    let b = masked.as_bytes();
    let mut colon = Vec::new();
    let mut brace = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b':' && (i == 0 || b[i - 1] == b'/') && i + 1 < b.len() && is_ident_start(b[i + 1]) {
            let mut j = i + 1;
            while j < b.len() && is_ident(b[j]) {
                j += 1;
            }
            colon.push(Placeholder { start: i, end: j, name: masked[i + 1..j].to_string(), colon: true });
            i = j;
            continue;
        }
        if b[i] == b'{' && i + 1 < b.len() && is_ident_start(b[i + 1]) {
            let mut j = i + 1;
            while j < b.len() && is_ident(b[j]) {
                j += 1;
            }
            if j < b.len() && b[j] == b'}' {
                brace.push(Placeholder { start: i, end: j + 1, name: masked[i + 1..j].to_string(), colon: false });
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    colon.extend(brace);
    colon
}

/// Placeholder names in the URL's path, in order, without duplicates.
pub fn path_param_names(url: &str) -> Vec<String> {
    let (base, _) = split_url(url);
    let mut names: Vec<String> = Vec::new();
    for p in scan(&mask_vars(&base)) {
        if !names.contains(&p.name) {
            names.push(p.name);
        }
    }
    names
}

/// Reconcile path-variable rows with the URL's placeholders.
pub fn path_params_from_url(url: &str, existing: &[KeyValue]) -> Vec<KeyValue> {
    let names = path_param_names(url);
    let unmatched: Vec<&KeyValue> = existing.iter().filter(|p| !names.contains(&p.key)).collect();
    let mut spare = 0;
    names
        .iter()
        .map(|name| {
            let prev = existing.iter().find(|p| &p.key == name).or_else(|| {
                let r = unmatched.get(spare).copied();
                spare += 1;
                r
            });
            match prev {
                Some(p) => KeyValue { key: name.clone(), ..p.clone() },
                None => KeyValue::new(name.clone(), ""),
            }
        })
        .collect()
}

fn join(base: String, query: &str) -> String {
    if query.is_empty() {
        base
    } else {
        format!("{base}?{query}")
    }
}

/// Rename a placeholder (`:old` → `:new`, `{old}` → `{new}`).
pub fn rename_path_param_in_url(url: &str, from: &str, to: &str) -> String {
    if from.is_empty() || to.is_empty() || from == to {
        return url.to_string();
    }
    let (base, query) = split_url(url);
    let mut hits: Vec<Placeholder> = scan(&mask_vars(&base)).into_iter().filter(|p| p.name == from).collect();
    hits.sort_by_key(|p| p.start);
    let mut out = String::new();
    let mut last = 0;
    for p in hits {
        out.push_str(&base[last..p.start]);
        if p.colon {
            out.push_str(&format!(":{to}"));
        } else {
            out.push_str(&format!("{{{to}}}"));
        }
        last = p.end;
    }
    out.push_str(&base[last..]);
    join(out, &query)
}

/// Append a `/:name` segment to the URL's path.
pub fn append_path_param_to_url(url: &str, name: &str) -> String {
    if name.is_empty() {
        return url.to_string();
    }
    let (base, query) = split_url(url);
    join(format!("{}/:{name}", base.trim_end_matches('/')), &query)
}

/// Remove a placeholder (and its leading `/`) from the URL.
pub fn remove_path_param_from_url(url: &str, name: &str) -> String {
    if name.is_empty() {
        return url.to_string();
    }
    let (base, query) = split_url(url);
    let mut hits: Vec<Placeholder> = scan(&mask_vars(&base)).into_iter().filter(|p| p.name == name).collect();
    hits.sort_by_key(|p| p.start);
    let mut out = String::new();
    let mut last = 0;
    for p in hits {
        let mut start = p.start;
        if start > 0 && base.as_bytes()[start - 1] == b'/' {
            start -= 1;
        }
        if start < last {
            continue;
        }
        out.push_str(&base[last..start]);
        last = p.end;
    }
    out.push_str(&base[last..]);
    join(out, &query)
}

/// Substitute placeholders with their values (path only; query is literal).
pub fn url_from_path_params(url: &str, path_params: &[KeyValue]) -> String {
    let values: Vec<(&str, &str)> = path_params
        .iter()
        .filter(|p| p.enabled && !p.key.is_empty())
        .map(|p| (p.key.as_str(), p.value.as_str()))
        .collect();
    if values.is_empty() {
        return url.to_string();
    }
    let (base, query) = split_url(url);
    let mut hits = scan(&mask_vars(&base));
    hits.sort_by_key(|p| p.start);
    let mut out = String::new();
    let mut last = 0;
    for p in hits {
        if p.start < last {
            continue;
        }
        let Some((_, value)) = values.iter().find(|(k, _)| *k == p.name) else { continue };
        out.push_str(&base[last..p.start]);
        out.push_str(value);
        last = p.end;
    }
    out.push_str(&base[last..]);
    join(out, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_colon_and_brace() {
        assert_eq!(path_param_names("https://x.io/users/:id/posts/{postId}?q=:no"), vec!["id", "postId"]);
        assert!(path_param_names("http://localhost:8080/a").is_empty());
        assert!(path_param_names("{{host}}/a").is_empty());
    }

    #[test]
    fn substitute_values() {
        let p = vec![KeyValue::new("id", "42")];
        assert_eq!(url_from_path_params("https://x.io/users/:id?x=:id", &p), "https://x.io/users/42?x=:id");
    }

    #[test]
    fn rename_and_remove() {
        assert_eq!(rename_path_param_in_url("/a/:id/{id}", "id", "uid"), "/a/:uid/{uid}");
        assert_eq!(remove_path_param_from_url("/a/:id/b", "id"), "/a/b");
        assert_eq!(append_path_param_to_url("/a/?q=1", "x"), "/a/:x?q=1");
    }

    #[test]
    fn reconcile_keeps_values() {
        let existing = vec![KeyValue::new("id", "7")];
        let rows = path_params_from_url("/u/:id/:other", &existing);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].value, "7");
        assert_eq!(rows[1].key, "other");
    }
}
