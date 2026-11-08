//! Application settings (persisted as one JSON document under key "app").

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::models::KeyValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ThemeMode {
    #[serde(rename = "light")]
    Light,
    #[default]
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "dark-slate")]
    DarkSlate,
    #[serde(rename = "system")]
    System,
}

impl ThemeMode {
    pub const ALL: [ThemeMode; 4] = [ThemeMode::Dark, ThemeMode::DarkSlate, ThemeMode::Light, ThemeMode::System];
    pub fn label(self) -> &'static str {
        match self {
            ThemeMode::Light => "Light",
            ThemeMode::Dark => "Dark",
            ThemeMode::DarkSlate => "Dark Slate",
            ThemeMode::System => "System",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CloseDraftBehavior {
    #[default]
    Ask,
    Save,
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RequestLayout {
    /// request on top, response below
    #[default]
    Vertical,
    /// request left, response right
    Horizontal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxySettings {
    pub enabled: bool,
    /// http://host:port, https://…, socks5://host:port
    pub url: String,
    pub username: String,
    /// comma separated hosts that bypass the proxy
    pub no_proxy: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TlsSettings {
    /// Certificate verification. ON by default; can only be disabled explicitly.
    pub verify: bool,
    /// Extra PEM CA bundle trusted in addition to the system roots.
    pub ca_cert_path: String,
    /// PEM file containing the client certificate chain AND private key.
    pub client_identity_path: String,
}

impl Default for TlsSettings {
    fn default() -> Self {
        Self { verify: true, ca_cert_path: String::new(), client_identity_path: String::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NetworkSafety {
    /// Show a warning when a request targets loopback/private/link-local addresses.
    pub warn_private: bool,
    /// Refuse to send such requests (off by default — local APIs are normal in dev).
    pub block_private: bool,
}

impl Default for NetworkSafety {
    fn default() -> Self {
        Self { warn_private: true, block_private: false }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptingSettings {
    pub enabled: bool,
    pub timeout_ms: u64,
    /// Max loop iterations per script (guards against infinite loops).
    pub loop_iteration_limit: u64,
    /// Allow pm.sendRequest() to perform network calls.
    pub allow_send_request: bool,
}

impl Default for ScriptingSettings {
    fn default() -> Self {
        Self { enabled: true, timeout_ms: 5000, loop_iteration_limit: 10_000_000, allow_send_request: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutSettings {
    pub request_layout: RequestLayout,
    pub sidebar_collapsed: bool,
    pub sidebar_width: f32,
    pub show_status_bar: bool,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self { request_layout: RequestLayout::Vertical, sidebar_collapsed: false, sidebar_width: 290.0, show_status_bar: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: ThemeMode,
    pub font_size: f32,
    pub editor_font_size: f32,
    pub request_timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub default_headers: Vec<KeyValue>,
    pub json_indent: usize,
    pub word_wrap: bool,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    pub cookies_enabled: bool,
    pub auto_sync_enabled: bool,
    pub auto_sync_interval_min: u32,
    pub background_fetch: bool,
    pub max_history_entries: usize,
    /// 0 = keep forever
    pub history_retention_days: u32,
    /// Store response bodies in history.
    pub history_store_bodies: bool,
    pub close_draft_behavior: CloseDraftBehavior,
    pub proxy: ProxySettings,
    pub tls: TlsSettings,
    pub network_safety: NetworkSafety,
    pub scripting: ScriptingSettings,
    pub layout: LayoutSettings,
    /// action id -> shortcut string such as "Cmd+Enter"
    pub shortcuts: BTreeMap<String, String>,
    pub default_environment_id: Option<String>,
    /// Max bytes shown in the response viewer before switching to the
    /// virtualized plain-text renderer.
    pub large_response_threshold: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::Dark,
            font_size: 13.0,
            editor_font_size: 13.0,
            request_timeout_ms: 30_000,
            connect_timeout_ms: 10_000,
            default_headers: Vec::new(),
            json_indent: 2,
            word_wrap: true,
            follow_redirects: true,
            max_redirects: 10,
            cookies_enabled: true,
            auto_sync_enabled: false,
            auto_sync_interval_min: 5,
            background_fetch: true,
            max_history_entries: 1000,
            history_retention_days: 0,
            history_store_bodies: true,
            close_draft_behavior: CloseDraftBehavior::Ask,
            proxy: ProxySettings::default(),
            tls: TlsSettings::default(),
            network_safety: NetworkSafety::default(),
            scripting: ScriptingSettings::default(),
            layout: LayoutSettings::default(),
            shortcuts: BTreeMap::new(),
            default_environment_id: None,
            large_response_threshold: 2 * 1024 * 1024,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_settings_load_with_defaults() {
        // legacy settings carry useServerProxy/proxyUrl which no longer exist
        let json = r#"{"theme":"dark-slate","fontSize":14,"editorFontSize":13,"requestTimeoutMs":5000,
            "defaultHeaders":[],"jsonIndent":4,"wordWrap":false,"useServerProxy":true,
            "proxyUrl":"/.netlify/functions/proxy","autoSyncEnabled":false,"autoSyncIntervalMin":5,
            "maxHistoryEntries":200,"closeDraftBehavior":"discard"}"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.theme, ThemeMode::DarkSlate);
        assert_eq!(s.json_indent, 4);
        assert!(s.tls.verify, "TLS verification must default to on");
        assert_eq!(s.close_draft_behavior, CloseDraftBehavior::Discard);
    }
}
