// 0.7.5 A1: từ engine 2.1.301, turn.start phát cả cho lần chạy của subagent (có agentId). Bộ đếm thay đổi của luồng chính
// không được tạo lại khi một subagent bắt đầu: cổng Stop và nhịp checkpoint của turn luồng chính vẫn giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const subagentStart = ($: Engine, n: number) => $.turn.start({ text: 'lô dữ liệu', turnId: `a${n}`, agentId: `agent-${n}` } as never)
const edit = ($: Engine, n: number) => $.tool.call({ tool: 'Edit', file_path: `src/f${n}.ts`, old_string: 'a', new_string: 'b' } as never) as Promise<{ context?: string[] }>

describe('0.7.5 A1: turn.start của subagent không xóa bộ đếm của luồng chính', () => {
  test('Stop vẫn chặn khi checklist còn mở sau khi một subagent bắt đầu giữa turn', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    await edit($, 1)
    await subagentStart($, 1)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
  })

  test('40 lần sửa xen 10 lần subagent bắt đầu: checkpoint ở 5, 10, 20, 40', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    const fired: number[] = []
    for (let n = 1; n <= 40; n++) {
      if (n % 4 === 0) await subagentStart($, n / 4)
      const out = await edit($, n)
      if ((out.context ?? []).some(c => c.includes('Checkpoint:'))) fired.push(n)
    }
    expect(fired).toEqual([5, 10, 20, 40])
  })

  test('turn.start của luồng chính vẫn mở bộ đếm mới (turn sau không bị chặn)', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await edit($, 1)
    await $.turn.start({ text: 'giải thích bước 1', turnId: 't2' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })
})
