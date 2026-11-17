# Tiến độ focus-conductor 0.9.0

Thư mục gốc: /home/user/KietTranData (git rev-parse --show-toplevel). MOD: /home/user/KietTranData/claude-mods/focus-conductor.
Tệp kế hoạch: /home/user/focus-conductor-090-work/KE-HOACH.md
Tệp tiến độ: /home/user/focus-conductor-090-work/TIEN-DO.md
Tệp bàn giao: /home/user/focus-conductor-090-work/DIEM-DUNG.md

## Trạng thái đã xác minh
- Đường dẫn khởi động chuẩn: khối mục 7 của prompt.
- Đường dẫn xác minh chuẩn: `claude plugin test .` ở MOD.
- Mục chưa xong ưu tiên cao nhất: A3.
- Điểm chặn hiện tại: không.

## Đo nền (17/11/2026, engine 2.1.326)
- HEAD 14a3a85; validate marketplace và mod đạt; version-check 0.8.9, đủ 47 option.
- tsc: 200+ lỗi TS2307 "Cannot find module 'claude-code'" vì `.claude-plugin/types/` chưa sinh trên clone sạch (giới hạn đã ghi ở README dòng 520, VERIFICATION dòng 487). Không phải lỗi mã.
- mutate --check: 2339/2339 khớp. hooks sha256 86fc2370..., tests sha256 b3c10de9...
- claude plugin test .: 3747 pass, 0 fail, 338 tệp, 338 giây. Đầu ra đủ: do-nen.txt, test-nen.txt cùng thư mục.

## Khai báo kiểu
- 17/11/2026: `claude -p --plugin-dir .` không sinh `.claude-plugin/types/`; phiên tương tác qua pty (tools/pty_drive.py, chọn tin cậy thư mục) sinh được, ghi bởi 2.1.326. tsc nền với khai báo 2.1.326: 14 lỗi, đều ở giao diện và kiểu test (ui.tsx, band.tsx, pane.tsx, neon.ts, 6 tệp test), do khai báo 2.1.326 lệch 2.1.296; tệp tsc-nen.txt. Nền tsc = 14 lỗi đó; cuối lượt không thêm lỗi mới.
- Khai báo 2.1.296: cài gói vào eng296/, sinh bằng cùng cách trước nhóm C.

## Chi phí model thật (trần 25 USD, báo ở 20 USD)
- Cộng dồn: 0 USD (thử model ở bước khởi động không tính, vài xu).

## Bảng mục việc
| Mã | Trạng thái | Bằng chứng |
|---|---|---|
| A1 | passing 17/11 | đỏ 20cd683 (4/9 ca đỏ); sửa 4172922; `run-tests.sh tests/fail-label-a1-090.test.ts` 14 pass 0 fail (chạy thật, toàn luồng prompt.submit tới classic.Stop trong tệp); 090-A1a..f KILLED trên tệp test |
| A2 | passing 17/11 | đỏ (5/7 ca đỏ); sửa bb227e5; tệp test 8 pass, toàn luồng prompt.submit tới Stop trong tệp; 090-A2a..e KILLED; tập 30 tệp liên quan 335 pass |
| A3 | not_started | |
| A4 | not_started | |
| A5 | not_started | |
| B1 | not_started | |
| B2 | not_started | |
| B3 | not_started | |
| B4 | not_started | |
| B5 | not_started | |
| B6 | not_started | |
| B7 | not_started | |
| B8 | not_started | |
| B9 | not_started | |
| B10 | not_started | |
| B11 | not_started | |
| B12 | not_started | |
| B13 | not_started | |
| D1 | not_started | |
| C1 | not_started | |
| C2 | not_started | |
| C3 | not_started | |
| C4 | not_started | |
| C5 | not_started | |
| C6 | not_started | |
| C7 | not_started | |
| C8 | not_started | |
| C9 | not_started | |
| D2 | not_started | |
| D4 | not_started | |
| D3 | not_started | |

## Nhật ký phiên
- 17/11/2026: khởi động, đo nền, trình kế hoạch.

## Nhật ký quyết định
- Chạy test theo tập tệp liên quan cho từng mục (tools/run-tests.sh), cả bộ test chạy ở cuối mỗi nhóm; mẫu đột biến kiểm nhanh trên tệp test của mục (tools/mut-subset.ts), lượt đột biến đầy đủ bằng scripts/mutate.ts trên engine 2.1.296 ở cuối lượt. Lý do: cả bộ 5,6 phút một lần. Loại: cả bộ sau mỗi commit.
- A2: thư mục nhà đọc bằng $.env.get('HOME') lúc session.start; đích ~/ chưa giải thì scopeStatus trả unknown. Loại: chỉ giữ dạng ~/ không giải.
- Mod focus-conductor không cài trong phiên cloud này (claude plugin list), nên các đường lùi cho H1, H2 ở mục 2 của prompt không cần dùng; tệp kế hoạch ghi trước khi duyệt. Phương án loại: chờ duyệt mới ghi.
