# Kế hoạch focus-conductor 0.9.0

Đường dẫn: GỐC = /home/user/KietTranData; MOD = /home/user/KietTranData/claude-mods/focus-conductor; thư mục làm việc ngoài repo = /home/user/focus-conductor-090-work. Cỡ việc: dài (prompt ghi).

Cách hiểu: một lượt nâng mod lên 0.9.0, 32 mục việc (A1-A5, B1-B13, C1-C9, D1-D4), một PR về main. Mỗi điểm: commit test đỏ (ghi số ca đỏ) rồi commit sửa, push sau mỗi commit; bản vá và ba tệp trạng thái đẩy lên nhánh -wip sau mỗi commit sửa.

Thứ tự: A1-A5, B1-B13, D1, C1-C8, D2 cùng C9, D4, D3.

## Cách làm và cách kiểm từng mục (tóm tắt, chi tiết đặc tả ở prompt)
- A1 output.ts/claims: dòng có nhãn chứa từ lỗi mà kết quả của chính dòng là dấu hiệu đạt đứng riêng thì không là lỗi. Test tests/fail-label-a1-090.test.ts. Mẫu 090-A1a.
- A2 classify/effects: đích ~/ và $HOME/ đọc thành đường dẫn dưới thư mục nhà; ~user và $OTHER vẫn không đọc được. Test home-target-a2-090. Mẫu 090-A2a.
- A3 bốn ca vào tests/integration/conductor-fallback-f1-087.test.ts; ca đỏ thì sửa conductor.ts/route.ts.
- A4 plugin.json, README, cảnh báo một lần khi conductorFallback trùng/hỏng, routerMaxWait chỉ nhận số.
- A5 pane và context: yêu cầu trong retired không hiện như mở, thêm dòng "đã bỏ N".
- B1 router: hai trường stateFiles, sideWrites (tên chốt khi đọc mã), tối đa 8, parseRoute lọc; brief lưu trong $.state, tiếp nối gộp thêm. Lời dặn thêm <= 500 ký tự cho B1+B12+B13.
- B2-B6 dùng chung một hàm "isStatePath / isSideWrite" ở scope.ts; nối vào scope, approval, conductor, quota pause, skill.
- B7 readonly.ts thêm lệnh băm, cmp, comm, command -v, bash -n.
- B8 classify: thân heredoc của bash/sh/zsh tách dòng như chuỗi lệnh; lồng, eval, không tách được giữ possible.
- B9 classify: <(lệnh) theo lệnh bên trong.
- B10 evidence/verify/tracker: lệnh của bước lấy từ check; khớp danh tính, sau thay đổi cuối, output đạt, kết quả mong đợi; check-changed ghi nhật ký và pane.
- B11 checkCommands có phạm vi glob; sổ thay đổi lưu đường dẫn có trần.
- B12 approval: duyệt một lần (bốn vế).
- B13 lời dặn router: bảng mục việc có mã là việc riêng; bỏ "at most 6".
- D1 phiên thật claude -p --plugin-dir với mod nhánh, hai cấu hình conductor; đọc decisions.jsonl.
- C1-C8 đội hình năm vai: role trong parseRoute + kẹp; quyền theo vai ở tool.call của subagent; đội hình theo cỡ trong lời dặn (<= 1.500 ký tự); mẫu báo cáo và dòng kết luận; file-clash; cổng đóng mục tiêu closingReview; vòng sửa; bảng báo cáo cuối.
- D2+C9 ghi lại golden một lần sau khi lời dặn chốt; đo --runs 3 lời dặn 14a3a85 và lời dặn mới cùng đợt; sáu ca D2, mười ca C9.
- D4 phiên thật có đội hình, prompt vừa và khó.
- D3 phiên bản 0.9.0, CHANGELOG, DESIGN hai mục, README, VERIFICATION.

## Tiêu chí nghiệm thu
Theo mục 9 của prompt: mọi mục passing (D1, D4 được blocked đúng lý do); khối đo nền chạy lại đạt với 0.9.0; số ca test >= nền; đột biến các tệp đã đổi không còn mẫu sống ngoài nhóm tương đương; PR mở, CI xanh.
