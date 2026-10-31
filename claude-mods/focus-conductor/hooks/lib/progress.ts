// Tiến độ từng việc (0.6.1): mỗi việc một dòng, gồm việc chính của luồng chính, từng việc router phân (làm trực tiếp hay
// giao subagent) và việc Claude tự giao. Hàm thuần, chỉ đọc Core (sống qua hot-reload vì nằm trong $.state).
// Nguyên tắc: thanh chỉ thể hiện phần trăm khi có số bước thật; không có thì chỉ thể hiện trạng thái.

import type { Choice, Core, PlanStep } from '../../types'
import { isFullyClosed } from './drift'
import { mirrorPlan, shownPlan } from './mirror'
import { matchTask } from './route'
import { tallyKey } from './state'
import { progress } from './text'
import type { AgentTally } from '../../types'

/** Bộ đếm theo việc của mục tiêu đang mở (0.7.5); trạng thái cũ không có thì rỗng. */
function talliesOf(core: Core): AgentTally[] {
  return core.brief !== null && core.agentProgress.goalId === core.brief.goalId ? (core.agentProgress.tally ?? []) : []
}

/** Tổng số lần gọi Agent đã xong và đã giao trong mục tiêu (0.7.5): chip của band đếm theo đây. */
export function agentTotals(core: Core): { done: number; total: number } {
  return talliesOf(core).reduce((sum, t) => ({ done: sum.done + t.done, total: sum.total + t.spawned }), { done: 0, total: 0 })
}

/**
 * Số trên chip subagent của band (0.7.5): theo tổng số lần gọi Agent của bộ đếm, cộng các việc giao chưa có lần gọi nào;
 * trạng thái cũ chưa có bộ đếm thì theo các dòng việc giao như trước. `delegated` là các dòng việc giao subagent.
 */
export function chipCounts(core: Core, delegated: readonly TaskRow[]): { done: number; total: number } {
  const totals = agentTotals(core)
  if (totals.total === 0) return { done: delegated.filter(row => row.state === 'done').length, total: delegated.length }
  return { done: totals.done, total: totals.total + delegated.filter(row => row.counts === undefined && row.tools === undefined).length }
}

/** Trạng thái của việc nhiều lô: còn lô chạy, có lô lỗi, xong hết. */
function tallyState(t: AgentTally): TaskState {
  if (t.running > 0) return 'running'
  if (t.failed > 0) return 'failed'
  return t.done >= t.spawned ? 'done' : 'running'
}

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
  /** Việc có nhiều lần gọi Agent (0.7.5): một dòng theo bộ đếm, k/n lô xong, r đang chạy. */
  counts?: { done: number; total: number; running: number }
  /** Số lô lỗi của việc nhiều lô, chỉ ghi khi có lô lỗi (0.7.6, U1). */
  failed?: number
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

  // Việc có từ hai lần gọi Agent (0.7.5): một dòng theo bộ đếm, không theo từng dòng của danh sách có trần.
  const tallies = talliesOf(core)
  const grouped = (key: string) => tallies.find(t => t.key === key && t.spawned > 1)
  const tallyRow = (t: AgentTally, title: string, pick: Choice | null, index?: number): TaskRow => {
    const state = tallyState(t)
    return { key: `tally-${t.key}`, kind: 'agent', ...(index !== undefined ? { index } : {}), title, pick, bar: { kind: 'state', state }, state, counts: { done: t.done, total: t.spawned, running: t.running }, ...(t.failed > 0 ? { failed: t.failed } : {}) }
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
    const many = grouped(`task-${task.index}`)
    if (many !== undefined) {
      const last = runs.at(-1)
      rows.push(tallyRow(many, task.title, last !== undefined ? { family: last.family, effort: last.effort ?? task.pick.effort } : task.pick, task.index))
      continue
    }
    if (runs.length > 0) {
      for (const item of runs) rows.push({ ...agentRow(item), title: task.title, pick: { family: item.family, effort: item.effort ?? task.pick.effort } })
      continue
    }
    // Chưa có lần gọi Agent nào cho việc này: trạng thái theo danh sách việc giao (chờ giao, hoặc lỗi chưa giao lại).
    const delegated = delegations.find(d => d.index === task.index)?.state ?? 'pending'
    const state: TaskState = delegated === 'failed' ? 'failed' : delegated === 'done' ? 'done' : delegated === 'running' ? 'running' : 'pending'
    rows.push({ key: `task-${task.index}`, kind: 'agent', index: task.index, title: task.title, pick: task.pick, bar: { kind: 'state', state }, state })
  }

  for (const t of tallies) if (t.taskIndex === undefined && t.spawned > 1) rows.push(tallyRow(t, t.title, null))
  for (const item of agents) if (item.taskIndex === undefined && grouped(tallyKey(item)) === undefined) rows.push(agentRow(item))
  return rows
}

