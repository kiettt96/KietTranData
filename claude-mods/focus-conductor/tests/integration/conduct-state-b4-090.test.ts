// 0.9.0 B4 (tích hợp): luồng chính giữ vai điều phối ghi được tệp trạng thái router đọc từ prompt (B1); sửa tệp khác và chạy lệnh kiểm vẫn
// bị từ chối như 0.8.9. Dựng lại H2 cho ba tệp trạng thái, cả họ fable và họ dự phòng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const WORK = '/work/run'
const STATE = [`${WORK}/KE-HOACH.md`, `${WORK}/TIEN-DO.md`, `${WORK}/DIEM-DUNG.md`]
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const BIG = (over: Json = {}) =>
  plan({ goal: 'Sửa thống kê', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm', 'agent', 'sonnet', 'medium'), task('Viết test', 'agent', 'sonnet', 'medium')], ...over })
const opts = { options: { planApproval: 'off', conductor: 'fable' } }
type Out = { deny?: string }
const isEditDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự sửa file')
const isCheckDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự chạy lệnh kiểm')
const write = ($: Engine, path: string) => $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>

function setup(on: Parameters<typeof base>[0], reply: Json, engine: { failFamily?: string } = {}) {
  const seen = base(on, { router: () => reply, root: '/work/repo', ...engine })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => (String((e as { command?: unknown }).command ?? '').startsWith('bun test') ? { result: JS.bun_pass } : { result: '' }))
  on('turn.complete', () => ({ text: '' }))
  return seen
}

describe('0.9.0 B4: vai điều phối ghi được tệp trạng thái', () => {
  test('họ fable: Write vào ba tệp trạng thái qua; echo >> TIEN-DO.md qua; Write src/a.ts và bun test vẫn bị từ chối', opts, async ($, on) => {
    const seen = setup(on, BIG({ stateFiles: STATE }))
    await submit($, 'Sửa thống kê')
    await step($, seen, { turnId: 't1' })
    for (const path of STATE) expect(isEditDeny(await write($, path)), path).toBe(false)
    expect(isEditDeny(await bash($, `echo "- bước 1 xong" >> ${WORK}/TIEN-DO.md`))).toBe(false)
    expect(isEditDeny(await write($, '/work/repo/src/a.ts'))).toBe(true)
    expect(isEditDeny(await bash($, `echo x > ${WORK}/KHAC.md`))).toBe(true)
    expect(isCheckDeny(await bash($, 'bun test'))).toBe(true)
  })

  test('họ dự phòng (fable không phản hồi): ba tệp trạng thái vẫn ghi được, src/a.ts vẫn bị từ chối', opts, async ($, on) => {
    const seen = setup(on, BIG({ stateFiles: STATE }), { failFamily: 'fable' })
    await submit($, 'Sửa thống kê')
    await step($, seen, { turnId: 't1' })
    await step($, seen, { turnId: 't2' })
    await step($, seen, { turnId: 't3' })
    for (const path of STATE) expect(isEditDeny(await write($, path)), path).toBe(false)
    expect(isEditDeny(await write($, '/work/repo/src/a.ts'))).toBe(true)
  })

  test('router không trả tệp trạng thái: như 0.8.9, Write TIEN-DO.md bị từ chối', opts, async ($, on) => {
    const seen = setup(on, BIG())
    await submit($, 'Sửa thống kê')
    await step($, seen, { turnId: 't1' })
    expect(isEditDeny(await write($, `${WORK}/TIEN-DO.md`))).toBe(true)
  })
})
