// Khung test cho bảo vệ hạn mức (0.6.0): số đo hạn mức giả qua session.usage, đổi được giữa chừng.

import type { On } from 'claude-code'
import { DEFAULT_ROUTER, plan } from './engine'
import type { Responder } from './engine'

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

/** Kho $.store trong bộ nhớ mà test đọc thẳng được; `failing` làm `set` bị từ chối (như khi vượt 4 MiB); `sets` đếm số lần ghi. */
export function memoryStore(on: On) {
  const box = { data: new Map<string, unknown>(), failing: false, sets: 0 }
  on('store.get', (_$, e) => ({ value: box.data.has(e.key) ? JSON.parse(JSON.stringify(box.data.get(e.key))) : undefined }) as never)
  on('store.set', (_$, e) => {
    box.sets += 1
    if (box.failing) throw new Error('kho đầy')
    box.data.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    box.data.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...box.data.keys()] }) as never)
  return box
}

/**
 * Router giả cho test tiếp tục: "tiếp tục" là làm tiếp mục tiêu đang mở (relation continue), mọi prompt khác như
 * router mặc định. Từ sau góp ý PR 21, khối ĐIỂM DỪNG chỉ được chèn khi router xếp prompt là tiếp nối.
 */
export const resumeRouter: Responder = request => (request.startsWith('tiếp tục') ? plan({ relation: 'continue', goal: 'tiếp tục' }) : DEFAULT_ROUTER(request))
export const RESUME = { router: resumeRouter }

/**
 * Hệ tệp phẳng cho test pauseAllowPaths (R9): mọi đường dẫn có thật và không có symlink (`realPath` là chính nó). Mod hỏi
 * `$.fs.stat(path, { resolve: true })` để biết đường dẫn ghi đáp vào đâu; không có hệ tệp giả thì engine thử không trả `realPath`.
 */
export function flatFs(on: On): void {
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }) as never)
}