/**
 * Dòng việc khớp từng bước (0.7.6, U1): bước có mã hay "Việc N" khớp một việc đã phân, hay trùng hệt tiêu đề của việc, thì dòng của việc đó (dòng đầu nếu việc có nhiều dòng)
 * đi cùng bước. Trả bảng tiêu đề bước tới dòng việc, và khóa của mọi dòng việc đã đi cùng một bước (để pane không vẽ lại chúng ở mục riêng).
 */
export function stepTaskRows(core: Core, rows: readonly TaskRow[], titles: readonly string[]): { byTitle: Map<string, TaskRow>; matched: Set<string> } {
  const tasks = core.brief === null || core.brief.isReference ? [] : core.brief.tasks
  const byTitle = new Map<string, TaskRow>()
  const matched = new Set<string>()
  for (const title of titles) {
    // Theo mã ("BƯỚC N", "Việc N"), hay tiêu đề trùng hệt một việc (bước dự kiến của router chính là tiêu đề của việc).
    const index = matchTask(tasks, title)?.index ?? tasks.find(task => task.title.trim() === title.trim())?.index
    if (index === undefined) continue
    const own = rows.filter(row => row.kind !== 'main' && row.index === index)
    const first = own[0]
    if (first === undefined) continue
    byTitle.set(title, first)
    for (const row of own) matched.add(row.key)
  }
  return { byTitle, matched }
}

/** Một nhóm agent đang chạy của mục "Đang chạy" (0.7.6, U8): theo việc router phân, hay theo mô tả với việc Claude tự giao. */
export type RunningGroup = {
  key: string
  kind: 'agent'
  index?: number
  title: string
  /** Số cuối của mô tả nhỏ nhất và lớn nhất trong nhóm (khoảng lô); null khi có agent mà mô tả không kết thúc bằng số. */
  range: { first: number; last: number } | null
  agents: number
  elapsedMs: number
}

/**
 * Các nhóm agent đang chạy của mục tiêu hiện tại (0.7.6, U8), theo thứ tự agent đầu tiên của nhóm bắt đầu. Tên nhóm là tiêu đề việc
 * router phân, hay mô tả của agent với việc Claude tự giao; số agent theo bộ đếm khi có (danh sách agent chỉ giữ 20 agent gần nhất).
 */
export function runningGroups(core: Core, now: number): RunningGroup[] {
  const brief = core.brief
  if (brief === null || core.agentProgress.goalId !== brief.goalId) return []
  const tasks = brief.isReference ? [] : brief.tasks
  const tallies = talliesOf(core)
  const groups = new Map<string, RunningGroup & { numbers: number[]; plain: boolean; startedAt: number }>()
  for (const item of core.agentProgress.items) {
    if (item.state !== 'running') continue
    const key = tallyKey(item)
    const tail = /(\d+)\s*$/.exec(item.title)
    const group = groups.get(key) ?? {
      key,
      kind: 'agent' as const,
      ...(item.taskIndex !== undefined ? { index: item.taskIndex } : {}),
      title: (item.taskIndex !== undefined ? tasks.find(task => task.index === item.taskIndex)?.title : undefined) ?? item.title,
      range: null,
      agents: 0,
      elapsedMs: 0,
      numbers: [],
      plain: false,
      startedAt: item.startedAt,
    }
    group.agents += 1
    group.startedAt = Math.min(group.startedAt, item.startedAt)
    if (tail) group.numbers.push(Number(tail[1]))
    else group.plain = true
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(({ numbers, plain, startedAt, ...group }) => ({
      ...group,
      range: !plain && numbers.length > 0 ? { first: Math.min(...numbers), last: Math.max(...numbers) } : null,
      agents: Math.max(group.agents, tallies.find(t => t.key === group.key)?.running ?? 0),
      elapsedMs: Math.max(0, now - startedAt),
    }))
}
