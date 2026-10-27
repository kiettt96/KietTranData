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
  if (e.requirements !== undefined) {
    const [least, most] = e.requirements
    if (plan.requirements.length < least || plan.requirements.length > most) fails.push(`${plan.requirements.length} yêu cầu, cần ${least} tới ${most}`)
  }
  if (e.covered === true && plan.tasks.length > 0) {
    const covered = new Set(plan.tasks.flatMap(t => t.covers ?? []))
    const missing = plan.requirements.map((_, i) => i + 1).filter(n => !covered.has(n))
    if (missing.length > 0) fails.push(`yêu cầu ${missing.join(', ')} không việc nào phủ`)
  }
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
  if (e.codes !== undefined) {
    // Bước có mã đủ và tách riêng (0.7.4): mỗi mã đúng một việc có tiêu đề mở đầu bằng mã ("BƯỚC 1" không khớp "BƯỚC 10").
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found = e.codes.map(code => plan.tasks.filter(t => new RegExp(`^${escape(code)}(?![0-9])`, 'i').test(t.title.trim())).map(t => t.index))
    const missing = e.codes.filter((_, i) => (found[i] ?? []).length === 0)
    const split = e.codes.filter((_, i) => (found[i] ?? []).length > 1)
    if (missing.length > 0) fails.push(`thiếu việc riêng cho ${missing.join(', ')}`)
    if (split.length > 0) fails.push(`${split.join(', ')} thành nhiều việc`)
    const firsts = found.flatMap(indexes => indexes.slice(0, 1))
    if (firsts.some((index, i) => i > 0 && index < (firsts[i - 1] ?? 0))) fails.push('việc có mã không theo thứ tự của prompt')
  }
  if (e.modelRule !== undefined && !e.modelRule.some(key => (plan.constraints[0] ?? '').toLowerCase().includes(key.toLowerCase()))) {
    fails.push(`ràng buộc đầu tiên không phải quy định model (${plan.constraints[0] ?? 'không có ràng buộc'})`)
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
