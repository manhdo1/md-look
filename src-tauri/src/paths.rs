//! Path helpers: absolute / normalized document keys, lexical cleanup, parent dirs.

use std::path::{Component, Path, PathBuf};

pub fn absolute_path(path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

/// Absolute path used as the document and watcher key.
///
/// Existing paths go through `dunce::canonicalize` (symlinks, `..`, and the
/// Windows `\\?\` prefix). Missing paths are cleaned lexically so close/reload
/// of a just-deleted file still matches the key that was stored at open.
pub fn normalize_path(path: impl AsRef<Path>) -> PathBuf {
    let absolute = absolute_path(path);
    match dunce::canonicalize(&absolute) {
        Ok(canon) => canon,
        Err(_) => lexical_normalize(&absolute),
    }
}

/// Clean `.` and `..` without touching the filesystem. Also strips a Windows
/// verbatim prefix so notify paths can be compared to opened paths.
pub(crate) fn lexical_normalize(path: &Path) -> PathBuf {
    let prepared = prepare_lexical(path);
    let mut prefix = String::new();
    let mut rooted = false;
    let mut parts: Vec<String> = Vec::new();

    for component in prepared.components() {
        match component {
            Component::Prefix(p) => {
                prefix = p.as_os_str().to_string_lossy().into_owned();
            }
            Component::RootDir => rooted = true,
            Component::CurDir => {}
            Component::ParentDir => {
                if !parts.is_empty() {
                    parts.pop();
                }
            }
            Component::Normal(part) => {
                if part == "." {
                    continue;
                }
                if part == ".." {
                    if !parts.is_empty() {
                        parts.pop();
                    }
                    continue;
                }
                parts.push(part.to_string_lossy().into_owned());
            }
        }
    }

    let sep = if cfg!(windows) { '\\' } else { '/' };
    let mut out = String::new();
    if !prefix.is_empty() {
        out.push_str(&prefix);
    }
    if rooted && !out.ends_with(sep) {
        out.push(sep);
    }
    if !parts.is_empty() {
        out.push_str(&parts.join(&sep.to_string()));
    }
    if out.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(out)
    }
}

fn prepare_lexical(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy().replace('/', "\\");
        PathBuf::from(strip_verbatim_prefix(&raw))
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

/// Drop a Windows verbatim prefix: `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\share` → `\\srv\share`.
pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    const VERBATIM: &str = "\\\\?\\";
    const VERBATIM_UNC: &str = "UNC\\";
    if let Some(rest) = path.strip_prefix(VERBATIM) {
        if let Some(unc) = rest.strip_prefix(VERBATIM_UNC) {
            return format!("\\\\{unc}");
        }
        return rest.to_string();
    }
    path.to_string()
}

/// Directory containing `path`, or `path` itself when it has no non-empty parent.
pub(crate) fn parent_dir(path: &Path) -> PathBuf {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(path)
        .to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_cleans_dotdot_without_the_file() {
        let name = format!("Hướng-{}.md", std::process::id());
        let rel = format!("md-look-absent-{}{}/../{name}", std::process::id(), "dir");
        let normalized = normalize_path(&rel);
        let shown = normalized.to_string_lossy().replace('\\', "/");
        assert!(!shown.contains(".."), "{shown}");
        assert!(shown.ends_with(&format!("/{name}")), "{shown}");
        assert!(normalized.is_absolute(), "{shown}");
    }

    #[test]
    fn normalize_existing_file_matches_dunce() {
        let dir = std::env::temp_dir().join(format!("md-look-norm-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let file = dir.join("Note.md");
        std::fs::write(&file, b"hi").unwrap();

        let via_dotdot = sub.join("..").join("Note.md");
        let normalized = normalize_path(&via_dotdot);
        let expected = dunce::canonicalize(&file).unwrap();
        assert_eq!(normalized, expected);

        std::fs::remove_file(&file).unwrap();
        let after_delete = normalize_path(&normalized);
        assert_eq!(
            after_delete, normalized,
            "a deleted file must keep the key that was stored while it existed"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn normalize_strips_verbatim_prefix() {
        let dir = std::env::temp_dir().join(format!("md-look-verb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Note.md");
        std::fs::write(&file, b"hi").unwrap();

        let canon = dunce::canonicalize(&file).unwrap();
        assert!(
            !canon.to_string_lossy().starts_with(r"\\?\"),
            "dunce left a verbatim prefix on {}",
            canon.display()
        );
        let verbatim = format!(r"\\?\{}", canon.display());
        assert_eq!(normalize_path(&verbatim), canon);

        let lexical = lexical_normalize(Path::new(r"\\?\D:\docs\sub\..\Hướng.md"));
        assert_eq!(lexical, PathBuf::from(r"D:\docs\Hướng.md"));
        let unc = lexical_normalize(Path::new(r"\\?\UNC\server\share\a\..\b.md"));
        assert_eq!(unc, PathBuf::from(r"\\server\share\b.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
