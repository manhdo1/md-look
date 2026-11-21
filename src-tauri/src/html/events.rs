//! Parser event pass: stable heading ids, outline, rewritten link/image targets.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use pulldown_cmark::{CowStr, Event, Tag, TagEnd};

use super::links::{rewrite_img, rewrite_link};
use super::media::{
    audio_html, classify_media, embed_html, video_html, MediaKind,
};
use crate::document::{unique_heading_id, OutlineEntry};

fn collect_plain_text(
    events: &[Event<'_>],
    start_idx: usize,
    mut is_end: impl FnMut(&Event<'_>) -> bool,
) -> String {
    let mut text = String::new();
    for ev in events.iter().skip(start_idx + 1) {
        if is_end(ev) {
            break;
        }
        match ev {
            Event::Text(t) | Event::Code(t) => text.push_str(t),
            Event::SoftBreak | Event::HardBreak => text.push(' '),
            _ => {}
        }
    }
    text
}

fn heading_text_between(events: &[Event<'_>], start_idx: usize) -> String {
    collect_plain_text(events, start_idx, |ev| {
        matches!(ev, Event::End(TagEnd::Heading(_)))
    })
}

fn image_alt_between(events: &[Event<'_>], start_idx: usize) -> String {
    collect_plain_text(events, start_idx, |ev| matches!(ev, Event::End(TagEnd::Image)))
}

fn owned_cow(s: String) -> CowStr<'static> {
    CowStr::Boxed(s.into_boxed_str())
}

fn push_resolved_asset(local_assets: &mut Vec<String>, path: Option<PathBuf>) {
    if let Some(path) = path {
        local_assets.push(path.to_string_lossy().into_owned());
    }
}

/// Advance `i` to the `End(Image)` event (inclusive of the start already at `i`).
fn consume_through_image_end(events: &[Event<'_>], i: &mut usize) {
    while *i < events.len() && !matches!(&events[*i], Event::End(TagEnd::Image)) {
        *i += 1;
    }
}

/// Rewrite parser events: heading ids, image/link paths; also build outline.
///
/// Returns rewritten events, outline entries, and resolved local asset paths.
pub(super) fn transform_events<'a>(
    events: &[Event<'a>],
    base_dir: &Path,
) -> (Vec<Event<'a>>, Vec<OutlineEntry>, Vec<String>) {
    let mut outline = Vec::new();
    let mut slug_counts: HashMap<String, usize> = HashMap::new();
    let mut local_assets = Vec::new();
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
                let title = heading_text_between(events, i);
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
                let title_str = title.as_ref();
                match classify_media(dest_url) {
                    MediaKind::Image => {
                        let (local, rewritten) = rewrite_img(base_dir, dest_url);
                        push_resolved_asset(&mut local_assets, local);
                        out.push(Event::Start(Tag::Image {
                            link_type: *link_type,
                            dest_url: owned_cow(rewritten.into_owned()),
                            title: title.clone(),
                            id: id.clone(),
                        }));
                    }
                    MediaKind::Video => {
                        let alt = image_alt_between(events, i);
                        let (local, src) = rewrite_img(base_dir, dest_url);
                        push_resolved_asset(&mut local_assets, local);
                        // Consume through End(Image); loop's trailing i += 1 advances past it.
                        consume_through_image_end(events, &mut i);
                        out.push(Event::Html(owned_cow(video_html(
                            &src, title_str, &alt,
                        ))));
                    }
                    MediaKind::Audio => {
                        let alt = image_alt_between(events, i);
                        let (local, src) = rewrite_img(base_dir, dest_url);
                        push_resolved_asset(&mut local_assets, local);
                        consume_through_image_end(events, &mut i);
                        out.push(Event::Html(owned_cow(audio_html(
                            &src, title_str, &alt,
                        ))));
                    }
                    MediaKind::Embed(url) => {
                        consume_through_image_end(events, &mut i);
                        out.push(Event::Html(owned_cow(embed_html(&url, title_str))));
                    }
                }
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

    (out, outline, local_assets)
}
