# Điểm dừng focus-conductor 0.9.0 (17/11/2026)

## Lý do dừng
C9 dưới ngưỡng sau lần chỉnh thứ ba (chủ mod cho phép, bước 6: không chỉnh lần thứ tư). Chờ chủ mod quyết. Số đo đợt 4 trong TIEN-DO.md.

## Trạng thái
- Xong (passing): A1-A5, B1-B13, B6 vòng sửa, D1, C1-C8. Nhánh claude/focus-conductor-0-9-0, commit cuối xem git log; nhánh -wip có ba tệp trạng thái.
- Đang dở: D2, C9 (đo xong ba đợt sonnet; chưa đo opus điều phối). Chưa làm: D4, D3, kiểm cuối, PR.
- golden.test.ts còn đỏ: 5 ca không lần nào đạt nên chưa ghi (c4-big-coded, arr-dup cũng 0/3 ở 14a3a85; c9-mid-check, c9-mid-nocheck, c9-doc).

## Số đo lần chỉnh 2 (d2/new3-sonnet.json, sonnet --runs 3)
- 205/228 lượt; 14a3a85 cùng đợt 170/180 (d2/old-sonnet.json).
- Ca mới dưới 2/3: c9-mid-check 0/3, c9-mid-nocheck 0/3, c9-doc 0/3 (router: tasks [], độ sâu light hay substantial nhưng vẫn [] ), c9-hard-data 1/3 (một lượt tasks [], một lượt thiếu design cuối).
- Ca cũ thấp hơn 14a3a85: k4 2/3 (3/3), six 1/3 (2/3, luồng chính sonnet).
- Token ra TB ca cũ: 710 -> 809 (+13,9%, trong ngưỡng 15%).
- Chi phí cộng dồn khoảng 15,7 USD.

## Bước tiếp theo đề xuất
Chủ mod chọn một trong các phương án ở báo cáo trong chat; sau đó đo opus điều phối cho C9, D4, D3, kiểm cuối, PR.
