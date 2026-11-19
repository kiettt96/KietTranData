/**
 * Tệp trạng thái mục tiêu của dự án (0.9.0 vòng 2 M15): engine không giữ $.state giữa hai tiến trình (`claude -p` rồi `claude -p --continue`),
 * nên mod ghi Core và bản ghi cổng đóng vào `.focus-conductor/state.json` dưới thư mục gốc của phiên mỗi lần đổi, và nạp lại ở session.start
 * của phiên chạy tiếp: cùng mã phiên (mã transcript, lượt --continue giữ mã này), tệp không cũ hơn GOAL_FILE_MAX_AGE_MS, đúng định dạng.
 */

export const GOAL_FILE = '.focus-conductor/state.json'
export const GOAL_FILE_MAX_AGE_MS = 24 * 3600 * 1000

export type GoalFile = { v: 1; sessionId: string; savedAt: number; core: unknown; closing: unknown }

export function goalFilePath(root: string): string {
  return `${root.replace(/\/+$/, '')}/${GOAL_FILE}`
}

/** Đọc tệp; sai định dạng, khác mã phiên hay quá cũ thì null. */
export function readGoalFile(text: unknown, sessionId: string, now: number): GoalFile | null {
  if (typeof text !== 'string' || text === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  const f = raw as Partial<GoalFile>
  if (f.v !== 1 || typeof f.sessionId !== 'string' || typeof f.savedAt !== 'number' || f.core === null || typeof f.core !== 'object') return null
  if (f.sessionId !== sessionId || now - f.savedAt > GOAL_FILE_MAX_AGE_MS || f.savedAt - now > GOAL_FILE_MAX_AGE_MS) return null
  return { v: 1, sessionId: f.sessionId, savedAt: f.savedAt, core: f.core, closing: f.closing ?? null }
}

export function goalFileText(sessionId: string, savedAt: number, core: unknown, closing: unknown): string {
  return `${JSON.stringify({ v: 1, sessionId, savedAt, core, closing })}\n`
}
