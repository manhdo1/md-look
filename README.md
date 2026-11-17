# markdown-look

A lightweight **read-only** Markdown previewer for Windows. Rust parses Markdown once (`pulldown-cmark` → sanitized HTML + outline); a Tauri 2 WebView2 window renders it in a calm reading column set in Be Vietnam Pro, with code in JetBrains Mono.

## Requirements

- Rust (stable)
- [Tauri CLI 2](https://v2.tauri.app/) (`cargo install tauri-cli --version "^2"`)
- WebView2 (preinstalled on modern Windows)

## Run

```bash
# from this directory
cargo tauri dev

# open a file from the CLI
cargo tauri dev -- -- tests/fixtures/huong-dan.md
```

Double-clicking a Markdown file reuses the running window (Notepad-style) via single-instance. After `cargo tauri build` + install, file associations come from the installer. If Explorer’s “Open with” still points at an older exe, pick the new build once.

## Build

```bash
cargo tauri build
```

The release installer/binary lands under `target/release/` (and `bundle/` when packaging).

Architecture, decisions, and icon notes: see [NOTES.md](./NOTES.md).

## Features

- GFM tables, task lists, strikethrough, footnotes, fenced code (local highlight.js, language label, copy button)
- Mermaid diagrams (` ```mermaid ` fences; local `mermaid.min.js`, themed to match light/dark):
  pan by dragging, Ctrl+scroll or toolbar to zoom, double-click to fit, Diagram/Source toggle,
  full-window view, and `click` links inside diagrams (external URLs, relative `.md`, `#anchors`)
- Outline drawn as a line with stations, filled up to the section you are reading; stable heading ids
- Reading progress line on the status bar with current section and position
- Find with match count (CSS Custom Highlight API)
- Multiple files in one window (tabs appear when two or more are open); single-instance so Explorer opens reuse the window
- External links open in the system browser; relative `.md` links open in a new tab
- File watch reload (~150 ms debounce) with scroll-position restore
- Light/dark theme and zoom, persisted in the app config dir
- Images from each open file’s directory via Tauri asset protocol (scoped per opened folder)

## Layout

```
markdown-look/
  ui/                 # vanilla HTML/CSS/JS (no bundler, no markdown-it)
  src-tauri/          # Tauri 2 + Rust Markdown pipeline
  tests/fixtures/     # sample.md, huong-dan.md
```

The previous egui build is preserved at `../markdown-look-egui-final/`.

## License

MIT. Be Vietnam Pro and JetBrains Mono font files are under the SIL Open Font License (see `ui/fonts/OFL.txt`).
