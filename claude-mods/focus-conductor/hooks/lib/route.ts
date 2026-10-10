// Lựa chọn model và effort: kiểm theo chính sách, thích nghi lúc chạy, chi phí cache.
//
// Router (router.ts) quyết định model và effort cho luồng chính và từng việc. File này
// không đọc prompt; nó chỉ:
//   - áp chính sách: model của phiên (ceiling, fixed), họ model đang bị chặn;
//   - nâng theo bằng chứng lúc chạy (lặp lỗi, vượt ngân sách) trong cùng một prompt;
//   - giữ model luồng chính khi hạ cấp không bù được chi phí ghi lại cache (giá
//     Claude API 2026-10, xem cost.ts); nâng cấp luôn được phép;
//   - khớp lời gọi Agent với việc đã phân theo cấu trúc ("Việc N", mã mục).

import type { Choice, Effort, Kind, Lift, ModelFamily, Route, Task, Tier, Volume } from '../../types'
import { SAFETY, shouldDowngrade, switchCost, turnCost } from './cost'

export type { Choice }

export const FAMILIES: readonly ModelFamily[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Ngân sách tool call theo tier (tier suy ra từ depth và volume). */
export const TOOL_BUDGET: Record<Tier, number> = { trivial: 8, simple: 15, moderate: 30, complex: 60, deep: 100 }

/** Chính sách model của phiên: auto (mod chọn), ceiling (không vượt model phiên), fixed (giữ model phiên). */
export type SessionPolicy = 'auto' | 'ceiling' | 'fixed'

export type SessionModel = { family: ModelFamily; policy: SessionPolicy }

const DEFAULT_IDS: Record<ModelFamily, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

export function familyRank(family: ModelFamily): number {
  return FAMILIES.indexOf(family)
}

export function effortRank(effort: Effort): number {
  return EFFORTS.indexOf(effort)
}

/** Thứ hạng tổng hợp: model quyết định trước, effort phân định trong cùng model. */
export function pickRank(pick: Choice): number {
  return familyRank(pick.family) * 10 + effortRank(pick.effort)
}

export function familyOf(model: string): ModelFamily | null {
  const lower = model.toLowerCase()
  return FAMILIES.find(family => lower.includes(family)) ?? null
}

export function describePick(pick: Choice): string {
  return `${pick.family}/${pick.effort}`
}

/** Đọc cấu hình "opus=claude-opus-5-5,sonnet=..." thành bảng ghi đè. */
export function parseModelMap(raw: unknown): Partial<Record<ModelFamily, string>> {
  const out: Partial<Record<ModelFamily, string>> = {}
  if (typeof raw !== 'string') return out
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=').map(s => s.trim())
    const family = FAMILIES.find(f => f === key)
    if (family && value) out[family] = value
  }
  return out
}

/** Đọc cấu hình "opus=1000000,sonnet=200000" thành cửa sổ ngữ cảnh theo họ model. */
export function parseWindows(raw: unknown): Partial<Record<ModelFamily, number>> {
  const out: Partial<Record<ModelFamily, number>> = {}
  if (typeof raw !== 'string') return out
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=').map(s => s.trim())
    const family = FAMILIES.find(f => f === key)
    const tokens = Number(value)
    if (family && Number.isFinite(tokens) && tokens > 0) out[family] = tokens
  }
  return out
}

/**
 * Model ID cho một step của luồng chính. Cùng họ với model engine đang dùng
 * thì giữ nguyên ID của engine (giữ cả hậu tố và tiền tố nhà cung cấp); khác
 * họ thì lấy ID ghi đè, hoặc ID mặc định kèm tiền tố nhà cung cấp hiện tại
 * (ví dụ "us.anthropic." trên Bedrock).
 */
export function resolveModelId(
  family: ModelFamily,
  engineModel: string,
  map: Partial<Record<ModelFamily, string>>,
): string {
  if (familyOf(engineModel) === family) return engineModel
  const override = map[family]
  if (override) return override
  const at = engineModel.indexOf('claude-')
  const prefix = at > 0 ? engineModel.slice(0, at) : ''
  return `${prefix}${DEFAULT_IDS[family]}`
}

