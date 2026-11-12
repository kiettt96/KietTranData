// 0.8.5 D1: khi luồng chính đang giữ vai điều phối cho mục tiêu hiện tại, mức strictDelegation hiệu dụng là block (option off hay remind):
// sửa file trong khi còn việc ghi giao subagent chưa giao bị từ chối tối đa blockLimit lần mỗi mục tiêu; lời nhắc sau đó theo option
// strictDelegation như 0.8.4 (mặc định nhắc một lần). Không điều phối thì theo option như 0.8.4. File kế hoạch không bị từ chối.
// 0.8.6 R1: hai ca đầu đổi kỳ vọng (giữ tên): luồng chính đang điều phối bị từ chối mọi lần sửa file, kể cả khi đã giao hết việc.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
/** Mục tiêu lớn có hai việc sửa file; router điều phối chuyển việc sửa của luồng chính thành việc giao subagent. */
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Sửa hàm thuế', 'main', 'sonnet', 'medium')] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [task('Sửa chú thích', 'agent', 'sonnet', 'low'), task('Sửa ví dụ', 'agent', 'sonnet', 'low')] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ deny?: string; context?: string[] }>
const nudged = (r: { context?: string[] }) => (r.context ?? []).join('\n').includes('chưa giao')

function setup(on: On, reply: Json) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply) })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

describe('0.8.5 D1: luồng chính điều phối không tự sửa file khi còn việc chưa giao', () => {
  test('blockLimit mặc định: hai lần Edit đầu bị từ chối, lần ba được chạy kèm lời nhắc, lần bốn không kèm', FABLE, async ($, on) => {
    setup(on, BIG)
    await submit($, A)
    // 0.8.6 R1: luồng chính đang điều phối bị từ chối mọi lần sửa file, không còn trần blockLimit và không còn lời nhắc sau lần chặn cuối.
    for (const _ of [1, 2, 3, 4]) {
      const r = await edit($)
      expect(String(r.deny ?? '')).toContain('vai điều phối không tự sửa file')
      expect(nudged(r)).toBe(false)
    }
  })

  test('đã giao hết việc bằng Agent: Edit ở luồng chính không bị từ chối', FABLE, async ($, on) => {
    setup(on, BIG)
    await submit($, A)
    for (const n of [1, 2]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'x' } as never)
    // 0.8.6 R1: giao hết việc rồi vẫn bị từ chối khi luồng chính đang điều phối.
    expect(String((await edit($)).deny ?? '')).toContain('vai điều phối không tự sửa file')
  })

  test('file kế hoạch không bị từ chối', FABLE, async ($, on) => {
    setup(on, BIG)
    await submit($, A)
    expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.claude/plans/p.md', content: 'x' } as never)).deny).toBeUndefined()
  })

  test('conductor mặc định, strictDelegation mặc định: Edit không bị từ chối', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on, BIG)
    await submit($, A)
    expect((await edit($)).deny).toBeUndefined()
  })

  test('conductor fable, mục tiêu light (không điều phối): theo option, Edit không bị từ chối', FABLE, async ($, on) => {
    setup(on, LIGHT)
    await submit($, 'Sửa chú thích README')
    expect((await edit($)).deny).toBeUndefined()
  })
})
