// 0.8.6 R3: luồng chính đang điều phối được đọc file, mỗi lời gọi Read, Grep, Glob (trừ file kế hoạch và thư mục .focus-conductor/) cộng số
// lần đọc của mục tiêu; số đếm chạm bội số của option conductorReads (mặc định 20, 0 là tắt) thì kết quả kèm một dòng nhắc giao subagent
// tra cứu. Không từ chối lời gọi đọc nào.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium')] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [] })
const fable = (extra: Json = {}) => ({ options: { planApproval: 'off', conductor: 'fable', ...extra } })
type Out = { deny?: string; context?: string[] }
const READ_NOTE = 'việc tra cứu khối lượng lớn nên giao'
const noted = (r: Out) => (r.context ?? []).some(line => line.includes(READ_NOTE))

function setup(on: On, reply: Json = BIG) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply) })
  for (const tool of ['Read', 'Grep', 'Glob']) on('tool.call', { tool }, () => ({ result: 'nội dung', isReadOnly: true }))
}
const read = ($: Engine, file: string, agentId?: string) => $.tool.call({ tool: 'Read', file_path: file, ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Out>
/** Gọi Read `count` lần ở luồng chính; trả số thứ tự các lần có dòng nhắc. */
async function reads($: Engine, count: number, from = 1): Promise<number[]> {
  const at: number[] = []
  for (let n = from; n < from + count; n++) {
    const r = await read($, `src/f${n}.ts`)
    expect(r.deny).toBeUndefined()
    if (noted(r)) at.push(n)
  }
  return at
}

describe('0.8.6 R3: dòng nhắc đọc của vai điều phối', () => {
  test('mặc định: lần đọc thứ 20 và 40 kèm dòng nhắc, các lần khác không; dòng nhắc không quá 200 ký tự', fable(), async ($, on) => {
    setup(on)
    await submit($, A)
    expect(await reads($, 19)).toEqual([])
    const twentieth = await read($, 'src/f20.ts')
    expect(noted(twentieth)).toBe(true)
    const line = (twentieth.context ?? []).find(item => item.includes(READ_NOTE)) ?? ''
    expect(line).toContain('20')
    expect(line.length).toBeLessThanOrEqual(200)
    expect(await reads($, 20, 21)).toEqual([40])
  })

  test('conductorReads 0: không bao giờ nhắc', fable({ conductorReads: 0 }), async ($, on) => {
    setup(on)
    await submit($, A)
    expect(await reads($, 25)).toEqual([])
  })

  test('conductorReads 3: nhắc ở lần 3 và 6', fable({ conductorReads: 3 }), async ($, on) => {
    setup(on)
    await submit($, A)
    expect(await reads($, 7)).toEqual([3, 6])
  })

  test('Grep và Glob cũng được đếm', fable({ conductorReads: 3 }), async ($, on) => {
    setup(on)
    await submit($, A)
    await read($, 'src/a.ts')
    expect(noted((await $.tool.call({ tool: 'Grep', pattern: 'phi' } as never)) as Out)).toBe(false)
    expect(noted((await $.tool.call({ tool: 'Glob', pattern: 'src/**/*.ts' } as never)) as Out)).toBe(true)
  })

  test('Read do subagent gọi không được đếm', fable({ conductorReads: 3 }), async ($, on) => {
    setup(on)
    await submit($, A)
    await reads($, 2)
    for (let n = 0; n < 5; n++) expect(noted(await read($, `src/s${n}.ts`, 'a-1'))).toBe(false)
    expect(noted(await read($, 'src/f3.ts'))).toBe(true)
  })

  test('Read khi không điều phối (mục tiêu light) không được đếm', fable({ conductorReads: 3 }), async ($, on) => {
    setup(on, LIGHT)
    await submit($, 'Sửa chú thích README')
    expect(await reads($, 7)).toEqual([])
  })

  test('đọc file kế hoạch và thư mục .focus-conductor không được đếm', fable({ conductorReads: 3 }), async ($, on) => {
    setup(on)
    await submit($, A)
    await reads($, 2)
    expect(noted(await read($, '/repo/.claude/plans/p.md'))).toBe(false)
    expect(noted(await read($, '/repo/.focus-conductor/errors.json'))).toBe(false)
    expect(noted(await read($, 'src/f3.ts'))).toBe(true)
  })
})