/** Effort lên (by > 0, kẹp ở xhigh) hoặc xuống (by < 0). Max do người dùng chọn thì giữ nguyên khi lên. */
export function bumpEffort(effort: Effort, by: number): Effort {
  const cap = effortRank('xhigh')
  if (by > 0 && effortRank(effort) > cap) return effort
  const next = effortRank(effort) + by
  return EFFORTS[by > 0 ? Math.min(cap, next) : Math.max(0, next)] ?? effort
}

/** Họ bị chặn (lỗi API) thì ưu tiên chất lượng: lên fable nếu được phép, nếu không thì xuống họ thấp hơn và tăng effort một bậc. */
export function avoidBlocked(
  pick: Choice,
  blocked: ReadonlySet<ModelFamily>,
  ctx: { kind: Kind; allowFable: boolean },
): Choice {
  if (!blocked.has(pick.family)) return pick
  if (pick.family === 'opus' && ctx.allowFable && !blocked.has('fable')) return { family: 'fable', effort: pick.effort }
  for (let rank = familyRank(pick.family) - 1; rank >= 0; rank--) {
    const family = FAMILIES[rank]
    if (!family || blocked.has(family)) continue
    if (family === 'haiku' && (ctx.kind === 'edit' || ctx.kind === 'mixed')) continue
    return { family, effort: bumpEffort(pick.effort, 1) }
  }
  for (let rank = familyRank(pick.family) + 1; rank < FAMILIES.length; rank++) {
    const family = FAMILIES[rank]
    if (family && !blocked.has(family)) return { family, effort: pick.effort }
  }
  return pick
}

/** Áp chính sách model của phiên lên một họ model: fixed giữ model phiên, ceiling không vượt model phiên. */
export function applySession(family: ModelFamily, session: SessionModel | null): ModelFamily {
  if (session === null || session.policy === 'auto') return family
  if (session.policy === 'fixed') return session.family
  return familyRank(family) > familyRank(session.family) ? session.family : family
}

/** Họ model cao hơn một bậc; opus chỉ lên fable khi được phép. */
function raiseFamily(family: ModelFamily, allowFable: boolean): ModelFamily {
  if (family === 'opus' && !allowFable) return 'opus'
  return FAMILIES[Math.min(FAMILIES.length - 1, familyRank(family) + 1)] ?? family
}

/**
 * Nâng lựa chọn của router theo bằng chứng lúc chạy trong cùng prompt: lặp lỗi nâng họ
 * model (mỗi bậc một họ), vượt ngân sách hoặc nhiều lỗi tool nâng effort.
 */
export function liftPick(pick: Choice, lift: Lift, allowFable: boolean): Choice {
  let family = pick.family
  for (let i = 0; i < lift.depth; i++) family = raiseFamily(family, allowFable)
  return { family, effort: bumpEffort(pick.effort, lift.effort) }
}

export type MainDecision = {
  /** Route áp cho turn này. */
  route: Route
  /** Có đổi so với route trước không. */
  isChanged: boolean
  /** Lựa chọn mong muốn bị giữ lại để bảo toàn cache. */
  isHeld: boolean
  wanted: Choice
  reason: string
}

/**
 * Quyết định model + effort của luồng chính cho một turn, theo chi phí token.
 * Nâng cấp luôn được phép. Hạ cấp chỉ khi lợi ích trong các turn còn lại vượt
 * chi phí ghi lại cache. Cache đã nguội hoặc vừa nén thì đổi không mất gì.
 */
