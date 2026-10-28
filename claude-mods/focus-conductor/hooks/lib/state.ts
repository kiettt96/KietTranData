// Trạng thái phiên của mod trong $.state (sống qua hot-reload, band/pane tự
// vẽ lại khi đổi). File này không gọi $ và không khai báo atom (engine chỉ
// quét atom trong module hooks): nó chứa giá trị khởi tạo và reducer thuần,
// hook áp chúng bằng update($, coreState, reducer) ngay tại chỗ.
// Mọi reducer đi qua normalizeCore, nên trạng thái lưu từ bản cũ (0.1.x) vẫn đọc được.

import type { PluginOptions } from 'claude-code'

import type { AgentProgress, AgentState, AgentTally, ArchivedGoal, Brief, CheckHint, Core, QuotaState, DelegationItem, MirrorStep, Ledger, Lift, ModelFamily, Mode, PlanStep, Route, RouteEvent, RouterFail, TurnFault, Warning } from '../../types'
import { restorableSteps } from './drift'
import type { Tokens } from './cost'
import { addUsage, emptyLedger, nextGoal, planSwitch, resetLedger } from './ledger'
import { legacyOf } from './scale'
import { statusLine, withQuotaNoticeStatus, withQuotaStatus, withRouterFailStatus, withTurnFaultStatus } from './text'
import { shownPlan } from './mirror'
import { evaluateQuota, isPauseActive, overrideOf, quotaBadge, softNotices } from './quota'
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
  routerFail: null,
  checkHint: null,
  turnFault: null,
  closing: { seq: 0, goalId: -1, lastPassSeq: null },
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
  // Thứ tự nhãn (0.7.3): hạn mức, lỗi router, turn lỗi.
  const evaluation = evaluateQuota(quota.readings, now, settings)
  const isPaused = isPauseActive(true, evaluation.hits, quota.pause, overrideOf(quota), now)
  // Vùng báo mềm (0.7.4) thay nhãn "hạn mức còn" khi chưa dừng; đang dừng thì chỉ nhãn dừng như cũ.
  const notices = isPaused ? [] : softNotices(quota.readings, now, settings)
  const quotaLabelled = !settings.enabled
    ? base
    : notices.length > 0
      ? withQuotaNoticeStatus(base, notices, view.lang)
      : withQuotaStatus(base, quotaBadge(isPaused, evaluation), view.lang)
  return withTurnFaultStatus(withRouterFailStatus(quotaLabelled, view.core.routerFail, view.lang), view.core.turnFault, view.lang)
}

/** Ghi (hoặc xóa, khi router đọc được lại) lần router lỗi gần nhất (0.7.2). */
export const withRouterFail =
  (fail: RouterFail | null) =>
  (c: Core): Core => ({ ...normalizeCore(c), routerFail: fail })

/** Ghi gợi ý khai checkCommands của mục tiêu (0.7.3). */
export const withCheckHint =
  (hint: CheckHint | null) =>
  (c: Core): Core => ({ ...normalizeCore(c), checkHint: hint })

/** Ghi (hoặc xóa) turn lỗi gần nhất của luồng chính (0.7.3). */
export const withTurnFault =
  (fault: TurnFault | null) =>
  (c: Core): Core => ({ ...normalizeCore(c), turnFault: fault })

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
    routerFail: raw.routerFail ?? null,
    checkHint: raw.checkHint ?? null,
    turnFault: raw.turnFault ?? null,
    closing: raw.closing ?? { seq: 0, goalId: -1, lastPassSeq: null },
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
    ...(brief.requirements !== undefined ? { requirements: brief.requirements } : {}),
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
    ...(brief.isBare === true ? { isBare: true } : {}),
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

/**
 * Brief tạm cho checklist còn bước mở mà mục tiêu chưa có brief (router lỗi hay tạm ngừng, Claude tự `plan set`): để lưu và khôi
 * phục được. Không có việc đã phân và không chọn model; khôi phục thì đánh số mục tiêu mới như mọi mục tiêu đã lưu.
 */
