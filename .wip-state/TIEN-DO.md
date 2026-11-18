# Tiến độ focus-conductor 0.9.0

Thư mục gốc: /home/user/KietTranData (git rev-parse --show-toplevel). MOD: /home/user/KietTranData/claude-mods/focus-conductor.
Tệp kế hoạch: /home/user/focus-conductor-090-work/KE-HOACH.md
Tệp tiến độ: /home/user/focus-conductor-090-work/TIEN-DO.md
Tệp bàn giao: /home/user/focus-conductor-090-work/DIEM-DUNG.md

## Trạng thái đã xác minh
- Đường dẫn khởi động chuẩn: khối mục 7 của prompt.
- Đường dẫn xác minh chuẩn: `claude plugin test .` ở MOD.
- Mục chưa xong ưu tiên cao nhất: D2 cùng C9.
- Điểm chặn: kiểm độc lập lần hai không đạt sau ba vòng; chờ chủ mod quyết.

## Đo nền (17/11/2026, engine 2.1.326)
- HEAD 14a3a85; validate marketplace và mod đạt; version-check 0.8.9, đủ 47 option.
- tsc: 200+ lỗi TS2307 "Cannot find module 'claude-code'" vì `.claude-plugin/types/` chưa sinh trên clone sạch (giới hạn đã ghi ở README dòng 520, VERIFICATION dòng 487). Không phải lỗi mã.
- mutate --check: 2339/2339 khớp. hooks sha256 86fc2370..., tests sha256 b3c10de9...
- claude plugin test .: 3747 pass, 0 fail, 338 tệp, 338 giây. Đầu ra đủ: do-nen.txt, test-nen.txt cùng thư mục.

## Khai báo kiểu
- 17/11/2026: `claude -p --plugin-dir .` không sinh `.claude-plugin/types/`; phiên tương tác qua pty (tools/pty_drive.py, chọn tin cậy thư mục) sinh được, ghi bởi 2.1.326. tsc nền với khai báo 2.1.326: 14 lỗi, đều ở giao diện và kiểu test (ui.tsx, band.tsx, pane.tsx, neon.ts, 6 tệp test), do khai báo 2.1.326 lệch 2.1.296; tệp tsc-nen.txt. Nền tsc = 14 lỗi đó; cuối lượt không thêm lỗi mới.
- Khai báo 2.1.296: cài gói vào eng296/, sinh bằng cùng cách trước nhóm C.

## Chi phí model thật (trần 25 USD, báo ở 20 USD)
- Sau đợt D2 thứ ba đang chạy: khoảng 15,6 USD (D1 1,7; D2 đợt 1 lời dặn 14a3a85 2,90; lời dặn mới đợt 1 3,60; lần chỉnh 1 3,71; lần chỉnh 2 ước 3,7; thử 0,03).
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
| C3 | passing 17/11 | đỏ (3/5 ca đỏ); sửa 064b407; router-team-c3-090 5 pass; 090-C3a..g KILLED; lời dặn 11.332 thành 12.818 (+1.486, trong 1.500 của nhóm C; tổng +1.930 so với 0.8.9, trong 2.000); ca cũ đổi kỳ vọng: limits-l2-087 (băm agentSystem); số lượt router mỗi prompt không đổi (không thêm lời gọi); hiệu quả đo ở C9 |
| C4 | passing 17/11 | đỏ (tệp chưa nạp được: chưa có hooks/lib/verdict.ts); sửa 1dccb63; verdict-c4-090 15 pass (10 dạng kết luận, dạng thiếu, dòng mẫu vi và en dưới 200 ký tự, nối vào prompt ở agent.spawn, dòng verdict trong nhật ký); 090-C4a..f KILLED. Khai báo 2.1.296: AgentSpawnInput.prompt viết lại được ('A rewrite is the prompt the subagent runs with') nên nối ở agent.spawn, không cần đường lùi |
| C5 | passing 17/11 | đỏ (1/3 ca đỏ); sửa 0a35e15; file-clash-c5-090 4 pass; 090-C5a..d KILLED; 36 tệp agent 380 pass |
| C6 | passing 17/11 | đỏ (5/9 ca đỏ); sửa 7a62b10; closing-c6-090 10 pass; 090-C6a..j KILLED; 58 tệp có classic.Stop 795 pass sau khi 8 ca cũ đặt closingReview off (CA-DOI-KY-VONG.md); version-check đủ 48 option; validate đạt |
| C7 | passing 17/11 | đỏ (3/3 ca đỏ); sửa 87c99f1; verdict-retry-c7-090 3 pass (vòng 1 nguyên văn, vòng 2 chẩn đoán opus hay fable theo allowFable, vòng 3 dừng hỏi, toast 3 vòng, ĐẠT đặt lại vòng); 090-C7a..e KILLED; câu dặn dưới 200 ký tự; 30 tệp retry/agent 214 pass |
| B6v | passing 17/11 | lộ ra khi dựng kịch bản đo kỷ luật của D2: Edit tệp tiến độ hay cp vào nơi sao lưu sau lần kiểm làm bước verified bị hạ done (lastMutation tính cả ghi phụ). Đỏ 2/3 ca (state-fresh-b6-090); sửa 5241aae: ghi chắc chỉ vào hai danh sách không là thay đổi của evidence; 090-B6c,g,h KILLED; 40 pass ở 5 tệp B2, B6, B10, B11 |
| C8 | passing 17/11 | đỏ fb3e1c3 (4/5 ca đỏ, ca không chèn bảng khi sổ rỗng xanh từ đầu); sửa e3e2464; report-c8-090 5 pass (bảng chỉ ở bước cuối, vai, model, kết luận, giữ lần chạy cuối, gộp theo vai dưới 600 ký tự, mục 6 đúng 472 ký tự); 090-C8a..e KILLED; plan-set-073 giữ nguyên (mọi cụm ghim còn) |
| C9 | passing 17/11 | đo F đạt ngưỡng (xem nhật ký phiên) |
| D2 | passing 17/11 | ca D2: 6/6 đạt ít nhất 2/3 (d2-many-rules 2/3); ca cũ k4, six thấp hơn 14a3a85; ký tự chèn: phiên dài +79 mỗi số, kịch bản kỷ luật 3381 -> 1398 |
| D4 | not_started | |
| D3 | not_started | |

