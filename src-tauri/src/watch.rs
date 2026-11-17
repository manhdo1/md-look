//! Shared file watcher hub: one notify watcher, many open documents.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::paths::{lexical_normalize, parent_dir};

const DEBOUNCE: Duration = Duration::from_millis(150);
const IDLE_WAIT: Duration = Duration::from_secs(3600);

type SettledCb = Arc<dyn Fn(PathBuf) + Send + Sync>;

/// Folded `(parent, file name)` used to match notify paths to targets in O(1).
type MatchKey = (String, String);
type Targets = Arc<Mutex<HashMap<MatchKey, PathBuf>>>;

/// Payload of the `doc-changed` event. `path` is the normalized target that was
/// opened, never the raw notify path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocChanged {
    pub path: String,
    pub missing: bool,
}

pub fn doc_changed_payload(path: &Path) -> DocChanged {
    DocChanged {
        path: path.to_string_lossy().into_owned(),
        missing: !path.exists(),
    }
}

/// Debounced multi-path watcher. The settled callback receives the watched target path.
pub struct WatchHub {
    watcher: Mutex<Option<RecommendedWatcher>>,
    dirs: Mutex<HashMap<PathBuf, usize>>,
    targets: Targets,
    on_settled: Arc<Mutex<Option<SettledCb>>>,
}

impl WatchHub {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            dirs: Mutex::new(HashMap::new()),
            targets: Arc::new(Mutex::new(HashMap::new())),
            on_settled: Arc::new(Mutex::new(None)),
        }
    }

    /// Install the callback invoked with the settled target path. Safe to call
    /// before the watcher thread starts; the thread reads it at flush time.
    pub fn set_on_settled<F>(&self, on_settled: F)
    where
        F: Fn(PathBuf) + Send + Sync + 'static,
    {
        *self.on_settled.lock().unwrap() = Some(Arc::new(on_settled));
    }

    fn ensure_started(&self) -> anyhow::Result<()> {
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
        let on_settled = Arc::clone(&self.on_settled);
        std::thread::Builder::new()
            .name("md-watch-debounce".into())
            .spawn(move || {
                debounce_loop(raw_rx, targets, move |path| {
                    let cb = on_settled.lock().unwrap().clone();
                    if let Some(cb) = cb {
                        cb(path);
                    }
                });
            })
            .map_err(|e| anyhow::anyhow!("spawn watch debounce: {e}"))?;

        *slot = Some(watcher);
        Ok(())
    }

    pub fn add(&self, path: &Path) -> anyhow::Result<()> {
        self.ensure_started()?;
        let dir = parent_dir(path);

        let mut dirs = self.dirs.lock().unwrap();
        if !dirs.contains_key(&dir) {
            if let Some(w) = self.watcher.lock().unwrap().as_mut() {
                w.watch(&dir, RecursiveMode::NonRecursive)?;
            }
        }
        *dirs.entry(dir).or_insert(0) += 1;
        if let Some(key) = match_key(path) {
            self.targets.lock().unwrap().insert(key, path.to_path_buf());
        }
        Ok(())
    }

    pub fn remove(&self, path: &Path) {
        let dir = parent_dir(path);
        if let Some(key) = match_key(path) {
            self.targets.lock().unwrap().remove(&key);
        }

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

/// Collapse bursts of notify paths onto watched targets, then invoke `on_settled`
/// with the target path (not the raw event path). Does not need a Tauri handle.
fn debounce_loop<F>(
    raw_rx: mpsc::Receiver<PathBuf>,
    targets: Targets,
    mut on_settled: F,
) where
    F: FnMut(PathBuf),
{
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
                let matched = match_key(&p).and_then(|key| targets.lock().unwrap().get(&key).cloned());
                if let Some(target) = matched {
                    pending.insert(target, Instant::now());
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }

        let mut due = Vec::new();
        pending.retain(|path, started| {
            if started.elapsed() < DEBOUNCE {
                return true;
            }
            due.push(path.clone());
            false
        });
        for path in due {
            on_settled(path);
        }
    }
}

#[cfg(test)]
fn same_file(event: &Path, target: &Path) -> bool {
    event == target || matches!((match_key(event), match_key(target)), (Some(a), Some(b)) if a == b)
}

