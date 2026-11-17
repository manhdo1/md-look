//! Shared file watcher hub: one notify watcher, many open documents.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(150);
const IDLE_WAIT: Duration = Duration::from_secs(3600);

/// Debounced multi-path watcher. Emits `doc-changed` with the absolute path string.
pub struct WatchHub {
    watcher: Mutex<Option<RecommendedWatcher>>,
    dirs: Mutex<HashMap<PathBuf, usize>>,
    targets: Arc<Mutex<HashSet<PathBuf>>>,
}

impl WatchHub {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            dirs: Mutex::new(HashMap::new()),
            targets: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    fn ensure_started(&self, app: &AppHandle) -> anyhow::Result<()> {
        let mut slot = self.watcher.lock().unwrap();
        if slot.is_some() {
            return Ok(());
        }

        let (raw_tx, raw_rx) = mpsc::channel::<PathBuf>();
        let watcher =
            notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    if matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                    ) {
                        for p in event.paths {
                            let _ = raw_tx.send(p);
                        }
                    }
                }
            })?;

        let targets = Arc::clone(&self.targets);
        let app = app.clone();
        std::thread::Builder::new()
            .name("md-watch-debounce".into())
            .spawn(move || debounce_loop(raw_rx, targets, app))
            .map_err(|e| anyhow::anyhow!("spawn watch debounce: {e}"))?;

        *slot = Some(watcher);
        Ok(())
    }

    pub fn add(&self, app: &AppHandle, path: &Path) -> anyhow::Result<()> {
        self.ensure_started(app)?;
        let dir = watch_dir(path);

        let mut dirs = self.dirs.lock().unwrap();
        if !dirs.contains_key(&dir) {
            if let Some(w) = self.watcher.lock().unwrap().as_mut() {
                w.watch(&dir, RecursiveMode::NonRecursive)?;
            }
        }
        *dirs.entry(dir).or_insert(0) += 1;
        self.targets.lock().unwrap().insert(path.to_path_buf());
        Ok(())
    }

    pub fn remove(&self, path: &Path) {
        let dir = watch_dir(path);
        self.targets.lock().unwrap().remove(path);

        let mut dirs = self.dirs.lock().unwrap();
        let Some(count) = dirs.get_mut(&dir) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            dirs.remove(&dir);
            if let Some(w) = self.watcher.lock().unwrap().as_mut() {
                let _ = w.unwatch(&dir);
            }
        }
    }
}

fn debounce_loop(
    raw_rx: mpsc::Receiver<PathBuf>,
    targets: Arc<Mutex<HashSet<PathBuf>>>,
    app: AppHandle,
) {
    let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
    loop {
        // Wait only until the oldest pending change is due, so unrelated events in a busy
        // folder cannot postpone the flush indefinitely.
        let timeout = pending
            .values()
            .map(|t| DEBOUNCE.saturating_sub(t.elapsed()))
            .min()
            .unwrap_or(IDLE_WAIT);

        match raw_rx.recv_timeout(timeout) {
            Ok(p) => {
                let targets = targets.lock().unwrap();
                for t in targets.iter().filter(|t| same_file(&p, t)) {
                    pending.insert(t.clone(), Instant::now());
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }

        pending.retain(|path, t| {
            if t.elapsed() < DEBOUNCE {
                return true;
            }
            let _ = app.emit("doc-changed", path.to_string_lossy().into_owned());
            false
        });
    }
}

fn watch_dir(path: &Path) -> PathBuf {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(path)
        .to_path_buf()
}

/// Full-path compare, case-insensitive on Windows. Avoids `canonicalize` so removed files
/// (editors that save via delete + rename) still match.
fn same_file(a: &Path, b: &Path) -> bool {
    fn eq(x: &Path, y: &Path) -> bool {
        if cfg!(windows) {
            x.to_string_lossy()
                .replace('/', "\\")
                .eq_ignore_ascii_case(&y.to_string_lossy().replace('/', "\\"))
        } else {
            x == y
        }
    }
    a == b || eq(a, b)
}

/// Resolve CLI / second-instance argv entries relative to a working directory.
pub fn resolve_argv_paths(argv: &[String], cwd: &Path) -> Vec<PathBuf> {
    argv.iter()
        .skip(1)
        .filter(|arg| !arg.is_empty())
        .map(|arg| {
            let p = PathBuf::from(arg);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_argv_skips_exe_and_empty() {
        let cwd = PathBuf::from("/docs");
        let args = vec!["markdown-look".into(), "a.md".into(), "".into()];
        let paths = resolve_argv_paths(&args, &cwd);
        assert_eq!(paths, vec![cwd.join("a.md")]);
    }

    #[test]
    fn same_file_distinguishes_directories() {
        let a = Path::new("/one/README.md");
        let b = Path::new("/two/README.md");
        assert!(same_file(a, a));
        assert!(!same_file(a, b));
    }

    #[cfg(windows)]
    #[test]
    fn same_file_ignores_case_on_windows() {
        assert!(same_file(
            Path::new(r"D:\Docs\Guide.md"),
            Path::new("d:/docs/guide.MD")
        ));
    }

    #[test]
    fn remove_releases_dir_refcount() {
        let hub = WatchHub::new();
        let a = PathBuf::from("/docs/a.md");
        let b = PathBuf::from("/docs/b.md");
        hub.dirs.lock().unwrap().insert(PathBuf::from("/docs"), 2);
        hub.targets.lock().unwrap().extend([a.clone(), b.clone()]);

        hub.remove(&a);
        assert_eq!(hub.dirs.lock().unwrap().get(Path::new("/docs")), Some(&1));
        assert!(!hub.targets.lock().unwrap().contains(&a));

        hub.remove(&b);
        assert!(hub.dirs.lock().unwrap().is_empty());
        assert!(hub.targets.lock().unwrap().is_empty());
    }
}
