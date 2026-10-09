// Điều phối model / effort / agent theo bản chất việc.
//
// Nguyên tắc (giá Claude API 2026-10, xem cost.ts):
//   - Model theo độ sâu: none → haiku; light → sonnet; substantial → opus;
//     hard → opus (fable nếu bật allowFable). Việc sửa code không bao giờ haiku.
//   - Effort theo khối lượng và bản chất việc, không dùng max mặc định.
//   - Luồng chính: chốt model + effort một lần ở step đầu của mỗi turn, giữ cho
//     mọi step trong turn. Đổi giữa turn chỉ khi lợi ích trong các turn còn lại
//     vượt chi phí ghi lại cache, hoặc khi nâng cấp vì chất lượng.
//   - Subagent: hội thoại riêng, không có cache của luồng chính để mất. Việc con
//     sửa hoặc điều tra không thấp hơn một bậc so với mục tiêu cha.

import type { PluginOptions } from 'claude-code'

import type { Depth, Effort, Kind, ModelFamily, Route, Subtask, Tier, Volume } from '../../types'
import { assessText, coverage, fold, isPureLookup, isSameIdea, isSynthesis, tokenCount } from './analyze'
import { SAFETY, shouldDowngrade, switchCost, turnCost } from './cost'
import { depthRank, legacyOf, maxDepth, stepDepth, tierOf } from './scale'

