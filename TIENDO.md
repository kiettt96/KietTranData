# Tiến độ focus-conductor 0.8.7

Nhánh `claude/focus-conductor-0-8-7`, tách từ `main` `45b5161` (0.8.6). Engine test: 2.1.296; đo Fable: 2.1.322.
Điểm: L1, H1, B1. Kế hoạch đã duyệt kèm 3 điều chỉnh L1 (dự phòng dùng trọn 120 s; prompt qua stdin; ghi token ra, cờ khi > 23.500).

Tiếp: đo Fable cho L1.
- L1 test đỏ: e825652, 6/12 đỏ trên bản sao 45b5161 có hằng giả (FABLE_REQUEST_CHARS 260.000, FABLE_FULL_TIMEOUT_MS 300.000).
- Đo Fable (6/6 đạt): 240k 227-235 s, token ra 32.558-33.433; 400k 333-369 s, token ra 47.892-53.618. Chốt 400.000 / 555.000 ms / maxTokens 80.000 / hỏi lại 120.000.
- Giới hạn hook: không có trần ở gói engine (model.complete kẹp 2147483647); probe thật không chạy vì hook module không nạp trong claude -p.
- L1 sửa: 6f76947 (18 ca, 8/18 đỏ trên 45b5161 có hằng giả; 11 mẫu 087-L1a..k bắt hết); 7 mẫu cũ viết lại ở commit kế. Cả bộ sau L1: 3344 đạt.
- H1: test đỏ 9b9fa6a (3/8 đỏ trên 45b5161); sửa 7d2b1d3, 4 mẫu 087-H1a..d bắt hết.
- B1: test đỏ 052ed74 (đơn vị 2/4, tích hợp 2/3 trên 45b5161); sửa c8bd562 kèm ca chained; 4 mẫu 087-B1a..d bắt hết. Phát hiện: acceptsVerified nhận verified kèm evidence sau chuỗi đạt rồi lỗi (cả 45b5161 và bản mới), không sửa.
- Phiên bản 3157f74; sửa ca chained aff7bf5; tài liệu (CHANGELOG, DESIGN, README) ở commit tài liệu.
- Cả bộ trên aff7bf5: 3360 đạt, 0 lỗi, 352,39 s; thêm 34 ca so với 45b5161, không mất ca nào.
- Băm split/cond/agent trùng 45b5161; golden diff rỗng; validate đạt; version-check 0.8.7/42; mutate --check 2182/2182.
- Phiên dài: 10.339/19.587, 8.563/7.048, 16.608/24.349 (không đổi).
- Đột biến vùng diff: 117 mẫu, pha 1 đang chạy. Tiếp: pha 2, VERIFICATION, PR.

## Bản bổ sung v3 (13/11/2026): L2, L3
- L2 test đỏ 310b4c1 (23/27 đỏ trên 45b5161); sửa fca9281 (bỏ trần việc, yêu cầu, bước; lời dặn mới; taskRows hết bậc ba; FORK_PART_LIMIT bỏ; tally việc đã phân giữ đủ). Golden đang ghi lại (sonnet 50 ca × 3, cả 45b5161).
- Đo L3 đang chạy (fable, sonnet × 240k, 400k × 3), log m3.jsonl.
- Plan update 60 bước: 107 ký tự, không tăng theo số bước.
