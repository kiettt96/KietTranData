// Bảo vệ hạn mức (0.6.0): đọc số đo hạn mức của engine (SessionRateLimit) và quyết định có đang ở vùng dừng không.
// Hàm thuần, không gọi $. Engine báo phần đã dùng (percentUsed, 0 đến 100); người dùng đặt ngưỡng bằng phần còn lại,
// nên dừng khi percentUsed >= 100 - còn_lại. Chỉ xét hạn mức phiên (five_hour) và tuần (seven_day).

import type { QuotaPause, QuotaReason, QuotaState } from '../../types'
import { maskSecrets } from './checkpoint'

/** Cửa sổ hạn mức mod xét: phiên (5 giờ) và tuần. */
export type QuotaKind = 'five_hour' | 'seven_day'
export type QuotaZone = 'ok' | 'pause' | 'unknown'

/** Một cửa sổ đã qua ngưỡng. */
export type QuotaHit = { kind: QuotaKind; percentUsed: number; remaining: number; resetsAt?: string; threshold: number }
export type QuotaEval = { zone: QuotaZone; hits: QuotaHit[]; nearest: { kind: QuotaKind; remaining: number } | null }
export type QuotaThresholds = { session: number; week: number }
export type QuotaSettings = QuotaThresholds & { enabled: boolean }

/** Khoảng kẹp của ngưỡng phần còn lại (%): cho phép đặt cao (ví dụ 90) để thử cơ chế mà không đốt hạn mức. */
export const REMAINING_MIN = 0.5
export const REMAINING_MAX = 99
export const DEFAULT_SESSION_REMAINING = 5
export const DEFAULT_WEEK_REMAINING = 2
/** Kết quả đọc hạn mức tại chỗ được dùng lại trong bấy nhiêu ms (một lượt tool song song không gọi lặp). */
export const QUOTA_CACHE_MS = 3_000

/** Ngưỡng phần còn lại từ option: số hoặc chuỗi số, kẹp trong khoảng cho phép; không đọc được thì dùng mặc định. */
export function clampRemaining(raw: unknown, fallback: number): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(REMAINING_MAX, Math.max(REMAINING_MIN, value))
}

export function quotaSettings(options: Record<string, unknown>): QuotaSettings {
  return {
    enabled: options['quotaGuard'] !== false,
    session: clampRemaining(options['pauseSessionRemainingPct'], DEFAULT_SESSION_REMAINING),
    week: clampRemaining(options['pauseWeekRemainingPct'], DEFAULT_WEEK_REMAINING),
  }
}

/** Đã chạm vùng dừng: phần đã dùng không nhỏ hơn 100 trừ phần còn lại cho phép (đúng bằng ngưỡng thì dừng). */
export function isPastLimit(percentUsed: number, remainingThreshold: number): boolean {
  return percentUsed >= 100 - remainingThreshold
}

/** Mốc làm mới đã qua (hoặc đúng bằng bây giờ): số đo thuộc cửa sổ cũ. Mốc vắng hay không đọc được thì không coi là cũ. */
export function isStale(resetsAt: string | undefined, now: number): boolean {
  if (resetsAt === undefined) return false
  const at = Date.parse(resetsAt)
  return Number.isFinite(at) && at <= now
}

/**
 * Vùng hiện tại từ các cửa sổ engine báo. `pause` khi ít nhất một cửa sổ hợp lệ qua ngưỡng; `ok` khi có cửa sổ hợp lệ
 * và không cửa sổ nào qua ngưỡng; `unknown` khi không có cửa sổ hợp lệ nào (mảng rỗng, kind lạ, số hỏng, số đo cũ).
 * `nearest`: cửa sổ còn trong vùng gấp đôi biên, gần ngưỡng nhất (cho band).
 */
export function evaluateQuota(limits: readonly unknown[] | null | undefined, now: number, thresholds: QuotaThresholds): QuotaEval {
  const hits: QuotaHit[] = []
  let valid = 0
  let nearest: QuotaEval['nearest'] = null
  let nearestRatio = Number.POSITIVE_INFINITY
  for (const raw of Array.isArray(limits) ? limits : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as { kind?: unknown; percentUsed?: unknown; resetsAt?: unknown }
    const kind = item.kind === 'five_hour' || item.kind === 'seven_day' ? item.kind : null
    if (kind === null || typeof item.percentUsed !== 'number' || !Number.isFinite(item.percentUsed)) continue
    const resetsAt = typeof item.resetsAt === 'string' ? item.resetsAt : undefined
    if (isStale(resetsAt, now)) continue
    valid += 1
    const threshold = kind === 'five_hour' ? thresholds.session : thresholds.week
    const remaining = Math.round((100 - item.percentUsed) * 10) / 10
    if (isPastLimit(item.percentUsed, threshold)) {
      hits.push({ kind, percentUsed: item.percentUsed, remaining, ...(resetsAt !== undefined ? { resetsAt } : {}), threshold })
    }
    const ratio = remaining / threshold
    if (remaining <= threshold * 2 && ratio < nearestRatio) {
      nearestRatio = ratio
      nearest = { kind, remaining }
    }
  }
  return { zone: hits.length > 0 ? 'pause' : valid > 0 ? 'ok' : 'unknown', hits, nearest }
}

