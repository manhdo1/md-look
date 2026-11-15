# markdown-look

A lightweight **read-only** Markdown previewer for Windows. Rust parses Markdown once (`pulldown-cmark` → sanitized HTML + outline); a Tauri 2 WebView2 window renders it with MarkText-inspired CSS and Open Sans.

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

## Build

```bash
cargo tauri build
```

The release installer/binary lands under `target/release/` (and `bundle/` when packaging).

Architecture, decisions, and icon notes: see [NOTES.md](./NOTES.md).

## Features

- GFM tables, task lists, strikethrough, footnotes, fenced code (local highlight.js)
- Mermaid diagrams (` ```mermaid ` fences; local `mermaid.min.js`, follows light/dark theme)
- Outline sidebar with stable heading ids (same ids in HTML and outline)
- Find with match count (CSS Custom Highlight API)
- External links open in the system browser; relative `.md` links open in-app
- File watch reload (~150 ms debounce) with scroll-position restore
- Light/dark theme and zoom, persisted in the app config dir
- Images from the open file’s directory via Tauri asset protocol (scoped, not whole-disk)

## Layout

```
markdown-look/
  ui/                 # vanilla HTML/CSS/JS (no bundler, no markdown-it)
  src-tauri/          # Tauri 2 + Rust Markdown pipeline
  tests/fixtures/     # sample.md, huong-dan.md
```

The previous egui build is preserved at `../markdown-look-egui-final/`.

## License

MIT. Open Sans font files are under the SIL Open Font License (see `ui/fonts/OFL.txt`).