## Nhật ký phiên
- Chỉ dẫn thứ ba của chủ mod (trần 40 USD): mục 1 kết luận theo vai xong (318b1b0, 52ff5d3). Mục 2 kiểm độc lập lần hai: vòng 1 không đạt (1 nặng, 5 vừa, 1 nhẹ) -> sửa 7eea57e (16 ca đỏ); vòng 2 không đạt (2 nặng, 4 vừa, 2 nhẹ) -> sửa c958d15 (20 ca đỏ, isBashWrite xét theo đoạn); vòng 3 không đạt (2 nặng: vòng lặp, if của shell và heredoc vào trình thông dịch; 3 vừa). Hết trần ba vòng, dừng và báo (DIEM-DUNG.md).
- Đo F (d2/new5-sonnet.json, old5-sonnet.json, sonnet, 3 lượt, cùng đợt): mới 216/228, 14a3a85 170/180. Mười ca c9 đạt 3/3 (chỉ chấm độ sâu); sáu ca D2 đạt ít nhất 2/3 (d2-many-rules 2/3). Ca cũ lệch: k4 2/3 và six 2/3 (14a3a85 3/3 cả hai) -> đo 6 lượt cùng đợt: k4 mới 5/6, cũ 6/6; six mới 3/6, cũ 4/6: chênh 1, không tính tụt. Token ra TB ca cũ 676 -> 761 (+12,6%). Đạt ngưỡng; không cần F2.
- Golden: ghi bằng lần đo F (73/76 ca), rồi c4-big-coded, c4-big-skill, c4-small, c4-status, arr-dup bằng router fable --record 3 lượt (15/15), như VERIFICATION mục 0.8.9. golden.test.ts 89 pass.
- Chi phí: đợt F 6,39; 6 lượt k4, six 0,65; ghi fable 1,43; cộng dồn khoảng 29,4 USD (gần mức báo 30).
- 17/11, chủ mod duyệt đổi thiết kế C1, C3 (chỉ dẫn A tới G): router chỉ đọc prompt, luật đội hình do mod áp. Đã làm: gỡ khối Team roles, câu tasks never [], role, câu catalog haiku và định nghĩa light đã đổi (lời dặn router +525 so với 0.8.9; agentSystem trùng 14a3a85 từng byte); vai do mod suy (hooks/lib/router.ts roleOf, roleRoute; hooks/parts/agents.ts ROLE_PREFIXES, prefixRole); đội hình do mod áp (hooks/lib/team.ts TEAM_FILES = 3, teamCause, closingNote, closingSteps; Core.team; pane mục Bước đóng); kết luận theo câu trả lời (hooks/lib/verdict.ts verdictOf(answer); Ctx.local.agentWrote; VerdictRun.isClean). Test đỏ 9519b92 (26 ca đỏ cộng hai tệp không nạp được, 24 ca), sửa 28c57f5, bộ chấm golden về như cũ 76a58a0. Mẫu 090-C1b..l, 090-C2d, 090-C3d, h..q, 090-C4a..j, 090-C6f,h,j, 090-C7e: 37 KILLED trên tập test liên quan.
- D3 (khai báo kiểu): AgentSpawnInput.prompt ghi rõ "A rewrite is the prompt the subagent runs with" ở cả 2.1.326 và 2.1.296: mod nối được dòng mẫu báo cáo; vẫn đưa từ kết luận vào đoạn dặn bước đóng (cho subagent không tiền tố).
- Đợt 4 sau lần chỉnh 3 (d2/new4-sonnet.json, old-k4six.json, new-k4six.json, diag-old2.json): dưới ngưỡng, dừng theo bước 6 của chủ mod, không chỉnh lần thứ tư.
  | Ca | 14a3a85 độ sâu (prompt viết lại) | lời dặn mới độ sâu | số việc mới | đạt mới |
  |---|---|---|---|---|
  | c9-mid-check | substantial x3 (0 việc) | substantial x3 | 4, 3, 3 | 3/3 |
  | c9-mid-nocheck | substantial x3 (0 việc) | hard x3 | 6, 5, 5 | 1/3 (thêm audit khi không có lệnh kiểm; một lượt thiếu review cuối) |
  | c9-doc | substantial x3 (0 việc) | substantial x3 | 3, 2, 2 | 0/3 (không có audit đối chiếu số liệu) |
  | c9-hard-data | hard x3 (0 việc, prompt lần chỉnh 1) | hard x3 | 6, 5, 6 | 3/3 |
  c9-cost 0/3 (thêm audit khi không có lệnh kiểm). Tổng 203/228. k4 6 lượt: 14a3a85 6/6, mới 2/6 (K4.9 thành nhiều việc; 15 việc cần 8 tới 14): tụt. six 6 lượt: 14a3a85 2/6, mới 0/6 (luồng chính sonnet, cần opus): tụt, blocked. Token ra TB ca cũ 710 -> 840 (+18,3%, quá ngưỡng 15%). Chi phí đợt 4: 5,08 USD; cộng dồn khoảng 20,9 USD.
