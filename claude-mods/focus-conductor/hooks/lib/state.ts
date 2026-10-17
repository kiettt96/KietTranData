// Trạng thái phiên của mod trong $.state (sống qua hot-reload, band/pane tự
// vẽ lại khi đổi). File này không gọi $ và không khai báo atom (engine chỉ
// quét atom trong module hooks): nó chứa giá trị khởi tạo và reducer thuần,
// hook áp chúng bằng update($, coreState, reducer) ngay tại chỗ.
// Mọi reducer đi qua normalizeCore, nên trạng thái lưu từ bản cũ (0.1.x) vẫn đọc được.

import type { PluginOptions } from 'claude-code'

import type { AgentProgress, AgentState, ArchivedGoal, Brief, Core, QuotaState, DelegationItem, MirrorStep, Ledger, Lift, ModelFamily, Mode, PlanStep, Route, RouteEvent, Warning } from '../../types'
import { restorableSteps } from './drift'
import type { Tokens } from './cost'
import { addUsage, emptyLedger, nextGoal, planSwitch, resetLedger } from './ledger'
import { legacyOf } from './scale'
import { statusLine, withQuotaStatus } from './text'
import { shownPlan } from './mirror'
import { evaluateQuota, isPauseActive, overrideOf, quotaBadge } from './quota'
import type { QuotaSettings } from './quota'
import type { Lang } from '../ui/labels'

export const EMPTY_LIFT: Lift = { depth: 0, effort: 0 }
export const EMPTY_CORE: Core = {
  brief: null,
  plan: [],
  route: null,
  warnings: [],
  log: [],
  ledger: emptyLedger(0),
  lift: EMPTY_LIFT,
  lastTurnAt: 0,
  lastContext: 0,
  sysTokens: 0,
  archived: [],
  delegations: { goalId: -1, items: [] },
  mirror: { goalId: -1, steps: [] },
  agentProgress: { goalId: -1, items: [] },
  activity: { goalId: -1, changes: 0 },
}

const LOG_LIMIT = 60
/** Số mục tiêu cũ còn bước mở được lưu để khôi phục. */
export const ARCHIVE_LIMIT = 3
const WARNING_LIMIT = 30
/** Nâng cấp theo bằng chứng tối đa hai bậc mỗi mục tiêu (depth và effort riêng). */
const LIFT_LIMIT = 2

/** Ảnh chụp mọi thứ band, pane và status line cần, đọc một lần. */
export type View = { core: Core; mode: Mode; isBandHidden: boolean; lang: Lang }

export function isMode(value: unknown): value is Mode {
  return value === 'auto' || value === 'subagents' || value === 'suggest' || value === 'off'
}

/** Chế độ có hiệu lực: ghi đè lúc chạy nếu có, nếu không thì theo cấu hình. */
export function modeOf(override: Mode | null, options: PluginOptions): Mode {
  if (override !== null) return override
  const configured = options['routing']
  return isMode(configured) ? configured : 'auto'
}

/** Nội dung status line; undefined để xóa khi mod tắt. */
export function statusOf(view: View): string | undefined {
  if (view.mode === 'off') return undefined
  return statusLine(view.core.brief, shownPlan(view.core).plan, view.core.route, view.mode)
}

/**
 * Status line của mọi hook: dòng của mod kèm nhãn hạn mức theo số đo đã lưu trong $.state (đang dừng, hay phần còn lại
 * khi gần ngưỡng). Chưa có mục tiêu thì dòng của mod là tên chế độ, nhãn vẫn đi kèm. statusOf chỉ trả undefined khi
 * mode off, lúc đó bảo vệ hạn mức không chạy nên không có nhãn. Tắt quotaGuard thì như statusOf.
 */
export function statusText(view: View, quota: QuotaState, now: number, settings: QuotaSettings): string | undefined {
  const base = statusOf(view)
  if (!settings.enabled) return base
  const evaluation = evaluateQuota(quota.readings, now, settings)
  return withQuotaStatus(base, quotaBadge(isPauseActive(true, evaluation.hits, quota.pause, overrideOf(quota), now), evaluation), view.lang)
}

