// 0.8.9 D3: context của prompt tiếp nối và của tin chen ngang không có arrange (tests/support/rearrange-ui.ts), ghi từ lượt chạy trên
// 7682ef7 (bản trước D3), engine 2.1.296. Bản sau D3 phải trùng từng ký tự.

export const FOLLOW_UP_7682 = "[focus-conductor] Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán\nRouter: refine; luồng chính opus/xhigh (việc vừa)\nViệc mới (router đã chấm; khi giao, description của Agent mở đầu \"Việc N: \"):\n5. Thêm phần kiểm thử hồi quy → làm trực tiếp ở luồng chính (opus/xhigh)\nRàng buộc mới: Giữ API cũ\nGiữ nhất quán với phần đã làm; nếu yêu cầu này đổi mục tiêu, cập nhật lại checklist."

export const INTERJECT_7682 = "[focus-conductor] Yêu cầu chen ngang khi đang làm: Nâng cấp module thanh toán\nViệc mới (khi giao, description của Agent mở đầu \"Việc N: \"):\nViệc 5: Thêm phần kiểm thử hồi quy → làm trực tiếp ở luồng chính (opus/xhigh)\nRàng buộc mới: Giữ API cũ\nHoàn tất hoặc tạm dừng đúng chỗ phần đang làm; thêm bước cho yêu cầu mới bằng plan add (action \"add\") trước khi làm phần mới, giữ nguyên các bước đang có."
