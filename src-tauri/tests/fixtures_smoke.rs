//! Fixture smoke: sample + huong-dan parse to HTML with outline parity.

use std::path::PathBuf;

use markdown_look_lib::html;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures")
        .join(name)
}

#[test]
fn sample_renders() {
    let path = fixture("sample.md");
    let doc = html::render_file(&path, false).expect("render sample");
    assert!(doc.html.contains("Xin chào") || doc.html.to_lowercase().contains("xin"));
    assert!(!doc.html.to_lowercase().contains("<script"));
}

#[test]
fn huong_dan_outline_ids_in_html() {
    let path = fixture("huong-dan.md");
    let doc = html::render_file(&path, false).expect("render huong-dan");
    assert!(!doc.outline.is_empty(), "expected headings in huong-dan");
    for entry in &doc.outline {
        assert!(
            doc.html.contains(&format!("id=\"{}\"", entry.id)),
            "missing id {} in html",
            entry.id
        );
    }
    assert!(doc.html.len() > 500);
}

#[test]
fn media_sample_renders_media_tags() {
    let path = fixture("media-sample.md");
    let doc = html::render_file(&path, false).expect("render media-sample");
    assert!(doc.html.contains("<video"), "expected video, html={}", doc.html);
    assert!(doc.html.contains("<audio"), "expected audio, html={}", doc.html);
    assert!(
        doc.html.contains("youtube-nocookie.com/embed/")
            && doc.html.contains("media-embed--lazy")
            && doc.html.contains("data-embed-src="),
        "expected lazy YouTube facade, html={}",
        doc.html
    );
    assert!(
        !doc.html.contains("<iframe"),
        "iframe should not be in HTML until click, html={}",
        doc.html
    );
    assert!(
        doc.html.contains("width=\"200\"") || doc.html.contains("width='200'"),
        "expected HTML img width kept, html={}",
        doc.html
    );
    assert!(!doc.html.to_lowercase().contains("autoplay"));
}
