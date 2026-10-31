// 0.7.6 U2: dòng cần chú ý của band chọn theo mức độ, không theo cảnh báo mới nhất: tạm dừng > lô lỗi chưa giao lại > sửa ngoài phạm vi
// > báo hạn mức mềm > mục bị bỏ > bước chưa kiểm chứng > vượt ngân sách tool call. Cảnh báo ngân sách không lên band khi mục tiêu có giao
// subagent theo kế hoạch (vẫn lưu, pane vẫn ghi). "+N" đếm phần còn lại.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, submit, task } from '../support/engine'

const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const PLAN = 'mcp__focus-conductor__plan'

async function bandTexts($: Engine) {
  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '')
  await ui.unmount()
  return texts
}
const routerOf = (agents: boolean) => () =>
  plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small', scope: ['src/'], tasks: agents ? [task('Lọc log lỗi', 'agent', 'sonnet', 'medium')] : [] })

async function scopeThenUnverified($: Engine) {
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
}

describe('0.7.6 U2: dòng cần chú ý theo mức độ', () => {
  test('cảnh báo phạm vi đến trước, cảnh báo bước chưa kiểm chứng đến sau: band vẫn hiện cảnh báo phạm vi, kèm +1', async ($, on) => {
    base(on, { router: routerOf(false) })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    await scopeThenUnverified($)
    const texts = await bandTexts($)
    expect(texts.some(t => t.includes('ngoài phạm vi'))).toBe(true)
    expect(texts.some(t => t.includes('ghi verified') || t.includes('ghi đã kiểm chứng'))).toBe(false)
    expect(texts).toContain('+1')
  })

  test('vượt ngân sách tool call không lên band khi mục tiêu có giao subagent theo kế hoạch; pane vẫn ghi', async ($, on) => {
    base(on, { router: routerOf(true) })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, 'Sửa module thanh toán trong src/')
    await $.turn.start({ text: 'làm', turnId: 'u2' } as never)
    for (let i = 0; i < 60; i++) await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` } as never)
    const texts = await bandTexts($)
    expect(texts.some(t => t.includes('vượt mức dự kiến'))).toBe(false)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /vượt mức dự kiến/ })).toBeDefined()
    await pane.unmount()
  })

  test('mục tiêu không giao subagent: vượt ngân sách vẫn lên band khi là cảnh báo duy nhất', async ($, on) => {
    base(on, { router: routerOf(false) })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, 'Sửa module thanh toán trong src/')
    await $.turn.start({ text: 'làm', turnId: 'u2b' } as never)
    for (let i = 0; i < 60; i++) await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` } as never)
    expect((await bandTexts($)).some(t => t.includes('vượt mức dự kiến'))).toBe(true)
  })

  test('lô lỗi chưa giao lại đứng trên cảnh báo phạm vi', async ($, on) => {
    base(on, { router: routerOf(true) })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('turn.complete', () => ({ text: '' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
    await scopeThenUnverified($)
    for (const n of [1, 2]) {
      const id = `x${n}`
      await $.tool.call({ tool: 'Agent', tool_use_id: id, description: `Việc 1: lọc log lỗi lô ${n}`, prompt: 'lọc', model: 'sonnet' } as never)
      await $.agent.spawn({ prompt: 'lọc', description: `Việc 1: lọc log lỗi lô ${n}`, tool_use_id: id } as never)
      await $.turn.start({ text: 'lọc', turnId: `a-${id}`, agentId: `ag-${id}` } as never)
      await $.turn.complete({ turnId: `a-${id}`, agentId: `ag-${id}`, answer: '', durationMs: 5, isAborted: false, reason: n === 1 ? 'error' : 'answer' } as never)
    }
    const texts = await bandTexts($)
    expect(texts.some(t => /lô lỗi chưa giao lại/.test(t))).toBe(true)
    expect(texts.some(t => t.includes('ngoài phạm vi'))).toBe(false)
    expect(texts).toContain('+2')
  })
})
