# Tiến độ focus-conductor 0.9.0

Thư mục gốc: /home/user/KietTranData (git rev-parse --show-toplevel). MOD: /home/user/KietTranData/claude-mods/focus-conductor.
Tệp kế hoạch: /home/user/focus-conductor-090-work/KE-HOACH.md
Tệp tiến độ: /home/user/focus-conductor-090-work/TIEN-DO.md
Tệp bàn giao: /home/user/focus-conductor-090-work/DIEM-DUNG.md

## Trạng thái đã xác minh
- Đường dẫn khởi động chuẩn: khối mục 7 của prompt.
- Đường dẫn xác minh chuẩn: `claude plugin test .` ở MOD.
- Mục chưa xong ưu tiên cao nhất: B7.
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
| A3 | passing 17/11 | đỏ (1/4 ca mới đỏ: T3, fallbackUsable bỏ qua promptPaused); sửa 7671e15 ở hooks/context.ts; conductor-fallback-f1-087 22 pass; 090-A3a KILLED; tập 42 tệp conductor/fable/router 421 pass |
| A4 | passing 17/11 | đỏ (4/6 ca đỏ); sửa 3832bef; config-a4-090 6 pass (toàn luồng session.start tới prompt.submit, cảnh báo một lần); 090-A4a..e KILLED; tập 34 tệp 296 pass; version-check đạt |
| A5 | passing 17/11 | đỏ (3/4 ca đỏ); sửa 7a5fe97; retired-a5-090 4 pass (toàn luồng submit, bỏ việc, plan set, đóng checklist); 090-A5a..e KILLED; mẫu cũ 078-G1m, 078-G2e, 078-G2f sửa chuỗi, vẫn KILLED; tập 26 tệp 366 pass |
| B1 | passing 17/11 | đỏ 4ee21e5 (12/13 ca đỏ; thông điệp commit ghi nhầm mã cha bcb1d0b, đúng là 7a5fe97); sửa 9aab1c4; state-files-b1-090 13 pass; 090-B1a..j KILLED; lời dặn router +272 ký tự (10.888 thành 11.160); hai ca ghim đổi kỳ vọng (CA-DOI-KY-VONG.md); golden đỏ tới D2; toàn luồng kiểm ở D1 |
| B2 | passing 17/11 | đỏ (2/3 ca đỏ); sửa c52ddf3 (isSidePath ở drift/scope.ts, tracker, changedTargets, subagent); side-scope-b2-090 8 pass; 090-B2a..h KILLED; tập 14 tệp phạm vi 107 pass; toàn luồng kiểm ở D1 |
| B3 | passing 17/11 | đỏ (3/4 ca đỏ); sửa 6444cb5; approval-state-b3-090 5 pass; 090-B3a..f KILLED; mẫu cũ 082-N2a, 085-W2h sửa chuỗi, KILLED; tập 16 tệp duyệt 302 pass; PLANNING_CHARS 600 thành 1000; toàn luồng kiểm ở D1 |
| B4 | passing 17/11 | đỏ (2/3 ca đỏ); sửa 4279179; conduct-state-b4-090 3 pass (fable và họ dự phòng); 090-B4a..c KILLED; tập conductor liên quan đạt; toàn luồng kiểm ở D1 |
| B5 | passing 17/11 | đỏ (2/3 ca đỏ); sửa af4c032; quota-state-b5-090 3 pass (kể cả symlink ra ngoài bị từ chối); 090-B5a,b KILLED; mẫu cũ 075-A6a,b sửa chuỗi; tập 24 tệp hạn mức 272 pass; toàn luồng kiểm ở D1 |
| B6 | passing 17/11 | đỏ (3/5 ca đỏ); sửa c5600e6; skill-side-b6-090 7 pass; 090-B6a..f KILLED; vế thử skill 107 ký tự; toàn luồng kiểm ở D1 |
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
- Cả bộ trên bản chụp 9aab1c4 (sau B1): 3795 pass, 1 fail (golden, được phép tới D2), 3796 ca, 343 tệp; tệp full-9aab1c4.txt.
- 17/11/2026: khởi động, đo nền, trình kế hoạch.

## Nhật ký quyết định
- B6: tệp trạng thái và nơi ghi phụ cũng không là thay đổi chắc chắn (tracker và evidence), để bản sao lưu .ts không sinh cảnh báo chưa kiểm. Loại: chỉ bỏ khỏi file skill (bản sao lưu .ts vẫn bị đòi chạy kiểm).
- Cả bộ test chạy trên bản chụp git archive của một commit (tools/full-suite.sh), không trên cây làm việc: lượt chạy sau nhóm A trên cây làm việc bị dừng vì đọc lẫn mã B1 đang sửa. Loại: chạy trên cây làm việc.
- A5: pane của 0.8.9 không có danh sách yêu cầu (grep hooks/ui), nên chỉ sửa hai chỗ liệt kê yêu cầu trong context: lời nhắc đối chiếu khi checklist đóng hẳn và lý do cổng Stop khi chưa có checklist. Loại: thêm danh sách yêu cầu vào pane (ngoài phạm vi).
- A4: cảnh báo cấu hình đặt ở session.start (toast và Core.warnings, cờ trong local, một lần mỗi lần nạp). Loại: cảnh báo ở tool.call như ngưỡng hạn mức (phụ thuộc option hạn mức bật).
- Chạy test theo tập tệp liên quan cho từng mục (tools/run-tests.sh), cả bộ test chạy ở cuối mỗi nhóm; mẫu đột biến kiểm nhanh trên tệp test của mục (tools/mut-subset.ts), lượt đột biến đầy đủ bằng scripts/mutate.ts trên engine 2.1.296 ở cuối lượt. Lý do: cả bộ 5,6 phút một lần. Loại: cả bộ sau mỗi commit.
- A2: thư mục nhà đọc bằng $.env.get('HOME') lúc session.start; đích ~/ chưa giải thì scopeStatus trả unknown. Loại: chỉ giữ dạng ~/ không giải.
- Mod focus-conductor không cài trong phiên cloud này (claude plugin list), nên các đường lùi cho H1, H2 ở mục 2 của prompt không cần dùng; tệp kế hoạch ghi trước khi duyệt. Phương án loại: chờ duyệt mới ghi.