function stubBrief(plan: readonly PlanStep[]): Brief {
  const open = restorableSteps(plan)
  return {
    goalId: 0,
    goal: (open[0]?.title ?? 'Mục tiêu dở dang').slice(0, 200),
    steps: plan.map(s => s.title.slice(0, 120)),
    tasks: [],
    constraints: [],
    quality: [],
    depth: 'substantial',
    volume: 'medium',
    kind: 'mixed',
    tier: 'moderate',
    main: null,
    why: 'checklist chưa có brief (router lỗi hay tạm ngừng)',
    relation: 'new',
    source: 'none',
    isFollowUp: false,
    isReference: false,
    scopePaths: [],
    prompt: '',
    at: 0,
  }
}

/** Lưu mục tiêu hiện tại nếu checklist còn bước mở hoặc đang chờ (chưa có brief thì dùng brief tạm); mới nhất trước. */
function archiveOf(n: Core): ArchivedGoal[] {
  if (restorableSteps(n.plan).length === 0) return n.archived
  const brief = n.brief ?? stubBrief(n.plan)
  return [{ brief, plan: n.plan }, ...n.archived.filter(a => n.brief === null || a.brief.goalId !== n.brief.goalId)].slice(0, ARCHIVE_LIMIT)
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
    return { ...n, brief, plan: [], warnings: [], lift: EMPTY_LIFT, ledger: nextGoal(n.ledger, brief.goalId), archived: archiveOf(n), mirror: { goalId: brief.goalId, steps: [] }, ...freshProgress(brief.goalId), turnFault: null }
  }

export const withBrief =
  (brief: Brief) =>
  (c: Core): Core => ({ ...normalizeCore(c), brief })

/**
 * Router quyết lại cho prompt tiếp nối: thay brief. Nâng cấp theo bằng chứng (vòng lặp, chuỗi lỗi, vượt ngân sách) sống qua
 * continue và refine (0.7.0), giảm dần bằng withLiftDecay; chỉ bị xóa khi người dùng báo chưa đạt (router đã thấy model luồng
 * chính thật sự chạy và tự nâng, nên không nâng hai lần) hoặc khi sang mục tiêu mới.
 */
export const withDecision =
  (brief: Brief) =>
  (c: Core): Core => ({ ...normalizeCore(c), brief, lift: brief.relation === 'dissatisfied' || brief.relation === 'new' ? EMPTY_LIFT : normalizeCore(c).lift })

/** Một turn không có phát hiện mới: nâng cấp theo bằng chứng giảm một bậc mỗi chiều (không xuống dưới 0). */
export const withLiftDecay = (c: Core): Core => {
  const n = normalizeCore(c)
  if (n.lift.depth === 0 && n.lift.effort === 0) return n
  return { ...n, lift: { depth: Math.max(0, n.lift.depth - 1), effort: Math.max(0, n.lift.effort - 1) } }
}

