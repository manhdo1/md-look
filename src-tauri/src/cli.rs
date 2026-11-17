//! Command-line / second-instance argv handling.

use std::path::{Path, PathBuf};

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
}
