# Điểm dừng 18/11: hết trần hai vòng kiểm độc lập của C2 đo dấu file, còn 2 lỗi nặng loại 1
Nhánh claude/focus-conductor-0-9-0. Chưa mở PR. Mục 12 chưa làm.
Lỗi nặng còn lại (vòng 2, trên ffef240):
1. fs đo được lúc này, không đo được lúc khác: lúc hoàn tất đo không được (done null) thì printChanged rỗng nên lượt sạch; lúc sinh đo không được mà lúc hoàn tất đo được thì cũng sạch; ở cổng now null thì bỏ qua. Nội dung đổi bằng lệnh possible không vào sổ nên vế theo sổ không thấy. (consistency.ts, nhánh turn.complete và stalePrints.)
   Đề xuất: đã có một mốc dấu mà mốc sau đo không được thì không tính lượt đó (hay coi là chưa xác nhận ở cổng); chỉ engine không có fs ở mọi mốc mới chạy theo sổ.
2. Chụp dấu lúc sinh và đọc spawnSeq sau await next() của agent.spawn (subagent đã khởi chạy): thay đổi bằng lệnh possible trong cửa sổ đó lọt vào bản chụp lúc sinh. Cửa sổ ngắn, có thật khi chạy song song.
   Đề xuất: chụp trước next() cho lượt có thể đủ điều kiện, bỏ bản ghi khi sau next() hóa ra haiku hay fork.
Vừa: tập lúc sinh đọc từ core trước lần gọi router (chặn thừa khi song song); lượt của mục tiêu cũ hoàn tất sau khi đổi mục tiêu xóa kết luận của mục tiêu mới (chặn thừa). Nhẹ: mktemp bị rào definite; cắt theo Object.keys với agentId toàn chữ số.
Đột biến: 090-C6zq còn sống (mốc lúc sinh chỉ có tác dụng khi fs không đo được, chưa có ca diệt).
