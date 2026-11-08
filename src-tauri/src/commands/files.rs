//! Native file dialogs: open text files / a folder of JSON files, save files.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::CmdResult;

const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Serialize)]
pub struct TextFile {
    name: String,
    path: String,
    text: String,
}

fn to_path(p: FilePath) -> CmdResult<PathBuf> {
    p.into_path().map_err(|e| format!("unsupported file location: {e}"))
}

fn read_text(path: &Path) -> CmdResult<String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("{} is larger than 100 MB", path.display()));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Pick one or more files and return their text content.
#[tauri::command]
pub async fn open_text_files(app: AppHandle, multiple: Option<bool>, extensions: Option<Vec<String>>) -> CmdResult<Vec<TextFile>> {
    super::blocking(move || {
        let mut dialog = app.dialog().file();
        let exts: Vec<String> = extensions.unwrap_or_default().into_iter().map(|e| e.trim_start_matches('.').to_string()).filter(|e| !e.is_empty()).collect();
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            dialog = dialog.add_filter("Supported files", &refs).add_filter("All files", &["*"]);
        }
        let picked = if multiple.unwrap_or(false) {
            dialog.blocking_pick_files().unwrap_or_default()
        } else {
            dialog.blocking_pick_file().into_iter().collect()
        };
        let mut out = Vec::new();
        for p in picked {
            let path = to_path(p)?;
            out.push(TextFile {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path: path.display().to_string(),
                text: read_text(&path)?,
            });
        }
        Ok(out)
    })
    .await
}

#[derive(Serialize)]
pub struct DirFile {
    path: String,
    text: String,
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<DirFile>, budget: &mut u64) -> CmdResult<()> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            walk(root, &path, out, budget)?;
        } else if ft.is_file() && name.to_ascii_lowercase().ends_with(".json") {
            let text = read_text(&path)?;
            *budget = budget.saturating_sub(text.len() as u64);
            if *budget == 0 {
                return Err("the folder contains more than 200 MB of JSON".into());
            }
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            out.push(DirFile { path: rel, text });
        }
    }
    Ok(())
}

/// Pick a folder and return every `.json` file in it (recursively). Null when cancelled.
#[tauri::command]
pub async fn open_directory_json(app: AppHandle) -> CmdResult<Option<Vec<DirFile>>> {
    super::blocking(move || {
        let Some(dir) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
        let root = to_path(dir)?;
        let mut out = Vec::new();
        let mut budget = 200 * 1024 * 1024;
        walk(&root, &root, &mut out, &mut budget)?;
        Ok(Some(out))
    })
    .await
}

/// Ask where to save and write the content. Returns false when cancelled.
/// Exactly one of `text` / `base64` is used.
#[tauri::command]
pub async fn save_file(app: AppHandle, suggested_name: String, text: Option<String>, base64: Option<String>) -> CmdResult<bool> {
    super::blocking(move || {
        let bytes = match (text, base64) {
            (Some(t), _) => t.into_bytes(),
            (None, Some(b)) => base64::engine::general_purpose::STANDARD.decode(b.as_bytes()).map_err(|e| format!("invalid file data: {e}"))?,
            (None, None) => Vec::new(),
        };
        let mut dialog = app.dialog().file().set_file_name(&suggested_name);
        if let Some(ext) = Path::new(&suggested_name).extension().and_then(|e| e.to_str()) {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
        }
        let Some(target) = dialog.blocking_save_file() else { return Ok(false) };
        let path = to_path(target)?;
        std::fs::write(&path, bytes).map_err(|e| format!("could not save {}: {e}", path.display()))?;
        Ok(true)
    })
    .await
}

#[derive(serde::Deserialize)]
pub struct NamedText {
    name: String,
    text: String,
}

/// Pick a folder and write several files into it. Returns the folder, or null when cancelled.
#[tauri::command]
pub async fn save_files_to_folder(app: AppHandle, files: Vec<NamedText>) -> CmdResult<Option<String>> {
    super::blocking(move || {
        let Some(dir) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
        let dir = to_path(dir)?;
        for f in files {
            // file names come from the UI: keep only the final component
            let name = Path::new(&f.name).file_name().map(|n| n.to_owned()).ok_or("invalid file name")?;
            let path = dir.join(name);
            std::fs::write(&path, f.text).map_err(|e| format!("could not save {}: {e}", path.display()))?;
        }
        Ok(Some(dir.display().to_string()))
    })
    .await
}
