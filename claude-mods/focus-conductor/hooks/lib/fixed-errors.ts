// Sổ lỗi đã sửa (0.7.9 L1). Mỗi PR sửa một loại lỗi có trong nhật ký lỗi của mod thêm khóa của loại đó (trường key trong file nhật ký)
// cùng phiên bản có bản sửa. Lúc mở phiên, mục có khóa trong sổ mà chỉ gặp ở bản trước fixedIn thì tự xóa khỏi nhật ký; gặp lại từ
// fixedIn trở lên thì giữ và đánh dấu regressed. Sổ bắt đầu rỗng ở 0.7.9.
import type { FixedError } from './errlog'

export const FIXED_ERRORS: readonly FixedError[] = []