/** Đưa trạng thái đọc được từ bản cũ về dạng đầy đủ của bản hiện tại. */
export function normalizeCore(raw: Partial<Core>): Core {
  const brief = raw.brief ? normalizeBrief(raw.brief) : null
  return {
    brief,
    plan: raw.plan ?? [],
    route: raw.route ?? null,
    warnings: raw.warnings ?? [],
    log: raw.log ?? [],
    ledger: raw.ledger ?? emptyLedger(brief?.goalId ?? 0),
    lift: raw.lift ?? EMPTY_LIFT,
    lastTurnAt: raw.lastTurnAt ?? 0,
    lastContext: raw.lastContext ?? 0,
    sysTokens: raw.sysTokens ?? 0,
    archived: raw.archived ?? [],
    delegations: raw.delegations ?? { goalId: -1, items: [] },
    mirror: raw.mirror ?? { goalId: -1, steps: [] },
    agentProgress: raw.agentProgress ?? { goalId: -1, items: [] },
    activity: raw.activity ?? { goalId: -1, changes: 0 },
  }
}

/** Brief lưu từ bản cũ, có thể thiếu trường của bản hiện tại hoặc còn trường đã bỏ. */
type StoredBrief = Partial<Brief> & Pick<Brief, 'goalId' | 'goal'> & { attached?: unknown; source?: string }

/**
 * Brief từ bản cũ (0.1.x chỉ có tier; 0.3.x đọc bằng heuristic): suy ra depth và volume tương
 * đương, không có lựa chọn của router (main null: mod không ép tới khi router đọc prompt sau).
 */
function normalizeBrief(raw: Brief): Brief {
  const brief = raw as StoredBrief
  const tier = brief.tier ?? 'moderate'
  const legacy = legacyOf(tier)
  return {
    goalId: brief.goalId,
    goal: brief.goal,
    steps: brief.steps ?? [],
    tasks: brief.tasks ?? [],
    constraints: brief.constraints ?? [],
    quality: brief.quality ?? [],
    depth: brief.depth ?? legacy.depth,
    volume: brief.volume ?? legacy.volume,
    kind: brief.kind ?? 'mixed',
    tier,
    main: brief.main ?? null,
    ...(brief.referenceMain ? { referenceMain: brief.referenceMain } : {}),
    why: brief.why ?? '',
    relation: brief.relation ?? 'new',
    source: brief.source === 'router' ? 'router' : 'none',
    isFollowUp: brief.isFollowUp ?? false,
    isReference: brief.isReference ?? brief.attached !== undefined,
    scopePaths: brief.scopePaths ?? [],
    prompt: brief.prompt ?? '',
    at: brief.at ?? 0,
  }
}

/**
 * Claude chốt lại mục tiêu và các bước qua tool plan: thay câu mục tiêu và danh sách bước
 * (bước dài bị cắt). Việc đã phân và lựa chọn của router giữ nguyên.
 */
export function retarget(brief: Brief, goal: string | undefined, steps: readonly string[], scope?: readonly string[]): Brief {
  const nextGoal = goal?.trim() ? goal.trim().slice(0, 200) : brief.goal
  const nextSteps = steps.length > 0 ? steps.map(s => s.slice(0, 120)) : brief.steps
  // Phạm vi chỉ đổi khi Claude ghi rõ (mảng rỗng là bỏ giới hạn); không ghi thì giữ phạm vi router đọc.
  return { ...brief, goal: nextGoal, steps: nextSteps, ...(scope !== undefined ? { scopePaths: [...scope] } : {}) }
}

/** Lưu mục tiêu hiện tại nếu checklist còn bước mở hoặc đang chờ; mới nhất trước. */
function archiveOf(n: Core): ArchivedGoal[] {
  if (n.brief === null || restorableSteps(n.plan).length === 0) return n.archived
  return [{ brief: n.brief, plan: n.plan }, ...n.archived.filter(a => a.brief.goalId !== n.brief?.goalId)].slice(0, ARCHIVE_LIMIT)
}

/**
 * Khôi phục mục tiêu đã lưu thứ `index` (1 là gần nhất): brief và checklist của nó thay mục tiêu hiện tại,
 * mục tiêu hiện tại được lưu nếu còn bước mở. Sổ chi phí theo mục tiêu, cảnh báo và nâng cấp bắt đầu lại.
 */
