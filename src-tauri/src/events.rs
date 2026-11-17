//! Names shared with the UI: emitted events, the main window label, the app title.

/// Emitted with a [`crate::watch::DocChanged`] payload when a watched file settles.
pub const EVENT_DOC_CHANGED: &str = "doc-changed";

/// Emitted with `()` when paths are queued; the UI drains them with `take_pending_paths`.
pub const EVENT_OPEN_PATHS: &str = "open-paths";

pub const MAIN_WINDOW: &str = "main";

pub const APP_NAME: &str = "markdown-look";
