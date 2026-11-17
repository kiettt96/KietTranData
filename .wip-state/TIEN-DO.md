# Tiến độ focus-conductor 0.9.0

Thư mục gốc: /home/user/KietTranData (git rev-parse --show-toplevel). MOD: /home/user/KietTranData/claude-mods/focus-conductor.
Tệp kế hoạch: /home/user/focus-conductor-090-work/KE-HOACH.md
Tệp tiến độ: /home/user/focus-conductor-090-work/TIEN-DO.md
Tệp bàn giao: /home/user/focus-conductor-090-work/DIEM-DUNG.md

## Trạng thái đã xác minh
- Đường dẫn khởi động chuẩn: khối mục 7 của prompt.
- Đường dẫn xác minh chuẩn: `claude plugin test .` ở MOD.
- Mục chưa xong ưu tiên cao nhất: C3.
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
- Cộng dồn: khoảng 1,7 USD sau D1 (theo total_cost_usd của claude -p: lần 1 off 0,54; on 0,45; off lần 2 0,59; ba lần thử 0,07; chưa gồm lượt router của mod nếu engine không cộng vào).

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
| B7 | passing 17/11 | đỏ (13/26 ca đỏ); sửa 77f8308; readonly-b7-090 26 pass (cả cổng duyệt và vai điều phối); 090-B7a..e KILLED; các tệp dùng classifyBash/isReadOnlyCommand đạt; toàn luồng kiểm ở D1 |
| B8 | passing 17/11 | đỏ (6/8 ca đỏ); sửa b86d3c9; heredoc-b8-090 9 pass (cổng duyệt qua, vai điều phối từ chối bằng câu lệnh kiểm, bun test trong khối nâng verified, rm -rf vẫn là ghi); 090-B8a..e KILLED; 61 tệp liên quan heredoc/classify 847 pass, không ca ghi cũ nào thành chỉ đọc; toàn luồng kiểm ở D1 |
| B9 | passing 17/11 | đỏ (4/6 ca đỏ); sửa 33e20ed; procsub-b9-090 6 pass; 090-B9a..d KILLED, 090-B9e tương đương có lý do; quota-procsub-r3-075 giữ xanh; 17 tệp liên quan 269 pass; toàn luồng kiểm ở D1 |
| B10 | passing 17/11 | đỏ (4 ca đỏ + tệp stepcheck chưa nạp được); sửa 0042c78 (drift/stepcheck.ts, withStepVerified, withAutoDemotedBy, check-changed); step-check-b10-090 15 pass + stepcheck-b10-090 1 pass; 090-B10a..o KILLED; mẫu cũ 061-P25, 070-V12, 070-V14, 071-M11 sửa chuỗi, KILLED; 170 tệp liên quan 1995 pass, không ca ghim 'không nâng verified' nào đổi; ký tự chèn: vế dặn 81 + dòng plan set 79 = 160; toàn luồng kiểm ở D1 |
| B11 | passing 17/11 | đỏ (4/6 ca đỏ); sửa 98920ef; check-scope-b11-090 7 pass; 090-B11a..f KILLED; mẫu cũ 070-V5, 073-N12 sửa chuỗi, 054-C46 giữ (đã bỏ bộ lọc thừa), đều KILLED; 33+ tệp checkCommands 534 pass; README ghi cú pháp @@ và cách khai theo dự án bằng glob tuyệt đối |
| B12 | passing 17/11 | đỏ (3 ca đỏ sau khi sửa khung test; vế b, duyệt giữa lượt khi presented, đã duyệt trước còn chỗ sửa, request rà dùng yêu cầu đã gộp xanh trên nền, giữ làm ca ghim); sửa 87a964b; approval-b12-090 8 pass; 090-B12a..g KILLED; 33 tệp duyệt/router 438 pass; lời dặn router +76 ký tự (tổng B1+B12 = 348) |
| B13 | passing 17/11 | đỏ (2/3 ca đỏ); sửa 8771b48; router-b13-090 3 pass; 090-B13a,b KILLED; lời dặn 10.888 thành 11.332 (+444, trong 500 của B1+B12+B13); 50 tệp lời dặn 630 pass, chỉ golden đỏ (được phép tới D2); phần đo router ở D2 |
| D1 | passing 17/11 | phiên thật claude -p --plugin-dir, engine 2.1.326, router và skill thật, dự án và prompt mẫu tự dựng (d1/); hai cấu hình (conductor off và opus), mỗi cấu hình lượt 1 làm việc, lượt 2 `--continue`. Số đo lượt 1 (nhật ký decisions-*-luot1.jsonl, transcript): từ chối ghi tệp trạng thái 0 và 0; cảnh báo ngoài phạm vi cho tệp trạng thái và nơi sao lưu 0 và 0 (một cảnh báo khác cho lệnh rm trên /tmp ở cấu hình off); khối đo nền heredoc chạy, không có câu 'không xác định được file đích'; bước lên verified nhờ lệnh ở check: 0 (on) và 1 (off, bước 3 qua `bash tests/kiem.sh`, dòng verify-step); cổng Stop chặn 1 lần mỗi cấu hình, lý do chưa có checklist (G1), không lần nào do H1 tới H5. Lỗi lộ ra và đã sửa: evidence dạng `lệnh => kết quả` bị đọc là stale (đỏ 6f8…, sửa ở commit evidence). Giới hạn: router chấm prompt là light nên cổng duyệt và vai điều phối không vào cuộc; ghi vào việc tồn |
| C1 | passing 17/11 | đỏ (6/6 ca đỏ); sửa 9a2adc3; role-c1-090 6 pass (parseRoute, sàn, chấm subagent, nhật ký route, pane 80 và 44 cột, vi và en); 090-C1a..g KILLED; mẫu cũ 075-L6a,b,c sửa chuỗi; 76 tệp giao diện/router 980 pass. Quyết định: vai chỉ lưu khi router trả vai hợp lệ (fail-closed) |
| C2 | passing 17/11 | đỏ (5/6 ca đỏ); sửa aedfcee; role-perm-c2-090 6 pass; 090-C2a..e KILLED; 36 tệp agent/subagent 391 pass. Khai báo 2.1.296 và 2.1.326: tool.call của subagent trả được {deny} (ToolCallResult), nên dùng từ chối thật, không chuyển thành nhắc |
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
- Sau nhóm B: cả bộ trên 8771b48: 3896 pass, 1 fail (golden), 3897 ca, 356 tệp.
- Đo phiên dài (bộ đo measure/, khớp 6 số của 0.8.9 trên 14a3a85): nền 14a3a85 mac-dinh 10339/19587, fable 8563/7048, solo 16608/24349; sau B 10418/19666, 8642/7127, 16687/24428: mỗi số +79 = dòng dạng check ở kết quả plan set (B10, trong hạn 160). Kịch bản 60 việc tự dựng lại (không khớp 5978/33204 của bản đo cũ): nền 21738/45121, fable -/6482 (ca fable-10 nền không nạp được); sau B 21817/45200, 7794/6561: cũng +79.
- tsc với khai báo 2.1.296 (mod296/): nền 14a3a85 27 lỗi; HEAD bắt hai lỗi mới (DecisionKind thiếu verify-step, check-changed), đã sửa 55047a0. Khai báo 2.1.326: nền 14 lỗi, HEAD 14 lỗi cùng loại.
- D1 (phiên thật, claude -p --plugin-dir, headlessRouting auto, checkCommands 'bash tests/kiem.sh'; dự án và prompt mẫu ở d1/): xem mục D1 dưới bảng.
- Cả bộ trên bản chụp 9aab1c4 (sau B1): 3795 pass, 1 fail (golden, được phép tới D2), 3796 ca, 343 tệp; tệp full-9aab1c4.txt.
- 17/11/2026: khởi động, đo nền, trình kế hoạch.

