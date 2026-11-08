//! Two-way sync between the URL bar and the query-parameter table.
//!
//! Values are kept raw (no percent-encoding) so `{{variables}}` survive
//! round-trips; encoding happens once, when the HTTP request is built.

use crate::models::KeyValue;

/// Blank out `{{var}}` tokens (same length) so delimiters inside them are ignored.
pub fn mask_vars(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            if let Some(rel) = text[i + 2..].find("}}") {
                let end = i + 2 + rel + 2;
                let inner = &text[i + 2..i + 2 + rel];
                let ok = !inner.is_empty()
                    && inner.trim().chars().all(|c| c.is_alphanumeric() || "_.-$".contains(c));
                if ok {
                    out.extend(std::iter::repeat(' ').take(end - i));
                    i = end;
                    continue;
                }
            }
        }
        // copy one (possibly multi-byte) char
        let ch = text[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Byte index of the first `?` not inside a `{{variable}}`.
fn query_start(url: &str) -> Option<usize> {
    mask_vars(url).find('?')
}

/// Split a URL into its path part and its raw query string.
pub fn split_url(url: &str) -> (String, String) {
    match query_start(url) {
        Some(i) => (url[..i].to_string(), url[i + 1..].to_string()),
        None => (url.to_string(), String::new()),
    }
}

/// Rebuild the URL's query string from the enabled params.
pub fn url_from_params(url: &str, params: &[KeyValue]) -> String {
    let (base, _) = split_url(url);
    let qs: Vec<String> = params
        .iter()
        .filter(|p| p.enabled && !p.key.is_empty())
        .map(|p| format!("{}={}", p.key, p.value))
        .collect();
    if qs.is_empty() {
        base
    } else {
        format!("{base}?{}", qs.join("&"))
    }
}

/// Parse the URL's query string into param rows. Enabled rows are rewritten
/// in order (keeping ids/descriptions where positions match); disabled rows
/// are preserved since they don't appear in the URL.
pub fn params_from_url(url: &str, existing: &[KeyValue]) -> Vec<KeyValue> {
    let (_, query) = split_url(url);
    let disabled: Vec<KeyValue> = existing.iter().filter(|p| !p.enabled).cloned().collect();
    let enabled_existing: Vec<&KeyValue> = existing.iter().filter(|p| p.enabled).collect();
    let pairs: Vec<(String, String)> = if query.is_empty() {
        Vec::new()
    } else {
        query
            .split('&')
            .filter(|s| !s.is_empty())
            .map(|s| match s.find('=') {
                Some(i) => (s[..i].to_string(), s[i + 1..].to_string()),
                None => (s.to_string(), String::new()),
            })
            .collect()
    };
    let mut next: Vec<KeyValue> = pairs
        .into_iter()
        .enumerate()
        .map(|(i, (key, value))| match enabled_existing.get(i) {
            Some(prev) => KeyValue { key, value, ..(*prev).clone() },
            None => KeyValue::new(key, value),
        })
        .collect();
    next.extend(disabled);
    next
}

/// Ensure the URL has a scheme (defaults to https://, like the legacy app).
pub fn with_scheme(url: &str) -> String {
    let t = url.trim();
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_ignores_question_mark_in_vars() {
        let (b, q) = split_url("{{host}}/x?a=1&b={{v}}");
        assert_eq!(b, "{{host}}/x");
        assert_eq!(q, "a=1&b={{v}}");
    }

    #[test]
    fn params_round_trip_preserves_disabled() {
        let mut off = KeyValue::new("off", "1");
        off.enabled = false;
        let rows = params_from_url("https://x.io/p?a=1&b", &[off.clone()]);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].key, "a");
        assert_eq!(rows[1].value, "");
        assert!(!rows[2].enabled);
        assert_eq!(url_from_params("https://x.io/p?zzz", &rows), "https://x.io/p?a=1&b=");
    }

    #[test]
    fn mask_keeps_length() {
        let s = "a{{b}}c";
        assert_eq!(mask_vars(s).len(), s.len());
    }
}