/** Claude chốt lại mục tiêu/các bước qua tool plan (action "set"): xem retarget. */
export const withRetarget =
  (goal: string | undefined, steps: readonly string[], scope?: readonly string[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return n.brief ? { ...n, brief: retarget(n.brief, goal, steps, scope) } : n
  }

export const withPlan =
  (plan: PlanStep[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    const { steps, seq } = stampClosed(n.plan, plan, (a, b) => a.id === b.id, n.closing.seq)
    return { ...n, plan: steps, closing: { ...n.closing, seq } }
  }

/**
 * Đóng dấu mốc đóng (0.7.5): bước vừa thành done (trước đó chưa done) nhận mốc mới; bước vẫn done giữ mốc cũ; bước không còn done
 * hay verified bỏ mốc.
 */
function stampClosed<T extends { status: string; closedSeq?: number }>(before: readonly T[], after: readonly T[], same: (a: T, b: T) => boolean, seq: number): { steps: T[]; seq: number } {
  let next = seq
  const steps = after.map(step => {
    if (step.status !== 'done') {
      if (step.status === 'verified' || step.closedSeq === undefined) return step
      const { closedSeq: _closed, ...rest } = step
      return rest as T
    }
    const old = before.find(b => same(b, step))
    if (old !== undefined && old.status === 'done' && old.closedSeq !== undefined) return { ...step, closedSeq: old.closedSeq }
    next += 1
    return { ...step, closedSeq: next }
  })
  return { steps, seq: next }
}

/** Mốc của lần kiểm đạt gần nhất của mục tiêu hiện tại; null khi chưa có (lần kiểm đạt đầu tiên nâng mọi bước done). */
const passMark = (n: Core): number | null => (n.brief !== null && n.closing.goalId === n.brief.goalId ? n.closing.lastPassSeq : null)

/**
 * Mod tự nâng các bước done (chỉ những bước có trong `only` nếu có) thành verified, ghi lệnh test đã chạy làm bằng chứng và đánh dấu
 * `auto` để hạ lại khi có thay đổi mới (0.7.0). Chỉ nâng bước đóng sau lần kiểm đạt trước của mục tiêu (0.7.5); `isPass` là chính
 * lần kiểm đạt đó (lệnh test của luồng chính vừa chạy đạt), ghi mốc mới. Không đổi gì khi không có bước để nâng và không phải lần
 * kiểm đạt.
 */
export const withAutoVerified =
  (command: string, only?: readonly number[], isPass = false) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    const mark = passMark(n)
    const isDue = (s: { status: string; closedSeq?: number }) => s.status === 'done' && (mark === null || (s.closedSeq ?? 0) > mark)
    const isPlanned = n.plan.some(s => isDue(s) && (only === undefined || only.includes(s.id)))
    // Danh sách phản chiếu (0.7.1): lệnh test đạt sau thay đổi cuối phủ mọi bước done của nó; không có id ổn định nên không có `only`.
    const isMirrored = only === undefined && liveMirror(n).some(isDue)
    const closing = isPass && n.brief !== null ? { seq: n.closing.seq + 1, goalId: n.brief.goalId, lastPassSeq: n.closing.seq + 1 } : n.closing
    if (!isPlanned && !isMirrored) return closing === n.closing ? n : { ...n, closing }
    const note = `tự động: ${command.slice(0, 120)} chạy đạt sau thay đổi cuối`
    return {
      ...n,
      plan: n.plan.map(s => (isDue(s) && (only === undefined || only.includes(s.id)) ? { ...s, status: 'verified' as const, auto: true, note } : s)),
      mirror: isMirrored ? { ...n.mirror, steps: n.mirror.steps.map(s => (isDue(s) ? { ...s, status: 'verified' as const } : s)) } : n.mirror,
      closing,
    }
  }

/**
 * Có thay đổi mới: các bước verified do mod tự nâng về done (bước verified do Claude ghi giữ nguyên). Bước bị hạ nhận mốc đóng mới
 * (0.7.5), để lần kiểm đạt sau nâng lại được.
 */
export const withAutoDemoted = (c: Core): Core => {
  const n = normalizeCore(c)
  const isMirrored = liveMirror(n).some(s => s.status === 'verified')
  if (!hasAutoVerified(n)) return n
  const seq = n.closing.seq + 1
  return {
    ...n,
    plan: n.plan.map(s => {
      if (s.auto !== true || s.status !== 'verified') return s
      const { auto: _auto, note: _note, ...rest } = s
      return { ...rest, status: 'done' as const, closedSeq: seq }
    }),
    mirror: isMirrored ? { ...n.mirror, steps: n.mirror.steps.map(s => (s.status === 'verified' ? { ...s, status: 'done' as const, closedSeq: seq } : s)) } : n.mirror,
    closing: { ...n.closing, seq },
  }
}

/** Có bước verified do mod tự nâng (của tool plan hay của danh sách phản chiếu) để hạ khi có thay đổi mới. */
export const hasAutoVerified = (n: Core): boolean =>
  n.plan.some(s => s.auto === true && s.status === 'verified') || liveMirror(n).some(s => s.status === 'verified')

/**
 * Các bước của danh sách việc phản chiếu khi nó là checklist đang hiển thị: tool plan chưa có bước (tool plan luôn thắng) và danh
 * sách thuộc mục tiêu hiện tại. Rỗng nếu không. Mod chỉ nâng và hạ verified của danh sách này (0.7.1).
 */
export const liveMirror = (n: Core): readonly MirrorStep[] =>
  n.plan.length === 0 && n.brief !== null && n.mirror.goalId === n.brief.goalId ? n.mirror.steps : []

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
  return core => {
    const n = normalizeCore(core)
    // Mốc đóng (0.7.5) theo key, chỉ so với danh sách của cùng mục tiêu.
    const stamped = stampClosed(n.mirror.goalId === goalId ? n.mirror.steps : [], steps, (a, b) => a.key === b.key, n.closing.seq)
    return { ...n, mirror: { goalId, steps: stamped.steps }, closing: { ...n.closing, seq: stamped.seq } }
  }
}

