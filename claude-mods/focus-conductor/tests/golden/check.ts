// Chấm một câu trả lời của router theo kỳ vọng của golden-set, và theo các bảo đảm mà phần kẹp của mod phải giữ
// (không haiku cho việc sửa file, không Explore hay Plan cho việc sửa, không effort max, không fable khi chưa bật).
// Trả danh sách điểm không đạt; rỗng là đạt.

import { describePick, pickRank } from '../../hooks/lib/route'
import { nextBrief, parseRoute } from '../../hooks/lib/router'
import type { GoldenCase } from './cases'
import { OPEN } from './cases'

export function check(c: GoldenCase, reply: string): string[] {
  const plan = parseRoute(reply, OPEN)
  if (plan === null) return ['router trả lời không đọc được']
  const fails: string[] = []
  const e = c.expect
  if (e.relation !== undefined && plan.relation !== e.relation) fails.push(`relation ${plan.relation}, cần ${e.relation}`)
  if (e.relations !== undefined && !e.relations.includes(plan.relation)) fails.push(`relation ${plan.relation}, cần ${e.relations.join('|')}`)
  if (e.scope !== undefined && !plan.scope.includes(e.scope)) fails.push(`phạm vi ${JSON.stringify(plan.scope)}, cần có ${e.scope}`)
  if (e.reference !== undefined && plan.isReference !== e.reference) fails.push(`reference ${plan.isReference}, cần ${e.reference}`)
  if (e.kind !== undefined && !e.kind.includes(plan.kind)) fails.push(`kind ${plan.kind}, cần ${e.kind.join('|')}`)
  if (!e.main.includes(plan.main.family)) fails.push(`luồng chính ${plan.main.family}/${plan.main.effort}, cần ${e.main.join('|')}`)
  const [low, high] = e.tasks
  if (plan.tasks.length < low || plan.tasks.length > high) fails.push(`${plan.tasks.length} việc, cần ${low} tới ${high}`)
  for (const piece of e.pieces ?? []) {
    const task = plan.tasks.find(t => t.index === piece.index)
    if (task === undefined) {
      fails.push(`thiếu việc ${piece.index}`)
      continue
    }
    if (piece.families && !piece.families.includes(task.pick.family)) fails.push(`việc ${piece.index} chạy ${task.pick.family}, cần ${piece.families.join('|')}`)
    if (piece.agents && (task.run !== 'agent' || !piece.agents.includes(task.agentType ?? ''))) fails.push(`việc ${piece.index} giao ${task.agentType ?? 'luồng chính'}, cần ${piece.agents.join('|')}`)
  }
  if (e.constraint !== undefined && !plan.constraints.some(x => x.toLowerCase().includes(e.constraint!.toLowerCase()))) {
    fails.push(`thiếu ràng buộc chứa "${e.constraint}"`)
  }
  if (e.above !== undefined && pickRank(plan.main) <= pickRank(e.above)) {
    fails.push(`luồng chính ${describePick(plan.main)} không cao hơn ${describePick(e.above)}`)
  }
  // Bảo đảm của phần kẹp, đúng với mọi câu trả lời.
  for (const pick of [plan.main, ...plan.tasks.map(t => t.pick)]) {
    if (pick.effort === 'max') fails.push('có effort max sau kẹp')
    if (pick.family === 'fable') fails.push('có fable khi chưa bật allowFable')
  }
  for (const task of plan.tasks) {
    const isEdit = task.kind === 'edit' || task.kind === 'mixed'
    if (isEdit && task.pick.family === 'haiku') fails.push(`việc ${task.index} sửa file mà chạy haiku`)
    if (isEdit && task.run === 'agent' && (task.agentType === 'Explore' || task.agentType === 'Plan')) fails.push(`việc ${task.index} sửa file mà giao ${task.agentType}`)
  }
  // Tiếp nối không được lập mục tiêu mới; mục tiêu mới phải có câu mục tiêu.
  const next = nextBrief(c.prev ?? null, plan, c.text, 1)
  if (c.prev !== undefined && plan.relation !== 'new' && next.isNewGoal && !plan.runReference) fails.push('tiếp nối mà lập mục tiêu mới')
  if (next.isNewGoal && next.brief.goal.trim() === '') fails.push('mục tiêu mới không có câu mục tiêu')
  return fails
}
