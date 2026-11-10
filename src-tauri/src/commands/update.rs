//! "Update" — find the latest GitHub release, download the installer for this
//! platform and install it over the running app, then relaunch.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::CmdResult;

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    name: String,
    url: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    latest: String,
    update_available: bool,
    release_name: String,
    notes: String,
    release_url: String,
    /// installer for this OS/architecture, if the release has one
    asset: Option<UpdateAsset>,
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("Zorvilo/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

/// "v1.2.3" / "1.2.3-beta" → (1, 2, 3)
fn version_tuple(v: &str) -> (u64, u64, u64) {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next().unwrap_or("");
    let mut parts = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

/// Score an asset for the running platform (higher is better; None = not installable here).
fn asset_score(name: &str) -> Option<u32> {
    let n = name.to_ascii_lowercase();
    let arm = cfg!(target_arch = "aarch64");
    let arch_bonus = |n: &str| -> u32 {
        let is_arm = n.contains("aarch64") || n.contains("arm64");
        let is_x64 = n.contains("x64") || n.contains("x86_64") || n.contains("amd64");
        if n.contains("universal") {
            2
        } else if (arm && is_arm) || (!arm && is_x64) {
            3
        } else if !is_arm && !is_x64 {
            1
        } else {
            0
        }
    };
    let base = if cfg!(target_os = "macos") {
        if n.ends_with(".dmg") { 10 } else { return None }
    } else if cfg!(target_os = "windows") {
        if n.ends_with("-setup.exe") {
            10
        } else if n.ends_with(".msi") {
            9
        } else {
            return None;
        }
    } else if n.ends_with(".appimage") {
        10
    } else if n.ends_with(".deb") {
        9
    } else if n.ends_with(".rpm") {
        8
    } else {
        return None;
    };
    let bonus = arch_bonus(&n);
    if bonus == 0 {
        return None; // wrong architecture
    }
    Some(base * 10 + bonus)
}

fn parse_repo(repo: &str) -> CmdResult<String> {
    let r = repo
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/")
        .trim_end_matches(".git")
        .trim_matches('/')
        .to_string();
    let valid = r.split('/').count() == 2
        && r.split('/').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
    if !valid {
        return Err("Set the GitHub repository for updates as owner/repo (e.g. acme/zorvilo).".into());
    }
    Ok(r)
}

/// Look up the latest published release of `repo` (owner/repo).
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, repo: String) -> CmdResult<UpdateInfo> {
    let repo = parse_repo(&repo)?;
    let resp = client()?
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    match resp.status().as_u16() {
        200 => {}
        404 => return Err(format!("No published release found for {repo}.")),
        403 | 429 => return Err("GitHub rate limit reached — try again later.".into()),
        s => return Err(format!("GitHub answered HTTP {s}.")),
    }
    let text = resp.text().await.map_err(|e| format!("could not read the GitHub response: {e}"))?;
    let rel: GhRelease = serde_json::from_str(&text).map_err(|e| format!("unexpected GitHub response: {e}"))?;
    if rel.draft {
        return Err("The latest release is still a draft.".into());
    }
    let current = app.package_info().version.to_string();
    let asset = rel
        .assets
        .iter()
        .filter_map(|a| asset_score(&a.name).map(|s| (s, a)))
        .max_by_key(|(s, _)| *s)
        .map(|(_, a)| UpdateAsset { name: a.name.clone(), url: a.browser_download_url.clone(), size: a.size });
    Ok(UpdateInfo {
        update_available: version_tuple(&rel.tag_name) > version_tuple(&current),
        current,
        latest: rel.tag_name.trim_start_matches(['v', 'V']).to_string(),
        release_name: rel.name.unwrap_or_else(|| rel.tag_name.clone()),
        notes: rel.body.unwrap_or_default(),
        release_url: rel.html_url,
        asset,
    })
}

fn downloads_dir() -> PathBuf {
    directories::UserDirs::new()
        .and_then(|d| d.download_dir().map(|p| p.to_path_buf()))
        .unwrap_or_else(std::env::temp_dir)
}

/// Fresh, empty scratch directory for one update attempt.
fn staging_dir() -> CmdResult<PathBuf> {
    let dir = std::env::temp_dir().join(format!("zorvilo-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn open_path(path: &std::path::Path) -> CmdResult<()> {
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(path).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(path).status()
    } else {
        // Linux: show the file in its folder (AppImage/.deb/.rpm install differs per distro)
        std::process::Command::new("xdg-open").arg(path.parent().unwrap_or(path)).status()
    };
    status.map(|_| ()).map_err(|e| format!("could not open {}: {e}", path.display()))
}

#[cfg(target_os = "macos")]
fn run(cmd: &mut std::process::Command, what: &str) -> CmdResult<String> {
    let out = cmd.output().map_err(|e| format!("{what} failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("{what} failed: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn spawn_detached(cmd: &mut std::process::Command, what: &str) -> CmdResult<()> {
    use std::process::Stdio;
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not start {what}: {e}"))
}

/// The `.app` bundle this process runs from, e.g. /Applications/Zorvilo.app.
#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    exe.ancestors()
        .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        .map(|p| p.to_path_buf())
}

/// macOS: copy the new .app out of the DMG, then — once Zorvilo has quit —
/// swap it in place of the running bundle and relaunch it.
#[cfg(target_os = "macos")]
fn apply_macos(installer: &std::path::Path, stage: &std::path::Path) -> CmdResult<bool> {
    use std::process::Command;
    if !installer.extension().map(|e| e.eq_ignore_ascii_case("dmg")).unwrap_or(false) {
        return Ok(false);
    }
    let Some(bundle) = current_app_bundle() else { return Ok(false) };
    let parent = bundle.parent().ok_or("invalid app location")?;
    let writable = |p: &std::path::Path| {
        std::fs::metadata(p).map(|m| !m.permissions().readonly()).unwrap_or(false)
    };
    if !writable(parent) || !writable(&bundle) {
        return Ok(false);
    }

    let mount = stage.join("mnt");
    std::fs::create_dir_all(&mount).map_err(|e| e.to_string())?;
    run(
        Command::new("hdiutil")
            .args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-quiet", "-mountpoint"])
            .arg(&mount)
            .arg(installer),
        "mounting the update",
    )?;
    let copied = (|| -> CmdResult<PathBuf> {
        let app = std::fs::read_dir(&mount)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
            .ok_or("the update image does not contain an app")?;
        let staged = stage.join(app.file_name().ok_or("invalid app name")?);
        run(Command::new("ditto").arg(&app).arg(&staged), "copying the update")?;
        Ok(staged)
    })();
    let _ = Command::new("hdiutil").args(["detach", "-quiet", "-force"]).arg(&mount).status();
    let staged = copied?;
    let _ = Command::new("xattr").arg("-cr").arg(&staged).status();

    // Wait for this process to exit, swap bundles (rolling back on failure), relaunch.
    const SCRIPT: &str = r#"
PID="$1"; APP="$2"; NEW="$3"; STAGE="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
OLD="$APP.zorvilo-old"
rm -rf "$OLD"
if mv "$APP" "$OLD"; then
  if ditto "$NEW" "$APP"; then
    rm -rf "$OLD"
  else
    rm -rf "$APP"; mv "$OLD" "$APP"
  fi
fi
xattr -cr "$APP" 2>/dev/null
rm -rf "$STAGE"
open "$APP"
"#;
    spawn_detached(
        Command::new("/bin/sh")
            .arg("-c")
            .arg(SCRIPT)
            .arg("zorvilo-updater")
            .arg(std::process::id().to_string())
            .arg(&bundle)
            .arg(&staged)
            .arg(stage),
        "the updater",
    )?;
    Ok(true)
}

/// Windows: run the NSIS installer in passive mode over the existing install;
/// `/R` makes it relaunch Zorvilo when it finishes.
#[cfg(target_os = "windows")]
fn apply_windows(installer: &std::path::Path) -> CmdResult<bool> {
    let is_exe = installer.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false);
    if !is_exe {
        return Ok(false);
    }
    spawn_detached(std::process::Command::new(installer).args(["/P", "/R"]), "the installer")?;
    Ok(true)
}

/// Linux: replace the running AppImage file and start the new one.
#[cfg(target_os = "linux")]
fn apply_linux(installer: &std::path::Path) -> CmdResult<bool> {
    use std::os::unix::fs::PermissionsExt;
    let is_appimage = installer.extension().map(|e| e.eq_ignore_ascii_case("appimage")).unwrap_or(false);
    let Some(current) = std::env::var_os("APPIMAGE").map(PathBuf::from) else { return Ok(false) };
    if !is_appimage || !current.is_file() {
        return Ok(false);
    }
    let tmp = current.with_extension("AppImage.new");
    std::fs::copy(installer, &tmp).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    std::fs::rename(&tmp, &current).map_err(|e| format!("could not replace {}: {e}", current.display()))?;
    spawn_detached(&mut std::process::Command::new(&current), "the new version")?;
    Ok(true)
}

/// Progress of the update download, sent to the UI as `update-progress` events.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    /// total size in bytes, when the server reports it
    total: Option<u64>,
}

/// Read the response body chunk by chunk, emitting progress at most ~10× a second.
async fn download_with_progress(app: &tauri::AppHandle, mut resp: reqwest::Response) -> CmdResult<Vec<u8>> {
    use tauri::Emitter;
    let total = resp.content_length().filter(|t| *t > 0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total.unwrap_or(0).min(512 * 1024 * 1024) as usize);
    let mut last = std::time::Instant::now();
    let emit = |downloaded: u64| {
        let _ = app.emit("update-progress", DownloadProgress { downloaded, total });
    };
    emit(0);
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download failed: {e}"))? {
        bytes.extend_from_slice(&chunk);
        if last.elapsed() >= std::time::Duration::from_millis(100) {
            last = std::time::Instant::now();
            emit(bytes.len() as u64);
        }
    }
    emit(bytes.len() as u64);
    Ok(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    /// true → the update is being applied in place and Zorvilo is about to restart
    restarting: bool,
    /// where the installer was saved when it had to be opened manually
    path: Option<String>,
}

/// Download the update and install it over the current app, then restart.
/// When an in-place update isn't possible (e.g. the app lives in a read-only
/// location), the installer is saved to Downloads and opened instead.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, url: String, name: String) -> CmdResult<InstallOutcome> {
    if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
        return Err("refusing to download an update from outside GitHub".into());
    }
    let file_name = std::path::Path::new(&name).file_name().ok_or("invalid file name")?.to_owned();
    let resp = client()?.get(&url).send().await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = download_with_progress(&app, resp).await?;

    let outcome = super::blocking(move || {
        let stage = staging_dir()?;
        let installer = stage.join(&file_name);
        std::fs::write(&installer, &bytes).map_err(|e| format!("could not save {}: {e}", installer.display()))?;

        #[cfg(target_os = "macos")]
        let applied = apply_macos(&installer, &stage)?;
        #[cfg(target_os = "windows")]
        let applied = apply_windows(&installer)?;
        #[cfg(target_os = "linux")]
        let applied = apply_linux(&installer)?;
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let applied = false;

        if applied {
            return Ok(InstallOutcome { restarting: true, path: None });
        }

        // Fallback: hand the installer to the user.
        let target = downloads_dir().join(&file_name);
        std::fs::copy(&installer, &target).map_err(|e| format!("could not save {}: {e}", target.display()))?;
        let _ = std::fs::remove_dir_all(&stage);
        #[cfg(unix)]
        if target.extension().map(|e| e.eq_ignore_ascii_case("appimage")).unwrap_or(false) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
        }
        open_path(&target)?;
        Ok(InstallOutcome { restarting: false, path: Some(target.display().to_string()) })
    })
    .await?;

    if outcome.restarting {
        // Let the response reach the UI, then quit so the update can replace us.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
            app.exit(0);
        });
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_and_repos() {
        assert!(version_tuple("v0.2.0") > version_tuple("0.1.9"));
        assert_eq!(version_tuple("1.2.3-beta.1"), (1, 2, 3));
        assert_eq!(parse_repo("https://github.com/acme/zorvilo.git").unwrap(), "acme/zorvilo");
        assert!(parse_repo("bad").is_err());
        assert!(parse_repo("a/b/c").is_err());
    }
}
