// Điều phối model / effort / agent theo độ phức tạp.
//
// Nguyên tắc chi phí (giá mỗi 1M token input/output, Claude API, 2026-10):
//   Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 $10/$50.
// Prompt cache gắn với từng model, và đổi effort giữa hội thoại cũng làm mất
// cache phần messages. Vì vậy:
//   - Luồng chính: chốt model + effort một lần ở step đầu của mỗi turn và giữ
//     nguyên cho mọi step trong turn. Giữa các turn chỉ đổi khi hội thoại còn
//     ngắn, khi bắt đầu mục tiêu mới, hoặc khi cần nâng cấp (việc khó hơn).
//     Hạ cấp giữa chừng một mục tiêu dài bị giữ lại (hysteresis).
//   - Subagent: mỗi subagent là một hội thoại mới, không có cache để mất, nên
//     đây là nơi điều phối tiết kiệm nhất; chọn theo độ khó của từng nhiệm vụ.

import type { PluginOptions } from 'claude-code'

import type { Effort, ModelFamily, Route, Tier } from '../../types'
import { fold, scoreComplexity, tierFromScore, tierRank } from './analyze'

export const FAMILIES: readonly ModelFamily[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export type Choice = { family: ModelFamily; effort: Effort }
type Policy = { main: Choice; agent: Choice; toolBudget: number }

/** Bảng chính sách theo tier: model luồng chính, model subagent, ngân sách tool call. */
export const POLICY: Record<Tier, Policy> = {
  trivial: { main: { family: 'haiku', effort: 'low' }, agent: { family: 'haiku', effort: 'low' }, toolBudget: 8 },
  simple: { main: { family: 'sonnet', effort: 'low' }, agent: { family: 'haiku', effort: 'low' }, toolBudget: 15 },
  moderate: {
    main: { family: 'sonnet', effort: 'medium' },
    agent: { family: 'sonnet', effort: 'low' },
    toolBudget: 30,
  },
  complex: { main: { family: 'opus', effort: 'high' }, agent: { family: 'sonnet', effort: 'medium' }, toolBudget: 60 },
  deep: { main: { family: 'opus', effort: 'xhigh' }, agent: { family: 'opus', effort: 'medium' }, toolBudget: 100 },
}

const DEFAULT_IDS: Record<ModelFamily, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

/** Hội thoại ngắn hơn ngưỡng này thì đổi model gần như không mất gì về cache. */
export const SMALL_PREFIX_MESSAGES = 6

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

/** Lựa chọn mong muốn cho luồng chính, có tính cấu hình Fable và họ model bị chặn. */
export function wantedMain(tier: Tier, options: PluginOptions, blocked: ReadonlySet<ModelFamily>): Choice {
  const base = tier === 'deep' && options['allowFable'] === true
    ? { family: 'fable' as const, effort: 'high' as const }
    : POLICY[tier].main
  return avoidBlocked(base, blocked)
}

/** Họ model bị chặn (lỗi API trước đó) thì lùi về họ thấp hơn gần nhất. */
export function avoidBlocked(pick: Choice, blocked: ReadonlySet<ModelFamily>): Choice {
  if (!blocked.has(pick.family)) return pick
  for (let rank = familyRank(pick.family) - 1; rank >= 0; rank--) {
    const family = FAMILIES[rank]
    if (family && !blocked.has(family)) return { family, effort: pick.effort }
  }
  for (let rank = familyRank(pick.family) + 1; rank < FAMILIES.length; rank++) {
    const family = FAMILIES[rank]
    if (family && !blocked.has(family)) return { family, effort: pick.effort }
  }
  return pick
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
 * Quyết định model + effort của luồng chính cho một turn, có tính chi phí cache.
 */
export function decideMain(args: {
  current: Route | null
  wanted: Choice
  tier: Tier
  goalId: number
  messageCount: number
  isNewGoal: boolean
}): MainDecision {
  const { current, wanted, tier, goalId, messageCount, isNewGoal } = args
  const fresh = (reason: string): MainDecision => ({
    route: { ...wanted, tier, goalId, reason },
    isChanged: current === null || current.family !== wanted.family || current.effort !== wanted.effort,
    isHeld: false,
    wanted,
    reason,
  })

  if (current === null) return fresh('turn đầu tiên của phiên')
  if (current.family === wanted.family && current.effort === wanted.effort) {
    return { ...fresh('giữ nguyên, đúng mức cần'), isChanged: false }
  }
  if (messageCount <= SMALL_PREFIX_MESSAGES) return fresh('hội thoại còn ngắn, đổi model gần như không mất cache')
  if (isNewGoal) return fresh('mục tiêu mới, chi phí ghi lại cache được chia đều cho cả task')
  if (pickRank(wanted) > pickRank(current)) return fresh(`việc khó hơn (${tier}), nâng cấp`)

  const reason = `giữ ${describePick(current)}; hạ xuống ${describePick(wanted)} giữa chừng sẽ ghi lại toàn bộ cache`
  return {
    route: { ...current, tier, goalId, reason },
    isChanged: false,
    isHeld: true,
    wanted,
    reason,
  }
}

const READ_ONLY =
  /\b(tim|search|find|locate|grep|liet ke|list|doc|read|explore|kham pha|tra cuu|look up|scan|quet|where|o dau|summari[sz]e|tom tat|report)\b/
const WRITES =
  /\b(sua|edit|write|viet|tao|create|implement|trien khai|fix|refactor|xoa|delete|remove|update|cap nhat|commit|push|install|cai dat|migrate|apply|ap dung)\b/

/** Nhiệm vụ chỉ đọc: có động từ tra cứu và không có động từ ghi. */
export function isReadOnlyTask(text: string): boolean {
  const folded = fold(text)
  return READ_ONLY.test(folded) && !WRITES.test(folded)
}

export type AgentPlan = Choice & {
  tier: Tier
  /** Loại agent đề xuất thay thế, nếu có. */
  agentType?: string
  reason: string
}

/**
 * Chọn model, effort và (khi chắc chắn) loại agent cho một subagent.
 * Prompt giao việc thường dài và chi tiết hơn prompt người dùng, nên điểm độ
 * dài bị giảm một nửa để không thổi phồng tier.
 */
export function planAgent(args: {
  prompt: string
  description: string
  subagentType: string | undefined
  offered: ReadonlySet<string>
  blocked: ReadonlySet<ModelFamily>
}): AgentPlan {
  const text = `${args.description}\n${args.prompt}`
  const { score } = scoreComplexity(text, { isDelegated: true })
  let tier = tierFromScore(score)
  const type = args.subagentType ?? 'general-purpose'
  const isReadOnly = isReadOnlyTask(text)
  if (isReadOnly && tierRank(tier) > tierRank('moderate')) tier = 'moderate'

  let pick: Choice = POLICY[tier].agent
  let agentType: string | undefined
  let reason = `nhiệm vụ ${tier}`

  if (type === 'Explore' || (type === 'general-purpose' && isReadOnly)) {
    pick = tierRank(tier) >= tierRank('moderate') ? { family: 'sonnet', effort: 'low' } : { family: 'haiku', effort: 'low' }
    reason = `tra cứu chỉ đọc (${tier})`
    if (type === 'general-purpose' && args.offered.has('Explore')) {
      agentType = 'Explore'
      reason = `tra cứu chỉ đọc (${tier}), chuyển sang Explore`
    }
  } else if (type === 'Plan') {
    pick = tierRank(tier) >= tierRank('complex')
      ? { family: 'opus', effort: tier === 'deep' ? 'high' : 'medium' }
      : { family: 'sonnet', effort: 'medium' }
    reason = `lập kế hoạch (${tier})`
  }

  return { ...avoidBlocked(pick, args.blocked), tier, agentType, reason }
}

/** Gợi ý ngắn cho một bước trong checklist: model luồng chính và cách giao việc. */
export function stepHint(tier: Tier): string {
  const main = POLICY[tier].main
  const agent = POLICY[tier].agent
  return `${describePick(main)}; nếu giao subagent: ${describePick(agent)}`
}
