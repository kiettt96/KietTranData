# Tiến độ focus-conductor 0.8.9

- Nhánh claude/focus-conductor-0-8-9 từ main 53bb146.
- Bước 0 xong: trần 64.000 ở 2.1.296 và 2.1.325, cả bốn họ; 64.001 và 128.000 bị ném lỗi trước khi gửi. Câu lỗi: "<plugin>: $.model.complete: maxTokens <n> is past what <id> can produce in one reply (64000)". 2.1.296 phân giải fable thành claude-fable-5-1, 2.1.325 thành claude-fable-5-2.
- Câu lỗi khác: "maxTokens must be a positive integer (got 0)", "timeoutMs must be a positive integer of milliseconds (got 0)", "effort must be one of low, medium, high, xhigh, max (got x)". Model ID lạ không bị ném lỗi.
- Tiếp: U1 test đỏ.
