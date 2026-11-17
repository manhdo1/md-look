# markdown-look — Notes & Architecture

Last updated: 2026-11-16

## Mục tiêu

Viewer Markdown **read-only**, nhẹ hơn MarkText (không Electron), chạy Windows qua WebView2. Nhiều file trong một cửa sổ (tab), kiểu Notepad: double-click / CLI lần sau gửi vào instance đang chạy.

## Lịch sử quyết định

1. **egui / egui_commonmark** — thử trước; không đạt fidelity MarkText → giữ archive tại `../markdown-look-egui-final/`.
2. **Tauri 2 + WebView2** — chọn cuối cùng: Rust parse Markdown một lần → HTML; UI vanilla trong WebView (không markdown-it, không bundler).
3. **Multi-tab (2026-11-16)** — thay mô hình một file / một process bằng tab + single-instance; ưu tiên hiệu năng (DOM detached, Mermaid lazy + cache SVG).

---

## Kiến trúc

```
markdown-look/                    # Cargo workspace
├── Cargo.toml                    # workspace + release profile (LTO, strip)
├── markdown-512px.png            # nguồn icon app (512×315)
├── NOTES.md                      # file này
├── README.md                     # hướng dẫn chạy nhanh
├── DESIGN.md                     # design system (Station Signage)
├── ui/                           # frontendDist — vanilla HTML/CSS/JS
│   ├── index.html                # titlebar, tabbar, outline, reader, statusbar
│   ├── main.js                   # tabs, IPC, TOC, find, zoom, Mermaid, prefs
│   ├── styles/
│   │   ├── fonts.css
│   │   ├── chrome.css            # tokens, titlebar, tabbar, outline, find, status
│   │   ├── article.css
│   │   ├── diagram.css
│   │   └── hljs-theme.css
│   ├── fonts/
│   └── vendor/                   # highlight.min.js, mermaid.min.js
├── tests/fixtures/
└── src-tauri/
    ├── tauri.conf.json           # window, CSP, icons, fileAssociations
    ├── capabilities/default.json
    ├── build.rs
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs                # single-instance (đầu tiên), drop, commands
        ├── document.rs
        ├── html.rs
        ├── commands.rs           # open / reload / close / prefs / pick / asset
        ├── watch.rs              # WatchHub: 1 watcher, nhiều path, debounce 150ms
        └── prefs.rs
```

### Luồng dữ liệu

```
.md file(s)
  → CLI / Explorer (single-instance) / drag-drop
       → pending_paths → emit open-paths → UI take_pending_paths
  → open_file / reload(path)
       → document::load + html::render (pulldown-cmark → rewrite → ammonia)
       → allow asset dir của file (không forbid — forbid thắng allow trong Tauri)
       → WatchHub.add(path)
  → UI
       · mỗi tab một <article>; chỉ tab active gắn vào #preview-scroll
       · tab nền: giữ DOM tách (detached); LRU tối đa 6 DOM sống
       · file đổi ở tab nền → chỉ đánh dấu stale; reload khi activate
       · Mermaid: IntersectionObserver (gần viewport) + cache SVG theo theme+source
```

### IPC

| Command | Vai trò |
|---------|---------|
| `open_file` | Render path, allow asset dir, WatchHub add, recent |
| `reload` | Render lại theo `path` (giữ `force` đã lưu) |
| `close_file` | Giảm refcount; bỏ watch khi về 0 |
| `set_active` | Đặt title cửa sổ (`{title} — markdown-look`) |
| `get_prefs` / `set_prefs` | Đọc/ghi prefs |
| `pick_files` | Dialog chọn nhiều `.md` → `Vec<path>` |
| `take_pending_paths` | Drain path từ CLI / second-instance / drag-drop |
| `resolve_relative` | Resolve link tương đối từ `base` (path tab active) |

**Events**

| Event | Payload | Khi nào |
|-------|---------|---------|
| `open-paths` | (rỗng) | Có path mới trong `pending_paths` — UI gọi `take_pending_paths` |
| `doc-changed` | `string` (path) | WatchHub debounce xong — UI reload tab active hoặc đánh dấu stale |

