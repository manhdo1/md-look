# markdown-look — Notes & Architecture

Last updated: 2026-11-15

## Mục tiêu

Viewer Markdown **read-only**, nhẹ hơn MarkText (không Electron), giao diện gần MarkText, chạy Windows qua WebView2.

## Lịch sử quyết định

1. **egui / egui_commonmark** — thử trước; không đạt fidelity MarkText → giữ archive tại `../markdown-look-egui-final/`.
2. **Tauri 2 + WebView2** — chọn cuối cùng: Rust parse Markdown một lần → HTML; UI vanilla trong WebView (không markdown-it, không bundler).

---

## Kiến trúc

```
markdown-look/                    # Cargo workspace
├── Cargo.toml                    # workspace + release profile (LTO, strip)
├── markdown-512px.png            # nguồn icon app (512×315)
├── NOTES.md                      # file này
├── README.md                     # hướng dẫn chạy nhanh
├── ui/                           # frontendDist — vanilla HTML/CSS/JS
│   ├── index.html                # titlebar, outline, reader, statusbar
│   ├── main.js                   # IPC, TOC, find, zoom, Mermaid, prefs
│   ├── styles/
│   │   ├── chrome.css
│   │   ├── marktext-preview.css
│   │   └── hljs-marktext.css
│   ├── fonts/OpenSans-*.woff2
│   └── vendor/                   # highlight.min.js, mermaid.min.js (local)
├── tests/fixtures/               # sample.md, huong-dan.md, mermaid-sample.md
└── src-tauri/
    ├── tauri.conf.json           # window, CSP, bundle.icon
    ├── capabilities/default.json
    ├── build.rs                  # tauri_build + rerun-if-changed icons/*
    ├── icons/                    # sinh từ `cargo tauri icon`
    └── src/
        ├── main.rs               # bin entry
        ├── lib.rs                # Builder, plugins, setup, commands
        ├── document.rs           # load, BOM, front matter, outline, words
        ├── html.rs               # pulldown-cmark → rewrite → ammonia → HTML
        ├── commands.rs           # open / reload / prefs / pick / asset scope
        ├── watch.rs              # notify + debounce ~150ms
        └── prefs.rs              # theme, zoom, outline, sidebar, recent
```

### Luồng dữ liệu

```
.md file
  → document::load_source / check_size
  → html::render_markdown (pulldown-cmark)
       · heading ids ổn định (khớp outline)
       · rewrite ảnh → asset:// (scoped thư mục file đang mở)
       · rewrite link .md nội bộ / opener ngoài
       · ammonia sanitize + wrap table
  → RenderedDocument { html, outline, word_count, … }
  → UI inject HTML → highlight.js + Mermaid
  → file watch reload → giữ scroll / heading neo
```

### IPC

| Command | Vai trò |
|---------|---------|
| `open_file` | Mở path, render, swap asset scope, watch |
| `reload` | Render lại file hiện tại |
| `get_prefs` / `set_prefs` | Đọc/ghi prefs |
| `pick_file` | Dialog chọn `.md` |
| `current_path` | Path đang mở |
| `take_pending_path` | Path từ CLI / drag-drop (một lần) |
| `resolve_relative` | Resolve link tương đối từ file đang mở |

**Events:** file-drop, thay đổi file qua watcher.

### Prefs (config dir app)

`theme`, `zoom`, `outlineOpen`, `sidebarWidth`, `recent` (danh sách path gần đây).

### Stack

Tauri 2 · WebView2 · pulldown-cmark · ammonia · notify · vanilla UI · highlight.js · Mermaid · Open Sans

---

## UI / UX đã làm

- Chrome kiểu MarkText: titlebar, outline có thể resize, empty state + recent files, find, theme, zoom.
- Outline toggle: thu về một cột grid (tránh `display:none` làm `#reader` mất bề rộng).
- TOC scroll-spy (kể cả khi cuộn tới cuối trang).
- Statusbar dính đáy (chuỗi flex height + padding article hợp lý).
- Mermaid local + CSP cho phép `worker-src 'self' blob:`.
- **Không** gắn logo trong titlebar HTML — chỉ icon hệ thống Windows (title bar / taskbar / exe).

---

## Icon app / taskbar

### Nguồn hiện tại

- File: `markdown-512px.png` (512×315, **không vuông**).
- Generate:

```bash
cd markdown-look
cargo tauri icon ./markdown-512px.png --fit contain
```

- Output: `src-tauri/icons/*` (`.ico` đa size 16–256, PNG, `.icns`, Appx, …).
- `tauri.conf.json` → `bundle.icon` trỏ các file đó.
- `build.rs` khai báo `cargo:rerun-if-changed` cho `icons/*` để đổi icon buộc rebuild resource Windows.

### Quy tắc quan trọng

1. Đổi file trong `icons/` mà **không rebuild** → exe/taskbar vẫn icon xanh dương mặc định của Tauri.
2. Nguồn icon nên là **PNG**. SVG từng gây ICO lệch; ảnh không vuông phải `--fit contain` (giữ đủ logo) hoặc `--fit cover` (cắt).
3. Sau khi đổi icon: **tắt app** rồi `cargo tauri dev` / `cargo build` lại (Windows hay cache icon taskbar).
4. Không cần cặp dark/light cho taskbar — Windows dùng **một** icon.

### Gợi ý khi thay icon sau này

Chỉ cần **1 file PNG vuông 1024×1024** (tối thiểu 512×512), rồi chạy `cargo tauri icon ./app-icon.png`. Không cần tự tạo đủ size.

---

## Build / chạy

```bash
cd markdown-look
cargo tauri dev
cargo tauri dev -- -- tests/fixtures/huong-dan.md
cargo tauri build
```

Binary workspace thường nằm ở:

- Debug: `markdown-look/target/debug/markdown-look.exe`
- Release / bundle: `markdown-look/target/release/` (và thư mục bundle khi đóng gói)

> Không nhầm với `src-tauri/target/` — workspace root là `markdown-look/`.

---

## Bảo mật / phạm vi

- App read-only (không sửa file Markdown).
- Asset protocol **scoped** theo thư mục của file đang mở; khi đổi file thì forbid thư mục cũ / allow thư mục mới.
- HTML đi qua ammonia; script chỉ vendor local (`highlight`, `mermaid`).
- Link ngoài → `tauri-plugin-opener` (trình duyệt hệ thống).

CSP (rút gọn): `default-src 'self'`; asset/img; `worker-src 'self' blob:` (Mermaid).

---

## Fixtures / kiểm thử

- `tests/fixtures/sample.md`, `huong-dan.md`, `mermaid-sample.md`
- Unit/smoke trong `src-tauri` (ví dụ rewrite asset URL, fixtures smoke)

Gợi ý tự kiểm: light/dark, outline toggle, find, zoom, drop file, reload khi sửa file, Mermaid, cửa sổ hẹp.

---

## Việc còn mở (optional)

- [ ] `fileAssociations` trong bundle để gắn mặc định mở `.md` (hiện vẫn “Open with” thủ công).
- [ ] Đồng bộ README nếu path binary / icon còn lệch với NOTES này.
- [ ] Cân nhắc `set_icon` runtime trên Windows nếu gặp máy vẫn cache icon cũ sau rebuild.

---

## Lệnh icon nhanh (cheat sheet)

```bash
# Xóa icon generate cũ (giữ nguồn PNG)
# rm -rf src-tauri/icons && mkdir src-tauri/icons

cargo tauri icon ./markdown-512px.png --fit contain
cargo build -p markdown-look
# hoặc
cargo tauri dev
```