/** Số dòng tiến độ của agent giữ lại cho một mục tiêu. */
export const AGENT_PROGRESS_LIMIT = 20

/** Tiến độ agent và số thay đổi bắt đầu lại ở mục tiêu mới. */
function freshProgress(goalId: number): Pick<Core, 'agentProgress' | 'activity'> {
  return { agentProgress: { goalId, items: [] }, activity: { goalId, changes: 0 } }
}

/** Số bộ đếm theo việc giữ lại cho một mục tiêu (0.7.5). */
const AGENT_TALLY_LIMIT = 50

/** Khóa bộ đếm của một lần gọi Agent (0.7.5): việc đã phân theo số; việc Claude tự giao theo dạng mô tả bỏ chữ số. */
export function tallyKey(item: Pick<AgentProgress, 'title' | 'taskIndex'>): string {
  return item.taskIndex !== undefined ? `task-${item.taskIndex}` : `own-${item.title.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()}`
}

/**
 * Một lần gọi Agent bắt đầu chạy: thêm dòng tiến độ (thay dòng cũ cùng agentId), giữ tối đa AGENT_PROGRESS_LIMIT dòng; bộ đếm
 * theo việc (0.7.5) giữ ngoài trần đó, nên hàng chục lô vẫn đếm đúng. agentId đã đếm (khởi động lại) không đếm hai lần.
 */
export function withAgentStart(goalId: number, item: AgentProgress): (core: Core) => Core {
  return core => {
    const n = normalizeCore(core)
    const same = n.agentProgress.goalId === goalId
    const items = same ? n.agentProgress.items.filter(i => i.agentId !== item.agentId) : []
    const tally: AgentTally[] = same ? [...(n.agentProgress.tally ?? [])] : []
    const open = same ? { ...(n.agentProgress.open ?? {}) } : {}
    if (open[item.agentId] === undefined) {
      const key = tallyKey(item)
      const at = tally.findIndex(t => t.key === key)
      const base: AgentTally = tally[at] ?? { key, title: item.title, ...(item.taskIndex !== undefined ? { taskIndex: item.taskIndex } : {}), spawned: 0, done: 0, failed: 0, running: 0 }
      const counted = { ...base, spawned: base.spawned + 1, running: base.running + 1 }
      if (at >= 0) tally[at] = counted
      else tally.push(counted)
      open[item.agentId] = key
    }
    return { ...n, agentProgress: { goalId, items: [...items, item].slice(-AGENT_PROGRESS_LIMIT), tally: tally.slice(-AGENT_TALLY_LIMIT), open } }
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

/** Agent kết thúc: xong, lỗi, hoặc bị cắt vì tạm dừng; bộ đếm theo việc cập nhật cả khi dòng đã bị đẩy khỏi danh sách (0.7.5). */
export function withAgentEnd(agentId: string, state: Exclude<AgentState, 'running'>, at: number): (core: Core) => Core {
  return core => {
    const n = withAgent(agentId, item => ({ ...item, state, endedAt: at }))(core)
    const key = n.agentProgress.open?.[agentId]
    if (key === undefined) return n
    const { [agentId]: _ended, ...open } = n.agentProgress.open ?? {}
    const tally = (n.agentProgress.tally ?? []).map(t =>
      t.key === key ? { ...t, running: Math.max(0, t.running - 1), ...(state === 'done' ? { done: t.done + 1 } : { failed: t.failed + 1 }) } : t,
    )
    return { ...n, agentProgress: { ...n.agentProgress, tally, open } }
  }
}

/** Danh sách việc agent tự ghi (phản chiếu). */
export const withAgentSteps = (agentId: string, steps: readonly MirrorStep[]) => withAgent(agentId, item => ({ ...item, steps: [...steps] }))

/** Luồng chính vừa thay đổi file trong mục tiêu goalId. */
export function withActivity(goalId: number): (core: Core) => Core {
  return core => {
    const n = normalizeCore(core)
    return { ...n, activity: { goalId, changes: (n.activity.goalId === goalId ? n.activity.changes : 0) + 1 } }
  }
}
