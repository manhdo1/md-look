# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A developer on Windows who opens Markdown files from disk to read them: READMEs, design docs, architecture notes, runbooks. Documents are technical, mixing Vietnamese and English prose with code blocks, tables, and Mermaid diagrams. The reader often has the file open in an editor at the same time and uses this app as the clean, live-reloading reading view.

## Product Purpose

markdown-look is a lightweight, read-only Markdown previewer (Tauri 2 + WebView2, no Electron). Rust parses Markdown once into sanitized HTML plus an outline; the WebView only renders. Success means a technical document reads comfortably for a long session, its structure is easy to navigate, and its diagrams are actually legible and explorable.

## Positioning

A native-weight viewer that does one job: reading Markdown well, offline, with instant reload on save. No editing surface, no accounts, no network.

## Operating Context

- Opened from the CLI, "Open with", drag-and-drop, the file picker, or the recent-files list.
- Watches the open file and reloads on save, preserving scroll position.
- Used next to an editor, often in a narrow window.

## Capabilities and Constraints

- Read-only; never modifies files.
- Fully offline: fonts and scripts are bundled locally (`ui/fonts`, `ui/vendor`); CSP is `default-src 'self'`.
- Vanilla HTML/CSS/JS, no bundler, no front-end Markdown parser.
- Features: GFM tables, task lists, footnotes, fenced code with highlight.js, Mermaid diagrams, outline with scroll-spy, find (CSS Custom Highlight API), light/dark theme, zoom, resizable outline, recent files, relative `.md` links open in-app, external links open in the system browser.
- Mermaid needs: zoom/pan inside a diagram, a fullscreen view, a Diagram/Source toggle, and working links inside diagrams.
- Vietnamese text must render correctly in every face used.

## Brand Commitments

- No logo inside the HTML title bar; the Windows system icon is the only app mark.
- The earlier MarkText look is not binding; the user approved replacing it.

## Product Principles

1. Reading comes first: chrome stays quiet and out of the way of the document.
2. Technical content is first-class: code, tables, and diagrams get the same care as prose.
3. Offline and light: every asset ships with the app.
4. Never surprise the reader: reloads keep position, links behave predictably.
