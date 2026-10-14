// Phân loại bước của checklist (0.5.6): bước đã đóng hẳn, bước đang chờ hoặc bị chặn, bước khôi phục được.
// `openSteps` và `isGoalDone` (tracker.ts) giữ nguyên nghĩa: chỉ todo và doing là bước mở, nên cổng Stop không đổi.
// Hàm thuần.

import type { PlanStep } from '../../../types'

/** Mọi bước đã done, verified hay skipped (checklist không rỗng). waiting và blocked chưa phải đã đóng. */
export function isFullyClosed(plan: readonly PlanStep[]): boolean {
  return plan.length > 0 && plan.every(step => step.status === 'done' || step.status === 'verified' || step.status === 'skipped')
}

/** Bước waiting rồi bước blocked, giữ thứ tự id trong mỗi nhóm. */
export function pendingSteps(plan: readonly PlanStep[]): PlanStep[] {
  return [...plan.filter(step => step.status === 'waiting'), ...plan.filter(step => step.status === 'blocked')]
}

/** Bước còn việc phải làm khi mục tiêu bị thay: todo, doing và waiting (blocked không lưu). */
export function restorableSteps(plan: readonly PlanStep[]): PlanStep[] {
  return plan.filter(step => step.status === 'todo' || step.status === 'doing' || step.status === 'waiting')
}