export const FAMILIES: readonly ModelFamily[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export type Choice = { family: ModelFamily; effort: Effort }

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
  const folded = fold(model)
  return FAMILIES.find(family => folded.includes(family)) ?? null
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

/** Model theo độ sâu. Việc sửa hoặc hỗn hợp không bao giờ xuống haiku. */
export function familyFor(depth: Depth, kind: Kind, allowFable: boolean): ModelFamily {
  if (depth === 'hard') return allowFable ? 'fable' : 'opus'
  if (depth === 'substantial') return 'opus'
  if (depth === 'light') return 'sonnet'
  return kind === 'edit' || kind === 'mixed' ? 'sonnet' : 'haiku'
}

/**
 * Effort theo model, khối lượng và bản chất việc. Haiku luôn low. Sonnet cho
 * trả lời ở low, sửa ở medium, điều tra khối lượng lớn ở high. Opus substantial
 * sửa hoặc việc lớn ở high, còn lại medium; opus hard ở high khi việc nhỏ, xhigh
 * khi vừa hoặc lớn.
 */
export function effortFor(family: ModelFamily, depth: Depth, volume: Volume, kind: Kind): Effort {
  if (family === 'haiku') return 'low'
  if (family === 'sonnet') {
    if (kind === 'answer') return 'low'
    if (kind === 'investigate') return volume === 'large' ? 'high' : 'medium'
    return 'medium'
  }
  if (family === 'fable') return 'high'
  if (depth === 'substantial') return volume === 'large' || kind === 'edit' || kind === 'mixed' ? 'high' : 'medium'
  return volume === 'small' ? 'high' : 'xhigh'
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

/** Model luồng chính mong muốn cho một việc, có nâng theo bằng chứng và chính sách model phiên. */
export function chooseMain(args: {
  depth: Depth
  volume: Volume
  kind: Kind
  allowFable: boolean
  depthLift?: number
  effortLift?: number
  blocked?: ReadonlySet<ModelFamily>
  session?: SessionModel | null
}): Choice & { capped: boolean } {
  const depth = stepDepth(args.depth, args.depthLift ?? 0)
  const natural = familyFor(depth, args.kind, args.allowFable)
  const family = applySession(natural, args.session ?? null)
  const effort = bumpEffort(effortFor(family, depth, args.volume, args.kind), args.effortLift ?? 0)
  const pick = avoidBlocked({ family, effort }, args.blocked ?? new Set(), args)
  return { ...pick, capped: family !== natural }
}

/** Chọn model luồng chính mong muốn cho một brief (đã có depth, volume, kind). */
export function wantedMain(
  brief: { depth: Depth; volume: Volume; kind: Kind },
  lift: { depth: number; effort: number },
  options: PluginOptions,
  blocked: ReadonlySet<ModelFamily>,
  session: SessionModel | null,
): Choice & { capped: boolean } {
  return chooseMain({
    depth: brief.depth,
    volume: brief.volume,
    kind: brief.kind,
    allowFable: options['allowFable'] === true,
    depthLift: lift.depth,
    effortLift: lift.effort,
    blocked,
    session,
  })
}

/** Một bậc cao hơn cho việc đã thất bại: họ model lên một bậc (fable chỉ khi được phép) và effort lên một bậc. */
export function raisePick(pick: Choice, allowFable: boolean): Choice {
  const up = pick.family === 'opus' && !allowFable ? 'opus' : FAMILIES[Math.min(FAMILIES.length - 1, familyRank(pick.family) + 1)]
  return { family: up ?? pick.family, effort: bumpEffort(pick.effort, 1) }
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

export type AgentPlan = Choice & {
  depth: Depth
  volume: Volume
  kind: Kind
  tier: Tier
  hardSignals: string[]
  /** Loại agent đề xuất thay thế, nếu có. */
  agentType?: string
  reason: string
}

/**
 * Chọn model, effort và (khi chắc chắn) loại agent cho một subagent. Tra cứu chỉ
 * đọc được xuống haiku. Việc sửa hoặc điều tra không thấp hơn một bậc so với
 * độ sâu của mục tiêu cha.
 */
export function planAgent(args: {
  prompt: string
  description: string
  subagentType: string | undefined
  offered: ReadonlySet<string>
  blocked: ReadonlySet<ModelFamily>
  allowFable: boolean
  parent: { depth: Depth } | null
  session: SessionModel | null
  /** Đánh giá đã có sẵn của việc (từ việc đã tách lúc nhận prompt): thay cho đánh giá prompt của agent. */
  assessed?: Pick<Subtask, 'depth' | 'volume' | 'kind' | 'hardSignals'> & { title?: string }
}): AgentPlan {
  const local = args.assessed ?? assessText(`${args.description}\n${args.prompt}`, { isDelegated: true })
  const type = args.subagentType ?? 'general-purpose'
  const isReadOnly = local.kind === 'answer' || local.kind === 'investigate'
  // Chỉ tra cứu thuần (tìm, liệt kê, đọc) mới xuống haiku; rà soát, kiểm tra, gỡ lỗi thì không.
  const text = args.assessed?.title ?? `${args.description}\n${args.prompt}`
  const isLookup =
    type === 'Explore' ||
    (type === 'general-purpose' && isReadOnly && local.hardSignals.length === 0 && isPureLookup(text))

  if (isLookup) {
    const light = local.depth === 'none' || local.depth === 'light'
    // Kể cả khi Claude chọn Explore: việc có phân tích (rà soát, gỡ lỗi) không xuống haiku.
    const natural: ModelFamily = light && local.volume !== 'large' && isPureLookup(text) ? 'haiku' : 'sonnet'
    const family = applySession(natural, args.session)
    const pick = avoidBlocked({ family, effort: 'low' }, args.blocked, { kind: local.kind, allowFable: args.allowFable })
    const canExplore = type === 'general-purpose' && args.offered.has('Explore')
    return {
      ...pick,
      depth: local.depth,
      volume: local.volume,
      kind: local.kind,
      tier: tierOf(local.depth, local.volume),
      hardSignals: local.hardSignals,
      agentType: canExplore ? 'Explore' : undefined,
      reason: `tra cứu chỉ đọc (${tierOf(local.depth, local.volume)})${canExplore ? ', chuyển sang Explore' : ''}${family !== natural ? ', theo model của phiên' : ''}`,
    }
  }

  const floor = args.parent ? stepDepth(args.parent.depth, -1) : local.depth
  const depth = maxDepth(local.depth, floor)
  const planned = type === 'Plan' ? maxDepth(depth, 'light') : depth
  const choice = chooseMain({
    depth: planned,
    volume: local.volume,
    kind: type === 'Plan' ? 'answer' : local.kind,
    allowFable: args.allowFable,
    blocked: args.blocked,
    session: args.session,
  })
  const isRaised = depthRank(depth) > depthRank(local.depth)
  return {
    family: choice.family,
    effort: choice.effort,
    depth: planned,
    volume: local.volume,
    kind: local.kind,
    tier: tierOf(planned, local.volume),
    hardSignals: local.hardSignals,
    reason: isRaised
      ? `nâng theo mục tiêu cha (${args.parent?.depth}), việc ${local.depth}`
      : `nhiệm vụ ${planned}`,
  }
}

/** Số việc con từ đó mới đáng tách và giao: với ít việc, chi phí khởi động subagent lớn hơn phần tiết kiệm. */
export const MIN_DELEGATE = 3

export type SubtaskAdvice = {
  subtask: Subtask
  /** Model và effort đã ghi sẵn cho việc này. */
  pick: Choice
  /** Làm trực tiếp ở luồng chính (cùng họ model với luồng chính), hay giao subagent. */
  direct: boolean
  /** Loại agent khi giao: Explore cho tra cứu chỉ đọc, nếu không thì general-purpose. */
  subagentType?: string
}

/**
 * Chấm model và effort cho từng việc đã tách, trước khi làm. Mỗi việc dùng đánh giá
 * riêng của nó, không kế thừa độ sâu của cả mục tiêu. Việc cùng họ model với luồng
 * chính thì làm trực tiếp; khác họ thì giao subagent đúng model đã ghi.
 */
export function adviseSubtasks(args: {
  subtasks: readonly Subtask[]
  main: Choice
  allowFable: boolean
  blocked: ReadonlySet<ModelFamily>
  offered: ReadonlySet<string>
  session: SessionModel | null
}): SubtaskAdvice[] {
  if (args.subtasks.length < MIN_DELEGATE) return []
  return args.subtasks.map(subtask => {
    const plan = planAgent({
      prompt: subtask.title,
      description: subtask.title,
      subagentType: undefined,
      offered: args.offered,
      blocked: args.blocked,
      allowFable: args.allowFable,
      parent: null,
      session: args.session,
      assessed: subtask,
    })
    return {
      subtask,
      pick: { family: plan.family, effort: plan.effort },
      // Tổng hợp, báo cáo kết quả là việc của luồng chính.
      direct: plan.family === args.main.family || isSynthesis(subtask.title),
      subagentType: plan.agentType,
    }
  })
}

/**
 * Mã đầu dòng của một việc có mã ("K4.1", "2.3", "3." ), viết thường; rỗng nếu không có.
 * Số trần phải có dấu chấm, hai chấm hoặc ngoặc theo sau, để "3 file controller" không phải mã.
 */
function taskCode(text: string): string {
  return fold(text).match(/^\s*([a-z]{1,3}\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+(?=[.:)]))/)?.[1] ?? ''
}

/**
 * Việc đã tách mà một lời gọi Agent đang làm, theo thứ tự tin cậy: description mở
 * đầu bằng "Việc N" (hoặc "Task N"; không nhận "Bước N" vì dễ trùng số bước của checklist); description cùng ý với tên việc;
 * prompt của agent chứa phần lớn từ của tên việc.
 */
export function matchSubtask(subtasks: readonly Subtask[], description: string, prompt: string): Subtask | undefined {
  const numbered = fold(description).match(/^\s*(?:viec|task)\s*#?\s*(\d+)\b/)
  if (numbered) {
    const hit = subtasks.find(s => s.index === Number(numbered[1]))
    if (hit) return hit
  }
  // Mục có mã (K4.1): so nguyên mã, để K4.1 không khớp K4.10.
  const code = taskCode(description)
  if (code) {
    const hit = subtasks.find(s => taskCode(s.title) === code)
    if (hit) return hit
  }
  const same = subtasks.find(s => isSameIdea(s.title, description))
  if (same) return same
  let best: Subtask | undefined
  let bestCover = 0.8
  for (const s of subtasks) {
    if (tokenCount(s.title) < 3) continue
    const cover = coverage(s.title, prompt)
    if (cover >= bestCover) {
      best = s
      bestCover = cover
    }
  }
  return best
}

/** Gợi ý ngắn cho một bước trong checklist: model luồng chính và cách giao việc. */
export function stepHint(tier: Tier): string {
  const { depth, volume } = legacyOf(tier)
  const main = chooseMain({ depth, volume, kind: 'mixed', allowFable: false })
  return `${describePick(main)}; nếu giao subagent: theo độ khó của việc con`
}
