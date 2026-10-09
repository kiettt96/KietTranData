// Trạng thái phiên của mod trong $.state (sống qua hot-reload, band/pane tự
// vẽ lại khi đổi). File này không gọi $ và không khai báo atom (engine chỉ
// quét atom trong module hooks): nó chứa giá trị khởi tạo và reducer thuần,
// hook áp chúng bằng update($, coreState, reducer) ngay tại chỗ.
// Mọi reducer đi qua normalizeCore, nên trạng thái lưu từ bản cũ (0.1.x) vẫn đọc được.

import type { PluginOptions } from 'claude-code'

import type { Brief, Core, Ledger, Lift, Mode, PlanStep, Route, RouteEvent, Warning } from '../../types'
import { retarget } from './analyze'
import { emptyLedger, nextGoal, resetLedger } from './ledger'
import { legacyOf } from './scale'
import { statusLine } from './text'

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
}

const LOG_LIMIT = 60
const WARNING_LIMIT = 30
/** Nâng cấp theo bằng chứng tối đa hai bậc mỗi mục tiêu (depth và effort riêng). */
const LIFT_LIMIT = 2

/** Ảnh chụp mọi thứ band, pane và status line cần, đọc một lần. */
export type View = { core: Core; mode: Mode; isBandHidden: boolean }

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
  return statusLine(view.core.brief, view.core.plan, view.core.route, view.mode)
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
  }
}

/** Brief cũ chỉ có tier: suy ra depth và volume tương đương, bản sắc việc để trung tính. */
function normalizeBrief(brief: Brief): Brief {
  const legacy = legacyOf(brief.tier)
  return {
    ...brief,
    depth: brief.depth ?? legacy.depth,
    volume: brief.volume ?? legacy.volume,
    kind: brief.kind ?? 'mixed',
    hardSignals: brief.hardSignals ?? [],
  }
}

// ------------------------------------------------------------ reducers

/** Mục tiêu mới: thay brief, xóa checklist, cảnh báo và nâng cấp của mục tiêu cũ; sổ theo mục tiêu được làm mới. */
export const adoptGoal =
  (brief: Brief) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return { ...n, brief, plan: [], warnings: [], lift: EMPTY_LIFT, ledger: nextGoal(n.ledger, brief.goalId) }
  }

export const withBrief =
  (brief: Brief) =>
  (c: Core): Core => ({ ...normalizeCore(c), brief })

/** Claude chốt lại mục tiêu/các bước qua tool plan (action "set"): xem retarget. */
export const withRetarget =
  (goal: string | undefined, steps: readonly string[]) =>
  (c: Core): Core => {
    const n = normalizeCore(c)
    return n.brief ? { ...n, brief: retarget(n.brief, goal, steps) } : n
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

/** Xóa mục tiêu, checklist, route, cảnh báo và nâng cấp; giữ nhật ký và hệ số hiệu chỉnh. */
export const resetCore = (c: Core): Core => {
  const n = normalizeCore(c)
  return { ...EMPTY_CORE, log: n.log, ledger: resetLedger(n.ledger) }
}
