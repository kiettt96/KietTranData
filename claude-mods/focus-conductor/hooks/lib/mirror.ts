// Phản chiếu danh sách việc Claude Code tự ghi (TodoWrite, TaskCreate, TaskUpdate) thành bước có trạng thái (0.6.1).
// Hàm thuần, không gọi $. Bước phản chiếu chỉ để vẽ tiến độ và không thay checklist của tool plan (checklist đó luôn thắng khi đã
// có). Claude Code không có trạng thái verified; bước verified ở đây do mod tự nâng ở state.ts (0.7.1), không phải từ applyTaskTool.

import type { Core, MirrorStep, PlanStep } from '../../types'

/** Tên ba tool danh sách việc của Claude Code mà mod đọc kết quả. */
export const TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate'] as const
/** Số bước tối đa giữ lại cho một danh sách, và số ký tự tối đa của tên bước. */
export const MIRROR_LIMIT = 50
const TITLE_MAX = 120

/** pending thành todo, in_progress thành doing, completed thành done; giá trị lạ là null (bỏ qua). */
export function mirrorStatus(status: unknown): MirrorStep['status'] | null {
  return status === 'pending' ? 'todo' : status === 'in_progress' ? 'doing' : status === 'completed' ? 'done' : null
}

const titleOf = (text: unknown): string => String(text ?? '').trim().slice(0, TITLE_MAX)

/**
 * Danh sách sau một lần gọi tool danh sách việc đã chạy xong (không lỗi, không bị từ chối). `input` là đầu vào của
 * tool, `result` là kết quả có kiểu của engine. Trả null khi lần gọi không đổi gì đọc được (giữ nguyên danh sách cũ).
 */
export function applyTaskTool(steps: readonly MirrorStep[], tool: string, input: Record<string, unknown>, result: unknown): MirrorStep[] | null {
  const out = (result ?? {}) as Record<string, unknown>
  if (tool === 'TodoWrite') {
    // Kết quả mang danh sách sau cập nhật; engine cũ không có thì dùng đầu vào.
    const todos = Array.isArray(out['newTodos']) ? out['newTodos'] : Array.isArray(input['todos']) ? input['todos'] : null
    if (todos === null) return null
    const next: MirrorStep[] = []
    for (const [i, raw] of todos.entries()) {
      const item = (raw ?? {}) as Record<string, unknown>
      const status = mirrorStatus(item['status'])
      const title = titleOf(item['content'])
      if (status !== null && title !== '') next.push({ key: `todo-${i + 1}`, title, status })
    }
    return next.slice(0, MIRROR_LIMIT)
  }
  if (tool === 'TaskCreate') {
    const task = (out['task'] ?? {}) as Record<string, unknown>
    const key = typeof task['id'] === 'string' || typeof task['id'] === 'number' ? String(task['id']) : ''
    const title = titleOf(task['subject'] ?? input['subject'])
    if (key === '' || title === '') return null
    return [...steps.filter(s => s.key !== key), { key, title, status: 'todo' as const }].slice(0, MIRROR_LIMIT)
  }
  if (tool === 'TaskUpdate') {
    if (out['success'] === false) return null
    const key = String(input['taskId'] ?? out['taskId'] ?? '')
    if (key === '' || !steps.some(s => s.key === key)) return null
    if (input['status'] === 'deleted') return steps.filter(s => s.key !== key)
    const status = input['status'] === undefined ? null : mirrorStatus(input['status'])
    const title = input['subject'] === undefined ? '' : titleOf(input['subject'])
    if (status === null && title === '') return null
    return steps.map(s => (s.key === key ? { ...s, ...(status !== null ? { status } : {}), ...(title !== '' ? { title } : {}) } : s))
  }
  return null
}

/** Bước phản chiếu dưới dạng bước checklist (id từ 1) để vẽ bằng cùng thanh và ký hiệu. */
export function mirrorPlan(steps: readonly MirrorStep[]): PlanStep[] {
  return steps.map((s, i) => ({ id: i + 1, title: s.title, status: s.status }))
}

/**
 * Checklist để hiển thị (band, pane, status line, /conductor status): checklist của tool plan khi đã có bước; nếu không,
 * danh sách phản chiếu của mục tiêu hiện tại; không có gì thì rỗng. Cổng và lời nhắc không dùng hàm này.
 */
export function shownPlan(core: Core): { plan: PlanStep[]; source: 'plan' | 'mirror' | null } {
  if (core.plan.length > 0) return { plan: core.plan, source: 'plan' }
  const mirror = core.mirror
  if (core.brief !== null && mirror.goalId === core.brief.goalId && mirror.steps.length > 0) return { plan: mirrorPlan(mirror.steps), source: 'mirror' }
  return { plan: [], source: null }
}
