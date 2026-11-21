//! Tauri commands: open / reload / close / prefs for multi-tab viewing.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::document::{self, is_supported_path, normalize_path, RenderedDocument};
use crate::events::{APP_NAME, MAIN_WINDOW};
use crate::fingerprint::{self, current_fingerprint, ChangeStatus};
use crate::html;
use crate::prefs::{self, Prefs};
use crate::reload::{missing_message, reload_with_retry};
use crate::state::AppState;

fn open_path_inner(
    app: &AppHandle,
    state: &AppState,
    path: PathBuf,
    force: bool,
) -> Result<RenderedDocument, String> {
    let path = normalize_path(&path);
    if !path.exists() {
        return Err(missing_message(&path));
    }
    if !is_supported_path(&path) {
        return Err(format!("unsupported file type: {}", path.display()));
    }

    state.allow_asset_dir(app, &path)?;

    let doc = html::render_file(&path, force).map_err(|e| e.to_string())?;
    state.allow_asset_files(app, &doc.local_assets)?;
    state.register_open(&path, force, current_fingerprint(&path));
    state.touch_recent(app, &path);
    Ok(doc)
}

#[tauri::command]
pub async fn open_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    force: Option<bool>,
) -> Result<RenderedDocument, String> {
    open_path_inner(&app, &state, PathBuf::from(path), force.unwrap_or(false))
}

#[tauri::command]
pub async fn reload(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<RenderedDocument, String> {
    let path = normalize_path(PathBuf::from(path));
    let (force, stored_len) = state
        .doc_meta(&path)
        .ok_or_else(|| "file is not open".to_string())?;
    state.allow_asset_dir(&app, &path)?;

    let doc = reload_with_retry(&path, force, stored_len).await?;
    state.allow_asset_files(&app, &doc.local_assets)?;
    state.store_fingerprint(&path);
    Ok(doc)
}

#[tauri::command]
pub fn check_changed(state: State<'_, AppState>, paths: Vec<String>) -> Vec<ChangeStatus> {
    let (open, queries) = state.fingerprints_for(paths);
    fingerprint::statuses_for(&open, &queries)
}

#[tauri::command]
pub fn close_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.release(&normalize_path(PathBuf::from(path)));
    Ok(())
}

#[tauri::command]
pub fn set_active(app: AppHandle, title: Option<String>) {
    let title = match title {
        Some(t) if !t.is_empty() => format!("{t} — {APP_NAME}"),
        _ => APP_NAME.into(),
    };
    let _ = app
        .get_webview_window(MAIN_WINDOW)
        .and_then(|w| w.set_title(&title).ok());
}

#[tauri::command]
pub fn get_prefs(state: State<'_, AppState>) -> Prefs {
    state.prefs()
}

#[tauri::command]
pub fn set_prefs(app: AppHandle, state: State<'_, AppState>, prefs: Prefs) -> Result<(), String> {
    prefs::save(&app, &prefs)?;
    state.replace_prefs(prefs);
    Ok(())
}

#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let extensions: Vec<&str> = document::SUPPORTED_EXTENSIONS.to_vec();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &extensions)
        .pick_files(move |files| {
            let _ = tx.send(files);
        });

    let files = rx.await.map_err(|_| "dialog channel closed".to_string())?;
    match files {
        Some(list) => {
            let mut out = Vec::with_capacity(list.len());
            for f in list {
                let path = f.into_path().map_err(|e| e.to_string())?;
                out.push(normalize_path(path).to_string_lossy().into_owned());
            }
            Ok(out)
        }
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn take_pending_paths(state: State<'_, AppState>) -> Vec<String> {
    state.take_pending()
}

#[tauri::command]
pub fn resolve_relative(base: String, rel: String) -> Result<String, String> {
    let base_path = normalize_path(PathBuf::from(base));
    let base_dir = base_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let joined = if Path::new(&rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        base_dir.join(rel)
    };
    Ok(normalize_path(joined).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_relative_from_base_file() {
        let base = if cfg!(windows) {
            r"D:\docs\guide.md".to_string()
        } else {
            "/docs/guide.md".to_string()
        };
        let resolved = resolve_relative(base, "../other/note.md".into()).unwrap();
        assert!(resolved.replace('\\', "/").ends_with("other/note.md"));
    }

    #[test]
    fn resolve_relative_absolute_passthrough() {
        let abs = if cfg!(windows) {
            r"D:\abs\file.md".to_string()
        } else {
            "/abs/file.md".to_string()
        };
        let base = if cfg!(windows) {
            r"D:\docs\guide.md".to_string()
        } else {
            "/docs/guide.md".to_string()
        };
        let resolved = resolve_relative(base, abs.clone()).unwrap();
        assert_eq!(
            PathBuf::from(resolved)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&abs)),
            PathBuf::from(&abs)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&abs))
        );
    }
}
