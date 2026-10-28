// 0.7.5 M11 (vòng sửa 2): việc giao subagent có mã (BƯỚC N, mã mục) chỉ "đang chờ giao" khi xác định được bước checklist của nó.
// Chưa có checklist, hoặc tiêu đề các bước checklist không mang mã nào: chưa xác định được bước của việc có mã, nên không nhắc
// và không chặn (strictDelegation remind, block). Checklist có mã mà chưa có bước của việc đó, và việc không mã: như B14, vẫn chờ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FOUR, base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ context?: string[]; deny?: string }>
const nudgeOf = (out: { context?: string[] }) => (out.context ?? []).find(c => c.includes('Phân việc còn việc ghi giao subagent chưa giao')) ?? ''
const CODED = () => plan({
  goal: 'Cập nhật dữ liệu theo các bước',
  depth: 'hard',
  volume: 'large',
  tasks: [
    task('BƯỚC 2: đổi tên userId', 'agent', 'sonnet', 'medium'),
    task('BƯỚC 3: thiết kế đa tiền tệ', 'main', 'opus', 'xhigh', { kind: 'answer', depth: 'hard' }),
    task('BƯỚC 4: cập nhật README', 'agent', 'sonnet', 'medium'),
  ],
})
const REMIND = { options: { strictDelegation: 'remind' } }
const BLOCK = { options: { strictDelegation: 'block' } }

describe('0.7.5 M11: việc có mã khi chưa xác định được bước', () => {
  test('chưa có checklist: strictDelegation remind không nhắc việc có mã', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect(nudgeOf(await edit($))).toBe('')
  })

  test('chưa có checklist: strictDelegation block không chặn sửa file vì việc có mã', BLOCK, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect((await edit($)).deny).toBeUndefined()
  })

  test('checklist mà tiêu đề các bước không mang mã: không nhắc việc có mã', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đổi tên userId' }, { title: 'Thiết kế đa tiền tệ' }, { title: 'Cập nhật README' }] })
    expect(nudgeOf(await edit($))).toBe('')
  })

  test('checklist có mã nhưng chưa có bước của việc: vẫn chờ (như B14)', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 1: đọc yêu cầu' }, { title: 'BƯỚC 2: đổi tên userId' }] })
    const nudge = nudgeOf(await edit($))
    expect(nudge).toContain('Việc 3 (sonnet/medium)')
    expect(nudge).not.toContain('Việc 1')
  })

  test('checklist trộn bước có mã và bước không mã: coi là checklist có mã, việc chưa có bước vẫn chờ', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 2: đổi tên userId' }, { title: 'Dọn dẹp cuối' }] })
    expect(nudgeOf(await edit($))).toContain('Việc 1 (sonnet/medium), 3 (sonnet/medium)')
  })

  test('checklist đánh số Việc N cũng là checklist có mã', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: đổi tên userId' }] })
    expect(nudgeOf(await edit($))).toContain('Việc 1 (sonnet/medium), 3 (sonnet/medium)')
  })

  test('checklist có mã, bước BƯỚC 4 đang làm: nhắc đúng việc đó', REMIND, async ($, on) => {
    base(on, { router: CODED })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 2: đổi tên userId' }, { title: 'BƯỚC 4: cập nhật README' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' })
    expect(nudgeOf(await edit($))).toContain('Việc 3 (sonnet/medium)')
  })

  test('việc không mã (FOUR) chưa có checklist: vẫn nhắc như cũ', REMIND, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect(nudgeOf(await edit($))).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
  })
})
