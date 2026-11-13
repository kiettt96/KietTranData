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
- Golden sonnet (2.1.323, 3 lượt): 45b5161 146/150, lời dặn mới 144/150; theo kỳ vọng đã sửa (long-vn, long-vn-xl bỏ cận trên, b7828ab): 146/150 và 149/150. Chạy lại 11 ca khác nhau, mỗi bên 3 lượt: 29/33 và 30/33.
- DỪNG L2 theo luật dừng: prose-hidden tasks [] -> 4 việc (3/3 cả hai bên); đổi model hay effort luồng chính ở đa số lượt: six, perf-root, long-vn-xl, n1-amend-1, vague. Chờ chủ mod quyết. Bản ghi golden mới cất ở v7/golden/replies-new-sonnet.ts, chưa commit. Đo L3 chưa chạy.
- Lời dặn chỉnh (57108f6). Golden sonnet 50×3 trên lời dặn mới: 147/150 (45b5161: 146/150 theo kỳ vọng hiện tại); Fable c4 12/12 cả hai bên. a: prose-hidden 0 việc 3/3, không chạm. c: không chạm (147 so với 146 sau khi thay lượt của six).
- b CHẠM: six đạt 2/3 ở 45b5161, chạy lại 2/3; bản mới 1/3, chạy lại 1/3 (luồng chính sonnet/medium, cần opus). DỪNG L2, chờ chủ mod. Bản ghi golden cất ở v7/golden/replies-new2.ts, chưa commit. Đo L3 chưa chạy.
- L2 qua theo quyết định chủ mod (six không ổn định ở 45b5161: 2/3, 0/3, 2/3). Golden ghi lại ở commit golden; cả bộ 3389, chỉ ca plan set 21 bước đỏ do kỳ vọng sai, đã sửa cùng commit.
- Tiếp: L3 (probe, test đỏ, đo một mình).
- L3 test đỏ cafab42 (21/25 đỏ trên bản sao 45b5161 có hàm giả); sửa 7c48073 (thông số tạm). Cả bộ 3396 đạt.
- Đo L3 (2.1.323, một mình, không lượt gọi model khác; bộ test và kiểm đột biến chạy cùng lúc): fable 240k 328/499/616 s, ra 47.560/72.272/91.084 token, 270 việc, 272 tới 1.081 yêu cầu; fable 400k lượt 1 bị bộ đo ngắt ở 900 s, lượt 2, 3 509/516 s, ra 72.709/75.264, 448 việc; sonnet 240k, 400k 8 tới 14 s, ra tối đa 1.025, 0 tới 2 việc, 6 hay 7 yêu cầu. Chi phí: fable 16,91 USD, sonnet 1,71 USD.
- Fable: 91.084 > 0,6 × 128.000. Theo công thức, sức chứa thời gian của Fable ở 600 s là 155.955 ký tự: prompt 238.489 bị cắt, trái ca test của đặc tả. DỪNG chờ chủ mod.
- Sửa askRouter chuyển full (test đỏ c47908d, sửa + mẫu 087-L3n); test L1e, L3h (73b2d3a).
- Đo bù fable 400k r1b: 539,5 s, ra 78.802, JSON 137.890 ký tự, 449 yêu cầu, 448 việc, 7,09 USD. Sonnet cap 240k/400k: 7/6 yêu cầu, 2/0 việc, end_turn, JSON hợp lệ. Tổng chi phí đo L3: fable 24,00 USD, sonnet 3,30 USD.
- Bước 1b chạm điều kiện 5 (sonnet dưới một nửa số yêu cầu và số việc của Fable). DỪNG trước khi commit READ_PARAMS, chờ chủ mod.
- Mức giữ hook tệ nhất theo mã: 1,5 × hạn (lượt dự phòng loại trừ với lượt hỏi lại), tức 2.700 s ở 1.800; 900 s ở 600 (số 1.020 trước đây sai).
- Đo thứ ba L3 (prompt 36 đề mục): sonnet 36/36 việc, 5/40/6 yêu cầu; Fable 36 việc, 173 yêu cầu, 157 s. READ_PARAMS thật + mặc định 1.800 (636a5eb); cả bộ 3400. Tài liệu b761adb. Nháp VERIFICATION ở v7/ver087.md.
- Bổ sung 2 (M1, F1, G1) đã duyệt kèm 5 điều chỉnh (xem plan). Dừng đột biến (kết quả cũ ở v7/mutf-preM1.log); chạy lại ở cuối bằng mut4p.py.
- Kiểm engine: model.complete nhận alias (2 bản); Agent chỉ alias; turn.step: 2.1.323 đổi alias, 2.1.296 không; $.session.version() có; model.complete không báo ID thật, turn usage.model có; không có thông tin hạn mức theo model, không giờ mở lại.
- M1 sửa (commit này): alias ở router, Agent; turn.step alias từ 2.1.323; noteServed và dòng Model đang dùng; 6 mẫu M1 bắt hết (M1f viết lại vì bản đầu tương đương). Cả bộ theo nhóm: 3420 đạt (3400 + 20 ca M1), 10 nhóm.
- Mã thoát 137: máy khởi động lại (uptime 3 phút), log dừng ở 2068 ca đạt, không có dấu hiệu hết bộ nhớ; nay chạy theo nhóm bằng v7/groups.py.
- F1 test đỏ 832d495 (đơn vị 8/8 không nạp được, tích hợp 11/18 trên fa608ae). F1 sửa (commit này): Core.fallback, activeConductor, routerTarget/wantedPick/Plan theo họ đang điều phối, đếm lỗi riêng, giữa turn chuyển họ dự phòng, apiFallback cho api-error, đoạn dặn theo họ, nhãn fallback; 9 mẫu F1 bắt hết; 16 mẫu 084 viết lại, bắt hết. 13 ca cũ (8 tệp) đặt conductorFallback off. Cả bộ theo nhóm 3446 đạt (3420 + 26 ca F1). Băm lời dặn và agentSystem không đổi.
- G1 test đỏ 6f8f7a3 (đơn vị 7/7 không nạp được, tích hợp 4/6). G1 sửa (commit này): families.ts, conductor theo họ, labels theo họ, version-check đếm 'fable' (families 1, route 3, router 4); 5 mẫu G1 bắt hết; 7 mẫu cũ viết lại, bắt hết. Ca cũ duy nhất đổi: conductor-c1-084 vòng lặp bỏ opus thêm haiku (tên mất "conductorOf(\"opus\") là off", tên mới "conductorOf(\"haiku\") là off"). Mốc trước/sau G1 trùng: băm, golden, 10339/19587, 8563/7048, 16608/24349, 60 việc 5978/33204, 8164/6931. Cả bộ 3459 đạt (11 nhóm).
