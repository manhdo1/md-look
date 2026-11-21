//! Document load helpers: decode, front matter, slugify, supported extensions.

use std::path::Path;

use serde::Serialize;

pub use crate::paths::{absolute_path, normalize_path};

/// Supported Markdown / text extensions (MarkText preload list).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "txt", "text",
];

/// Files larger than this require an explicit confirm before load.
pub const MAX_AUTO_LOAD_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct OutlineEntry {
    pub level: u8,
    pub title: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RenderedDocument {
    pub path: String,
    pub title: String,
    pub html: String,
    pub outline: Vec<OutlineEntry>,
    pub lossy_decode: bool,
    pub word_count: u32,
    /// Local media/image paths referenced by this document (not sent to the UI).
    #[serde(skip)]
    pub local_assets: Vec<String>,
}

/// Count whitespace-separated tokens that contain at least one alphanumeric char.
pub fn count_words(text: &str) -> u32 {
    text.split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
        .count() as u32
}

pub fn is_supported_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|s| s.eq_ignore_ascii_case(ext))
        })
}

pub fn decode_bytes(bytes: &[u8]) -> (String, bool) {
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (String::from_utf8_lossy(bytes).into_owned(), true),
    }
}

pub fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

/// Detect YAML front matter delimited by `---` lines; return (front_matter, body).
pub fn split_front_matter(source: &str) -> (Option<&str>, &str) {
    let trimmed = source.trim_start_matches(['\r', '\n']);
    if !trimmed.starts_with("---") {
        return (None, source);
    }
    let after = &trimmed[3..];
    let after = after.strip_prefix('\r').unwrap_or(after);
    let after = after.strip_prefix('\n').unwrap_or(after);

    let mut offset = 0;
    for line in after.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\r', '\n']);
        if bare == "---" || bare == "..." {
            let fm = &after[..offset];
            let body_start = offset + line.len();
            let body = &after[body_start..];
            return (Some(fm.trim_end_matches(['\r', '\n'])), body);
        }
        offset += line.len();
    }
    (None, source)
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Allocate a unique heading id from a title (dedupe with `-1`, `-2`, …).
pub fn unique_heading_id(title: &str, used: &mut std::collections::HashMap<String, usize>) -> String {
    let base = {
        let s = slugify(title);
        if s.is_empty() {
            "heading".to_string()
        } else {
            s
        }
    };
    let count = used.entry(base.clone()).or_insert(0);
    let id = if *count == 0 {
        base.clone()
    } else {
        format!("{base}-{count}")
    };
    *count += 1;
    id
}

pub fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_owned()
}

pub fn load_source(path: &Path) -> anyhow::Result<(String, bool)> {
    let bytes = std::fs::read(path)?;
    Ok(decode_bytes(&bytes))
}

pub fn check_size(path: &Path, force: bool) -> anyhow::Result<()> {
    let meta = std::fs::metadata(path)?;
    if !force && meta.len() > MAX_AUTO_LOAD_BYTES {
        anyhow::bail!(
            "file is {:.1} MB (over 50 MB); pass force=true to load anyway",
            meta.len() as f64 / (1024.0 * 1024.0)
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("Tiêu đề"), "tiêu-đề");
    }

    #[test]
    fn unique_ids_dedupe() {
        let mut used = std::collections::HashMap::new();
        assert_eq!(unique_heading_id("Hello", &mut used), "hello");
        assert_eq!(unique_heading_id("Hello", &mut used), "hello-1");
        assert_eq!(unique_heading_id("Hello", &mut used), "hello-2");
    }

    #[test]
    fn strip_bom_and_lossy() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"# Hi\n");
        let (text, lossy) = decode_bytes(&bytes);
        assert!(!lossy);
        assert!(text.starts_with('#'));

        let (text2, lossy2) = decode_bytes(&[0xFF, 0xFE, b'A']);
        assert!(lossy2);
        assert!(!text2.is_empty());
    }

    #[test]
    fn front_matter_split() {
        let src = "---\ntitle: hi\n---\n\n# Body\n";
        let (fm, body) = split_front_matter(src);
        assert_eq!(fm, Some("title: hi"));
        assert!(body.contains("# Body"));
    }

    #[test]
    fn supported_extensions() {
        assert!(is_supported_path(Path::new("a.md")));
        assert!(is_supported_path(Path::new("a.MDX")));
        assert!(is_supported_path(Path::new("a.txt")));
        assert!(!is_supported_path(Path::new("a.pdf")));
    }

    #[test]
    fn word_count_basic() {
        assert_eq!(count_words("Hello world"), 2);
        assert_eq!(count_words("  one   two\nthree  "), 3);
        assert_eq!(count_words("--- ***"), 0);
        assert_eq!(count_words("Tiêu đề tiếng Việt"), 4);
    }
}
