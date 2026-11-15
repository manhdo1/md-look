# MarkItDown — ghi chú làm việc

Bản cài nằm ở `D:\Application\markitdown`.

- Python 3.13, virtual environment trong `.venv`
- Gói `markitdown[all]` phiên bản 0.1.9
- Script chuyển nhanh: `convert.bat`, `convert.sh`, `convert.ps1`
- Phần xử lý nằm ở `scripts\convert.py`

MarkItDown đổi PDF, Word, PowerPoint, Excel và một số file khác thành Markdown để đưa vào LLM. Kết quả giữ được tiêu đề, danh sách, bảng và liên kết. Đây không phải bản chuyển đổi trình bày đẹp cho người đọc.

## Cách nhanh nhất

Kéo một file hoặc cả thư mục thả lên:

```text
D:\Application\markitdown\convert.bat
```

File `.md` được ghi cạnh file gốc. Cửa sổ hiện `XONG` hoặc `LỖI` rồi chờ một phím trước khi đóng.

Ví dụ: thả `D:\tai lieu\bao-cao.pdf` sẽ tạo `D:\tai lieu\bao-cao.md`.

## Git Bash

```bash
cd /d/Application/markitdown

./convert.sh "D:/tai lieu/bao-cao.pdf"
./convert.sh "D:/tai lieu" -o "D:/markdown" --skip-existing
./convert.sh a.pdf b.docx --merge "D:/out/gop.md"
```

## PowerShell

```powershell
cd D:\Application\markitdown
.\convert.ps1 "D:\tai lieu\bao-cao.pdf"
.\convert.ps1 "D:\tai lieu" -o "D:\markdown" --skip-existing
```

Nếu PowerShell báo không cho chạy script, chạy một lần:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Không cần mở môi trường

Ba lệnh trên tự gọi Python trong `.venv`. Muốn gọi thẳng công cụ gốc:

```text
D:\Application\markitdown\.venv\Scripts\markitdown.exe
```

```bash
"/d/Application/markitdown/.venv/Scripts/markitdown.exe" "D:/tai lieu/bao-cao.pdf" -o "D:/tai lieu/bao-cao.md"
```

Chỉ cần `source .venv/Scripts/activate` khi muốn gõ `markitdown` hoặc `import markitdown` trong Python.

## Việc hay dùng

| Việc | Lệnh |
|---|---|
| Một file, ghi cạnh file gốc | `./convert.sh bao-cao.pdf` |
| Ghi đúng một đường dẫn | `./convert.sh bao-cao.pdf -o D:\out\bao-cao.md` |
| Cả thư mục, gồm thư mục con | `./convert.sh D:\inbox` |
| Gom kết quả vào một thư mục | `./convert.sh D:\inbox -o D:\markdown` |
| Chạy lại, bỏ file đã có `.md` | `./convert.sh D:\inbox -o D:\markdown --skip-existing` |
| Chỉ tầng trên của thư mục | `./convert.sh D:\inbox --no-recursive` |
| Chỉ PDF và Word | `./convert.sh D:\inbox --ext pdf,docx` |
| Gộp nhiều file thành một Markdown | `./convert.sh a.pdf b.docx --merge D:\out\gop.md` |
| In ra màn hình | `./convert.sh bao-cao.pdf --stdout` |

Trong PowerShell đổi `./convert.sh` thành `.\convert.ps1`. Trong CMD đổi thành `convert.bat`.

Với thư mục, cấu trúc con được giữ lại. `D:\inbox\hop-dong\a.pdf` với `-o D:\markdown` thành `D:\markdown\hop-dong\a.md`.

Hai file cùng tên khác đuôi không ghi đè nhau. `report.csv` và `report.txt` trong cùng thư mục thành `report.csv.md` và `report.txt.md`.

Khi quét thư mục, script bỏ qua `.venv`, `.git`, `node_modules` và thư mục ẩn.

## Đuôi file được nhận

`pdf`, `docx`, `pptx`, `xlsx`, `xls`, `html`, `htm`, `csv`, `json`, `jsonl`, `txt`, `xml`, `rss`, `epub`, `zip`, `ipynb`, `msg`, `jpg`, `jpeg`, `png`, `wav`, `mp3`, `m4a`, `mp4`.

Ảnh chỉ lấy nội dung có sẵn trên máy. Script này không gửi ảnh cho model để viết chú thích. Audio có thể cần dịch vụ nhận dạng giọng nói trên mạng. PDF scan (ảnh chụp, không có lớp chữ) thường ra ít chữ vì bản cài này không bật OCR.

## Dùng trong Python

```powershell
cd D:\Application\markitdown
.\.venv\Scripts\Activate.ps1
python
```

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False)
result = md.convert(r"D:\tai lieu\bao-cao.pdf")
print(result.markdown)
```

## Dòng kết quả

- `XONG` — đã ghi file
- `BỎ QUA` — đã có file đích và bạn dùng `--skip-existing`
- `LỖI` — không thấy file, sai đuôi, hoặc không đọc được nội dung

Cuối lệnh có dòng đếm: `4 xong, 0 bỏ qua, 0 lỗi`.
