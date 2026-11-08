//! App info, clipboard, external links, native confirmation dialog.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::CmdResult;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    keychain_available: bool,
    platform: String,
    notes: Vec<String>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.paths.root.display().to_string(),
        keychain_available: state.secrets.is_persistent(),
        platform: std::env::consts::OS.to_string(),
        notes: state.startup_notes.clone(),
    }
}

/// Deep links that arrived before the UI was ready.
#[tauri::command]
pub fn take_pending_links(state: State<'_, AppState>) -> Vec<String> {
    state.take_pending_links()
}

#[tauri::command]
pub fn clipboard_write(app: AppHandle, text: String) -> CmdResult<()> {
    app.clipboard().write_text(text).map_err(|e| format!("could not write to the clipboard: {e}"))
}

/// Open an http(s) URL in the system browser.
#[tauri::command]
pub fn open_external(url: String) -> CmdResult<()> {
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    webbrowser::open(url.trim()).map_err(|e| format!("could not open the browser: {e}"))
}

/// Native OK/Cancel dialog. Returns true when the user confirmed.
#[tauri::command]
pub async fn confirm_dialog(app: AppHandle, title: String, message: String, ok_label: Option<String>) -> CmdResult<bool> {
    let ok = ok_label.unwrap_or_else(|| "OK".into());
    super::blocking(move || {
        Ok(app
            .dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(ok, "Cancel".into()))
            .blocking_show())
    })
    .await
}
