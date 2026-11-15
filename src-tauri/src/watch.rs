//! Debounced file watcher that emits reload events through the app handle.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(150);

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    /// Keeps the raw event sender alive for the notify callback.
    _raw_tx: mpsc::Sender<PathBuf>,
}

impl FileWatcher {
    pub fn watch(path: &Path, app: AppHandle) -> anyhow::Result<Self> {
        let (raw_tx, raw_rx) = mpsc::channel::<PathBuf>();

        let raw_tx_cb = raw_tx.clone();
        let mut watcher =
            notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
                            if let Some(p) = event.paths.first() {
                                let _ = raw_tx_cb.send(p.clone());
                            }
                        }
                        _ => {}
                    }
                }
            })?;

        let watch_path = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(path);
        watcher.watch(watch_path, RecursiveMode::NonRecursive)?;

        let target = path.to_path_buf();
        std::thread::Builder::new()
            .name("md-watch-debounce".into())
            .spawn(move || {
                while let Ok(p) = raw_rx.recv() {
                    if !paths_match(&p, &target) && p.file_name() != target.file_name() {
                        continue;
                    }
                    let mut last = Instant::now();
                    loop {
                        match raw_rx.recv_timeout(DEBOUNCE) {
                            Ok(p2) => {
                                if paths_match(&p2, &target) || p2.file_name() == target.file_name()
                                {
                                    last = Instant::now();
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if last.elapsed() >= DEBOUNCE {
                                    let _ = app.emit("doc-changed", ());
                                    break;
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }
                }
            })
            .map_err(|e| anyhow::anyhow!("spawn watch debounce: {e}"))?;

        Ok(Self {
            _watcher: watcher,
            _raw_tx: raw_tx,
        })
    }
}

fn paths_match(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a.file_name().is_some_and(|n| Some(n) == b.file_name()),
    }
}
