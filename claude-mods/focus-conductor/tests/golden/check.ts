// Chấm một câu trả lời của router theo kỳ vọng của golden-set, và theo các bảo đảm mà phần kẹp của mod phải giữ
// (không haiku cho việc sửa file, không Explore hay Plan cho việc sửa, không effort max, không fable khi chưa bật).
// Trả danh sách điểm không đạt; rỗng là đạt.

import { describePick, pickRank } from '../../hooks/lib/route'
import { nextBrief, parseRoute } from '../../hooks/lib/router'
import type { GoldenCase } from './cases'
import { OPEN } from './cases'

type RawArrange = { order?: unknown[]; drop?: Array<{ task?: unknown }>; merge?: Array<{ tasks?: unknown[] }> }

/** Trường arrange của câu trả lời gốc (đối tượng JSON đầu tiên trong câu trả lời); undefined khi không có hay không đọc được. */
export function rawArrange(reply: string): RawArrange | undefined {
  const from = reply.indexOf('{')
  const to = reply.lastIndexOf('}')
  if (from < 0 || to <= from) return undefined
  try {
    const value = (JSON.parse(reply.slice(from, to + 1)) as Record<string, unknown>)['arrange']
    return value !== null && typeof value === 'object' ? (value as RawArrange) : undefined
  } catch {
    return undefined
  }
}

/** Các việc router bỏ hay gộp trong arrange gốc. */
export function removedOf(arrange: RawArrange | undefined): number[] {
  if (arrange === undefined) return []
  return [...(arrange.drop ?? []).map(d => d.task), ...(arrange.merge ?? []).flatMap(m => m.tasks ?? [])].filter((n): n is number => typeof n === 'number')
}

function arrangeFails(e: NonNullable<GoldenCase['expect']['arrange']>, arrange: RawArrange | undefined): string[] {
  const fails: string[] = []
  if (e.present === true && arrange === undefined) fails.push('thiếu arrange')
  if (e.present === false && arrange !== undefined) fails.push('có arrange khi không cần')
  const removed = removedOf(arrange)
  if (e.keep === true && removed.length > 0) fails.push(`bỏ hay gộp việc ${removed.join(', ')} khi không cần`)
  if (e.removes !== undefined) {
    const hit = e.removes.filter(n => removed.includes(n)).length
    const need = e.min ?? e.removes.length
    if (hit < need) fails.push(`bỏ hay gộp ${hit}/${e.removes.length} việc cần gỡ (cần ${need})`)
  }
  if (e.first !== undefined && arrange?.order?.[0] !== e.first) fails.push(`việc đầu của order là ${String(arrange?.order?.[0])}, cần ${e.first}`)
  return fails
}

export function check(c: GoldenCase, reply: string): string[] {
  const plan = parseRoute(reply, OPEN)
  if (plan === null) return ['router trả lời không đọc được']
  const fails: string[] = []
  const e = c.expect
  if (e.relation !== undefined && plan.relation !== e.relation) fails.push(`relation ${plan.relation}, cần ${e.relation}`)
  if (e.relations !== undefined && !e.relations.includes(plan.relation)) fails.push(`relation ${plan.relation}, cần ${e.relations.join('|')}`)
  if (e.intent !== undefined && !e.intent.includes(plan.intent)) fails.push(`intent ${plan.intent}, cần ${e.intent.join('|')}`)
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
  // Fable điều phối (0.8.4 C4): đọc câu trả lời thô của router (không kẹp của conductor), nên luật việc lớn phải do router tự làm.
  if (e.editAgents === true) {
    for (const task of plan.tasks) {
      const isEdit = task.kind === 'edit' || task.kind === 'mixed'
      if (isEdit && (task.run !== 'agent' || task.pick.family === 'fable')) fails.push(`việc ${task.index} sửa file mà ${task.run === 'agent' ? `giao ${task.pick.family}` : 'ở luồng chính'}`)
    }
  }
  if (e.noDelegation === true && plan.tasks.some(t => t.run === 'agent')) fails.push('việc nhỏ mà có việc giao subagent')
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
  // Điều phối lại (0.8.9 D4): chấm trường arrange của câu trả lời gốc, trước khi parseRoute lọc theo relation và intent.
  if (e.arrange !== undefined) fails.push(...arrangeFails(e.arrange, rawArrange(reply)))
  // Tiếp nối không được lập mục tiêu mới; mục tiêu mới phải có câu mục tiêu.
  const next = nextBrief(c.prev ?? null, plan, c.text, 1)
  if (c.prev !== undefined && plan.relation !== 'new' && next.isNewGoal && !plan.runReference) fails.push('tiếp nối mà lập mục tiêu mới')
  if (next.isNewGoal && next.brief.goal.trim() === '') fails.push('mục tiêu mới không có câu mục tiêu')
  return fails
}
