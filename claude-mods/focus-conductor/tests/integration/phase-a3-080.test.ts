// 0.8.0 A3: đợt giao việc mới trong cùng mục tiêu. Prompt tiếp nối có danh sách việc riêng (từ 3 mục đánh số hay có mã) và thêm từ 3 việc
// thì mở đợt mới: việc của đợt trước đã xong được cất (pane gập một dòng "k việc của đợt trước"), ràng buộc và yêu cầu đã phủ hay thuộc việc
// đã cất được cất theo (giữ quy định model và ràng buộc của prompt lập mục tiêu), checklist giữ các bước mở. Vẫn đầy thì mục mới thay mục cũ ở
// cuối kèm cảnh báo, không bỏ mục mới. Router xếp mục tiêu mới với tin cậy thấp khi checklist còn bước mở cũng mở đợt mới, không thay checklist.
// Plan set giữa mục tiêu cất các việc đã xong theo checklist cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../../hooks/lib/router'
import type { Policy, RouterPlan } from '../../hooks/lib/router'
import type { Brief, Task } from '../../types'
import { makeBrief } from '../support/commands'
import { PANE, base, plan, step, submit, task } from '../support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const PLAN = 'mcp__focus-conductor__plan'

const oldTask = (i: number, covers?: number[]): Task => ({ index: i, title: `Việc ${i}: phần cũ ${i}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, kind: 'edit', ...(covers !== undefined ? { covers } : {}) }) as Task
const NEW_TASKS = Array.from({ length: 8 }, (_, i) => task(`Phần mới ${i + 1}`, 'main', 'sonnet', 'medium'))
const NEW_PROMPT = Array.from({ length: 8 }, (_, i) => `${i + 1}. Phần mới ${i + 1}`).join('\n')
const BASE_REQ = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const MORE_REQ = Array.from({ length: 10 }, (_, i) => `Yêu cầu thêm ${i + 1}`)
const FRESH_REQ = Array.from({ length: 5 }, (_, i) => `Yêu cầu đợt mới ${i + 1}`)
/** Sáu việc cũ phủ 30 yêu cầu gốc (5 yêu cầu mỗi việc). */
const SIX = Array.from({ length: 6 }, (_, k) => oldTask(k + 1, [1, 2, 3, 4, 5].map(r => k * 5 + r)))

type PhaseOut = ReturnType<typeof nextBrief> & { phase?: boolean }
const run = (prev: Brief, over: Record<string, unknown>, prompt: string, options: Record<string, unknown>) => nextBrief(prev, routed(over), prompt, 2, options as never) as PhaseOut
const field = (brief: Brief, key: string) => (brief as unknown as Record<string, unknown>)[key]

describe('0.8.0 A3: mở đợt mới', () => {
  test('6 việc đã xong, prompt continue có 8 việc mới đánh số: đợt 2, 8 việc, 6 việc cũ được cất', () => {
    const prev = makeBrief({ tasks: SIX, steps: SIX.map(t => t.title) })
    const out = run(prev, { relation: 'continue', goal: '', tasks: NEW_TASKS }, NEW_PROMPT, { openSteps: [], doneTasks: new Set([1, 2, 3, 4, 5, 6]) })
    expect(out.isNewGoal).toBe(false)
    expect(field(out.brief, 'phase')).toBe(2)
    expect(out.brief.tasks.length).toBe(8)
    expect(field(out.brief, 'archived')).toBe(6)
  })

  test('yêu cầu đầy 40 mục, 30 mục thuộc việc đã xong: yêu cầu của prompt mới được giữ, không có mục bị bỏ hay bị thay', () => {
    const prev = makeBrief({ tasks: SIX, steps: SIX.map(t => t.title), requirements: [...BASE_REQ, ...MORE_REQ], requirementsBase: 30 })
    const out = run(prev, { relation: 'continue', goal: '', tasks: NEW_TASKS, requirements: FRESH_REQ }, NEW_PROMPT, { openSteps: [], doneTasks: new Set([1, 2, 3, 4, 5, 6]) })
    for (const item of FRESH_REQ) expect(out.brief.requirements).toContain(item)
    expect(out.dropped).toBe(0)
    expect(out.replaced).toEqual([])
  })

  test('yêu cầu đầy 40 mục đều còn mở: mục mới thay mục cũ ở cuối, có danh sách mục bị thay, không có mục bị bỏ', () => {
    const prev = makeBrief({ tasks: [...SIX, oldTask(7, MORE_REQ.map((_, i) => 31 + i))], steps: [], requirements: [...BASE_REQ, ...MORE_REQ], requirementsBase: 30 })
    const out = run(prev, { relation: 'continue', goal: '', tasks: NEW_TASKS, requirements: FRESH_REQ }, NEW_PROMPT, { openSteps: ['Việc 1: phần cũ 1'], doneTasks: new Set() })
    // 0.8.7 L2: yêu cầu không còn trần, nên mục mới được thêm, không thay mục nào; mọi mục cũ còn.
    for (const item of FRESH_REQ) expect(out.brief.requirements).toContain(item)
    expect(out.dropped).toBe(0)
    expect(out.replaced).toEqual([])
    for (const item of [...BASE_REQ, ...MORE_REQ]) expect(out.brief.requirements).toContain(item)
  })

  test('router xếp new tin cậy 0.7 khi còn 3 bước mở: không lập mục tiêu mới, mở đợt mới', () => {
    const prev = makeBrief({ tasks: SIX.slice(0, 3), steps: SIX.slice(0, 3).map(t => t.title) })
    const out = run(prev, { relation: 'new', confidence: 0.7, goal: 'Mục tiêu khác', tasks: NEW_TASKS }, NEW_PROMPT, { openSteps: ['A', 'B', 'C'], doneTasks: new Set() })
    expect(out.isNewGoal).toBe(false)
    expect(out.brief.goalId).toBe(prev.goalId)
    expect(field(out.brief, 'phase')).toBe(2)
  })

  test('new tin cậy 0.9 khi không còn bước mở: mục tiêu mới như trước', () => {
    const prev = makeBrief({ tasks: SIX, steps: SIX.map(t => t.title) })
    const out = run(prev, { relation: 'new', confidence: 0.9, goal: 'Mục tiêu khác', tasks: NEW_TASKS }, NEW_PROMPT, { openSteps: [], doneTasks: new Set([1, 2, 3, 4, 5, 6]) })
    expect(out.isNewGoal).toBe(true)
  })

  test('câu ngắn "chạy tiếp đi" không mở đợt', () => {
    const prev = makeBrief({ tasks: SIX, steps: SIX.map(t => t.title) })
    const out = run(prev, { relation: 'continue', goal: '' }, 'chạy tiếp đi', { openSteps: [], doneTasks: new Set([1, 2, 3, 4, 5, 6]) })
    expect(field(out.brief, 'phase') ?? 1).toBe(1)
    expect(out.brief.tasks.length).toBe(6)
  })
})

const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
async function paneText($: Engine): Promise<string> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
  await pane.unmount()
  return texts
}

const S_TASKS = Array.from({ length: 6 }, (_, i) => task(`S${i}: phần cũ ${i}`, 'main', 'sonnet', 'medium'))
const FIRST = plan({ goal: 'Chạy lô kiểm', depth: 'substantial', volume: 'large', tasks: S_TASKS })
const SECOND = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'large', tasks: NEW_TASKS })

describe('0.8.0 A3: đầu cuối', () => {
  test('prompt continue có 8 việc mới: pane gập 6 việc đã xong thành một dòng, câu báo đợt mới một lần, tối đa 160 ký tự', { options: { planApproval: 'off' } }, async ($, on) => {
    let call = 0
    const seen = base(on, { router: () => (call++ === 0 ? FIRST : SECOND) })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Chạy lô kiểm S0 đến S5')
    await $.tool.call({ tool: PLAN, action: 'set', steps: S_TASKS.map(t => ({ title: String(t['title']) })) })
    await $.turn.start({ text: 'Chạy lô kiểm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    for (let id = 1; id <= 6; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' })
    await submit($, NEW_PROMPT)
    const texts = await paneText($)
    expect(texts).toContain('6 việc của đợt trước')
    expect(texts).toContain('Phần mới 8')
    const notes = (seen.contexts[1] ?? []).filter(c => c.includes('Đợt 2'))
    expect(notes.length).toBe(1)
    expect(notes[0]?.length ?? 0).toBeLessThanOrEqual(160)
  })

  test('router xếp new tin cậy 0.7 khi checklist còn 3 bước mở: không mất bước nào', { options: { planApproval: 'off' } }, async ($, on) => {
    let call = 0
    const seen = base(on, { router: () => (call++ === 0 ? FIRST : plan({ relation: 'new', confidence: 0.7, goal: 'Lô khác', tasks: NEW_TASKS })) })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Chạy lô kiểm S0 đến S5')
    await $.tool.call({ tool: PLAN, action: 'set', steps: S_TASKS.map(t => ({ title: String(t['title']) })) })
    await $.turn.start({ text: 'Chạy lô kiểm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    for (let id = 1; id <= 3; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' })
    await submit($, NEW_PROMPT)
    const plan1 = await shown($)
    for (const t of S_TASKS.slice(3)) expect(plan1).toContain(String(t['title']))
  })

  test('sáu việc S0 đến S5 đã xong, rồi plan set mười bước V0 đến V9: sáu việc gập vào đợt trước, không việc nào đang làm', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => FIRST })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Chạy lô kiểm S0 đến S5')
    await $.tool.call({ tool: PLAN, action: 'set', steps: S_TASKS.map(t => ({ title: String(t['title']) })) })
    await $.turn.start({ text: 'Chạy lô kiểm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    for (let id = 1; id <= 6; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: Array.from({ length: 10 }, (_, i) => ({ title: `V${i}: phần mới ${i}` })) })
    const texts = await paneText($)
    expect(texts).toContain('6 việc của đợt trước')
    expect(texts).not.toContain('phần cũ 2')
  })
})
