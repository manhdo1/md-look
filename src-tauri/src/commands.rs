//! Tauri commands: open / reload / close / prefs for multi-tab viewing.

use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::document::{self, is_supported_path, normalize_path, RenderedDocument};
use crate::html;
use crate::prefs::{self, Prefs};
use crate::watch::WatchHub;

/// `(mtime, len)` captured after a successful open or reload. Polls compare
/// against this and do not update it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Fingerprint {
    mtime: SystemTime,
    len: u64,
}

struct DocEntry {
    force: bool,
    refs: usize,
    fingerprint: Fingerprint,
}

/// One open path whose fingerprint changed, or that is no longer on disk.
/// Unchanged and unknown paths are omitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeStatus {
    pub path: String,
    pub missing: bool,
}

/// Gaps before retry 1, 2, and 3. The first read is immediate.
const RELOAD_RETRY_GAPS_MS: [u64; 3] = [100, 250, 500];

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

    /// Adapt settled watch paths into `doc-changed` objects. Call before any file is opened.
    pub fn bind_watcher(&self, app: AppHandle) {
        self.watch.set_on_settled(move |path| {
            let _ = app.emit("doc-changed", crate::watch::doc_changed_payload(&path));
        });
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

fn read_fingerprint(path: &Path) -> std::io::Result<Fingerprint> {
    let meta = std::fs::metadata(path)?;
    Ok(Fingerprint {
        mtime: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        len: meta.len(),
    })
}

fn current_fingerprint(path: &Path) -> Fingerprint {
    read_fingerprint(path).unwrap_or(Fingerprint {
        mtime: SystemTime::UNIX_EPOCH,
        len: 0,
    })
}

/// Compare stored fingerprints to the files on disk. Does not write.
fn statuses_for(open: &HashMap<PathBuf, Fingerprint>, queries: &[PathBuf]) -> Vec<ChangeStatus> {
    let mut out = Vec::new();
    for query in queries {
        let Some(stored) = open.get(query) else {
            continue;
        };
        match read_fingerprint(query) {
            Ok(current) if current == *stored => {}
            Ok(_) => out.push(ChangeStatus {
                path: query.to_string_lossy().into_owned(),
                missing: false,
            }),
            Err(err) if err.kind() == ErrorKind::NotFound => out.push(ChangeStatus {
                path: query.to_string_lossy().into_owned(),
                missing: true,
            }),
            Err(_) => {}
        }
    }
    out
}

fn missing_message(path: &Path) -> String {
    format!("file not found: {}", path.display())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReloadStep {
    Render,
    Retry,
    Missing,
}

/// `len == None` means the file is not there. A 0-byte file is retried only when
/// the stored length was already non-zero (a partial save). On the final attempt
/// a readable file is rendered, including one the user actually emptied.
fn reload_step(len: Option<u64>, stored_len: u64, retries_left: u32) -> ReloadStep {
    match len {
        None => {
            if retries_left == 0 {
                ReloadStep::Missing
            } else {
                ReloadStep::Retry
            }
        }
        Some(0) if stored_len > 0 && retries_left > 0 => ReloadStep::Retry,
        Some(_) => ReloadStep::Render,
    }
}

#[derive(Debug)]
enum Attempt {
    Render(RenderedDocument),
    Retry(String),
    Fail(String),
}

fn attempt_reload(path: &Path, force: bool, stored_len: u64, retries_left: u32) -> Attempt {
    let len = match std::fs::metadata(path) {
        Ok(meta) => Some(meta.len()),
        Err(err) if err.kind() == ErrorKind::NotFound => None,
        Err(err) => {
            return if retries_left == 0 {
                Attempt::Fail(err.to_string())
            } else {
                Attempt::Retry(err.to_string())
            };
        }
    };

    match reload_step(len, stored_len, retries_left) {
        ReloadStep::Missing => return Attempt::Fail(missing_message(path)),
        ReloadStep::Retry => {
            return Attempt::Retry(if len.is_none() {
                missing_message(path)
            } else {
                format!("file is empty: {}", path.display())
            });
        }
        ReloadStep::Render => {}
    }

    if !force && len.unwrap_or(0) > document::MAX_AUTO_LOAD_BYTES {
        let msg = document::check_size(path, false)
            .err()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "file is over 50 MB".to_string());
        return Attempt::Fail(msg);
    }

    match html::render_file(path, force) {
        Ok(doc) => Attempt::Render(doc),
        Err(err) => {
            let msg = if !path.exists() {
                missing_message(path)
            } else {
                err.to_string()
            };
            if retries_left == 0 {
                Attempt::Fail(msg)
            } else {
                Attempt::Retry(msg)
            }
        }
    }
}

fn store_fingerprint(state: &AppState, path: &Path) {
    if let Some(entry) = state.docs.lock().unwrap().get_mut(path) {
        if let Ok(fingerprint) = read_fingerprint(path) {
            entry.fingerprint = fingerprint;
        }
    }
}

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

    allow_asset_dir(app, state, &path)?;

    let doc = html::render_file(&path, force).map_err(|e| e.to_string())?;
    let fingerprint = current_fingerprint(&path);

    {
        let mut docs = state.docs.lock().unwrap();
        let entry = docs.entry(path.clone()).or_insert(DocEntry {
            force,
            refs: 0,
            fingerprint,
        });
        entry.force = force;
        entry.fingerprint = fingerprint;
        entry.refs = entry.refs.saturating_add(1);
        if entry.refs == 1 {
            if let Err(e) = state.watch.add(&path) {
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
    let path = normalize_path(PathBuf::from(path));
    let (force, stored_len) = {
        let docs = state.docs.lock().unwrap();
        let entry = docs
            .get(&path)
            .ok_or_else(|| "file is not open".to_string())?;
        (entry.force, entry.fingerprint.len)
    };
    allow_asset_dir(&app, &state, &path)?;

    let mut last_err = missing_message(&path);
    for attempt in 0..=RELOAD_RETRY_GAPS_MS.len() {
        let retries_left = (RELOAD_RETRY_GAPS_MS.len() - attempt) as u32;
        match attempt_reload(&path, force, stored_len, retries_left) {
            Attempt::Render(doc) => {
                store_fingerprint(&state, &path);
                return Ok(doc);
            }
            Attempt::Fail(err) => return Err(err),
            Attempt::Retry(err) => {
                last_err = err;
                if let Some(gap) = RELOAD_RETRY_GAPS_MS.get(attempt) {
                    tokio::time::sleep(Duration::from_millis(*gap)).await;
                }
            }
        }
    }
    Err(last_err)
}

#[tauri::command]
pub fn check_changed(state: State<'_, AppState>, paths: Vec<String>) -> Vec<ChangeStatus> {
    // The UI sends back the normalized `doc.path`, so the direct lookup almost always
    // hits; canonicalizing on every 2s poll would open each file just to resolve it.
    let (open, queries) = {
        let docs = state.docs.lock().unwrap();
        let mut open = HashMap::with_capacity(paths.len());
        let mut queries = Vec::with_capacity(paths.len());
        for raw in paths {
            let direct = PathBuf::from(raw);
            let key = if docs.contains_key(&direct) {
                direct
            } else {
                normalize_path(&direct)
            };
            if let Some(entry) = docs.get(&key) {
                open.insert(key.clone(), entry.fingerprint);
                queries.push(key);
            }
        }
        (open, queries)
    };
    statuses_for(&open, &queries)
}

#[tauri::command]
pub fn close_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = normalize_path(PathBuf::from(path));
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
                out.push(normalize_path(path).to_string_lossy().into_owned());
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

    #[test]
    fn reload_step_retries_partial_and_missing() {
        assert_eq!(reload_step(None, 10, 3), ReloadStep::Retry);
        assert_eq!(reload_step(None, 10, 0), ReloadStep::Missing);
        assert_eq!(reload_step(Some(0), 10, 2), ReloadStep::Retry);
        assert_eq!(reload_step(Some(0), 10, 0), ReloadStep::Render);
        assert_eq!(reload_step(Some(0), 0, 3), ReloadStep::Render);
        assert_eq!(reload_step(Some(5), 10, 3), ReloadStep::Render);
        assert_eq!(RELOAD_RETRY_GAPS_MS, [100, 250, 500]);
    }

    #[test]
    fn attempt_reload_missing_says_not_found() {
        let path = std::env::temp_dir().join(format!(
            "md-look-missing-{}-nope.md",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        match attempt_reload(&path, false, 12, 0) {
            Attempt::Fail(msg) => {
                let lower = msg.to_lowercase();
                assert!(
                    lower.contains("not found") || lower.contains("missing"),
                    "{msg}"
                );
            }
            other => panic!("expected a terminal missing error, got {other:?}"),
        }
    }

    #[test]
    fn attempt_reload_skips_retry_for_legitimately_empty() {
        let dir = std::env::temp_dir().join(format!("md-look-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("empty.md");
        std::fs::write(&path, b"").unwrap();
        match attempt_reload(&path, false, 0, 3) {
            Attempt::Render(doc) => {
                assert_eq!(doc.path, path.to_string_lossy());
            }
            Attempt::Retry(msg) => panic!("empty file was retried: {msg}"),
            Attempt::Fail(msg) => panic!("empty file failed: {msg}"),
        }
        match attempt_reload(&path, false, 8, 3) {
            Attempt::Retry(msg) => assert!(msg.to_lowercase().contains("empty"), "{msg}"),
            other => panic!("partial empty should retry, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_changed_reports_delta_until_fingerprint_refresh() {
        let dir = std::env::temp_dir().join(format!("md-look-fp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, b"one").unwrap();
        let key = normalize_path(&file);
        let stored = read_fingerprint(&key).unwrap();
        let mut open = HashMap::new();
        open.insert(key.clone(), stored);

        assert!(statuses_for(&open, &[key.clone()]).is_empty());

        std::fs::write(&key, b"one-two").unwrap();
        let once = statuses_for(&open, &[key.clone()]);
        assert_eq!(
            once,
            vec![ChangeStatus {
                path: key.to_string_lossy().into_owned(),
                missing: false,
            }]
        );
        let twice = statuses_for(&open, &[key.clone()]);
        assert_eq!(twice, once, "comparing must not refresh the fingerprint");
        assert_eq!(open.get(&key).unwrap().len, stored.len);

        let unknown = normalize_path(dir.join("not-open.md"));
        assert!(statuses_for(&open, &[unknown]).is_empty());

        let unchanged = dir.join("same.md");
        std::fs::write(&unchanged, b"stay").unwrap();
        let unchanged_key = normalize_path(&unchanged);
        open.insert(
            unchanged_key.clone(),
            read_fingerprint(&unchanged_key).unwrap(),
        );
        let mixed = statuses_for(&open, &[unchanged_key, key.clone()]);
        assert_eq!(mixed.len(), 1);
        assert_eq!(mixed[0].path, key.to_string_lossy());
        assert!(!mixed[0].missing);

        std::fs::remove_file(&key).unwrap();
        let queried = normalize_path(&key);
        assert_eq!(queried, key);
        let missing = statuses_for(&open, &[queried]);
        assert_eq!(
            missing,
            vec![ChangeStatus {
                path: key.to_string_lossy().into_owned(),
                missing: true,
            }]
        );
        assert!(open.contains_key(&key));

        let json = serde_json::to_value(&missing[0]).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 2);
        assert_eq!(json["missing"], true);
        assert!(json["path"].is_string());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
