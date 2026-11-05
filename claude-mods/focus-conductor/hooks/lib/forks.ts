// Phiên con của việc tách (0.7.9 F1): các câu hỏi thuần trên Core mà cổng Stop, câu gom, pane và band cùng dùng. Không gọi $.

import type { Core, ForkPart, Task } from '../../types'
import { taskMatch } from './route'

/** Việc có split của mục tiêu đang mở (không tính prompt đối chiếu). */
function splitTasks(core: Core): Task[] {
  const brief = core.brief
  if (brief === null || brief.isReference) return []
  return brief.tasks.filter(t => (t.split?.length ?? 0) >= 2)
}

/** Các lần giao phiên con của mục tiêu đang mở; mục tiêu khác thì rỗng. */
export function liveForks(core: Core): ForkPart[] {
  return core.brief !== null && core.forks.goalId === core.brief.goalId ? core.forks.parts : []
}

/**
 * Bước checklist ghi phần (hay cả việc) là skipped hoặc blocked: phần lỗi đó đã được ghi lý do, không còn chặn Stop. Bước khớp theo cùng
 * luật với description của phiên con ("Việc 3b: ..." là phần b, "Việc 3: ..." là cả việc).
 */
function isExcused(core: Core, task: Task, part: string): boolean {
  const tasks = core.brief?.tasks ?? []
  return core.plan.some(step => {
    if (step.status !== 'skipped' && step.status !== 'blocked') return false
    const hit = taskMatch(tasks, step.title)
    return hit.task?.index === task.index && (hit.part === undefined || hit.part === part)
  })
}

/**
 * Phần lỗi chưa làm lại của mục tiêu đang mở (0.7.9 F1), dạng "3b (phiên con)": cổng Stop chặn như việc giao subagent đã lỗi. Phần đã
 * chuyển về luồng chính vì engine từ chối không phải phần lỗi.
 */
export function forkFailures(core: Core): string[] {
  const tasks = splitTasks(core)
  return liveForks(core)
    .filter(p => p.state === 'failed')
    .filter(p => {
      const task = tasks.find(t => t.index === p.task)
      return task === undefined || !isExcused(core, task, p.part)
    })
    .map(p => `${p.task}${p.part} (phiên con)`)
}

/** Việc mà mọi phần trong split đều đã có kết quả từ phiên con và chưa gom (0.7.9 F1). */
export function mergeDue(core: Core): Task[] {
  const parts = liveForks(core)
  return splitTasks(core).filter(
    task => !core.forks.merged.includes(task.index) && (task.split ?? []).every(s => parts.some(p => p.task === task.index && p.part === s.part && p.state === 'done')),
  )
}

/** Kết quả từng phần của một việc, cho dòng fork-archive: mã phần tới trạng thái. */
export function forkResults(core: Core, index: number): Record<string, string> {
  return Object.fromEntries(liveForks(core).filter(p => p.task === index).map(p => [p.part, p.state]))
}

/** Phần chưa xong của một việc (để báo chuyển về luồng chính), theo thứ tự trong split. */
export function openParts(core: Core, index: number): string[] {
  const task = splitTasks(core).find(t => t.index === index)
  const done = new Set(liveForks(core).filter(p => p.task === index && p.state === 'done').map(p => p.part))
  return (task?.split ?? []).filter(s => !done.has(s.part)).map(s => `${index}${s.part}`)
}

/** File được sửa của phần mà phiên con agentId đang chạy (0.7.9 F1); rỗng khi không phải phiên con của việc tách hay phần chỉ đọc. */
export function forkFiles(core: Core, agentId: string): string[] {
  const part = liveForks(core).find(p => p.agentId === agentId)
  if (part === undefined) return []
  return splitTasks(core).find(t => t.index === part.task)?.split?.find(s => s.part === part.part)?.files ?? []
}
