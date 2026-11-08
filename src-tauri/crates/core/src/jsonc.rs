//! Minimal JSONC support: strip `//` and `/* */` comments and trailing
//! commas (string-aware) so strictly valid JSON goes over the wire.

pub fn strip_json_comments(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let (mut in_string, mut in_line, mut in_block) = (false, false, false);
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied();
        if in_line {
            if ch == '\n' {
                in_line = false;
                out.push(ch);
            }
            i += 1;
            continue;
        }
        if in_block {
            if ch == '*' && next == Some('/') {
                in_block = false;
                i += 1;
            }
            i += 1;
            continue;
        }
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(n) = next {
                    out.push(n);
                    i += 1;
                }
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match (ch, next) {
            ('"', _) => {
                in_string = true;
                out.push(ch);
            }
            ('/', Some('/')) => {
                in_line = true;
                i += 1;
            }
            ('/', Some('*')) => {
                in_block = true;
                i += 1;
            }
            _ => out.push(ch),
        }
        i += 1;
    }
    strip_trailing_commas(&out)
}

fn strip_trailing_commas(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut in_string = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(n) = chars.get(i + 1) {
                    out.push(*n);
                    i += 1;
                }
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            i += 1;
            continue;
        }
        if ch == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if matches!(chars.get(j), Some('}') | Some(']')) {
                i += 1;
                continue;
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

/// Pretty-print JSON (accepting JSONC) with the given indent; None if invalid.
pub fn pretty_json(input: &str, indent: usize) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(&strip_json_comments(input)).ok()?;
    let indent_bytes = vec![b' '; indent.clamp(1, 8)];
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(&indent_bytes);
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    serde::Serialize::serialize(&value, &mut ser).ok()?;
    String::from_utf8(buf).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_and_commas() {
        let src = "{\n // c\n \"a\": \"//not\", /* b */ \"b\": [1,2,],\n}";
        let out = strip_json_comments(src);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["a"], "//not");
        assert_eq!(v["b"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn pretty() {
        assert_eq!(pretty_json("{\"a\":1}", 2).unwrap(), "{\n  \"a\": 1\n}");
        assert!(pretty_json("{", 2).is_none());
    }
}
