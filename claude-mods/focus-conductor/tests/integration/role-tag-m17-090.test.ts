// 0.9.0 vòng 2 M17: nhãn vai của dòng bước trong pane đứng sau phần chi tiết (số tool, thời gian), ở cuối dòng; không còn đứng giữa chip
// model và số tool. Band giữ như hiện nay (stepTaskMeta vẫn ghép nhãn sau model cho các nơi khác dùng).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, step, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', tasks: [task('Thiết kế luồng phí', 'agent', 'opus', 'high', { agent: 'Plan', kind: 'investigate' })] })

async function nodes($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  return (await pane.findAll({ type: 'Text' })).map(e => (e.text ?? '').trim()).filter(Boolean)
}

describe('0.9.0 vòng 2 M17: vị trí nhãn vai', () => {
  test('việc đã phân giao agent Plan đang chạy: nhãn vai đứng sau phần chi tiết, không đứng giữa chip model và số tool', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => GOAL })
    on('tool.call', { tool: /^(?:Agent|Read)$/ }, () => ({ result: 'ok' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: Thiết kế luồng phí' }] } as never)
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: 'Agent', tool_use_id: 'p1', description: 'Việc 1: Thiết kế luồng phí', prompt: 'Thiết kế.', subagent_type: 'Plan' } as never)
    await $.agent.spawn({ prompt: 'Thiết kế.', description: 'Việc 1: Thiết kế luồng phí', tool_use_id: 'p1', subagentType: 'Plan' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/repo/phi.ts', agentId: 'a-p1' } as never)
    const list = await nodes($)
    const tag = list.findIndex(t => t === '[thiết kế]')
    const tools = list.findIndex(t => /\d+ tool/.test(t))
    expect(tag).toBeGreaterThanOrEqual(0)
    expect(tools).toBeGreaterThanOrEqual(0)
    expect(tag).toBeGreaterThan(tools)
    expect(list.some(t => /\[thiết kế\]/.test(t) && /opus/.test(t))).toBe(false)
  })
})
