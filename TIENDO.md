# Tiến độ focus-conductor 0.8.9

- Nhánh claude/focus-conductor-0-8-9 từ main 53bb146.
- Bước 0 xong: trần 64.000 ở 2.1.296 và 2.1.325, cả bốn họ; 64.001 và 128.000 bị ném lỗi trước khi gửi. Câu lỗi: "<plugin>: $.model.complete: maxTokens <n> is past what <id> can produce in one reply (64000)". 2.1.296 phân giải fable thành claude-fable-5-1, 2.1.325 thành claude-fable-5-2.
- Câu lỗi khác: "maxTokens must be a positive integer (got 0)", "timeoutMs must be a positive integer of milliseconds (got 0)", "effort must be one of low, medium, high, xhigh, max (got x)". Model ID lạ không bị ném lỗi.
- U1: test đỏ 7b503b9 (20/3.610), sửa 0d70116. Mẫu 089-U1a 15, U1b 4, U1c 3 ca đỏ; 087-L3i 3, 087-L3n 1.
- U2: test đỏ 17ed0f2 (8/9), sửa 1ec3557. Mẫu U2a 5, U2b 2, U2c 4, U2d 1, U2e 2 ca đỏ. Commit sửa chỉnh một ca của tệp U2 (toBeCloseTo không có trong kit).
- U3: test đỏ b4bd337 (7), sửa 341f667. Kit không chuyển lỗi do hook test ném sang mod (tests/support/engine.ts:188, hooks/lib/router.ts:1413): mod nhận 'no implementation for model.complete'. Chủ mod chọn phương án 1: hai ca tích hợp kiểm câu mod nhận. Mẫu U3a 6, U3b 1, U3c 1 ca đỏ.
- U4: test đỏ 47772be (4/6), sửa a757267. Mẫu U4a 2, U4b 1, U4c 3, U4d 1 ca đỏ.
- Tiếp: hoàn tất (cả bộ, đột biến vùng diff, phiên dài, lượt chạy thật, tài liệu).
- Đột biến vùng diff xong: 85 mẫu cũ, pha 1 diệt 55, lọc diệt 21, pha 2 diệt 7; sống 078-G8h (thêm ca ranh giới, d54a529, 2 đỏ) và 087-L3k (tương đương sau U4, 116ace8). Phiên dài: 10 dòng trùng 0.8.8. Việc tiếp: chạy lại hai mẫu trên cả bộ, mutate --check, validate, version-check, VERIFICATION, PR.

## Vòng 2 (C1, C2, R1, R2, R3, D1 tới D4)
- C1: test đỏ 15c041f (13 đỏ: 9/10 mới, 4 cũ đổi kỳ vọng), sửa 7ad695e, mẫu 089-C1a..e diệt (3,2,1,1,3). Cả bộ với bản sửa: 3.643 ca, chỉ 5 ca cũ đỏ (đã đổi). Ca brief.dropped cũ kiểm ở mức hàm vì kit không cho ghi state. Việc tiếp: C2.
- C2: test đỏ 4815e93 (7 đỏ, 3 xanh giữ hành vi cũ), sửa 19e4d79, chuỗi mẫu cũ 075-R1c/R1f 2327a0e. Mẫu 089-C2a..f diệt (5,6,1,1,1,1). Cả bộ với bản sửa: không ca cũ đỏ. Lưu ý: commit sửa 19e4d79 push khi mutate --check báo 2 mẫu lệch; sửa ngay ở 2327a0e. Việc tiếp: R1 (test đã viết, 3/5 đỏ), R2, R3.
- R1: test đỏ 6d02deb (3/5), sửa 12279f2 (không ca cũ đổi), ca diệt 089-R1b fe? (xem log). 089-R1a 3 đỏ, 089-R1b 1 đỏ sau ca mới. Việc tiếp: R2 (test đã viết: 5/7 thuần + 1 tích hợp đỏ), R3 (4/8 đỏ).
- R2: test đỏ f1ca2ae (6/8), sửa f66ed53, mẫu 089-R2a..f diệt (4,3,1,1,1,1), 072-R9 sửa chuỗi (3 đỏ). Không ca cũ đổi.
- R3: test đỏ (4/8) đã push; việc tiếp: sửa engineMessage, mẫu 089-R3a..c.
- R3: sửa đã push; mẫu 089-R3a..c diệt (1,1,1). Cả bộ sau C1 tới R3 (bản sửa R3): 3.675 ca, 330 tệp, 0 lỗi. Việc tiếp: D1 (test đã viết, chưa chạy). Độ dài lời dặn router ở 7682ef7: 10.282 (cờ tắt), 11.180 (cờ bật).
- D1: test đỏ fa42df8 (5/13), sửa c78ed19. Lời dặn router 10.282 -> 11.053 (+771). 5 ca cũ đổi kỳ vọng; golden.test đỏ tới D4 (ghi CHANGELOG). Mẫu 089-D1a..e diệt (1,2,1,4,1). Mẫu cũ sửa chuỗi: 070-C13, 074-C2, 074-C3, 075-B13f, 075-S1e. Việc tiếp: D2 (test thuần đã viết: tests/rearrange-d2-089.test.ts, chưa có bản tích hợp).
- D2: test đỏ d523168 (22/23), sửa đã push. Mẫu 089-D2a..g diệt (4,9,6,1,2,6,1). Cả bộ 3.711 ca, chỉ golden đỏ (chờ D4). Mẫu cũ sửa chuỗi: 075-B12f, 075-M5i. Việc tiếp: D3.
- D3: test đỏ 6096935 (8/11, đo lại với bộ test đã sửa vẫn 8/11), sửa đã push. Mẫu 089-D3a..h diệt (3,1,3,3,2,1,2,1). rowStatusState: việc trực tiếp chưa có bước không tính xong khi checklist đóng hết. Cả bộ 3.721 ca, chỉ golden đỏ. Việc tiếp: D4 (sáu ca golden arr-*, eval fable và sonnet 3 lượt, ghi lại golden).
- D4 (DỪNG theo mục 6): sáu ca arr-* đạt ngưỡng (fable 6/6 ca 18/18 lượt; sonnet 5/6 ca 15/18, arr-dup 0/3; 0 lượt bỏ hay gộp việc đã xong hay đang chạy ở cả hai model). Ghi lại golden bằng sonnet: 54/56 ca; không lần nào đạt: six (ca cũ, main sonnet/medium thay vì opus) và arr-dup. Đo thêm six: lời dặn 7682ef7 3/3, lời dặn mới 1/3 (tổng mới 1/6). Chi phí D4 tới đây khoảng 4,16 USD. Chưa ghi c4-* bằng fable. Phần D4 chưa commit (cases.ts, check.ts, hash.ts, eval-router.ts, replies.ts 54 ca, DESIGN, README) nằm trong bản sao lưu wip. Chờ chủ mod quyết.