### Single-instance (Notepad-style)

- Plugin: `tauri-plugin-single-instance` — **phải đăng ký đầu tiên** trong `lib.rs`.
- Mutex theo `identifier` (`com.markdownlook.viewer`) → mọi build (dev/release/installer) cùng identifier dùng chung một cửa sổ.
- Lần chạy sau: forward argv + cwd → instance đang sống → `enqueue_paths` + focus / unminimize; process thứ hai thoát ngay.
- Cold start: `args_os().skip(1)` → `pending_paths` trước khi UI boot.
- Drag-drop: nhận **toàn bộ** paths (không chỉ file đầu).

**Lưu ý Explorer:** nếu “Open with” trỏ vào exe cũ (trước single-instance), mỗi double-click vẫn mở cửa sổ mới. Cần chọn lại exe mới build, hoặc cài installer (có `fileAssociations`).

### File associations

Trong `tauri.conf.json` → `bundle.fileAssociations`: các đuôi Markdown (`.md`, `.markdown`, …). Chỉ có hiệu lực sau `cargo tauri build` + cài đặt. **Không** đăng ký `.txt` (tránh chiếm Notepad).

### Prefs (config dir app)

`theme`, `zoom`, `outlineOpen`, `sidebarWidth`, `recent` (tối đa 8). **Không** khôi phục session tab khi mở lại app.

### Stack

Tauri 2 · WebView2 · pulldown-cmark · ammonia · notify · tauri-plugin-single-instance · vanilla UI · highlight.js · Mermaid · Be Vietnam Pro · JetBrains Mono

---

## Multi-tab (chi tiết)

### UX

- Thanh `#tabbar` chỉ hiện khi **≥ 2** tab; 1 file → giao diện giữ như trước.
- Tab active: nền surface + vạch vermilion 2px trên cạnh (One Signal Rule); không shadow.
- Trùng basename → hiện thêm thư mục cha (faint).
- Đóng: nút × (active/hover), middle-click, Ctrl+W, Delete trên tablist.
- Mở: Ctrl+O / Open / Recent / drop / argv / link `.md` nội bộ (tab mới hoặc focus tab đã mở).
- Phím: Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageUp|Down; Ctrl+1–8; Ctrl+9 = tab cuối; Ctrl+Shift+T = mở lại tab vừa đóng (stack 10).

### Frontend model

```
tabs: Map<id, Tab>
  Tab = { id, path, title, el, outline, wordCount, scrollTop, force, stale }
order: string[]          # thứ tự tab
activeId, lruOrder
MAX_LIVE_TABS = 6        # DOM sống; tab ít dùng → evict el, đánh stale
```

- Chuyển tab: detach article cũ (giữ scrollTop) → attach article mới (hoặc `reload` nếu stale/evicted).
- Dedupe path (không phân biệt hoa thường trên Windows).
- Link `.md` nội bộ: `resolve_relative(base=active.path)` → `openPath` (tab mới / focus).

### Backend model

- Frontend sở hữu danh sách tab; Rust giữ `docs` (refcount + force), `asset_dirs` (allow-only), `WatchHub`, `pending_paths`.
- Asset: chỉ `allow_directory`, **không** `forbid` (trong Tauri forbid thắng allow → đổi tab khác thư mục rồi quay lại sẽ mất ảnh nếu vẫn forbid).

### WatchHub

- Một `RecommendedWatcher` + một thread debounce.
- Refcount theo thư mục (`NonRecursive`); target theo path file.
- So khớp path đầy đủ, case-insensitive trên Windows; không `canonicalize` mỗi event (ổn với save kiểu delete+rename).
- Timeout theo **thay đổi cũ nhất** trong pending (không để file khác trong cùng thư mục hoãn reload mãi).

---

## Mermaid (hiệu năng)

Vấn đề: file nhiều diagram → chuyển tab / mở lại bị chậm vì trước đây vẽ tuần tự hết mọi diagram mỗi lần hiện tab.

Giải pháp (2026-11-16):

