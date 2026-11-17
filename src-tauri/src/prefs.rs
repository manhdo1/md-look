//! Persisted UI preferences (theme, zoom, sidebar, recent files).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const MAX_RECENT: usize = 8;
pub const DEFAULT_SIDEBAR_WIDTH: f32 = 240.0;
const PREFS_FILE_NAME: &str = "prefs.json";

fn default_sidebar_width() -> f32 {
    DEFAULT_SIDEBAR_WIDTH
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub theme: String,
    pub zoom: f32,
    pub outline_open: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: f32,
    #[serde(default)]
    pub recent: Vec<String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            zoom: 1.0,
            outline_open: true,
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            recent: Vec::new(),
        }
    }
}

/// Push `path` to the front of recent, dedupe, and cap at [`MAX_RECENT`].
pub fn push_recent(recent: &mut Vec<String>, path: String) {
    recent.retain(|p| p != &path);
    recent.insert(0, path);
    recent.truncate(MAX_RECENT);
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join(PREFS_FILE_NAME))
}

pub fn load(app: &AppHandle) -> Prefs {
    let Ok(path) = prefs_path(app) else {
        return Prefs::default();
    };
    let Ok(bytes) = fs::read(&path) else {
        return Prefs::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn save(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_dedupe_and_cap() {
        let mut recent = Vec::new();
        for i in 1..=10 {
            push_recent(&mut recent, format!("/docs/file{i}.md"));
        }
        assert_eq!(recent.len(), MAX_RECENT);
        assert_eq!(recent[0], "/docs/file10.md");
        assert_eq!(recent[7], "/docs/file3.md");

        push_recent(&mut recent, "/docs/file5.md".into());
        assert_eq!(recent.len(), MAX_RECENT);
        assert_eq!(recent[0], "/docs/file5.md");
        assert_eq!(recent.iter().filter(|p| *p == "/docs/file5.md").count(), 1);
    }

    #[test]
    fn prefs_default_sidebar_width() {
        let p = Prefs::default();
        assert!((p.sidebar_width - DEFAULT_SIDEBAR_WIDTH).abs() < f32::EPSILON);
        assert!(p.recent.is_empty());
    }

    #[test]
    fn prefs_deserialize_legacy_without_new_fields() {
        let json = r#"{"theme":"dark","zoom":1.2,"outlineOpen":false}"#;
        let p: Prefs = serde_json::from_str(json).unwrap();
        assert_eq!(p.theme, "dark");
        assert!((p.zoom - 1.2).abs() < f32::EPSILON);
        assert!(!p.outline_open);
        assert!((p.sidebar_width - DEFAULT_SIDEBAR_WIDTH).abs() < f32::EPSILON);
        assert!(p.recent.is_empty());
    }
}
