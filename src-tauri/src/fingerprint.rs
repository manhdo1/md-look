//! `(mtime, len)` fingerprints of open files and the change report built from them.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

/// `(mtime, len)` captured after a successful open or reload. Polls compare
/// against this and do not update it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Fingerprint {
    pub(crate) mtime: SystemTime,
    pub(crate) len: u64,
}

/// One open path whose fingerprint changed, or that is no longer on disk.
/// Unchanged and unknown paths are omitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeStatus {
    pub path: String,
    pub missing: bool,
}

pub(crate) fn read_fingerprint(path: &Path) -> std::io::Result<Fingerprint> {
    let meta = std::fs::metadata(path)?;
    Ok(Fingerprint {
        mtime: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        len: meta.len(),
    })
}

pub(crate) fn current_fingerprint(path: &Path) -> Fingerprint {
    read_fingerprint(path).unwrap_or(Fingerprint {
        mtime: SystemTime::UNIX_EPOCH,
        len: 0,
    })
}

/// Compare stored fingerprints to the files on disk. Does not write.
pub(crate) fn statuses_for(
    open: &HashMap<PathBuf, Fingerprint>,
    queries: &[PathBuf],
) -> Vec<ChangeStatus> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::normalize_path;

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

        assert!(statuses_for(&open, std::slice::from_ref(&key)).is_empty());

        std::fs::write(&key, b"one-two").unwrap();
        let once = statuses_for(&open, std::slice::from_ref(&key));
        assert_eq!(
            once,
            vec![ChangeStatus {
                path: key.to_string_lossy().into_owned(),
                missing: false,
            }]
        );
        let twice = statuses_for(&open, std::slice::from_ref(&key));
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
