//! HTML post-processing: scrollable table wrappers and the ammonia allowlist.

pub(super) fn sanitize(html: &str) -> String {
    let mut builder = ammonia::Builder::default();
    // Allow asset.localhost hosts by keeping relative/passthrough and http scheme.
    builder.add_tags(&["input"]);
    for heading in ["h1", "h2", "h3", "h4", "h5", "h6"] {
        builder.add_tag_attributes(heading, &["id"]);
    }
    builder
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