- 17/11, chủ mod duyệt hướng 1 có thu hẹp: lần chỉnh thứ ba, trần chi phí 35 USD (báo ở 30).
- Chẩn đoán độ sâu (prompt C9 bản lần chỉnh 1, sonnet, 3 lượt; d2/diag-old.json và d2/new3-sonnet.json):
  | Ca | 14a3a85 | lời dặn mới (lần chỉnh 2) |
  |---|---|---|
  | c9-mid-check | light, light, light (0 việc) | light, light, light (0 việc) |
  | c9-mid-nocheck | light, light, light (0 việc) | substantial, light, substantial (0 việc) |
  | c9-doc | light, light, light (0 việc) | light, light, light (0 việc) |
  | c9-hard-data | hard, hard, hard (0 việc) | hard, hard, hard (0, 5, 5 việc) |
  Ba ca vừa: 14a3a85 cũng chấm light 3/3, nên prompt chưa đủ cỡ vừa: viết lại (đổi hành vi qua nhiều mô-đun, có rủi ro hồi quy), giữ kỳ vọng audit, review, thêm kỳ vọng độ sâu substantial hay hard. Không ca nào 14a3a85 chấm substantial mà lời dặn mới chấm light. c9-hard-data: độ sâu đúng, lỗi là danh sách việc rỗng.
