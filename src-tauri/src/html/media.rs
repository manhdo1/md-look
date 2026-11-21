//! Classify Markdown image destinations and build escaped media HTML.

/// Destination kind for a Markdown `![]()` target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum MediaKind {
    Video,
    Audio,
    /// Canonical embed URL (YouTube nocookie / Vimeo player).
    Embed(String),
    Image,
}

const VIDEO_EXTS: &[&str] = &["mp4", "webm", "mov"];
const AUDIO_EXTS: &[&str] = &["mp3", "ogg", "wav", "m4a", "flac"];

/// Path/URL extension without query or fragment (case preserved).
fn path_extension(dest: &str) -> Option<&str> {
    let path_part = dest.split(['?', '#']).next().unwrap_or(dest);
    let name = path_part
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path_part);
    let (_, ext) = name.rsplit_once('.')?;
    if ext.is_empty() {
        None
    } else {
        Some(ext)
    }
}

fn is_valid_embed_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn strip_scheme_host(url: &str) -> Option<(&str, &str)> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let (host, path_query) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let host = host.split(':').next().unwrap_or(host);
    Some((host, path_query))
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        if k == key {
            let v = parts.next().unwrap_or("");
            return Some(v.split('#').next().unwrap_or(v));
        }
    }
    None
}

fn path_starts_with_ignore_ascii_case(path: &str, prefix: &str) -> bool {
    path.len() >= prefix.len()
        && path.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

fn youtube_embed_url(dest: &str) -> Option<String> {
    let (host, path_query) = strip_scheme_host(dest)?;
    let host = host.to_ascii_lowercase();
    let id = if host == "youtu.be" || host == "www.youtu.be" {
        let path = path_query.trim_start_matches('/');
        let id = path.split(['/', '?', '#']).next().unwrap_or("");
        id
    } else if host == "youtube.com"
        || host == "www.youtube.com"
        || host == "m.youtube.com"
        || host == "youtube-nocookie.com"
        || host == "www.youtube-nocookie.com"
    {
        let (path, query) = match path_query.find('?') {
            Some(i) => (&path_query[..i], &path_query[i + 1..]),
            None => (path_query, ""),
        };
        let path = path.trim_end_matches('/');
        if path == "/watch" {
            query_param(query, "v").unwrap_or("")
        } else if let Some(rest) = path.strip_prefix("/shorts/") {
            rest.split(['/', '?', '#']).next().unwrap_or("")
        } else if let Some(rest) = path.strip_prefix("/embed/") {
            rest.split(['/', '?', '#']).next().unwrap_or("")
        } else {
            ""
        }
    } else {
        return None;
    };

    if !is_valid_embed_id(id) {
        return None;
    }
    Some(format!("https://www.youtube-nocookie.com/embed/{id}"))
}

fn vimeo_embed_url(dest: &str) -> Option<String> {
    let (host, path_query) = strip_scheme_host(dest)?;
    let host = host.to_ascii_lowercase();
    let path = path_query
        .split('?')
        .next()
        .unwrap_or(path_query)
        .trim_end_matches('/');

    let id = if host == "player.vimeo.com" {
        path.strip_prefix("/video/")?
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
    } else if host == "vimeo.com" || host == "www.vimeo.com" {
        let rest = path.trim_start_matches('/');
        // Skip channel/manage-style paths; accept bare numeric ids.
        if rest.contains('/') {
            return None;
        }
        rest.split(['?', '#']).next().unwrap_or("")
    } else {
        return None;
    };

    if !is_valid_embed_id(id) {
        return None;
    }
    Some(format!("https://player.vimeo.com/video/{id}"))
}

/// Classify a destination URL or path as video, audio, embed, or image.
pub(super) fn classify_media(dest: &str) -> MediaKind {
    if let Some(url) = youtube_embed_url(dest).or_else(|| vimeo_embed_url(dest)) {
        return MediaKind::Embed(url);
    }
    if let Some(ext) = path_extension(dest) {
        let lower = ext.to_ascii_lowercase();
        if VIDEO_EXTS.iter().any(|e| *e == lower) {
            return MediaKind::Video;
        }
        if AUDIO_EXTS.iter().any(|e| *e == lower) {
            return MediaKind::Audio;
        }
    }
    MediaKind::Image
}

/// Whether an iframe `src` may be kept after sanitize (YouTube embed / Vimeo player).
pub(super) fn is_allowed_iframe_src(src: &str) -> bool {
    let Some((host, path_query)) = strip_scheme_host(src) else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    let path = path_query.split('?').next().unwrap_or(path_query);

    if host == "www.youtube-nocookie.com" || host == "youtube-nocookie.com" {
        return path_starts_with_ignore_ascii_case(path, "/embed/");
    }
    if host == "www.youtube.com" || host == "youtube.com" {
        return path_starts_with_ignore_ascii_case(path, "/embed/");
    }
    if host == "player.vimeo.com" {
        return path_starts_with_ignore_ascii_case(path, "/video/");
    }
    false
}

fn media_element_html(tag: &str, src: &str, title: &str, alt: &str) -> String {
    let mut out = String::with_capacity(64 + src.len() + title.len() + alt.len());
    out.push('<');
    out.push_str(tag);
    out.push_str(" controls preload=\"none\" src=\"");
    super::push_escaped_html(&mut out, src);
    out.push('"');
    if !title.is_empty() {
        out.push_str(" title=\"");
        super::push_escaped_html(&mut out, title);
        out.push('"');
    }
    out.push('>');
    super::push_escaped_html(&mut out, alt);
    out.push_str("</");
    out.push_str(tag);
    out.push('>');
    out
}

pub(super) fn video_html(src: &str, title: &str, alt: &str) -> String {
    media_element_html("video", src, title, alt)
}

pub(super) fn audio_html(src: &str, title: &str, alt: &str) -> String {
    media_element_html("audio", src, title, alt)
}

/// Click-to-load facade — iframe is injected by the UI only after the user clicks.
pub(super) fn embed_html(src: &str, title: &str) -> String {
    let mut out = String::with_capacity(160 + src.len() + title.len());
    out.push_str("<div class=\"media-embed media-embed--lazy\" data-embed-src=\"");
    super::push_escaped_html(&mut out, src);
    out.push('"');
    if !title.is_empty() {
        out.push_str(" data-embed-title=\"");
        super::push_escaped_html(&mut out, title);
        out.push('"');
        out.push_str(" title=\"");
        super::push_escaped_html(&mut out, title);
        out.push('"');
    }
    out.push_str(
        "><button type=\"button\" class=\"media-embed__load\">Load video</button></div>",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_extensions_case_and_query() {
        assert_eq!(classify_media("clip.MP4?x=1"), MediaKind::Video);
        assert_eq!(classify_media("song.m4a#t=1"), MediaKind::Audio);
        assert_eq!(classify_media("pic.PNG"), MediaKind::Image);
    }

    #[test]
    fn youtube_and_vimeo_embeds() {
        match classify_media("https://youtu.be/dQw4w9WgXcQ") {
            MediaKind::Embed(u) => {
                assert_eq!(u, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
            }
            other => panic!("expected embed, got {other:?}"),
        }
        match classify_media("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1") {
            MediaKind::Embed(u) => assert!(u.ends_with("/embed/dQw4w9WgXcQ")),
            other => panic!("expected embed, got {other:?}"),
        }
        match classify_media("https://vimeo.com/123456789") {
            MediaKind::Embed(u) => assert_eq!(u, "https://player.vimeo.com/video/123456789"),
            other => panic!("expected embed, got {other:?}"),
        }
    }

    #[test]
    fn iframe_host_whitelist() {
        assert!(is_allowed_iframe_src(
            "https://www.youtube-nocookie.com/embed/abc"
        ));
        assert!(is_allowed_iframe_src("https://www.youtube.com/embed/abc"));
        assert!(is_allowed_iframe_src("https://www.youtube.com/EMBED/abc"));
        assert!(is_allowed_iframe_src("https://player.vimeo.com/video/1"));
        assert!(!is_allowed_iframe_src("https://evil.com/embed/x"));
        assert!(!is_allowed_iframe_src("https://www.youtube.com/watch?v=x"));
    }
}
