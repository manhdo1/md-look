//! markdown-look Tauri library entry.

mod commands;
pub mod document;
pub mod html;
mod prefs;
mod watch;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let prefs = prefs::load(app.handle());
            let state = AppState::new(prefs);
            if let Some(ref path) = cli_path {
                *state.pending_path.lock().unwrap() = Some(path.clone());
            }
            app.manage(state);

            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                        event
                    {
                        let Some(path) = paths.first() else {
                            return;
                        };
                        let state = handle.state::<AppState>();
                        *state.pending_path.lock().unwrap() = Some(path.clone());
                        let _ = handle.emit("file-drop", ());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::reload,
            commands::get_prefs,
            commands::set_prefs,
            commands::pick_file,
            commands::current_path,
            commands::take_pending_path,
            commands::resolve_relative,
        ])
        .run(tauri::generate_context!())
        .expect("error while running markdown-look");
}
