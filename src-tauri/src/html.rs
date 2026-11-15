//! Markdown → sanitized HTML + outline (single Rust pipeline).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use pulldown_cmark::html::push_html;
use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, TagEnd};

use crate::document::{
    self, count_words, split_front_matter, strip_bom, title_from_path, unique_heading_id,
    OutlineEntry, RenderedDocument,
};

fn markdown_options() -> Options {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options
}

/// Convert a filesystem path to a Tauri asset protocol URL (Windows WebView2 form).
pub fn path_to_asset_url(path: &Path) -> String {
    let simplified = dunce_simplified(path);
    let encoded = utf8_percent_encode(&simplified, NON_ALPHANUMERIC);
    format!("http://asset.localhost/{encoded}")
}

fn dunce_simplified(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if let Some(unc) = rest.strip_prefix("UNC\\") {
            return format!(r"\\{unc}");
        }
        return rest.to_string();
    }
    s.into_owned()
}

fn resolve_relative(base_dir: &Path, href: &str) -> PathBuf {
    let p = Path::new(href);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(p)
    }
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
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
    out
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

fn rewrite_link(base_dir: &Path, dest: &str) -> String {
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

fn rewrite_img(base_dir: &Path, dest: &str) -> String {
    if dest.is_empty() || is_external_or_special(dest) {
        return dest.to_string();
    }
    path_to_asset_url(&resolve_relative(base_dir, dest))
}

fn heading_text_between(events: &[Event<'_>], start_idx: usize) -> String {
    let mut text = String::new();
    for ev in events.iter().skip(start_idx + 1) {
        match ev {
            Event::End(TagEnd::Heading(_)) => break,
            Event::Text(t) | Event::Code(t) => text.push_str(t),
            Event::SoftBreak | Event::HardBreak => text.push(' '),
            _ => {}
        }
    }
    text
}

fn owned_cow(s: String) -> CowStr<'static> {
    CowStr::Boxed(s.into_boxed_str())
}

/// Rewrite parser events: heading ids, image/link paths; also build outline.
fn transform_events<'a>(
    events: Vec<Event<'a>>,
    base_dir: &Path,
) -> (Vec<Event<'a>>, Vec<OutlineEntry>) {
    let mut outline = Vec::new();
    let mut slug_counts: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::with_capacity(events.len());

    let mut i = 0;
    while i < events.len() {
        match &events[i] {
            Event::Start(Tag::Heading {
                level,
                id: _existing,
                classes,
                attrs,
            }) => {
                let title = heading_text_between(&events, i);
                let id = unique_heading_id(&title, &mut slug_counts);
                outline.push(OutlineEntry {
                    level: *level as u8,
                    title,
                    id: id.clone(),
                });
                out.push(Event::Start(Tag::Heading {
                    level: *level,
                    id: Some(owned_cow(id)),
                    classes: classes.clone(),
                    attrs: attrs.clone(),
                }));
            }
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let rewritten = rewrite_img(base_dir, dest_url);
                out.push(Event::Start(Tag::Image {
                    link_type: *link_type,
                    dest_url: owned_cow(rewritten),
                    title: title.clone(),
                    id: id.clone(),
                }));
            }
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let rewritten = rewrite_link(base_dir, dest_url);
                out.push(Event::Start(Tag::Link {
                    link_type: *link_type,
                    dest_url: owned_cow(rewritten),
                    title: title.clone(),
                    id: id.clone(),
                }));
            }
            other => out.push(other.clone()),
        }
        i += 1;
    }

    (out, outline)
}

fn sanitize(html: &str) -> String {
    let mut builder = ammonia::Builder::default();
    // Allow asset.localhost hosts by keeping relative/passthrough and http scheme.
    builder
        .add_tags(&["input"])
        .add_tag_attributes("h1", &["id"])
        .add_tag_attributes("h2", &["id"])
        .add_tag_attributes("h3", &["id"])
        .add_tag_attributes("h4", &["id"])
        .add_tag_attributes("h5", &["id"])
        .add_tag_attributes("h6", &["id"])
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("pre", &["class"])
        .add_tag_attributes("div", &["class"])
        .add_tag_attributes("a", &["href", "title"])
        .add_tag_attributes("img", &["src", "alt", "title"])
        .add_tag_attributes("input", &["type", "disabled", "checked"])
        .add_tag_attributes("th", &["align", "style"])
        .add_tag_attributes("td", &["align", "style"])
        .url_relative(ammonia::UrlRelative::PassThrough)
        .link_rel(None)
        .url_schemes(
            ["http", "https", "mailto", "data", "asset"]
                .into_iter()
                .collect(),
        );

    builder.clean(html).to_string()
}

/// Wrap each `<table>…</table>` in a scrollable container before sanitize.
fn wrap_tables(html: &str) -> String {
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(start) = rest.find("<table") {
        out.push_str(&rest[..start]);
        let after_start = &rest[start..];
        if let Some(end_rel) = after_start.find("</table>") {
            let end = end_rel + "</table>".len();
            out.push_str("<div class=\"table-wrap\">");
            out.push_str(&after_start[..end]);
            out.push_str("</div>");
            rest = &after_start[end..];
        } else {
            out.push_str(after_start);
            return out;
        }
    }
    out.push_str(rest);
    out
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
    let (events, outline) = transform_events(events, &base_dir);

    let mut html = String::new();
    if let Some(fm) = front_matter {
        html.push_str("<pre><code class=\"language-yaml\">");
        html.push_str(&escape_html(fm));
        html.push_str("</code></pre>\n");
    }
    push_html(&mut html, events.into_iter());

    let html = sanitize(&wrap_tables(&html));
    let title = title_from_path(path);
    let word_count = count_words(body);

    RenderedDocument {
        path: path.to_string_lossy().into_owned(),
        title,
        html,
        outline,
        lossy_decode: false,
        word_count,
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
