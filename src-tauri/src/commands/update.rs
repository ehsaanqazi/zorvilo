//! "Update" — find the latest GitHub release, download the installer for this
//! platform and open it.

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
        if n.ends_with(".msi") {
            10
        } else if n.ends_with(".exe") {
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
pub async fn update_check(repo: String) -> CmdResult<UpdateInfo> {
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
    let current = env!("CARGO_PKG_VERSION").to_string();
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

/// Download the installer into the Downloads folder and open it. Returns the file path.
#[tauri::command]
pub async fn update_install(url: String, name: String) -> CmdResult<String> {
    if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
        return Err("refusing to download an update from outside GitHub".into());
    }
    let file_name = std::path::Path::new(&name).file_name().ok_or("invalid file name")?.to_owned();
    let resp = client()?.get(&url).send().await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("download failed: {e}"))?;
    let path = downloads_dir().join(file_name);
    let target = path.clone();
    super::blocking(move || {
        std::fs::write(&target, &bytes).map_err(|e| format!("could not save {}: {e}", target.display()))?;
        #[cfg(unix)]
        if target.extension().map(|e| e.eq_ignore_ascii_case("appimage")).unwrap_or(false) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
        }
        open_path(&target)
    })
    .await?;
    Ok(path.display().to_string())
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
