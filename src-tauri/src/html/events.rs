//! Parser event pass: stable heading ids, outline, rewritten link/image targets.

use std::collections::HashMap;
use std::path::Path;

use pulldown_cmark::{CowStr, Event, Tag, TagEnd};

use super::links::{rewrite_img, rewrite_link};
use crate::document::{unique_heading_id, OutlineEntry};

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
pub(super) fn transform_events<'a>(
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
