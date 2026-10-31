// 0.7.5 C3: cảnh báo fan-out (quá FANOUT_WARN subagent) chỉ đếm lời gọi Agent thật sự chạy ở luồng chính và không khớp việc
// đã phân: lời gọi bị từ chối, lời gọi lồng từ subagent và lần giao việc đã phân không tính. Cảnh báo chi phí không lên dòng
// cảnh báo của band (vẫn ở pane).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, FOUR, PANE, base, submit } from '../support/engine'

const FANOUT = 'subagent; mỗi agent có chi phí riêng'
const agent = ($: Engine, description: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Agent', description, prompt: `${description} trong codebase`, ...over } as never)
const BAND = (maxRows = 3) => ({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: maxRows }, view: {} } }) as const

describe('0.7.5 C3: chỉ đếm lời gọi thật sự chạy ở luồng chính', () => {
  test('8 lời gọi bị từ chối: không cảnh báo', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'không cho giao' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 8; i++) await agent($, `Tìm file ${i}`)
    expect(seen.toasts.some(t => t.includes(FANOUT))).toBe(false)
  })

  test('8 lời gọi lồng từ subagent: không cảnh báo', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 8; i++) await agent($, `Tìm file ${i}`, { agentId: 'agent-parent' })
    expect(seen.toasts.some(t => t.includes(FANOUT))).toBe(false)
  })

  test('8 lần giao việc đã phân (Việc 2): không cảnh báo', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, FOUR)
    for (let i = 0; i < 8; i++) await agent($, `Việc 2: đổi tên lô ${i}`)
    expect(seen.toasts.some(t => t.includes(FANOUT))).toBe(false)
  })

  test('7 lời gọi tự phát chạy ở luồng chính: cảnh báo đúng một lần', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 9; i++) await agent($, `Tìm file ${i}`)
    expect(seen.toasts.filter(t => t.includes(FANOUT)).length).toBe(1)
  })
})

describe('0.7.5 C3: cảnh báo chi phí không lên band', () => {
  test('cảnh báo fan-out ở pane, không ở dòng cảnh báo của band', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 7; i++) await agent($, `Tìm file ${i}`)
    const band = await $.ui.mount(BAND())
    const texts = (await band.findAll({ type: 'Text' })).map(e => e.text)
    await band.unmount()
    expect(texts.some(t => t.includes(FANOUT))).toBe(false)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: new RegExp(FANOUT) })).toBeDefined()
  })
})
