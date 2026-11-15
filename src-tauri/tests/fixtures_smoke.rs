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
