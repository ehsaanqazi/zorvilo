//! Response helpers shared by the engine, the viewer and scripting.

/// Whether a content type should be decoded as text.
pub fn is_textual(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    if ct.is_empty() {
        return true;
    }
    ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("x-www-form-urlencoded")
        || ct.contains("graphql")
        || ct.contains("svg")
        || ct.contains("yaml")
}

/// Language id for viewer highlighting.
pub fn language_for(content_type: &str, body: &str) -> &'static str {
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("json") {
        "json"
    } else if ct.contains("html") || ct.contains("xml") || ct.contains("svg") {
        "xml"
    } else if ct.contains("javascript") {
        "js"
    } else {
        let t = body.trim_start();
        if t.starts_with('{') || t.starts_with('[') {
            "json"
        } else if t.starts_with('<') {
            "xml"
        } else {
            "text"
        }
    }
}

pub fn is_image(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.starts_with("image/") && !ct.contains("svg")
}

/// A cookie parsed from a `Set-Cookie` header.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedCookie {
    pub name: String,
    pub value: String,
    pub attributes: Vec<(String, String)>,
}

pub fn parse_set_cookie(header: &str) -> Option<ParsedCookie> {
    let mut parts = header.split(';');
    let first = parts.next()?.trim();
    let eq = first.find('=')?;
    let mut cookie = ParsedCookie {
        name: first[..eq].trim().to_string(),
        value: first[eq + 1..].trim().to_string(),
        attributes: Vec::new(),
    };
    for p in parts {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        match p.find('=') {
            Some(i) => cookie.attributes.push((p[..i].trim().to_string(), p[i + 1..].trim().to_string())),
            None => cookie.attributes.push((p.to_string(), String::new())),
        }
    }
    Some(cookie)
}

pub fn response_cookies(headers: &[(String, String)]) -> Vec<ParsedCookie> {
    headers
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
        .filter_map(|(_, v)| parse_set_cookie(v))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn textual() {
        assert!(is_textual("application/json; charset=utf-8"));
        assert!(is_textual("application/problem+json"));
        assert!(!is_textual("image/png"));
        assert!(!is_textual("application/octet-stream"));
    }

    #[test]
    fn cookies() {
        let c = parse_set_cookie("sid=abc; Path=/; HttpOnly").unwrap();
        assert_eq!(c.name, "sid");
        assert_eq!(c.attributes.len(), 2);
    }
}
