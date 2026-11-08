//! Pre-commit secret detection. Findings are shown to the user before a
//! commit; matched values are masked in the report.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub file: String,
    pub line: usize,
    pub kind: &'static str,
    pub preview: String,
}

static PATTERNS: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    let p = |s: &str| Regex::new(s).expect("valid secret pattern");
    vec![
        ("GitHub token", p(r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")),
        ("AWS access key id", p(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
        ("Private key", p(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
        ("Slack token", p(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
        ("Stripe live key", p(r"\b[sr]k_live_[0-9A-Za-z]{20,}")),
        ("Google API key", p(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
        ("JSON Web Token", p(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
        (
            "Credential field",
            p(r#""(password|clientSecret|secretKey|sessionToken|accessToken|refreshToken|token|secret)"\s*:\s*"([^"{]{8,})""#),
        ),
    ]
});

fn mask(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "••••".into();
    }
    let head: String = chars[..4].iter().collect();
    format!("{head}••••({} chars)", chars.len())
}

/// Scan text content.
pub fn scan_text(file: &str, content: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        for (kind, re) in PATTERNS.iter() {
            if let Some(m) = re.find(line) {
                out.push(Finding { file: file.to_string(), line: i + 1, kind, preview: mask(m.as_str()) });
            }
        }
    }
    out
}

/// Scan a set of repository-relative files.
pub fn scan_files(root: &Path, files: &[String]) -> Vec<Finding> {
    let mut out = Vec::new();
    for f in files {
        let full = root.join(f);
        if let Ok(meta) = std::fs::metadata(&full) {
            if meta.len() > 16 * 1024 * 1024 {
                continue;
            }
        }
        if let Ok(content) = std::fs::read_to_string(&full) {
            out.extend(scan_text(f, &content));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_secrets() {
        let text = r#"{
  "token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB",
  "aws": "AKIAABCDEFGHIJKLMNOP",
  "password": "{{db_password}}",
  "url": "https://example.com"
}"#;
        let f = scan_text("c.json", text);
        assert!(f.iter().any(|x| x.kind == "GitHub token"));
        assert!(f.iter().any(|x| x.kind == "AWS access key id"));
        // variable references are not secrets
        assert!(!f.iter().any(|x| x.line == 4));
        assert!(f.iter().all(|x| !x.preview.contains("abcdefghijklmnop")));
    }
}
