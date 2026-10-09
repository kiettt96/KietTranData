// Trạng thái phiên của mod trong $.state (sống qua hot-reload, band/pane tự
// vẽ lại khi đổi). File này không gọi $ và không khai báo atom (engine chỉ
// quét atom trong module hooks): nó chứa giá trị khởi tạo và reducer thuần,
// hook áp chúng bằng update($, coreState, reducer) ngay tại chỗ.

import type { PluginOptions } from 'claude-code'

import type { Brief, Core, Mode, PlanStep, Route, RouteEvent, Warning } from '../../types'
import { retarget } from './analyze'
import { statusLine } from './text'

export const EMPTY_CORE: Core = { brief: null, plan: [], route: null, warnings: [], log: [] }

const LOG_LIMIT = 60
const WARNING_LIMIT = 30

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

// ------------------------------------------------------------ reducers

/** Mục tiêu mới: thay brief, xóa checklist và cảnh báo của mục tiêu cũ. */
export const adoptGoal =
  (brief: Brief) =>
  (c: Core): Core => ({ ...c, brief, plan: [], warnings: [] })

export const withBrief =
  (brief: Brief) =>
  (c: Core): Core => ({ ...c, brief })

/** Claude chốt lại mục tiêu/các bước qua tool plan (action "set"): xem retarget. */
export const withRetarget =
  (goal: string | undefined, steps: readonly string[]) =>
  (c: Core): Core => (c.brief ? { ...c, brief: retarget(c.brief, goal, steps) } : c)

export const withPlan =
  (plan: PlanStep[]) =>
  (c: Core): Core => ({ ...c, plan })

export const withRoute =
  (route: Route | null) =>
  (c: Core): Core => ({ ...c, route })

export const withLog =
  (...entries: RouteEvent[]) =>
  (c: Core): Core => ({ ...c, log: [...c.log, ...entries].slice(-LOG_LIMIT) })

/** Thêm cảnh báo; bỏ qua nếu trùng loại và nội dung với cảnh báo cuối. */
export const withWarnings =
  (...entries: Warning[]) =>
  (c: Core): Core => {
    let list = c.warnings
    for (const entry of entries) {
      const last = list[list.length - 1]
      if (last && last.kind === entry.kind && last.text === entry.text) continue
      list = [...list, entry]
    }
    return list === c.warnings ? c : { ...c, warnings: list.slice(-WARNING_LIMIT) }
  }

/** Xóa mục tiêu, checklist, route và cảnh báo; giữ nhật ký điều phối. */
export const resetCore = (c: Core): Core => ({ ...EMPTY_CORE, log: c.log })
