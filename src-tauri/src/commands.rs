//! Tauri commands: open / reload / prefs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::document::{self, absolute_path, is_supported_path, RenderedDocument};
use crate::html;
use crate::prefs::{self, Prefs};
use crate::watch::FileWatcher;

pub struct AppState {
    pub current_path: Mutex<Option<PathBuf>>,
    pub pending_path: Mutex<Option<PathBuf>>,
    pub prefs: Mutex<Prefs>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub force_large: Mutex<bool>,
    pub allowed_asset_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(prefs: Prefs) -> Self {
        Self {
            current_path: Mutex::new(None),
            pending_path: Mutex::new(None),
            prefs: Mutex::new(prefs),
            watcher: Mutex::new(None),
            force_large: Mutex::new(false),
            allowed_asset_dir: Mutex::new(None),
        }
    }
}

fn asset_parent(path: &Path) -> PathBuf {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(path)
        .to_path_buf()
}

/// Allow the new file's directory; forbid the previously allowed directory when switching.
fn swap_asset_dir(app: &AppHandle, state: &AppState, path: &Path) -> Result<(), String> {
    let parent = asset_parent(path);
    let mut prev = state.allowed_asset_dir.lock().unwrap();
    if let Some(old) = prev.as_ref() {
        if old != &parent {
            let _ = app.asset_protocol_scope().forbid_directory(old, true);
        }
    }
    app.asset_protocol_scope()
        .allow_directory(&parent, true)
        .map_err(|e| format!("asset scope: {e}"))?;
    *prev = Some(parent);
    Ok(())
}

fn replace_watch(app: &AppHandle, state: &AppState, path: &Path) {
    match FileWatcher::watch(path, app.clone()) {
        Ok(w) => *state.watcher.lock().unwrap() = Some(w),
        Err(e) => {
            eprintln!("watch failed: {e}");
            *state.watcher.lock().unwrap() = None;
        }
    }
}

fn touch_recent(app: &AppHandle, state: &AppState, path: &Path) {
    let path_str = path.to_string_lossy().into_owned();
    let mut prefs = state.prefs.lock().unwrap();
    prefs::push_recent(&mut prefs.recent, path_str);
    let snapshot = prefs.clone();
    drop(prefs);
    if let Err(e) = prefs::save(app, &snapshot) {
        eprintln!("save prefs (recent): {e}");
    }
}

fn open_path_inner(
    app: &AppHandle,
    state: &AppState,
    path: PathBuf,
    force: bool,
) -> Result<RenderedDocument, String> {
    let path = absolute_path(&path);
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    if !is_supported_path(&path) {
        return Err(format!("unsupported file type: {}", path.display()));
    }

    swap_asset_dir(app, state, &path)?;

    let doc = html::render_file(&path, force).map_err(|e| e.to_string())?;

    *state.current_path.lock().unwrap() = Some(path.clone());
    *state.force_large.lock().unwrap() = force;
    replace_watch(app, state, &path);
    touch_recent(app, state, &path);

    let _ = app
        .get_webview_window("main")
        .and_then(|w| w.set_title(&format!("{} — markdown-look", doc.title)).ok());

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
pub async fn reload(app: AppHandle, state: State<'_, AppState>) -> Result<RenderedDocument, String> {
    let path = state
        .current_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no file open".to_string())?;
    let force = *state.force_large.lock().unwrap();
    swap_asset_dir(&app, &state, &path)?;
    let doc = html::render_file(&path, force).map_err(|e| e.to_string())?;
    let _ = app
        .get_webview_window("main")
        .and_then(|w| w.set_title(&format!("{} — markdown-look", doc.title)).ok());
    Ok(doc)
}

#[tauri::command]
pub fn get_prefs(state: State<'_, AppState>) -> Prefs {
    state.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_prefs(app: AppHandle, state: State<'_, AppState>, prefs: Prefs) -> Result<(), String> {
    prefs::save(&app, &prefs)?;
    *state.prefs.lock().unwrap() = prefs;
    Ok(())
}

#[tauri::command]
pub async fn pick_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<RenderedDocument>, String> {
    use tauri_plugin_dialog::DialogExt;

    let extensions: Vec<&str> = document::SUPPORTED_EXTENSIONS.to_vec();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &extensions)
        .pick_file(move |file| {
            let _ = tx.send(file);
        });

    let file = rx.await.map_err(|_| "dialog channel closed".to_string())?;
    match file {
        Some(f) => {
            let path = f.into_path().map_err(|e| e.to_string())?;
            open_path_inner(&app, &state, path, false).map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn current_path(state: State<'_, AppState>) -> Option<String> {
    state
        .current_path
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn take_pending_path(state: State<'_, AppState>) -> Option<String> {
    state
        .pending_path
        .lock()
        .unwrap()
        .take()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn resolve_relative(state: State<'_, AppState>, rel: String) -> Result<String, String> {
    let current = state
        .current_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no file open".to_string())?;
    let base = current
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let joined = if Path::new(&rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        base.join(rel)
    };
    Ok(absolute_path(joined).to_string_lossy().into_owned())
}