## Nhật ký quyết định
- C1: vai chỉ lưu vào việc khi router trả giá trị hợp lệ; vắng hay sai thì việc không mang vai, không có sàn theo vai, không nhãn (như 0.8.9, theo ràng buộc fail-closed); roleOf suy vai cho nơi cần đọc. Loại: lưu vai suy ra (làm đổi pick và 14 ca ghim giao diện cũ).
- D1: mỗi cấu hình chạy một prompt mẫu cỡ vừa, rồi một lượt `--continue`. Lượt `--continue` mất nhật ký quyết định của lượt 1 và mất mục tiêu (mod coi tin duyệt là mục tiêu mới), nên số đo lấy từ bản chép nhật ký ngay sau lượt 1 và từ transcript. Ghi vào việc tồn: (1) nhật ký decisionLog bị ghi đè ở phiên resume; (2) trạng thái mục tiêu không sống qua `claude -p --continue`; (3) câu 'Việc nhỏ: làm trực tiếp, không cần checklist' của mục tiêu light cãi với prompt đòi checklist, Claude lập checklist sau khi làm nên B10 không có bằng chứng (lần chạy trước khi check được lưu); (4) router chấm prompt kỷ luật cỡ vừa là light.
- B11: cú pháp phạm vi là token `@@` rồi glob nối bằng `;` (`bun test @@ src/**`): không lệnh shell nào có token đúng bằng `@@`, không va với gói npm `@scope/x`. Engine 2.1.326 không có option theo dự án (`claude plugin configure --help`), nên README hướng dẫn glob tuyệt đối. Loại: `[glob] lệnh` (va với `[ -f x ]`), `@glob` (va với `@scope/pkg`).
- B10: bước nâng nhờ check (byCheck) chỉ hạ khi có thay đổi không nhẹ, vì điều kiện bằng chứng là 'sau thay đổi không nhẹ cuối cùng'; bước nâng theo luật 0.7.0 giữ cách hạ cũ. Dòng dạng check ở plan set đi bằng context để dòng kết quả một dòng của 0.7.3 giữ nguyên. Mốc check và lần chạy giữ trong local cùng vòng đời với dấu vết evidence. Loại: lưu mốc trong Core (lệch seq sau nạp lại mod).
- B9: tác động ghi của lệnh bên trong <( ) giữ mức và đích nhưng đánh isUnknown, để ca cũ 0.7.5 R3 (thay thế tiến trình là không xác định ở tạm dừng cứng) giữ nguyên. Loại: đích chắc chắn (làm đỏ ca cũ R3).
- B8: thân có errexit (cờ -e hay set -e) được nối bằng && để dùng đúng luật mã thoát của chuỗi && (A11); không có thì nối bằng ; như xuống dòng. Dòng gán bằng thay thế lệnh chỉ đọc bỏ như phép gán; thay thế lệnh khác, heredoc lồng, eval, if, for, while, case, hàm, nối dòng thì giữ possible. Loại: mô phỏng set -e theo từng dòng.
- B6: tệp trạng thái và nơi ghi phụ cũng không là thay đổi chắc chắn (tracker và evidence), để bản sao lưu .ts không sinh cảnh báo chưa kiểm. Loại: chỉ bỏ khỏi file skill (bản sao lưu .ts vẫn bị đòi chạy kiểm).
- Cả bộ test chạy trên bản chụp git archive của một commit (tools/full-suite.sh), không trên cây làm việc: lượt chạy sau nhóm A trên cây làm việc bị dừng vì đọc lẫn mã B1 đang sửa. Loại: chạy trên cây làm việc.
- A5: pane của 0.8.9 không có danh sách yêu cầu (grep hooks/ui), nên chỉ sửa hai chỗ liệt kê yêu cầu trong context: lời nhắc đối chiếu khi checklist đóng hẳn và lý do cổng Stop khi chưa có checklist. Loại: thêm danh sách yêu cầu vào pane (ngoài phạm vi).
- A4: cảnh báo cấu hình đặt ở session.start (toast và Core.warnings, cờ trong local, một lần mỗi lần nạp). Loại: cảnh báo ở tool.call như ngưỡng hạn mức (phụ thuộc option hạn mức bật).
- Chạy test theo tập tệp liên quan cho từng mục (tools/run-tests.sh), cả bộ test chạy ở cuối mỗi nhóm; mẫu đột biến kiểm nhanh trên tệp test của mục (tools/mut-subset.ts), lượt đột biến đầy đủ bằng scripts/mutate.ts trên engine 2.1.296 ở cuối lượt. Lý do: cả bộ 5,6 phút một lần. Loại: cả bộ sau mỗi commit.
- A2: thư mục nhà đọc bằng $.env.get('HOME') lúc session.start; đích ~/ chưa giải thì scopeStatus trả unknown. Loại: chỉ giữ dạng ~/ không giải.
- Mod focus-conductor không cài trong phiên cloud này (claude plugin list), nên các đường lùi cho H1, H2 ở mục 2 của prompt không cần dùng; tệp kế hoạch ghi trước khi duyệt. Phương án loại: chờ duyệt mới ghi.