- Lần chỉnh 3 (984c3bd): 'depth substantial or hard, kind edit or mixed: tasks is never []: the work is build tasks (main or agent), then one audit task (...), then one review task, last.'; câu tasks [] thêm ', except as Team roles say.'. Lời dặn +1994 (nhóm C 1500, B 494). c9-mid-nocheck: bỏ design khỏi vai cấm vì prompt mới chạm quyền truy cập (C3: hard chạm bảo mật có design).
- Lần chỉnh 2 (d2/new3-sonnet.json): 205/228; c9-mid-check, c9-mid-nocheck, c9-doc 0/3, c9-hard-data 1/3; ca cũ k4 2/3 (14a3a85 3/3), six 1/3 (2/3); token +13,9%. Dừng theo điểm dừng của C9. Chi phí cộng dồn khoảng 15,7 USD.
- D2, C9 đợt 1 (sonnet, --runs 3, cùng đợt): 14a3a85 170/180 lượt (six 2/3; c4-big-coded, c4-big-skill, arr-dup 0/3); lời dặn mới 194/228. Ca C9 cỡ vừa và khó không có việc (router xếp light hay giữ tasks [] cho một khối việc); ca cũ có số việc ghim tụt vì việc audit, review thêm. Token ra TB trên ca cũ 710 -> 809 (+13,9%).
- Lần chỉnh 1: lời dặn 'một khối việc thì là một việc build, không []'; bộ chấm golden đếm số việc không tính việc đội hình thêm (design đầu, chuỗi audit/review/design cuối); viết lại năm prompt C9 cho đúng cỡ. Kết quả chấm lại offline: 205/228; ca cũ tụt: six 0/3 (luồng chính sonnet vì design, review chạy opus), long-vn 1/3 (ràng buộc và báo cáo cuối không việc nào phủ); C9 vừa và tài liệu vẫn light.
- Lần chỉnh 2 (lần cuối trước điểm dừng): light hẹp lại 'in one or two places'; 'Review also covers the request's rules and final report. Team tasks never lower "main".'; bỏ câu thừa về tra cứu. Lời dặn +1968 so với 0.8.9 (nhóm C 1500, B 468).
- Phiên dài sau nhóm C (5241aae): mười số trùng số sau nhóm B (C4, C6, C7, C8 không kích hoạt trong kịch bản không có vai).
- Cả bộ trên bản chụp e3e2464 (sau C8): 3952 pass, 1 fail (golden, được phép tới D2), 3953 ca, 364 tệp.
- Kịch bản đo 'phiên theo kỷ luật giao việc' (measure/ky-luat.test.ts, dựng lại H1 tới H5: phạm vi một tệp, ba tệp trạng thái, nơi sao lưu, khối đo nền, hai mục việc có check là lệnh; đếm context của prompt.submit và tool.call, ghi chú của kết quả plan, lý do chặn Stop). Không dựng ở bước đo nền; số nền đo trên bản chụp 14a3a85: 3381 ký tự (bốn cảnh báo ngoài phạm vi 797, hai câu hạ verified 1184). e3e2464: 2582. 5241aae: 1398.
- Sau nhóm B: cả bộ trên 8771b48: 3896 pass, 1 fail (golden), 3897 ca, 356 tệp.
- Đo phiên dài (bộ đo measure/, khớp 6 số của 0.8.9 trên 14a3a85): nền 14a3a85 mac-dinh 10339/19587, fable 8563/7048, solo 16608/24349; sau B 10418/19666, 8642/7127, 16687/24428: mỗi số +79 = dòng dạng check ở kết quả plan set (B10, trong hạn 160). Kịch bản 60 việc tự dựng lại (không khớp 5978/33204 của bản đo cũ): nền 21738/45121, fable -/6482 (ca fable-10 nền không nạp được); sau B 21817/45200, 7794/6561: cũng +79.
- tsc với khai báo 2.1.296 (mod296/): nền 14a3a85 27 lỗi; HEAD bắt hai lỗi mới (DecisionKind thiếu verify-step, check-changed), đã sửa 55047a0. Khai báo 2.1.326: nền 14 lỗi, HEAD 14 lỗi cùng loại.
- D1 (phiên thật, claude -p --plugin-dir, headlessRouting auto, checkCommands 'bash tests/kiem.sh'; dự án và prompt mẫu ở d1/): xem mục D1 dưới bảng.
- Cả bộ trên bản chụp 9aab1c4 (sau B1): 3795 pass, 1 fail (golden, được phép tới D2), 3796 ca, 343 tệp; tệp full-9aab1c4.txt.
- 17/11/2026: khởi động, đo nền, trình kế hoạch.

