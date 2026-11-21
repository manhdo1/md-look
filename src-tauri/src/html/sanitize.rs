//! HTML post-processing: scrollable table wrappers and the ammonia allowlist.

use std::borrow::Cow;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::links::rewrite_img;
use super::media::is_allowed_iframe_src;

/// Sanitize HTML and rewrite relative media `src`/`poster` against `base_dir`.
///
/// Also returns local filesystem paths discovered while rewriting raw HTML media.
pub(super) fn sanitize(html: &str, base_dir: &Path) -> (String, Vec<String>) {
    let base_dir = base_dir.to_path_buf();
    let collected = Arc::new(Mutex::new(Vec::<String>::new()));
    let collected_cb = Arc::clone(&collected);

    let mut builder = ammonia::Builder::default();
    builder.add_tags(&["input", "video", "audio", "source", "iframe", "button"]);
    for heading in ["h1", "h2", "h3", "h4", "h5", "h6"] {
        builder.add_tag_attributes(heading, &["id"]);
    }
    builder
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("pre", &["class"])
        .add_tag_attributes(
            "div",
            &["class", "data-embed-src", "data-embed-title", "title"],
        )
        .add_tag_attributes("a", &["href", "title"])
        .add_tag_attributes("img", &["src", "alt", "title", "width", "height", "loading"])
        .add_tag_attributes(
            "video",
            &[
                "src",
                "poster",
                "controls",
                "loop",
                "muted",
                "playsinline",
                "preload",
                "width",
                "height",
            ],
        )
        .add_tag_attributes("audio", &["src", "controls", "loop", "muted", "preload"])
        .add_tag_attributes("source", &["src", "type"])
        .add_tag_attributes(
            "iframe",
            &[
                "src",
                "title",
                "allowfullscreen",
                "loading",
                "width",
                "height",
                "sandbox",
                "referrerpolicy",
            ],
        )
        .add_tag_attributes("button", &["type", "class", "aria-label"])
        .add_tag_attributes("input", &["type", "disabled", "checked"])
        .add_tag_attributes("th", &["align", "style"])
        .add_tag_attributes("td", &["align", "style"])
        .set_tag_attribute_value(
            "iframe",
            "sandbox",
            "allow-scripts allow-same-origin allow-presentation allow-popups",
        )
        .set_tag_attribute_value("iframe", "referrerpolicy", "strict-origin-when-cross-origin")
        .url_relative(ammonia::UrlRelative::PassThrough)
        .link_rel(None)
        .url_schemes(
            ["http", "https", "mailto", "data", "asset"]
                .into_iter()
                .collect(),
        )
        .attribute_filter(move |element, attribute, value| {
            filter_attribute(element, attribute, value, &base_dir, &collected_cb)
        });

    let cleaned = builder.clean(html).to_string();
    drop(builder); // release attribute_filter's Arc clone
    let assets = Arc::try_unwrap(collected)
        .expect("attribute filter still holds collector")
        .into_inner()
        .expect("asset collector mutex poisoned");
    (cleaned, assets)
}

fn filter_attribute<'u>(
    element: &str,
    attribute: &str,
    value: &'u str,
    base_dir: &Path,
    collected: &Arc<Mutex<Vec<String>>>,
) -> Option<Cow<'u, str>> {
    match (element, attribute) {
        ("img" | "video" | "audio" | "source", "src") | ("video", "poster") => {
            let (local, rewritten) = rewrite_img(base_dir, value);
            if let Some(path) = local {
                collected
                    .lock()
                    .expect("asset collector mutex poisoned")
                    .push(path.to_string_lossy().into_owned());
            }
            Some(rewritten)
        }
        ("iframe", "src") => {
            if is_allowed_iframe_src(value) {
                Some(Cow::Borrowed(value))
            } else {
                None
            }
        }
        _ => Some(Cow::Borrowed(value)),
    }
}

/// Wrap each `<table>…</table>` in a scrollable container before sanitize.
pub(super) fn wrap_tables(html: &str) -> String {
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
