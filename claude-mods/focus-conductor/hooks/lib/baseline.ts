// 0.9.0 vòng 3: lệnh kiểm đỏ từ nền. Một lệnh kiểm là đỏ từ nền của mục tiêu khi lần chạy lỗi đầu tiên của nó trong mục tiêu xảy ra lúc sổ
// thay đổi của mục tiêu chưa có lần ghi nào (mọi mức; ghi vào tệp trạng thái, nơi ghi phụ, .claude/plans/, .focus-conductor/ không tính).
// Phần dữ liệu thêm vào mục của cổng lệnh kiểm chưa đạt và vào trạng thái lượt; vắng ở trạng thái lưu từ bản trước.

import type { RetryItem, RetryState } from '../../types'
import type { EvidenceLog } from './drift/evidence'

/** Cờ đỏ từ nền của một mục: số đếm lỗi đọc được ở lần nền (null khi không đọc được), đã chặn đòi mục báo cáo chưa. */
export type BaseMark = { baseline?: true; baseCount?: number | null; baseAsked?: true }
export type BaseItem = RetryItem & BaseMark
/** Chữ ký các lệnh đã có lần chạy lỗi trong mục tiêu: lần lỗi sau của chúng không còn là lần lỗi đầu tiên. */
export type BaseState = RetryState & { seen?: string[] }
/** Trần số chữ ký giữ trong `seen`. */
export const BASE_SEEN = 60

export const baseOf = (item: RetryItem): BaseMark => item as BaseItem
export const isBaseline = (item: RetryItem): boolean => baseOf(item).baseline === true
export const seenOf = (retry: RetryState): string[] => (retry as BaseState).seen ?? []

/** Lần chạy ở `seq` đứng trước mọi lần ghi của sổ thay đổi (sổ đã nạp lại mà thiếu danh sách ghi thì không tính là nền). */
export function isBaselineRun(log: EvidenceLog, seq: number): boolean {
  if (log.mutations === 0) return true
  return log.writes.length === log.mutations && (log.writes[0]?.seq ?? seq) > seq
}

/** Số đếm lỗi đọc được trong output của lệnh kiểm (dòng tổng kết cuối có số kèm error, errors, failed, fail, failures); null khi không có. */
export function errorCountOf(output: string | undefined): number | null {
  if (typeof output !== 'string' || output === '') return null
  const hits = [...output.matchAll(/\b(\d{1,6})\s+(?:errors?|failed|fail|failures?)\b/gi)]
  const last = hits.at(-1)
  return last === undefined ? null : Number(last[1])
}

/** Giữ phần vòng 3 của một mục khi chuẩn hóa trạng thái lưu. */
export function keepBase(raw: Partial<RetryItem>, item: RetryItem): BaseItem {
  const mark = raw as BaseMark
  return {
    ...item,
    ...(mark.baseline === true ? { baseline: true as const, baseCount: typeof mark.baseCount === 'number' ? mark.baseCount : null } : {}),
    ...(mark.baseAsked === true ? { baseAsked: true as const } : {}),
  }
}
