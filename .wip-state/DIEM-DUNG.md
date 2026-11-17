# Điểm dừng 17/11: hết trần hai vòng kiểm độc lập của C2 danh sách cho phép, còn 3 lỗi nặng
Nhánh claude/focus-conductor-0-9-0, commit cuối c2e9a01. Chưa mở PR. Mục 16 chưa làm.
Lỗi nặng còn lại (vòng 2, đã dò lại):
1. readonly.ts sort: /^-o/ không bắt cờ gộp (-uo, -nuo): `sort -uo src/a.ts src/a.ts` ghi tại chỗ, effects rỗng, kết luận vẫn tính.
2. readonly.ts SED_WRITE: dấu phân cách khác / (`s#a#b#w tệp`) lọt.
3. team.ts wordsStayInTemp: ở thư mục tạm xét mọi từ, nên `cd /tmp/x && cp -r /repo/src .` bị từ chối và bật outside; biến thể hợp lý của mục 12 bị Stop chặn.
Lỗi vừa: ln -s /repo/src vào /tmp rồi sửa qua symlink; lời gọi bị từ chối vẫn bật outside; tên lệnh là đường dẫn ngoài tạm không bị xét. Nhẹ: file -C, rg --pre; outside không truyền lên subagent cha.
Đề xuất sửa: sort `/^-[a-zA-Z]*o/` và `--output`; sed lấy ký tự sau `s` làm dấu phân cách; ở thư mục tạm chỉ xét đích của tác động có đích đọc được, xét mọi từ (kể cả tên lệnh) chỉ với tác động possible; ln có nguồn ngoài tạm thì bỏ loại (e) cho thư mục đó; không bật outside cho lời gọi đã bị từ chối.
