# Tiến độ focus-conductor 0.8.5

Nhánh làm việc `claude/focus-conductor-0-8-5`, tách từ `main` `87023af`. Engine kiểm 2.1.296.

- Bộ test gốc trên `87023af` [Đo trực tiếp]: 3189 ca đạt, 0 lỗi, 274 tệp.
- Khai báo kiểu của engine: không sinh được trong phiên này (engine không nạp hooks module của mod ở phiên `-p` và phiên tương tác qua pty); K9, K11 theo lối dừng.
- K2: test đỏ `ac1f59f` (9/11 đỏ trên `87023af`); sửa `f77a086`; mẫu K2a 7 đỏ, K2b 2, K2c 4, K2d 2.
- K3: test đỏ `4e7605f` (3/4 đỏ trên `87023af`); sửa ở commit kế; mẫu K3a 3 đỏ, K3b 3, K3c 4.
- K8: test đỏ `8544718` (3/5 đỏ); sửa `4c6dbe5`; mẫu K8a 2 đỏ, K8b 2. Cả bộ sau K8: 3209 đạt, 0 lỗi.
- K1: test đỏ (5/6 đỏ); sửa ở commit kế; mẫu K1a 2 đỏ, K1b 2, K1c 1; viết lại 084-A1g (1 đỏ trên A1).
- Tách resumeTarget `f4ee986` (không đổi hành vi, A1 và A2 xanh).
- K5: test đỏ (3 đỏ trên tệp A2); sửa ở commit kế (thêm ca waiting, đỏ trên `87023af`); mẫu K5a 1 đỏ, K5b 1; bỏ 084-A2e.
- D3: test đỏ (2/3 đỏ); sửa ở commit kế; mẫu D3a, D3b.
- K4: test đỏ (1/1); sửa ở commit kế; mẫu K4a 1 đỏ; viết lại 084-Z2d.
- K6: test đỏ (1/1); sửa ở commit kế; mẫu K6a 1 đỏ.
- K7: test đỏ (1/3); sửa ở commit kế; mẫu K7a 1 đỏ, K7b 1.
- D1: test đỏ (1/5); sửa ở commit kế; mẫu D1a, D1b, D1c mỗi mẫu 1 đỏ. Cả bộ sau K7: 3227 đạt.
- D2: test đỏ (1/4); sửa ở commit kế; mẫu D2a 1 đỏ, D2b 1 (D2b bỏ cả needsApproval và vế độ sâu, vì brief tiếp nối lấy độ sâu của router).
- K9: không sửa mã; trường model của Agent là enum alias ở cả 2.1.296 và 2.1.322 (chuỗi trong binary).
- K10: test đỏ (2/3); sửa ở commit kế; mẫu K10a 3 đỏ; viết lại 084-C6c (6), 084-W4d (5); ca C1 đổi kỳ vọng.
- Cả bộ sau K10: 3239 đạt. K11: thêm isCollapsed vào 27 chỗ ở 25 tệp; 283 ca đạt trên 2.1.296; tsc chưa chạy được (không có khai báo kiểu).