export function restoreArchived(c: Core, index: number): { core: Core; restored: ArchivedGoal } | { error: string } {
  const n = normalizeCore(c)
  const restored = n.archived[index - 1]
  if (n.archived.length === 0) return { error: 'Không có mục tiêu cũ nào đang được lưu để khôi phục.' }
  if (restored === undefined) return { error: `Chỉ có ${n.archived.length} mục tiêu đã lưu; index từ 1 (gần nhất) tới ${n.archived.length}.` }
  const rest = n.archived.filter((_, i) => i !== index - 1)
  const archived = archiveOf({ ...n, archived: rest })
  // Số mục tiêu mới, lớn hơn mọi số đã dùng: số mục tiêu tăng dần, việc giao và route của mục tiêu khác không bị nhận nhầm.
  const goalId = Math.max(n.brief?.goalId ?? 0, ...n.archived.map(a => a.brief.goalId)) + 1
  const brief: Brief = { ...restored.brief, goalId }
  const core: Core = {
    ...n,
    brief,
    plan: restored.plan,
    warnings: [],
    lift: EMPTY_LIFT,
    ledger: nextGoal(n.ledger, goalId),
    archived,
    mirror: { goalId, steps: [] },
    ...freshProgress(goalId),
  }
  return { core, restored: { brief, plan: restored.plan } }
}

// ------------------------------------------------------------ reducers

/**
 * Mục tiêu mới: thay brief, xóa checklist, cảnh báo và nâng cấp của mục tiêu cũ; sổ theo mục tiêu được làm mới.
 * Checklist cũ còn bước mở được lưu (archived), khôi phục được bằng plan action "restore".
 */
export const adoptGoal =
  (brief: Brief) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return { ...n, brief, plan: [], warnings: [], lift: EMPTY_LIFT, ledger: nextGoal(n.ledger, brief.goalId), archived: archiveOf(n), mirror: { goalId: brief.goalId, steps: [] }, ...freshProgress(brief.goalId) }
  }

export const withBrief =
  (brief: Brief) =>
  (c: Core): Core => ({ ...normalizeCore(c), brief })

/**
 * Router quyết lại cho prompt tiếp nối: thay brief và xóa nâng cấp theo bằng chứng, vì router
 * đã thấy model luồng chính thật sự chạy và tự nâng khi người dùng báo chưa đạt (không nâng hai lần).
 */
export const withDecision =
  (brief: Brief) =>
  (c: Core): Core => ({ ...normalizeCore(c), brief, lift: EMPTY_LIFT })

/** Claude chốt lại mục tiêu/các bước qua tool plan (action "set"): xem retarget. */
export const withRetarget =
  (goal: string | undefined, steps: readonly string[], scope?: readonly string[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return n.brief ? { ...n, brief: retarget(n.brief, goal, steps, scope) } : n
  }

export const withPlan =
  (plan: PlanStep[]) =>
  (c: Core): Core => ({ ...normalizeCore(c), plan })

export const withRoute =
  (route: Route | null) =>
  (c: Core): Core => ({ ...normalizeCore(c), route })

export const withLog =
  (...entries: RouteEvent[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return { ...n, log: [...n.log, ...entries].slice(-LOG_LIMIT) }
  }

/** Gắn chi phí đo được vào dòng nhật ký của subagent (dòng gần nhất có agentId đó). */
export const withAgentUsd =
  (agentId: string, usd: number) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    const at = n.log.map(entry => entry.agentId).lastIndexOf(agentId)
    if (at < 0) return n
    // Số đo thay thế ước lượng lúc giao việc; các lượt đo sau của cùng agent được cộng dồn.
    const log = n.log.map((entry, i) =>
      i === at ? { ...entry, usd: entry.measured ? (entry.usd ?? 0) + usd : usd, measured: true } : entry,
    )
    return { ...n, log }
  }

/** Thêm cảnh báo; bỏ qua nếu trùng loại và nội dung với cảnh báo cuối. */
export const withWarnings =
  (...entries: Warning[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    let list = n.warnings
    for (const entry of entries) {
      const last = list[list.length - 1]
      if (last && last.kind === entry.kind && last.text === entry.text) continue
      list = [...list, entry]
    }
    return list === n.warnings ? n : { ...n, warnings: list.slice(-WARNING_LIMIT) }
  }

/** Nâng cấp theo bằng chứng cho các turn sau của mục tiêu hiện tại. */
export const withLift =
  (depthBy: number, effortBy: number) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    const lift = {
      depth: Math.min(LIFT_LIMIT, n.lift.depth + depthBy),
      effort: Math.min(LIFT_LIMIT, n.lift.effort + effortBy),
    }
    return { ...n, lift }
  }

/** Cộng usage của các lượt router (đọc prompt, chấm subagent, kiểm lạc đề) vào nhóm analyzer của sổ, theo giá của model router. */
export const withAnalyzerUsage =
  (usages: readonly Tokens[], family: ModelFamily) =>
  (c: Core): Core =>
    usages.reduce((acc, usage) => withLedger(ledger => addUsage(ledger, 'analyzer', family, usage).ledger)(acc), c)

/** Đầu turn luồng chính: ghi model của phiên và của lượt mod phục vụ vào cơ sở so với chạy thuần (xem planSwitch). */
export const withBaseline =
  (args: Omit<Parameters<typeof planSwitch>[1], 'sysTokens'>) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return { ...n, ledger: planSwitch(n.ledger, { ...args, sysTokens: n.sysTokens }) }
  }

