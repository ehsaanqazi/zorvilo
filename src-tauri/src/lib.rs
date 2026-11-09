//! Zorvilo desktop shell: Tauri application, IPC commands and events.
//!
//! The React UI talks to Rust exclusively through the commands registered
//! below; networking, storage, scripting, Git and import/export all run here.

mod commands;
mod state;

use tauri::{Emitter, Manager};
use zorvilo_storage::AppPaths;

use crate::state::AppState;

fn init_logging(paths: &AppPaths) {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let filter = EnvFilter::try_from_env("ZORVILO_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let file = std::fs::OpenOptions::new().create(true).append(true).open(paths.logs_dir.join("zorvilo.log"));
    let registry = tracing_subscriber::registry().with(filter).with(fmt::layer().with_writer(std::io::stderr));
    match file {
        Ok(f) => {
            let _ = registry.with(fmt::layer().with_ansi(false).with_writer(std::sync::Mutex::new(f))).try_init();
        }
        Err(_) => {
            let _ = registry.try_init();
        }
    }
}

/// Forward `zorvilo://…` links to the UI.
fn forward_deep_links(app: &tauri::AppHandle, urls: Vec<String>) {
    for url in urls {
        let _ = app.emit("deep-link", url);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    // rustls 0.23 needs exactly one process-wide crypto provider.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let paths = match AppPaths::resolve() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Zorvilo: cannot create the data directory: {e}");
            std::process::exit(1);
        }
    };
    init_logging(&paths);
    let mut notes = Vec::new();
    match zorvilo_storage::database::apply_pending_restore(&paths) {
        Ok(Some(msg)) => notes.push(msg),
        Ok(None) => {}
        Err(e) => notes.push(format!("Restoring the backup failed: {e}")),
    }
    tracing::info!(data_dir = %paths.root.display(), "starting Zorvilo");

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let links: Vec<String> = argv.into_iter().filter(|a| a.starts_with("zorvilo://")).collect();
            forward_deep_links(app, links);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::new(paths, notes))
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                // registers the zorvilo:// scheme for unbundled/dev runs too
                let _ = app.deep_link().register_all();
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls().into_iter().map(|u| u.to_string()).collect();
                forward_deep_links(&handle, urls);
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let pending: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
                app.state::<AppState>().set_pending_links(pending);
            }
            commands::db::purge_expired(&app.state::<AppState>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::take_pending_links,
            commands::system::clipboard_write,
            commands::system::open_external,
            commands::system::confirm_dialog,
            commands::db::db_bootstrap,
            commands::db::db_load_workspace,
            commands::db::db_apply,
            commands::db::db_get,
            commands::db::db_delete_workspace,
            commands::db::db_clear_history,
            commands::db::db_wipe_all,
            commands::db::db_reset,
            commands::db::db_backup,
            commands::trash::trash_list,
            commands::trash::trash_restore,
            commands::trash::trash_delete,
            commands::trash::trash_empty,
            commands::http::execute_request,
            commands::http::cancel_request,
            commands::http::oauth2_get_token,
            commands::realtime::realtime_connect,
            commands::realtime::realtime_send,
            commands::realtime::realtime_disconnect,
            commands::git::git_info,
            commands::git::git_clone,
            commands::git::git_init,
            commands::git::git_commit,
            commands::git::git_pull,
            commands::git::git_reset_to_remote,
            commands::git::git_push,
            commands::git::git_discard_changes,
            commands::git::git_checkout,
            commands::git::git_sync,
            commands::git::git_fetch,
            commands::git::git_backup_files,
            commands::git::git_open_local,
            commands::update::update_check,
            commands::update::update_install,
            commands::files::open_text_files,
            commands::files::open_directory_json,
            commands::files::save_file,
            commands::files::save_files_to_folder,
            commands::import_export::import_parse,
            commands::import_export::parse_curl,
            commands::import_export::export_postman_collection,
            commands::import_export::export_postman_environment,
            commands::import_export::export_workspace_bundle,
            commands::import_export::generate_code,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Zorvilo")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // close live sockets and cancel in-flight requests on quit
                let state = app.state::<AppState>();
                for (_, c) in state::lock(&state.realtime).drain() {
                    c.handle.close();
                }
                for (_, (_, t)) in state::lock(&state.inflight).drain() {
                    t.cancel();
                }
            }
        });
}