/// Key that matches a notify path to a watched target.
///
/// The parent directory is lexically cleaned (slash form and `\\?\` stripped,
/// `.` / `..` removed) and the file name is Unicode case-folded. Does not
/// canonicalize: editors that save by delete + rename must still match while
/// the target is briefly gone.
fn match_key(path: &Path) -> Option<MatchKey> {
    let clean = lexical_normalize(path);
    let name = clean.file_name()?.to_string_lossy().to_lowercase();
    let parent = clean.parent().unwrap_or(Path::new(""));
    Some((parent_key(parent), name))
}

fn parent_key(parent: &Path) -> String {
    let text = parent.to_string_lossy();
    if cfg!(windows) {
        text.replace('/', "\\").to_lowercase()
    } else {
        text.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn same_file_folds_vietnamese_case() {
        let (upper, lower, sibling) = if cfg!(windows) {
            (
                PathBuf::from(r"D:\Docs\Hướng.md"),
                PathBuf::from(r"D:\Docs\hướng.md"),
                PathBuf::from(r"D:\Docs\khác.md"),
            )
        } else {
            (
                PathBuf::from("/docs/Hướng.md"),
                PathBuf::from("/docs/hướng.md"),
                PathBuf::from("/docs/khác.md"),
            )
        };
        assert!(same_file(&upper, &lower));
        assert!(same_file(&upper.with_file_name("Ấ.md"), &lower.with_file_name("ấ.md")));
        assert!(!same_file(&upper, &sibling));
        assert!(same_file(
            &upper.with_file_name("sub").join("..").join("Hướng.md"),
            &lower
        ));
    }

    #[cfg(windows)]
    #[test]
    fn same_file_matches_verbatim_prefix_without_canonicalize() {
        assert!(same_file(
            Path::new(r"\\?\D:\Docs\Hướng.md"),
            Path::new(r"D:\Docs\hướng.md")
        ));
        assert!(same_file(
            Path::new(r"\\?\D:\Docs\sub\..\Guide.md"),
            Path::new(r"D:\docs\guide.md")
        ));
    }

    #[cfg(not(windows))]
    #[test]
    fn same_file_directories_stay_case_sensitive() {
        assert!(!same_file(Path::new("/Docs/a.md"), Path::new("/docs/a.md")));
        assert!(same_file(Path::new("/docs/Ấ.md"), Path::new("/docs/ấ.md")));
    }

    #[test]
    fn remove_releases_dir_refcount() {
        let hub = WatchHub::new();
        let a = PathBuf::from("/docs/a.md");
        let b = PathBuf::from("/docs/b.md");
        hub.dirs.lock().unwrap().insert(PathBuf::from("/docs"), 2);
        hub.targets.lock().unwrap().extend([
            (match_key(&a).unwrap(), a.clone()),
            (match_key(&b).unwrap(), b.clone()),
        ]);

        hub.remove(&a);
        assert_eq!(hub.dirs.lock().unwrap().get(Path::new("/docs")), Some(&1));
        assert!(!hub.targets.lock().unwrap().values().any(|t| t == &a));

        hub.remove(&b);
        assert!(hub.dirs.lock().unwrap().is_empty());
        assert!(hub.targets.lock().unwrap().is_empty());
    }

    #[test]
    fn doc_changed_json_is_object() {
        let dir = std::env::temp_dir().join(format!("md-look-ev-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        std::fs::write(&file, b"hi").unwrap();

        let present = doc_changed_payload(&file);
        let present_json = serde_json::to_value(&present).unwrap();
        assert!(present_json.is_object());
        assert_eq!(present_json["missing"], false);
        assert_eq!(present_json["path"], present.path);
        assert!(!present.path.is_empty());

        std::fs::remove_file(&file).unwrap();
        let gone = doc_changed_payload(&file);
        let gone_json = serde_json::to_value(&gone).unwrap();
        assert_eq!(gone_json["missing"], true);
        assert!(gone_json["path"].as_str().unwrap().contains("a.md"));
        assert_eq!(gone_json.as_object().unwrap().len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn debounce_loop_calls_back_with_target_not_event_path() {
        let (tx, rx) = mpsc::channel();
        let targets: Targets = Arc::new(Mutex::new(HashMap::new()));
        let target = if cfg!(windows) {
            PathBuf::from(r"D:\Docs\Hướng.md")
        } else {
            PathBuf::from("/docs/Hướng.md")
        };
        let other = target.with_file_name("khác.md");
        let folded = if cfg!(windows) {
            PathBuf::from(r"d:/docs/hướng.md")
        } else {
            PathBuf::from("/docs/hướng.md")
        };
        targets
            .lock()
            .unwrap()
            .insert(match_key(&target).unwrap(), target.clone());

        let (out_tx, out_rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            debounce_loop(rx, targets, move |path| {
                let _ = out_tx.send(path);
            });
        });

        tx.send(other).unwrap();
        tx.send(folded).unwrap();
        #[cfg(windows)]
        tx.send(PathBuf::from(r"\\?\D:\Docs\Hướng.md")).unwrap();

        let got = out_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("debounce callback");
        assert_eq!(got, target);
        assert!(
            out_rx.recv_timeout(Duration::from_millis(400)).is_err(),
            "a non-matching file or a second burst was emitted"
        );

        drop(tx);
        handle.join().expect("debounce thread");
    }

    #[test]
    fn watcher_reports_write_and_rename_over_only_for_target() {
        let dir = std::env::temp_dir().join(format!("md-look-watch-{}", std::process::id()));
        let _cleanup = RmDir(dir.clone());
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        let other = dir.join("other.md");
        std::fs::write(&file, b"base").unwrap();
        std::fs::write(&other, b"other").unwrap();

        let target = crate::document::normalize_path(&file);
        let other_norm = crate::document::normalize_path(&other);

        let (tx, rx) = mpsc::channel();
        let hub = WatchHub::new();
        hub.set_on_settled(move |path| {
            let _ = tx.send(path);
        });
        hub.add(&target).expect("watch target");
        std::thread::sleep(Duration::from_millis(300));
        let _startup = drain(&rx, Duration::from_millis(200));

        std::fs::write(&target, b"first edit is longer").unwrap();
        expect_target(&rx, &target, Duration::from_secs(5));
        let burst = drain(&rx, Duration::from_millis(350));
        assert!(
            burst.iter().all(|p| p == &target),
            "write burst included {burst:?}"
        );

        replace_over(&target, b"renamed over with new contents");
        expect_target(&rx, &target, Duration::from_secs(5));
        let burst = drain(&rx, Duration::from_millis(350));
        assert!(
            burst.iter().all(|p| p == &target),
            "rename burst included {burst:?}"
        );

        std::fs::write(&other_norm, b"a different file in the same directory").unwrap();
        let noise = drain(&rx, Duration::from_millis(800));
        assert!(
            noise.iter().all(|p| p == &target),
            "different file fired the callback: {noise:?}"
        );
        assert!(
            !noise.iter().any(|p| p == &other || p == &other_norm),
            "callback fired for {other_norm:?}: {noise:?}"
        );

        drop(hub);
    }

    fn expect_target(rx: &mpsc::Receiver<PathBuf>, target: &Path, timeout: Duration) {
        match rx.recv_timeout(timeout) {
            Ok(path) if path == target => {}
            Ok(path) => panic!(
                "callback fired for {}, expected {}",
                path.display(),
                target.display()
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                panic!("timed out waiting for {}", target.display())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                panic!("watch callback disconnected")
            }
        }
    }

    fn drain(rx: &mpsc::Receiver<PathBuf>, quiet: Duration) -> Vec<PathBuf> {
        let mut out = Vec::new();
        while let Ok(path) = rx.recv_timeout(quiet) {
            out.push(path);
        }
        out
    }

    fn replace_over(path: &Path, contents: &[u8]) {
        let tmp = path.with_file_name(format!(
            ".{}.{}.tmp",
            std::process::id(),
            path.file_name().unwrap().to_string_lossy()
        ));
        std::fs::write(&tmp, contents).expect("write temp");
        #[cfg(windows)]
        {
            rename_replace(&tmp, path).expect("rename over");
        }
        #[cfg(not(windows))]
        {
            std::fs::rename(&tmp, path).expect("rename over");
        }
    }

    #[cfg(windows)]
    fn rename_replace(from: &Path, to: &Path) -> std::io::Result<()> {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(
                existing: *const u16,
                new: *const u16,
                flags: u32,
            ) -> i32;
        }
        const MOVEFILE_REPLACE_EXISTING: u32 = 1;
        fn wide(path: &Path) -> Vec<u16> {
            path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
        }
        let from_w = wide(from);
        let to_w = wide(to);
        let ok = unsafe { MoveFileExW(from_w.as_ptr(), to_w.as_ptr(), MOVEFILE_REPLACE_EXISTING) };
        if ok == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    struct RmDir(PathBuf);
    impl Drop for RmDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