export function decideMain(args: {
  current: Route | null
  wanted: Choice
  volume: Volume
  tier: Tier
  goalId: number
  /** Số token ngữ cảnh hiện tại. */
  context: number
  /** Cửa sổ ngữ cảnh của phiên (token). */
  window: number
  /** Số turn còn lại dự kiến: 2 cho mục tiêu mới, 1 cho tiếp nối. */
  turnsLeft: number
  /** Cache đã nguội hoặc vừa nén: đổi không mất chi phí ghi lại. */
  isFree: boolean
  calib: Record<ModelFamily, number>
  /** Phần cố định đo được của ngữ cảnh (system prompt và tools); thiếu thì dùng giả định. */
  sysTokens?: number
  /** Cửa sổ ngữ cảnh của model đích, nếu người dùng khai báo (contextWindows). */
  targetWindow?: number
}): MainDecision {
  const { current, wanted, volume, tier, goalId, context, window, turnsLeft, isFree, calib } = args
  const isSame = current !== null && current.family === wanted.family && current.effort === wanted.effort
  const fresh = (reason: string): MainDecision => ({
    route: { family: wanted.family, effort: wanted.effort, tier, goalId, reason },
    isChanged: !isSame,
    isHeld: false,
    wanted,
    reason,
  })

  if (current === null) return fresh('turn đầu tiên của phiên')
  if (isSame) return { ...fresh('giữ nguyên, đúng mức cần'), isChanged: false }
  // Model đích có cửa sổ nhỏ hơn ngữ cảnh hiện tại: không đổi, kể cả khi nâng cấp.
  if (current.family !== wanted.family && args.targetWindow !== undefined && context * SAFETY > args.targetWindow) {
    const reason = `giữ ${describePick(current)}: ngữ cảnh vượt cửa sổ của ${wanted.family}`
    return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
  }
  if (pickRank(wanted) > pickRank(current)) return fresh(`việc khó hơn, nâng cấp từ ${describePick(current)}`)
  if (current.family !== wanted.family && context * SAFETY > window) {
    const reason = `giữ ${describePick(current)}: ngữ cảnh gần đầy, chưa đổi sang ${describePick(wanted)}`
    return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
  }
  if (isFree) return fresh('cache đã nguội hoặc vừa nén, đổi không mất chi phí ghi lại')

  const rewrite = switchCost(current, wanted, context, args.sysTokens)
  const saving =
    turnCost(current.family, current.effort, volume, context, calib[current.family]) -
    turnCost(wanted.family, wanted.effort, volume, context, calib[wanted.family])
  if (saving > 0 && shouldDowngrade({ saving, rewrite, turnsLeft })) {
    return fresh(`hạ xuống ${describePick(wanted)}: tiết kiệm khoảng $${(saving * turnsLeft).toFixed(3)}, bù được chi phí ghi lại cache`)
  }
  const reason = `giữ ${describePick(current)}: hạ xuống ${describePick(wanted)} chưa đủ lợi, ghi lại cache khoảng $${rewrite.toFixed(3)}`
  return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
}

/** Bỏ dấu tiếng Việt và hạ chữ thường. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Mã đầu dòng của một việc có mã ("K4.1", "2.3", "3." ), viết thường; rỗng nếu không có.
 * Số trần phải có dấu chấm, hai chấm hoặc ngoặc theo sau, để "3 file controller" không phải mã.
 */
function taskCode(text: string): string {
  return fold(text).match(/^\s*([a-z]{1,3}\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+(?=[.:)]))/)?.[1] ?? ''
}

/**
 * Việc đã phân mà một lời gọi Agent đang làm, chỉ theo cấu trúc: description mở đầu bằng
 * "Việc N" (hoặc "Task N"; không nhận "Bước N" vì dễ trùng số bước của checklist), hoặc
 * cùng mã mục với tên việc (so nguyên mã, để K4.1 không khớp K4.10). Không đoán theo ý.
 */
export function matchTask(tasks: readonly Task[], description: string): Task | undefined {
  const numbered = fold(description).match(/^\s*(?:viec|task)\s*#?\s*(\d+)\b/)
  if (numbered) {
    const hit = tasks.find(t => t.index === Number(numbered[1]))
    if (hit) return hit
  }
  const code = taskCode(description)
  return code ? tasks.find(t => taskCode(t.title) === code) : undefined
}
