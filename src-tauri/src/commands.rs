//! Tauri commands: open / reload / close / prefs for multi-tab viewing.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::document::{self, absolute_path, is_supported_path, RenderedDocument};
use crate::html;
use crate::prefs::{self, Prefs};
use crate::watch::WatchHub;

struct DocEntry {
    force: bool,
    refs: usize,
}

pub struct AppState {
    pending_paths: Mutex<Vec<PathBuf>>,
    docs: Mutex<HashMap<PathBuf, DocEntry>>,
    asset_dirs: Mutex<HashSet<PathBuf>>,
    prefs: Mutex<Prefs>,
    watch: WatchHub,
}

impl AppState {
    pub fn new(prefs: Prefs) -> Self {
        Self {
            pending_paths: Mutex::new(Vec::new()),
            docs: Mutex::new(HashMap::new()),
            asset_dirs: Mutex::new(HashSet::new()),
            prefs: Mutex::new(prefs),
            watch: WatchHub::new(),
        }
    }

    pub fn push_pending(&self, paths: impl IntoIterator<Item = PathBuf>) {
        let mut pending = self.pending_paths.lock().unwrap();
        for path in paths {
            if !path.as_os_str().is_empty() {
                pending.push(path);
            }
        }
    }
}

fn asset_parent(path: &Path) -> PathBuf {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(path)
        .to_path_buf()
}

/// Allow the file's directory for the asset protocol. Never forbid — forbid wins over allow
/// in Tauri's scope, which breaks images when switching between tabs in different folders.
fn allow_asset_dir(app: &AppHandle, state: &AppState, path: &Path) -> Result<(), String> {
    let parent = asset_parent(path);
    let mut dirs = state.asset_dirs.lock().unwrap();
    if dirs.contains(&parent) {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_directory(&parent, true)
        .map_err(|e| format!("asset scope: {e}"))?;
    dirs.insert(parent);
    Ok(())
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

    allow_asset_dir(app, state, &path)?;

    let doc = html::render_file(&path, force).map_err(|e| e.to_string())?;

    {
        let mut docs = state.docs.lock().unwrap();
        let entry = docs.entry(path.clone()).or_insert(DocEntry { force, refs: 0 });
        entry.force = force;
        entry.refs = entry.refs.saturating_add(1);
        if entry.refs == 1 {
            if let Err(e) = state.watch.add(app, &path) {
                eprintln!("watch failed: {e}");
            }
        }
    }

    touch_recent(app, state, &path);
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
    let path = absolute_path(PathBuf::from(path));
    let force = {
        let docs = state.docs.lock().unwrap();
        docs.get(&path)
            .map(|e| e.force)
            .ok_or_else(|| "file is not open".to_string())?
    };
    allow_asset_dir(&app, &state, &path)?;
    html::render_file(&path, force).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = absolute_path(PathBuf::from(path));
    let mut docs = state.docs.lock().unwrap();
    let Some(entry) = docs.get_mut(&path) else {
        return Ok(());
    };
    entry.refs = entry.refs.saturating_sub(1);
    if entry.refs == 0 {
        docs.remove(&path);
        state.watch.remove(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn set_active(app: AppHandle, title: Option<String>) {
    let title = match title {
        Some(t) if !t.is_empty() => format!("{t} — markdown-look"),
        _ => "markdown-look".into(),
    };
    let _ = app
        .get_webview_window("main")
        .and_then(|w| w.set_title(&title).ok());
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
                out.push(absolute_path(path).to_string_lossy().into_owned());
            }
            Ok(out)
        }
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn take_pending_paths(state: State<'_, AppState>) -> Vec<String> {
    state
        .pending_paths
        .lock()
        .unwrap()
        .drain(..)
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn resolve_relative(base: String, rel: String) -> Result<String, String> {
    let base_path = absolute_path(PathBuf::from(base));
    let base_dir = base_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let joined = if Path::new(&rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        base_dir.join(rel)
    };
    Ok(absolute_path(joined).to_string_lossy().into_owned())
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
