//! Re-render an open file, retrying through partial saves and delete + rename.

use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use crate::document::{self, RenderedDocument};
use crate::html;

/// Gaps before retry 1, 2, and 3. The first read is immediate.
pub(crate) const RELOAD_RETRY_GAPS_MS: [u64; 3] = [100, 250, 500];

pub(crate) fn missing_message(path: &Path) -> String {
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

/// Render `path`, waiting [`RELOAD_RETRY_GAPS_MS`] between attempts that may be
/// mid-save. Returns the last retry error when every attempt is exhausted.
pub(crate) async fn reload_with_retry(
    path: &Path,
    force: bool,
    stored_len: u64,
) -> Result<RenderedDocument, String> {
    let mut last_err = missing_message(path);
    for attempt in 0..=RELOAD_RETRY_GAPS_MS.len() {
        let retries_left = (RELOAD_RETRY_GAPS_MS.len() - attempt) as u32;
        match attempt_reload(path, force, stored_len, retries_left) {
            Attempt::Render(doc) => return Ok(doc),
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