/** Đổi sổ chi phí bằng một hàm thuần. */
export const withLedger =
  (change: (ledger: Ledger) => Ledger) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return { ...n, ledger: change(n.ledger) }
  }

/** Đánh dấu một turn luồng chính: thời điểm kết thúc và số token ngữ cảnh lúc bắt đầu. */
export const withTurnMark =
  (at: number, context: number) =>
  (c: Core): Core => ({ ...normalizeCore(c), lastTurnAt: at, lastContext: context })

/** Phần cố định của ngữ cảnh đo được ở đầu phiên. */
export const withSysTokens =
  (tokens: number) =>
  (c: Core): Core => ({ ...normalizeCore(c), sysTokens: tokens })

/** Xóa mục tiêu, checklist, route, cảnh báo và nâng cấp; giữ nhật ký, hệ số hiệu chỉnh và phần cố định đã đo. */
export const resetCore = (c: Core): Core => {
  const n = normalizeCore(c)
  return { ...EMPTY_CORE, log: n.log, ledger: resetLedger(n.ledger), sysTokens: n.sysTokens }
}

/** Ghi trạng thái các việc giao subagent của một mục tiêu (bản sao để pane và status đọc). */
export function withDelegations(goalId: number, items: readonly DelegationItem[]): (core: Core) => Core {
  return core => ({ ...normalizeCore(core), delegations: { goalId, items: [...items] } })
}

/** Ghi danh sách việc phản chiếu của luồng chính cho mục tiêu goalId (xem lib/mirror.ts). */
export function withMirror(goalId: number, steps: readonly MirrorStep[]): (core: Core) => Core {
  return core => ({ ...normalizeCore(core), mirror: { goalId, steps: [...steps] } })
}

/** Số dòng tiến độ của agent giữ lại cho một mục tiêu. */
export const AGENT_PROGRESS_LIMIT = 20

/** Tiến độ agent và số thay đổi bắt đầu lại ở mục tiêu mới. */
function freshProgress(goalId: number): Pick<Core, 'agentProgress' | 'activity'> {
  return { agentProgress: { goalId, items: [] }, activity: { goalId, changes: 0 } }
}

/** Một lần gọi Agent bắt đầu chạy: thêm dòng tiến độ (thay dòng cũ cùng agentId), giữ tối đa AGENT_PROGRESS_LIMIT dòng. */
export function withAgentStart(goalId: number, item: AgentProgress): (core: Core) => Core {
  return core => {
    const n = normalizeCore(core)
    const items = n.agentProgress.goalId === goalId ? n.agentProgress.items.filter(i => i.agentId !== item.agentId) : []
    return { ...n, agentProgress: { goalId, items: [...items, item].slice(-AGENT_PROGRESS_LIMIT) } }
  }
}

/** Đổi dòng tiến độ của agentId (không có thì giữ nguyên). */
function withAgent(agentId: string, change: (item: AgentProgress) => AgentProgress): (core: Core) => Core {
  return core => {
    const n = normalizeCore(core)
    if (!n.agentProgress.items.some(i => i.agentId === agentId)) return n
    return { ...n, agentProgress: { ...n.agentProgress, items: n.agentProgress.items.map(i => (i.agentId === agentId ? change(i) : i)) } }
  }
}

/** Agent chạy thêm một tool call. */
export const withAgentTool = (agentId: string) => withAgent(agentId, item => ({ ...item, tools: item.tools + 1 }))

/** Agent kết thúc: xong, lỗi, hoặc bị cắt vì tạm dừng. */
export const withAgentEnd = (agentId: string, state: Exclude<AgentState, 'running'>, at: number) =>
  withAgent(agentId, item => ({ ...item, state, endedAt: at }))

/** Danh sách việc agent tự ghi (phản chiếu). */
export const withAgentSteps = (agentId: string, steps: readonly MirrorStep[]) => withAgent(agentId, item => ({ ...item, steps: [...steps] }))

/** Luồng chính vừa thay đổi file trong mục tiêu goalId. */
export function withActivity(goalId: number): (core: Core) => Core {
  return core => {
    const n = normalizeCore(core)
    return { ...n, activity: { goalId, changes: (n.activity.goalId === goalId ? n.activity.changes : 0) + 1 } }
  }
}
