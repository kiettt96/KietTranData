// Khung test cho bảo vệ hạn mức (0.6.0): số đo hạn mức giả qua session.usage, đổi được giữa chừng.

import type { On } from 'claude-code'

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Mốc làm mới xa trong tương lai so với đồng hồ giả của test (bắt đầu ở 1000 ms). */
export const FAR = '2100-01-01T00:00:00.000Z'

/**
 * Trả về một bảng số đo đổi được: `set` thay các cửa sổ, `calls` đếm số lần mod hỏi `$.session.usage()`.
 * `failing` làm `session.usage` ném lỗi (engine không trả được).
 */
export function quotaMeter(on: On, initial: Limit[] = []) {
  const meter = { limits: initial, calls: 0, failing: false, set(limits: Limit[]) { meter.limits = limits } }
  on('session.usage', () => {
    meter.calls += 1
    if (meter.failing) throw new Error('usage không trả được')
    return { value: { startedAt: 0, context: { tokens: 1_000, window: 200_000 }, rateLimits: meter.limits } } as never
  })
  return meter
}

/** Hạn mức phiên đã dùng `used` phần trăm. */
export const session = (used: number, resetsAt = FAR): Limit => ({ kind: 'five_hour', percentUsed: used, resetsAt })
/** Hạn mức tuần đã dùng `used` phần trăm. */
export const week = (used: number, resetsAt = FAR): Limit => ({ kind: 'seven_day', percentUsed: used, resetsAt })
