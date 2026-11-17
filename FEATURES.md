# markdown-look — Tính năng

Viewer Markdown **chỉ đọc** cho Windows (Tauri 2 + WebView2). File này liệt kê những gì người dùng làm được trong app. Kiến trúc và lý do thiết kế: xem [NOTES.md](./NOTES.md).

## Mở file

- **Các cách mở:** nút Open hoặc `Ctrl+O` (chọn được nhiều file một lần), kéo-thả một hoặc nhiều file vào cửa sổ, truyền đường dẫn qua dòng lệnh, double-click file trong Explorer.
- **Một cửa sổ duy nhất (kiểu Notepad):** khi app đang chạy, mở thêm file sẽ thành tab mới trong cửa sổ hiện tại, đồng thời cửa sổ được đưa lên trước (kể cả khi đang thu nhỏ).
- **Đuôi file hỗ trợ:** `.md`, `.markdown`, `.mdown`, `.mkdn`, `.mkd`, `.mdwn`, `.mdtxt`, `.mdtext`, `.mdx`, `.txt`, `.text`. Installer chỉ đăng ký các đuôi Markdown với Windows, không đăng ký `.txt`.
- **File lớn:** file trên 50 MB phải xác nhận trước khi mở.
- **File đã mở:** mở lại một file đang có tab thì chỉ chuyển sang tab đó, không tạo tab trùng. So sánh đường dẫn không phân biệt hoa/thường và `\` hay `/`.
- **Màn hình trống:** hướng dẫn kéo-thả hoặc `Ctrl+O`, nút Open file, và danh sách **Recent** gồm 8 file mở gần nhất (tên file + thư mục). File trong Recent không còn mở được thì tự bị xoá khỏi danh sách.

## Hiển thị Markdown

- **Cú pháp hỗ trợ:** CommonMark + GFM gồm bảng (cuộn ngang khi rộng, có căn lề cột), task list, gạch ngang, footnote, và heading attribute.
- **Front matter YAML** (khối `---` ở đầu file) hiện thành một code block YAML ở đầu bài.
- **An toàn:** HTML được lọc (sanitize), không chạy script nhúng trong file Markdown.
- **Mã hoá:** đọc UTF-8 và bỏ BOM. Byte không hợp lệ vẫn hiển thị được (thay bằng ký tự thế chỗ `�`) thay vì báo lỗi; khi đó status bar hiện cảnh báo **Lỗi mã hoá** cho tab đó.
- **Ảnh tương đối:** ảnh nằm cạnh file hiển thị bình thường, kể cả khi chuyển qua lại giữa các tab ở những thư mục khác nhau.
- **Font:** Be Vietnam Pro cho chữ đọc, JetBrains Mono cho code. Cả hai đi kèm app, không cần mạng.

## Code block

- Tô màu cú pháp bằng highlight.js (chạy local), với nhãn ngôn ngữ ở góc. Chỉ tô khi block sắp cuộn tới; block không ghi ngôn ngữ (```` ``` ```` trơn) hiện chữ thường, không tự đoán ngôn ngữ.
- Nút **Copy** để chép code vào clipboard; nút báo "Copied" khi thành công.
- Highlight được cache, nên khi file reload thì các block không đổi không bị tô màu lại.

## Sơ đồ Mermaid

Các khối ` ```mermaid ` được vẽ bằng `mermaid.min.js` local, theo palette sáng/tối của app.

- **Đầu khung:** hai tab **Diagram / Source** (xem sơ đồ hoặc mã nguồn) và nhãn loại sơ đồ (flowchart, sequence, class, state, gantt, pie, mindmap, timeline, ...).
- **Pan/zoom trong bài:**
  - Kéo để pan; `Ctrl` + cuộn hoặc các nút −/+ để zoom.
  - Nút % để về kích thước thật; double-click hoặc nút Fit để vừa khung.
  - Zoom tối thiểu khi vừa khung là 68% để chữ còn đọc được. Sơ đồ lớn hơn khung sẽ có gợi ý mở toàn màn hình.
- **Xem toàn cửa sổ:** cuộn chuột để zoom, kéo để pan. Phím: `+`/`=` phóng to, `-` thu nhỏ, `0` kích thước thật, `F` vừa khung, `Esc` đóng.
- **Copy source:** chép mã Mermaid của sơ đồ.
- **Link trong sơ đồ** (`click` của Mermaid): mở được URL ngoài, file `.md` tương đối và anchor `#...`.
- **Lỗi cú pháp:** hiện hộp báo lỗi (tối đa 6 dòng) và tự chuyển sang tab Source.
- **Hiệu năng:**
  - Thư viện Mermaid chỉ được nạp khi gặp sơ đồ đầu tiên, nên mở app và mở file không có sơ đồ đều nhanh hơn.
  - Chỉ vẽ sơ đồ khi nó sắp cuộn tới vùng đang đọc.
  - Sơ đồ đã vẽ không vẽ lại khi quay về tab.
  - SVG được cache theo theme, nên đổi theme hay reload file đều nhanh.

## Liên kết

- `#anchor` cuộn mượt tới heading trong bài.
- `http(s):` và `mailto:` mở bằng trình duyệt hoặc ứng dụng mặc định của hệ thống.
- File `.md` / `.markdown` / `.mdx` / `.txt` tương đối được mở thành tab mới (hoặc chuyển sang tab có sẵn), và có thể kèm `#anchor`.
- Link loại khác thì báo không mở được từ viewer.

## Tab (nhiều file)

