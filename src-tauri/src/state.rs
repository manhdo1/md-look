//! Shared app state: open documents, asset scope, prefs, pending paths, watcher.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::events::EVENT_DOC_CHANGED;
use crate::fingerprint::{read_fingerprint, Fingerprint};
use crate::paths::{normalize_path, parent_dir};
use crate::prefs::{self, Prefs};
use crate::watch::WatchHub;

struct DocEntry {
    force: bool,
    refs: usize,
    fingerprint: Fingerprint,
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

    pub(crate) fn take_pending(&self) -> Vec<String> {
        self.pending_paths
            .lock()
            .unwrap()
            .drain(..)
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    }

    /// Adapt settled watch paths into `doc-changed` objects. Call before any file is opened.
    pub fn bind_watcher(&self, app: AppHandle) {
        self.watch.set_on_settled(move |path| {
            let _ = app.emit(EVENT_DOC_CHANGED, crate::watch::doc_changed_payload(&path));
        });
    }

    /// Record one more open of `path` with its fresh fingerprint. The first open
    /// starts watching it.
    pub(crate) fn register_open(&self, path: &Path, force: bool, fingerprint: Fingerprint) {
        let mut docs = self.docs.lock().unwrap();
        let entry = docs.entry(path.to_path_buf()).or_insert(DocEntry {
            force,
            refs: 0,
            fingerprint,
        });
        entry.force = force;
        entry.fingerprint = fingerprint;
        entry.refs = entry.refs.saturating_add(1);
        if entry.refs == 1 {
            if let Err(e) = self.watch.add(path) {
                eprintln!("watch failed: {e}");
            }
        }
    }

    /// Drop one open of `path`. The last close forgets it and stops watching.
    pub(crate) fn release(&self, path: &Path) {
        let mut docs = self.docs.lock().unwrap();
        let Some(entry) = docs.get_mut(path) else {
            return;
        };
        entry.refs = entry.refs.saturating_sub(1);
        if entry.refs == 0 {
            docs.remove(path);
            self.watch.remove(path);
        }
    }

    /// `(force, stored_len)` of an open document.
    pub(crate) fn doc_meta(&self, path: &Path) -> Option<(bool, u64)> {
        let docs = self.docs.lock().unwrap();
        docs.get(path)
            .map(|entry| (entry.force, entry.fingerprint.len))
    }

    /// Stored fingerprints for the open paths among `paths`, plus the matched keys in order.
    pub(crate) fn fingerprints_for(
        &self,
        paths: Vec<String>,
    ) -> (HashMap<PathBuf, Fingerprint>, Vec<PathBuf>) {
        // The UI sends back the normalized `doc.path`, so the direct lookup almost always
        // hits; canonicalizing on every 2s poll would open each file just to resolve it.
        let docs = self.docs.lock().unwrap();
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
    }

    pub(crate) fn store_fingerprint(&self, path: &Path) {
        if let Some(entry) = self.docs.lock().unwrap().get_mut(path) {
            if let Ok(fingerprint) = read_fingerprint(path) {
                entry.fingerprint = fingerprint;
            }
        }
    }

    /// Allow the file's directory for the asset protocol. Never forbid — forbid wins over allow
    /// in Tauri's scope, which breaks images when switching between tabs in different folders.
    pub(crate) fn allow_asset_dir(&self, app: &AppHandle, path: &Path) -> Result<(), String> {
        let parent = parent_dir(path);
        let mut dirs = self.asset_dirs.lock().unwrap();
        if dirs.contains(&parent) {
            return Ok(());
        }
        app.asset_protocol_scope()
            .allow_directory(&parent, true)
            .map_err(|e| format!("asset scope: {e}"))?;
        dirs.insert(parent);
        Ok(())
    }

    pub(crate) fn touch_recent(&self, app: &AppHandle, path: &Path) {
        let path_str = path.to_string_lossy().into_owned();
        let mut prefs = self.prefs.lock().unwrap();
        if prefs.recent.first() == Some(&path_str) {
            return;
        }
        prefs::push_recent(&mut prefs.recent, path_str);
        let snapshot = prefs.clone();
        drop(prefs);
        if let Err(e) = prefs::save(app, &snapshot) {
            eprintln!("save prefs (recent): {e}");
        }
    }

    pub(crate) fn prefs(&self) -> Prefs {
        self.prefs.lock().unwrap().clone()
    }

    pub(crate) fn replace_prefs(&self, prefs: Prefs) {
        *self.prefs.lock().unwrap() = prefs;
    }
}