/** Lần từ chối tool thứ bấy nhiêu của luồng chính trong cùng một turn đang dừng thì gọi $.turn.abort (dừng cứng dự phòng). */
export const HARD_STOP_AFTER = 3
/** Đầu vào của lệnh bị từ chối được cắt còn bấy nhiêu ký tự khi ghi vào điểm dừng. */
export const DENIED_INPUT_MAX = 300

export const EMPTY_QUOTA: QuotaState = { zone: 'unknown', readings: [], measuredAt: 0, pause: null, overrideUntil: 0, overrideKinds: [], resumeArmed: false, mainTurnId: '', checkpoint: null, resume: null, discardArmedUntil: 0, recent: [], touched: { goalId: -1, paths: [] } }

export function normalizeQuota(raw: Partial<QuotaState> | null | undefined): QuotaState {
  return { ...EMPTY_QUOTA, ...(raw ?? {}) }
}

/**
 * Có đang dừng không: người dùng tự dừng (/conductor pause) luôn là dừng; dừng do hạn mức khi có cửa sổ qua ngưỡng mà
 * không được ép tiếp (ép chỉ miễn các cửa sổ trong overrideKinds, tới overrideUntil). Tắt quotaGuard thì không dừng.
 */
export function isPauseActive(
  enabled: boolean,
  hits: ReadonlyArray<{ kind: QuotaKind }>,
  pause: QuotaPause | null,
  override: { until: number; kinds: readonly QuotaKind[] },
  now: number,
): boolean {
  if (!enabled) return false
  if (pause?.source === 'user') return true
  return blockingHits(hits, override, now).length > 0
}

/** Các cửa sổ qua ngưỡng mà không được ép tiếp: chỉ chúng là lý do dừng. */
export function blockingHits<T extends { kind: QuotaKind }>(hits: readonly T[], override: { until: number; kinds: readonly QuotaKind[] }, now: number): T[] {
  return hits.filter(h => !(now < override.until && override.kinds.includes(h.kind)))
}

/** Phần ép tiếp của trạng thái, cho isPauseActive. */
export function overrideOf(q: Pick<QuotaState, 'overrideUntil' | 'overrideKinds'>): { until: number; kinds: readonly QuotaKind[] } {
  return { until: q.overrideUntil, kinds: q.overrideKinds }
}

/** Lý do dừng từ các cửa sổ đã qua ngưỡng. */
export function reasonsOf(hits: readonly QuotaHit[]): QuotaReason[] {
  return hits.map(h => ({ kind: h.kind, percentUsed: h.percentUsed, ...(h.resetsAt !== undefined ? { resetsAt: h.resetsAt } : {}), thresholdRemainingPct: h.threshold }))
}

/** Lần dừng mới, chưa có lệnh nào bị từ chối. */
export function newPause(at: number, source: QuotaPause['source'], reason: QuotaReason[]): QuotaPause {
  return { at, source, reason, denials: 0, denialTurn: '', aborted: false, denied: null }
}

/** Tool ghi file: điểm dừng chỉ giữ đường dẫn và độ dài nội dung, không giữ nội dung. */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const CONTENT_FIELDS = ['content', 'old_string', 'new_string', 'new_source', 'edits'] as const

function contentLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (value === undefined) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Đầu vào của tool call, bỏ tên tool và định danh, che bí mật, cắt ngắn; không bao giờ có output. Tool ghi file chỉ
 * còn đường dẫn và độ dài nội dung.
 */
export function deniedInput(e: Record<string, unknown>): string {
  const { tool, agentId: _agent, tool_use_id: _id, ...input } = e
  let text: string
  if (typeof tool === 'string' && WRITE_TOOLS.has(tool)) {
    const path = input['file_path'] ?? input['notebook_path'] ?? ''
    const size = CONTENT_FIELDS.reduce((n, field) => n + contentLength(input[field]), 0)
    text = `${String(path)}, nội dung ${size} ký tự`
  } else {
    try {
      text = JSON.stringify(input)
    } catch {
      text = ''
    }
  }
  text = maskSecrets(text)
  return text.length > DENIED_INPUT_MAX ? `${text.slice(0, DENIED_INPUT_MAX - 1)}…` : text
}

/**
 * Ghi một lần từ chối của luồng chính vào lần dừng: đếm theo turn, nhớ lệnh đầu tiên bị từ chối. `abort` là true đúng
 * một lần, ở lần từ chối thứ HARD_STOP_AFTER trong cùng turn.
 */
export function noteDenial(pause: QuotaPause, turnId: string, denied: { tool: string; input: string }): { pause: QuotaPause; abort: boolean } {
  const sameTurn = pause.denialTurn === turnId
  const denials = (sameTurn ? pause.denials : 0) + 1
  const aborted = sameTurn ? pause.aborted : false
  const abort = denials >= HARD_STOP_AFTER && !aborted && turnId !== ''
  return { pause: { ...pause, denials, denialTurn: turnId, aborted: aborted || abort, denied: pause.denied ?? denied }, abort }
}

/** Nhãn hạn mức cho band và status line: đang dừng, hoặc phần còn lại của cửa sổ gần ngưỡng nhất (trong vùng gấp đôi biên). */
export type QuotaBadge = { paused: boolean; left: number | null }

export function quotaBadge(isPaused: boolean, evaluation: QuotaEval): QuotaBadge | null {
  if (isPaused) return { paused: true, left: null }
  return evaluation.nearest !== null ? { paused: false, left: evaluation.nearest.remaining } : null
}
