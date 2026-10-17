// Tiến độ từng việc (0.6.1): mỗi việc một dòng, gồm việc chính của luồng chính, từng việc router phân (làm trực tiếp hay
// giao subagent) và việc Claude tự giao. Hàm thuần, chỉ đọc Core (sống qua hot-reload vì nằm trong $.state).
// Nguyên tắc: thanh chỉ thể hiện phần trăm khi có số bước thật; không có thì chỉ thể hiện trạng thái.

import type { Choice, Core, PlanStep } from '../../types'
import { isFullyClosed } from './drift'
import { mirrorPlan, shownPlan } from './mirror'
import { matchTask } from './route'
import { progress } from './text'

/** Trạng thái của một việc khi không có số bước: chờ giao, chưa bắt đầu, đang chạy hay đang làm, xong, lỗi, bị cắt. */
export type TaskState = 'pending' | 'idle' | 'running' | 'done' | 'failed' | 'cut'

/** Thanh của một việc: theo các bước thật của nó, hoặc chỉ theo trạng thái. */
export type TaskBar = { kind: 'steps'; plan: PlanStep[] } | { kind: 'state'; state: TaskState }

export type TaskRow = {
  /** Khóa ổn định cho phần tử giao diện. */
  key: string
  kind: 'main' | 'direct' | 'agent'
  /** Số của việc trong mục "Phân việc"; vắng ở việc chính và việc Claude tự giao. */
  index?: number
  title: string
  pick: Choice | null
  bar: TaskBar
  /** Trạng thái để ghi chữ và để xếp thứ tự khi band thiếu chỗ. */
  state: TaskState
  /** Agent: số tool call và thời gian chạy (ms). */
  tools?: number
  elapsedMs?: number
}

/** Thứ tự ưu tiên khi band thiếu chỗ: đang chạy, rồi lỗi hay bị cắt, rồi chờ hoặc chưa bắt đầu, rồi xong. */
const PRIORITY: Record<TaskState, number> = { running: 0, failed: 1, cut: 1, pending: 2, idle: 2, done: 3 }

export function byPriority(rows: readonly TaskRow[]): TaskRow[] {
  return rows.map((row, i) => ({ row, i })).sort((a, b) => PRIORITY[a.row.state] - PRIORITY[b.row.state] || a.i - b.i).map(x => x.row)
}

/** Trạng thái theo các bước: xong khi đóng hẳn, chưa bắt đầu khi chưa bước nào khác todo, còn lại là đang làm. */
function stepsState(plan: readonly PlanStep[]): TaskState {
  if (isFullyClosed(plan)) return 'done'
  return plan.every(s => s.status === 'todo') ? 'idle' : 'running'
}

/**
 * Các dòng tiến độ của mục tiêu hiện tại, theo thứ tự: việc chính, các việc router phân theo số thứ tự (việc giao
 * subagent có thể nhiều dòng nếu giao lại), rồi việc Claude tự giao. Không có mục tiêu thì rỗng.
 */
export function taskRows(core: Core, now: number): TaskRow[] {
  const brief = core.brief
  if (brief === null) return []
  const { plan } = shownPlan(core)
  const changes = core.activity.goalId === brief.goalId ? core.activity.changes : 0
  const agents = core.agentProgress.goalId === brief.goalId ? core.agentProgress.items : []
  const delegations = core.delegations.goalId === brief.goalId ? core.delegations.items : []
  const tasks = brief.isReference ? [] : [...brief.tasks].sort((a, b) => a.index - b.index)
  const rows: TaskRow[] = []

  // Việc chính: thanh của checklist (tool plan hay phản chiếu). Chưa có bước thì chỉ trạng thái.
  const mainPick = core.route !== null ? { family: core.route.family, effort: core.route.effort } : brief.main
  const isBusy = changes > 0 || agents.length > 0
  rows.push({
    key: 'main',
    kind: 'main',
    title: brief.goal,
    pick: mainPick,
    bar: plan.length > 0 ? { kind: 'steps', plan } : { kind: 'state', state: isBusy ? 'running' : 'idle' },
    state: plan.length > 0 ? stepsState(plan) : isBusy ? 'running' : 'idle',
  })

  const agentRow = (item: (typeof agents)[number]): TaskRow => {
    const state: TaskState = item.state
    const steps = mirrorPlan(item.steps)
    const hasSteps = steps.length > 0 && state !== 'failed' && state !== 'cut'
    return {
      key: `agent-${item.agentId}`,
      kind: 'agent',
      ...(item.taskIndex !== undefined ? { index: item.taskIndex } : {}),
      title: item.title,
      pick: { family: item.family, effort: item.effort ?? 'medium' },
      bar: hasSteps ? { kind: 'steps', plan: steps } : { kind: 'state', state },
      state,
      tools: item.tools,
      elapsedMs: Math.max(0, (item.endedAt ?? now) - item.startedAt),
    }
  }

  for (const task of tasks) {
    if (task.run === 'main') {
      // Bước của checklist mở đầu "Việc N" (hay cùng mã mục) là bước của việc N, theo cùng quy tắc cấu trúc với Agent.
      const own = plan.filter(step => matchTask(tasks, step.title)?.index === task.index)
      const closedAny = progress(plan).closed > 0
      const state: TaskState = own.length > 0 ? stepsState(own) : plan.length > 0 && isFullyClosed(plan) ? 'done' : !closedAny && changes === 0 ? 'idle' : 'running'
      rows.push({
        key: `task-${task.index}`,
        kind: 'direct',
        index: task.index,
        title: task.title,
        pick: task.pick,
        bar: own.length > 0 ? { kind: 'steps', plan: own } : { kind: 'state', state },
        state,
      })
      continue
    }
    const runs = agents.filter(item => item.taskIndex === task.index)
    if (runs.length > 0) {
      for (const item of runs) rows.push({ ...agentRow(item), title: task.title, pick: { family: item.family, effort: item.effort ?? task.pick.effort } })
      continue
    }
    // Chưa có lần gọi Agent nào cho việc này: trạng thái theo danh sách việc giao (chờ giao, hoặc lỗi chưa giao lại).
    const delegated = delegations.find(d => d.index === task.index)?.state ?? 'pending'
    const state: TaskState = delegated === 'failed' ? 'failed' : delegated === 'done' ? 'done' : delegated === 'running' ? 'running' : 'pending'
    rows.push({ key: `task-${task.index}`, kind: 'agent', index: task.index, title: task.title, pick: task.pick, bar: { kind: 'state', state }, state })
  }

  for (const item of agents) if (item.taskIndex === undefined) rows.push(agentRow(item))
  return rows
}
