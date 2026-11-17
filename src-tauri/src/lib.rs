//! markdown-look Tauri library entry.

mod cli;
mod commands;
pub mod document;
mod events;
mod fingerprint;
pub mod html;
mod paths;
mod prefs;
mod reload;
mod state;
mod watch;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use cli::resolve_argv_paths;
use events::{EVENT_OPEN_PATHS, MAIN_WINDOW};
use state::AppState;

fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Queue paths for the UI; it drains them with `take_pending_paths` on `open-paths`.
fn enqueue_paths(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<AppState>().push_pending(paths);
    let _ = app.emit(EVENT_OPEN_PATHS, ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_paths: Vec<PathBuf> = std::env::args_os()
        .skip(1)
        .filter(|a| !a.is_empty())
        .map(PathBuf::from)
        .collect();

    tauri::Builder::default()
        // Must be registered first so a second process exits before other plugins run.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            enqueue_paths(app, resolve_argv_paths(&argv, &PathBuf::from(cwd)));
            focus_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let prefs = prefs::load(app.handle());
            let state = AppState::new(prefs);
            state.bind_watcher(app.handle().clone());
            state.push_pending(cli_paths);
            app.manage(state);

            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                        event
                    {
                        enqueue_paths(&handle, paths.clone());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::reload,
            commands::check_changed,
            commands::close_file,
            commands::set_active,
            commands::get_prefs,
            commands::set_prefs,
            commands::pick_files,
            commands::take_pending_paths,
            commands::resolve_relative,
        ])
        .run(tauri::generate_context!())
        .expect("error while running markdown-look");
}
