//! Small formatting helpers shared by the UI and exporters.

/// Same algorithm as the legacy `slugify` (used for Git file names).
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            out.push(ch);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled".into()
    } else {
        trimmed
    }
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

pub fn format_duration(ms: f64) -> String {
    if ms < 1000.0 {
        format!("{} ms", ms.round() as i64)
    } else {
        format!("{:.2} s", ms / 1000.0)
    }
}

/// Local, human friendly timestamp: time only for today, date + time otherwise.
pub fn format_timestamp(ts_ms: i64) -> String {
    use chrono::{Local, TimeZone};
    let Some(dt) = Local.timestamp_millis_opt(ts_ms).single() else {
        return String::new();
    };
    let today = Local::now().date_naive();
    if dt.date_naive() == today {
        dt.format("%H:%M").to_string()
    } else {
        dt.format("%Y-%m-%d %H:%M").to_string()
    }
}

/// Case-insensitive substring match used across search surfaces.
pub fn matches(haystack: &str, query: &str) -> bool {
    query.is_empty() || haystack.to_lowercase().contains(&query.to_lowercase())
}

/// Truncate a string to at most `max` chars (on a char boundary), adding an ellipsis.
pub fn ellipsize(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_matches_legacy() {
        assert_eq!(slugify("My Collection!"), "my-collection");
        assert_eq!(slugify("  --  "), "untitled");
        assert_eq!(slugify("Ünïcode API v2"), "n-code-api-v2");
    }

    #[test]
    fn formats() {
        assert_eq!(format_bytes(10), "10 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_duration(12.4), "12 ms");
        assert_eq!(format_duration(1500.0), "1.50 s");
    }
}
