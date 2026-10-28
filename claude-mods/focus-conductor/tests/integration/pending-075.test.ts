// 0.7.5 B14: việc ghi giao subagent chỉ "đang chờ giao" khi bước checklist của nó đang làm hoặc là bước mở kế tiếp; bước của
// nó đã done hay skipped thì không còn chờ. Việc không có bước nào trong checklist thì như cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FOUR, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const edit = async ($: Engine) => ((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)) as { context?: string[] }).context ?? []
const nudgeOf = (context: string[]) => context.find(c => c.includes('Phân việc còn việc ghi giao subagent chưa giao')) ?? ''
const STEPS = [{ title: 'Việc 1: tìm chỗ gọi charge' }, { title: 'Việc 2: đổi tên userId' }, { title: 'Việc 3: thiết kế đa tiền tệ' }, { title: 'Việc 4: cập nhật README' }]

describe('0.7.5 B14: việc chờ giao theo bước checklist', () => {
  test('bước của việc 1, 2 đã done, skipped; bước kế tiếp là việc 3 (làm trực tiếp): không nhắc việc nào', { options: { strictDelegation: 'remind' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'skipped', note: 'người dùng bỏ' })
    expect(nudgeOf(await edit($))).toBe('')
  })

  test('bước của việc 4 đang làm: nhắc đúng việc 4', { options: { strictDelegation: 'remind' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'skipped', note: 'bỏ' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 4, status: 'doing' })
    const nudge = nudgeOf(await edit($))
    expect(nudge).toContain('Việc 4 (sonnet/medium)')
    expect(nudge).not.toContain('Việc 1')
  })

  test('chưa có checklist: như cũ, nhắc mọi việc chờ giao', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect(nudgeOf(await edit($))).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
  })
})
