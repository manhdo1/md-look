//! Link and image destination rewriting (relative Markdown links, asset URLs).

use std::path::{Path, PathBuf};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

use crate::paths::strip_verbatim_prefix;

/// Convert a filesystem path to a Tauri asset protocol URL (Windows WebView2 form).
pub fn path_to_asset_url(path: &Path) -> String {
    let simplified = strip_verbatim_prefix(&path.to_string_lossy());
    let encoded = utf8_percent_encode(&simplified, NON_ALPHANUMERIC);
    format!("http://asset.localhost/{encoded}")
}

fn resolve_relative(base_dir: &Path, href: &str) -> PathBuf {
    let p = Path::new(href);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(p)
    }
}

fn is_external_or_special(dest: &str) -> bool {
    dest.starts_with('#')
        || dest.starts_with("http://")
        || dest.starts_with("https://")
        || dest.starts_with("mailto:")
        || dest.starts_with("data:")
        || dest.starts_with("asset:")
        || dest.starts_with("http://asset.localhost")
}

fn looks_like_markdown_link(dest: &str) -> bool {
    let lower = dest.to_ascii_lowercase();
    let path_part = lower.split(['#', '?']).next().unwrap_or(&lower);
    path_part.ends_with(".md")
        || path_part.ends_with(".markdown")
        || path_part.ends_with(".mdx")
        || path_part.ends_with(".txt")
}

pub(super) fn rewrite_link(base_dir: &Path, dest: &str) -> String {
    if dest.is_empty() || is_external_or_special(dest) {
        return dest.to_string();
    }
    // Keep markdown links relative so ammonia preserves href; UI resolves against
    // the open file directory. Other local targets become asset URLs (images etc.).
    if looks_like_markdown_link(dest) {
        return dest.replace('\\', "/");
    }
    path_to_asset_url(&resolve_relative(base_dir, dest))
}

pub(super) fn rewrite_img(base_dir: &Path, dest: &str) -> String {
    if dest.is_empty() || is_external_or_special(dest) {
        return dest.to_string();
    }
    path_to_asset_url(&resolve_relative(base_dir, dest))
}
