// Pane chi tiết tự mở ở mỗi mục tiêu mới (0.7.2): quyết định thuần. Việc gọi $.ui.open nằm ở hook (parts/session.ts, parts/command.ts).

/** Số dòng xin khi pane nằm ngay trên prompt (terminal thường): vừa đủ xem mà không chiếm cả màn hình. Cạnh transcript thì engine tự quyết. */
export const PANE_ROWS = 16

/** Chỉ lần đóng của người dùng (dấu đóng hay phím) được nhớ; plugin tự đóng hay gỡ plugin thì không. */
export function isPersonClose(origin: { kind: string }): boolean {
  return origin.kind === 'person'
}

/**
 * Mở pane khi option bật, pane chưa mở, và người dùng chưa tự đóng nó trong chính mục tiêu này (`closedGoal` là mục tiêu họ đóng
 * pane gần nhất, -1 nếu chưa). Sang mục tiêu mới thì mở lại.
 */
export function shouldAutoOpenPane(args: { enabled: boolean; goalId: number; closedGoal: number; isOpen: boolean }): boolean {
  return args.enabled && !args.isOpen && args.closedGoal !== args.goalId
}
