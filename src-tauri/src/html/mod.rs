//! Markdown → sanitized HTML + outline (single Rust pipeline).

mod events;
mod links;
mod media;
mod sanitize;

use std::path::{Path, PathBuf};

use pulldown_cmark::html::push_html;
use pulldown_cmark::{Event, Options, Parser};

use crate::document::{
    self, count_words, split_front_matter, strip_bom, title_from_path, RenderedDocument,
};
use events::transform_events;
pub use links::path_to_asset_url;
use sanitize::{sanitize, wrap_tables};

fn markdown_options() -> Options {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options
}

/// Append `s` with HTML special characters escaped into `out` (no intermediate `String`).
pub(super) fn push_escaped_html(out: &mut String, s: &str) {
    out.reserve(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
}

/// Render Markdown source to sanitized HTML + outline with stable heading ids.
pub fn render_markdown(source: &str, path: &Path) -> RenderedDocument {
    let source = strip_bom(source);
    let (front_matter, body) = split_front_matter(source);
    let base_dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let events: Vec<Event<'_>> = Parser::new_ext(body, markdown_options()).collect();
    let (events, outline, mut local_assets) = transform_events(&events, &base_dir);

    let mut html = String::new();
    if let Some(fm) = front_matter {
        html.push_str("<pre><code class=\"language-yaml\">");
        push_escaped_html(&mut html, fm);
        html.push_str("</code></pre>\n");
    }
    push_html(&mut html, events.into_iter());

    let (html, sanitize_assets) = sanitize(&wrap_tables(&html), &base_dir);
    local_assets.extend(sanitize_assets);
    local_assets.sort_unstable();
    local_assets.dedup();

    let title = title_from_path(path);
    let word_count = count_words(body);

    RenderedDocument {
        path: path.to_string_lossy().into_owned(),
        title,
        html,
        outline,
        lossy_decode: false,
        word_count,
        local_assets,
    }
}

pub fn render_file(path: &Path, force: bool) -> anyhow::Result<RenderedDocument> {
    document::check_size(path, force)?;
    let (source, lossy) = document::load_source(path)?;
    let mut doc = render_markdown(&source, path);
    doc.lossy_decode = lossy;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn render(src: &str) -> RenderedDocument {
        render_markdown(src, &PathBuf::from(r"D:\docs\test.md"))
    }

    #[test]
    fn heading_ids_and_outline_parity() {
        let doc = render("# Hello\n\n## World\n\n## Hello\n");
        assert_eq!(doc.outline.len(), 3);
        assert_eq!(doc.outline[0].id, "hello");
        assert_eq!(doc.outline[1].id, "world");
        assert_eq!(doc.outline[2].id, "hello-1");
        for entry in &doc.outline {
            assert!(
                doc.html.contains(&format!("id=\"{}\"", entry.id)),
                "outline id {} missing in html: {}",
                entry.id,
                doc.html
            );
        }
    }

    #[test]
    fn sanitize_strips_script() {
        let doc = render("Hello <script>alert(1)</script> world\n");
        assert!(!doc.html.to_lowercase().contains("<script"));
        assert!(!doc.html.to_lowercase().contains("alert(1)"));
    }

    #[test]
    fn image_rewrite_to_asset_url() {
        let doc = render("![alt](./pic.png)\n");
        assert!(
            doc.html.contains("http://asset.localhost/"),
            "expected asset URL, html={}",
            doc.html
        );
        assert!(doc.html.contains("pic"), "html={}", doc.html);
        assert!(
            doc.local_assets.iter().any(|p| p.replace('\\', "/").ends_with("pic.png")),
            "local_assets={:?}",
            doc.local_assets
        );
    }

    #[test]
    fn markdown_video_and_audio_become_media_tags() {
        let video = render("![clip](./demo.mp4)\n");
        assert!(
            video.html.contains("<video"),
            "expected video tag, html={}",
            video.html
        );
        assert!(
            video.html.contains("http://asset.localhost/"),
            "expected asset URL, html={}",
            video.html
        );
        assert!(video.html.contains("controls"));
        assert!(
            video.html.contains("preload=\"none\""),
            "expected preload=none, html={}",
            video.html
        );

        let audio = render("![track](./song.mp3)\n");
        assert!(
            audio.html.contains("<audio"),
            "expected audio tag, html={}",
            audio.html
        );
        assert!(audio.html.contains("http://asset.localhost/"));
        assert!(audio.html.contains("preload=\"none\""));
    }

    #[test]
    fn youtube_link_becomes_lazy_embed_facade() {
        let doc = render("![yt](https://youtu.be/dQw4w9WgXcQ)\n");
        assert!(
            doc.html.contains("youtube-nocookie.com/embed/dQw4w9WgXcQ"),
            "html={}",
            doc.html
        );
        assert!(
            doc.html.contains("media-embed--lazy"),
            "expected lazy facade, html={}",
            doc.html
        );
        assert!(
            doc.html.contains("data-embed-src="),
            "expected data-embed-src, html={}",
            doc.html
        );
        assert!(
            !doc.html.contains("<iframe"),
            "iframe should load only after click, html={}",
            doc.html
        );
    }

    #[test]
    fn raw_html_img_rewritten_and_keeps_width() {
        let doc = render("<img src=\"./x.png\" width=\"200\" alt=\"x\">\n");
        assert!(
            doc.html.contains("http://asset.localhost/"),
            "expected rewrite, html={}",
            doc.html
        );
        assert!(
            doc.html.contains("width=\"200\"") || doc.html.contains("width='200'"),
            "html={}",
            doc.html
        );
        assert!(
            doc.local_assets.iter().any(|p| p.replace('\\', "/").ends_with("x.png")),
            "local_assets={:?}",
            doc.local_assets
        );
    }

    #[test]
    fn iframe_evil_src_and_autoplay_stripped() {
        let evil = render("<iframe src=\"https://evil.com/x\"></iframe>\n");
        assert!(
            !evil.html.contains("evil.com"),
            "evil src should be removed, html={}",
            evil.html
        );

        let auto = render("<video src=\"https://example.com/a.mp4\" autoplay controls></video>\n");
        assert!(
            !auto.html.to_lowercase().contains("autoplay"),
            "autoplay should be stripped, html={}",
            auto.html
        );
        assert!(auto.html.contains("<video"));
    }

    #[test]
    fn media_extension_case_insensitive_and_query_ignored() {
        let video = render("![clip](./Demo.MP4?download=1)\n");
        assert!(
            video.html.contains("<video"),
            "expected video for .MP4?query, html={}",
            video.html
        );
        assert!(
            video.html.contains("http://asset.localhost/"),
            "expected asset URL, html={}",
            video.html
        );

        let audio = render("![track](./Song.MP3#t=10)\n");
        assert!(
            audio.html.contains("<audio"),
            "expected audio for .MP3#frag, html={}",
            audio.html
        );
    }

    #[test]
    fn gfm_table_and_tasklist() {
        let src = "| A | B |\n| --- | ---: |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n";
        let doc = render(src);
        assert!(doc.html.contains("<table>"), "html={}", doc.html);
        assert!(
            doc.html.contains("table-wrap"),
            "expected table-wrap, html={}",
            doc.html
        );
        assert!(doc.html.contains("checkbox") || doc.html.contains("type=\"checkbox\""));
    }

    #[test]
    fn table_wrap_preserves_table() {
        let doc = render("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
        assert!(
            doc.html.contains("<div class=\"table-wrap\"><table>")
                || doc.html.contains("<div class=\"table-wrap\">\n<table>")
                || (doc.html.contains("class=\"table-wrap\"") && doc.html.contains("<table>")),
            "html={}",
            doc.html
        );
        assert!(doc.word_count >= 2);
    }

    #[test]
    fn word_count_from_body() {
        let doc = render("# Title\n\nHello brave world.\n");
        assert!(doc.word_count >= 3, "word_count={}", doc.word_count);
    }

    #[test]
    fn code_fence_language_class() {
        let doc = render("```rust\nfn main() {}\n```\n");
        assert!(
            doc.html.contains("language-rust") || doc.html.contains("rust"),
            "html={}",
            doc.html
        );
        assert!(doc.html.contains("fn main"));
    }

    #[test]
    fn relative_md_link_kept_as_path() {
        let doc = render("[next](./other.md)\n");
        assert!(doc.html.contains("other.md"), "html={}", doc.html);
    }

    #[test]
    fn fixture_huong_dan_renders() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("huong-dan.md");
        let doc = render_file(&path, true).expect("load huong-dan.md");
        assert!(doc.html.contains("<h1"), "missing h1: {}", &doc.html[..doc.html.len().min(200)]);
        assert!(doc.html.contains("<table>") || doc.html.contains("<pre>"));
        assert!(!doc.outline.is_empty(), "expected outline entries");
        for entry in &doc.outline {
            assert!(
                doc.html.contains(&format!("id=\"{}\"", entry.id)),
                "missing id {}",
                entry.id
            );
        }
    }

    #[test]
    fn fixture_sample_renders() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("sample.md");
        let doc = render_file(&path, true).expect("load sample.md");
        assert!(!doc.html.is_empty());
    }
}