1. **Lazy theo viewport** — `IntersectionObserver` (`root: #preview-scroll`, `rootMargin: 100% 0px`): chỉ vẽ diagram gần vùng đang đọc; cuộn tới đâu vẽ tới đó.
2. **Không vẽ lại nếu đã có** — mỗi `.diagram` ghi `data-rendered` theo theme; quay lại tab không gọi Mermaid lại.
3. **Cache SVG** — `Map` key = `theme + "\n" + source`, tối đa 80 mục LRU: reload file / evict tab / đổi theme / full window lấy lại SVG đã render.
4. **Hàng đợi một worker** — `diagramQueue` + `drainDiagramQueue`; rời tab giữa chừng → bỏ qua fit; lần sau lấy từ cache.
5. Đổi theme: chỉ `rescheduleVisibleDiagrams()` cho diagram đang gần viewport của tab active.

Giữ nguyên UX cũ: theme `base` khớp palette, `securityLevel: "antiscript"`, min scale 68%, full window, Diagram/Source.

---

## UI / UX khác đã làm

- Redesign 2026-11-15: Station Signage (`DESIGN.md`). Outline tuyến tàu + status progress.
- Titlebar, outline resize, empty + recent, find, theme, zoom.
- Outline toggle bằng cột grid (tránh `display:none` làm mất bề rộng `#reader`).
- TOC scroll-spy (kể cả cuối trang).
- CSP: `worker-src 'self' blob:` cho Mermaid.
- Không logo trong titlebar HTML — chỉ icon hệ thống Windows.

---

## Bảo mật / phạm vi

- Read-only (không sửa file Markdown).
- Asset protocol: allow theo thư mục của từng file đã mở trong phiên (tích lũy, không forbid).
- HTML qua ammonia; script chỉ vendor local.
- Link ngoài → `tauri-plugin-opener`.

CSP (rút gọn): `default-src 'self'`; asset/img; `worker-src 'self' blob:`.

---

## Icon app / taskbar

- Nguồn: `markdown-512px.png` (512×315, không vuông).
- Generate: `cargo tauri icon ./markdown-512px.png --fit contain`
- Đổi icon mà không rebuild → taskbar vẫn icon mặc định Tauri.
- Sau đổi: tắt app rồi `cargo tauri dev` / `cargo build` lại.

---

## Build / chạy

```bash
cd markdown-look
cargo tauri dev
cargo tauri dev -- -- tests/fixtures/huong-dan.md
cargo build -p markdown-look --release
cargo tauri build
```

- Debug: `target/debug/markdown-look.exe`
- Release: `target/release/markdown-look.exe` (+ bundle khi `tauri build`)

> Workspace root là `markdown-look/` — không nhầm với `src-tauri/target/`.

---

## Fixtures / kiểm thử

- `tests/fixtures/sample.md`, `huong-dan.md`, `mermaid-sample.md`
- Unit/smoke Rust (WatchHub refcount, resolve_relative, argv, fixtures)

**Checklist tay (multi-tab + Mermaid):**

- [ ] Mở 2–3 file trong app (tab hiện từ file thứ 2)
- [ ] Double-click `.md` khi app đang chạy → một cửa sổ, tab mới (cùng exe mới build)
- [ ] Drop nhiều file; mở lại path đã mở → focus tab cũ
- [ ] Sửa file tab nền → reload khi quay lại, giữ scroll
- [ ] Ảnh ở thư mục khác nhau khi chuyển tab
- [ ] File nhiều Mermaid: chuyển tab tức thì; cuộn mới vẽ dần; quay lại không vẽ lại
- [ ] Đổi theme với nhiều tab; diagram lỗi cú pháp không làm chậm
- [ ] Ctrl+W / Ctrl+Tab / Ctrl+Shift+T; đóng hết → empty state
- [ ] Cửa sổ hẹp &lt; 760px với nhiều tab (cuộn ngang tabbar)

---

## Lệnh icon nhanh

```bash
cargo tauri icon ./markdown-512px.png --fit contain
cargo build -p markdown-look
```
