// 0.9.0 vòng 2 L4: bắt mẫu 085-D1c (sống cả trên 14a3a85). Đang điều phối, đã miễn bằng /conductor solo, strictDelegation mặc định (off):
// luồng chính sửa file khi còn việc ghi giao subagent chưa giao thì chỉ nhắc ở lần sửa đầu, như khi không điều phối; mức nhắc mọi lần chỉ
// theo strictDelegation remind hay block.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { base, plan, submit, task } from '../support/engine'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const GOAL = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium'), task('Sửa hàm thuế', 'agent', 'sonnet', 'medium')] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const NUDGE = 'chưa giao: Việc'
const run = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never) as Promise<{ text?: string }>
const edit = async ($: Engine, path: string) => ((await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)) as { deny?: string; context?: string[] })

describe('0.9.0 vòng 2 L4: lời nhắc giao việc khi đang điều phối mà được miễn', () => {
  test('strictDelegation off: lần sửa đầu có lời nhắc, lần sửa thứ hai không', FABLE, async ($, on) => {
    base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : GOAL) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, A)
    expect(String((await run($, 'solo')).text)).toContain('Đã miễn')
    const first = await edit($, '/repo/src/phi.ts')
    expect(first.deny).toBeUndefined()
    expect((first.context ?? []).some(c => c.includes(NUDGE))).toBe(true)
    const second = await edit($, '/repo/src/thue.ts')
    expect(second.deny).toBeUndefined()
    expect((second.context ?? []).some(c => c.includes(NUDGE))).toBe(false)
  })
})