- Thanh tab chỉ hiện khi mở từ 2 file trở lên. Tab mới được chèn ngay sau tab đang xem.
- Hai file trùng tên ở hai thư mục khác nhau: tab hiện thêm tên thư mục cha để phân biệt.
- **Đóng tab:** nút ×, click chuột giữa, `Ctrl+W`, hoặc `Delete`/`Backspace` khi focus đang ở thanh tab.
- **Chuyển tab:**
  - Click; `Ctrl+Tab` / `Ctrl+Shift+Tab`; `Ctrl+PageDown` / `Ctrl+PageUp`.
  - Phím `←` / `→` khi focus đang ở thanh tab.
  - `Ctrl+1`…`Ctrl+8` theo vị trí, `Ctrl+9` là tab cuối.
- **Mở lại tab vừa đóng:** `Ctrl+Shift+T`, nhớ tối đa 10 tab.
- **Các tiện ích khác:**
  - Cuộn chuột dọc trên thanh tab để cuộn ngang.
  - Mỗi tab nhớ vị trí cuộn riêng.
  - Tối đa 6 tab giữ sẵn nội dung trong bộ nhớ; tab lâu không dùng sẽ tự render lại khi mở.

## Theo dõi thay đổi file (live reload)

- **Phát hiện:** app theo dõi file trên đĩa (gom thay đổi trong 150 ms). Ngoài ra, khi cửa sổ đang hiện, cứ 2 giây app kiểm tra lại tab đang xem; khi cửa sổ được focus hoặc hiện lại thì kiểm tra mọi tab.
- **Tab đang xem:** tự reload và giữ vị trí đọc theo heading gần nhất, rồi hiện toast "Đã cập nhật · HH:MM". Đang mở sơ đồ toàn màn hình thì toast chờ tới khi đóng.
- **Tab nền:** hiện chấm báo có thay đổi; nội dung được reload khi mở lại tab.
- **Lưu dở:** khi editor đang ghi file dở dang hoặc lưu kiểu xoá rồi đổi tên, app thử đọc lại sau 100 / 250 / 500 ms.
- **File bị xoá hoặc chuyển đi:**
  - App giữ nguyên nội dung cũ và hiện banner cảnh báo.
  - Bấm × trên banner thì banner không tự hiện lại cho tab đó.
  - Khi file xuất hiện trở lại, tab tự reload.
- **Reload thủ công:** `F5` hoặc `Ctrl+R`, có giữ vị trí cuộn.

## Đọc và điều hướng

- **Outline:**
  - Dạng "tuyến tàu": phần đã đọc được tô màu tới mục hiện tại; click một mục để cuộn tới.
  - Mục hiện tại theo vị trí cuộn, và mục cuối được bật khi cuộn tới cuối trang.
  - Heading có id ổn định; tiêu đề trùng được đánh `-1`, `-2`, ...
- **Sidebar outline:**
  - Bật/tắt bằng nút ở titlebar.
  - Kéo mép để đổi bề rộng (180–420 px), hoặc dùng phím `←`/`→` (giữ `Shift` để bước lớn).
  - Cửa sổ hẹp dưới 760 px: outline tự thu lại, nút outline mở nó tạm thời.
- **Tìm trong bài:**
  - `Ctrl+F` để mở; `Enter` / `Shift+Enter` để tới kết quả sau/trước; `Esc` để đóng.
  - Không phân biệt hoa/thường, có đếm số kết quả ("3 of 12" / "No results"), và tự cuộn tới kết quả đang chọn.
  - Bỏ qua thanh công cụ của code block và sơ đồ đang ở chế độ Diagram; mã Mermaid chỉ được tìm khi sơ đồ ở tab Source.
- **Status bar:**
  - Mục hiện tại ("3 / 22" + tên mục), số từ, và % đã đọc.
  - Cảnh báo **Lỗi mã hoá** khi file không phải UTF-8 hợp lệ (rê chuột để xem giải thích).
  - Thanh tiến độ đọc chạy dọc mép trên của status bar.

## Giao diện và tuỳ chỉnh

- **Theme sáng/tối:** nút ở titlebar. Sơ đồ Mermaid vẽ lại theo theme mới.
- **Cỡ chữ:**
  - `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, hoặc các nút − / % / + ở status bar.
  - Phạm vi 70%–250%, bước 10%.
- **Titlebar:** tên file và thư mục (rê chuột để xem đường dẫn đầy đủ). Tiêu đề cửa sổ là `<tên file> — markdown-look`.
- **Lưu tuỳ chỉnh:** theme, cỡ chữ, trạng thái outline, bề rộng sidebar và danh sách Recent được lưu trong `prefs.json` ở thư mục config của app. App **không** mở lại các tab của phiên trước.

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `Ctrl+O` | Mở file |
| `Ctrl+F` | Tìm trong bài (`Enter` / `Shift+Enter` để tới kết quả, `Esc` để đóng) |
| `F5`, `Ctrl+R` | Reload tab đang xem |
| `Ctrl+W` | Đóng tab |
| `Ctrl+Shift+T` | Mở lại tab vừa đóng |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Tab sau / trước |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Tab sau / trước |
| `Ctrl+1`…`Ctrl+8`, `Ctrl+9` | Tới tab theo vị trí / tab cuối |
| `Ctrl+=`, `Ctrl+-`, `Ctrl+0` | Phóng to / thu nhỏ / đặt lại cỡ chữ |
| `←` `→`, `Delete` (focus ở thanh tab) | Chuyển tab, đóng tab |
| `←` `→` (focus ở mép sidebar) | Đổi bề rộng outline (`Shift` để bước lớn) |
| `+` `-` `0` `F` `Esc` (sơ đồ toàn màn hình) | Zoom, kích thước thật, vừa khung, đóng |

## Ngoài phạm vi

- Không sửa file: app chỉ đọc, không có chế độ edit.
- Không xuất PDF/HTML, không in.
- Không khôi phục các tab của phiên trước khi mở lại app.