## Nhật ký quyết định
- B6 vòng sửa: ghi chắc (Edit, Write, hay Bash mà mọi đích đã biết đều thuộc hai danh sách) vào tệp trạng thái hay nơi ghi phụ không vào sổ thay đổi của evidence (không lastMutation, không writes); ghi possible hay đích không xác định giữ như cũ. Loại: chỉ bỏ khỏi lastHard (vẫn hạ bước vì claims dùng lastMutation).
- C9: 'họ điều phối đang cấu hình' đọc là opus (cấu hình gợi ý ở D3: conductor opus); đo opus cùng biến thể điều phối (--conductor) trên mười ca C9 và bốn ca c4 có cờ conductor, so với 14a3a85 trên bốn ca c4; ca cũ còn lại đo bằng sonnet. Lý do: trần 25 USD. Loại: đo opus trên cả 70 ca của hai lời dặn (ước 19 USD).
- C8: bảng lấy từ sổ kết luận của mục tiêu (mọi lần subagent có vai trả lời xong), mỗi việc một dòng theo số việc hay mô tả; sổ rỗng thì không chèn (giữ số ký tự của 0.8.9). Mục 6 bỏ cụm 'subagent theo quy tắc riêng ở dòng cuối' (dòng cuối của khối vẫn nói riêng cho subagent) và rút 'khi chuyển sang việc khác chỉ viết' để giữ đúng 472 ký tự. Khai báo kiểu Core.closingGap của C6 sót khỏi commit C6, commit riêng 09e20a3. Loại: thêm cột bước chưa xác minh vào bảng (ngoài chữ của C8).
- C6: 'phiên giao được subagent' đọc là engine đã mời ít nhất một loại agent (agent.offer) hay đã có subagent sinh ra, và không solo, không bị từ chối Agent; phiên chưa có cả hai thì cổng không chặn, pane ghi 'Chưa có duyệt độc lập'. Miễn bằng `/conductor waive review` (chỉ người gõ). Loại: luôn coi phiên giao được (làm đỏ 13 ca cũ không có subagent).
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

## 17/11 chỉ dẫn C2 danh sách cho phép và B14
- e105dc6: bản cài C2 danh sách cho phép, B14 mục 7 tới 11; 336 ca 0.9.0 qua.
- ac91323: mẫu 090-C2r tới 090-C2zg, 090-B14a tới 090-B14i; 19 mẫu cũ viết lại chuỗi; DESIGN, CHANGELOG.
- Kiểm độc lập vòng 1: CHƯA ĐẠT, 4 lỗi nặng (cwd subagent mang qua lời gọi; cwd trong cùng lệnh; bộ phân loại bỏ sót sed w, git --output, tree -o, uniq, awk getline; probe heredoc và Write vào thư mục tạm bị chặn). Vừa, nhẹ ghi việc tồn.
- 3c1f...: test đỏ 19/30; cff6ede: vòng sửa 1; 363 ca 0.9.0 qua.
- Đột biến lượt 1 của mẫu mới: 17/25 diệt; mẫu sống có ca thêm ở indep4-fix-090; C2x đánh dấu tương đương.
- Đang chạy: kiểm độc lập vòng 2; đột biến cho vòng sửa 1 và mẫu sống.
- Kiểm độc lập vòng 2: CHƯA ĐẠT, 3 lỗi nặng (đã dò lại, đúng): sort -uo gộp cờ lọt (loại 2); sed s#..#..#w lọt (loại 2); ở thư mục tạm, đường dẫn nguồn tuyệt đối trong repo bị từ chối (cp -r /repo/src .), Stop chặn mục 12 biến thể (loại 3). Hết trần hai vòng: DỪNG theo mục 15.
- Đột biến vòng sửa 1: 17/26 diệt; sống C2s, C2v, C2zj, C2zl, C2zo, C2zp, B14b, B14e, B14f (chưa xử lý).

## 18/11 C2 đổi cách làm: đo dấu file
- 4068422 test đỏ 13/15; 57d0566 bản cài (352 ca 0.9.0 qua); 4ba8575 DESIGN, CHANGELOG.
- Bổ sung 18/11 (4 điểm): 47cab8e test đỏ 8 ca; 0f4718b bản cài; 361 ca 0.9.0 qua.
- Đột biến lượt 1 (22 mẫu): 18 diệt; sống C6zg, C6z (đã thêm ca), B11f (tập test thiếu tệp B11), C6zf trôi chuỗi (đã sửa).
- Quyết định: "ĐẠT phần lớn" là chưa đạt theo đúng chữ mục 2 (chiều an toàn). Pane vỡ khi usage chỉ có token: có từ 0.8.9, ngoài phạm vi, ghi việc tồn.
- Đang chạy: kiểm độc lập dấu file vòng 1 (tác tử mới); đột biến 16 mẫu trên mọi test 0.9.0.
