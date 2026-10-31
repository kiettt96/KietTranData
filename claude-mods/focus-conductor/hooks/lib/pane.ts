// Pane chi tiết tự mở ở mỗi mục tiêu mới (0.7.2): quyết định thuần. Việc gọi $.ui.open nằm ở hook (parts/session.ts, parts/command.ts).

import type { Depth } from '../../types'

/** Số dòng xin khi pane nằm ngay trên prompt (terminal thường): vừa đủ xem mà không chiếm cả màn hình. Cạnh transcript thì engine tự quyết. */
export const PANE_ROWS = 16

/** Chỉ lần đóng của người dùng (dấu đóng hay phím) được nhớ; plugin tự đóng hay gỡ plugin thì không. */
export function isPersonClose(origin: { kind: string }): boolean {
  return origin.kind === 'person'
}

/**
 * Mở pane khi option bật, pane chưa mở, và người dùng chưa tự đóng nó trong chính mục tiêu này (`closedGoal` là mục tiêu họ đóng
 * pane gần nhất, -1 nếu chưa). Sang mục tiêu mới thì mở lại. Từ 0.7.6 (U11) chỉ mục tiêu substantial hay hard mới tự mở: việc none,
 * light thường không có checklist, band đã đủ. `depth` null là mục tiêu không qua router chấm (router lỗi, /conductor goal): vẫn mở.
 */
export function shouldAutoOpenPane(args: { enabled: boolean; goalId: number; closedGoal: number; isOpen: boolean; depth: Depth | null }): boolean {
  return args.enabled && !args.isOpen && args.closedGoal !== args.goalId && (args.depth === null || args.depth === 'substantial' || args.depth === 'hard')
}
