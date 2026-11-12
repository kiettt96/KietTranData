// 0.8.6 R1: luồng chính đang điều phối bị từ chối mọi lần sửa file (Edit, Write, NotebookEdit, lệnh Bash ghi file), trừ file kế hoạch, không
// xét việc còn chờ giao và không xét blockLimit. Được miễn (/conductor solo, hay lời gọi Agent gần nhất bị từ chối mà không sinh subagent)
// thì cho chạy. Không điều phối thì strictDelegation như 0.8.5. Cổng duyệt kế hoạch từ chối trước như 0.8.5.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Sửa hàm thuế', 'main', 'sonnet', 'medium')] })
const EMPTY = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [task('Sửa chú thích', 'agent', 'sonnet', 'low'), task('Sửa ví dụ', 'agent', 'sonnet', 'low')] })
const DELEGATED = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium'), task('Sửa hàm thuế', 'agent', 'sonnet', 'medium')] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }
type Out = { deny?: string; context?: string[] }
const run = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
const edit = ($: Engine, file = 'src/phi.ts', agentId?: string) => $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b', ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>
const isConductDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự sửa file')

function setup(on: On, $: Engine, reply: (request: string) => Json) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply(request)) })
  const agent = { how: 'run' as 'run' | 'deny' }
  const writes: string[] = []
  for (const tool of ['Edit', 'Write', 'Bash']) on('tool.call', { tool }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, () => (agent.how === 'deny' ? { deny: 'quyền: người dùng từ chối' } : { result: 'đã giao' }))
  on('fs.write', (_x, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  return { agent, writes }
}

describe('0.8.6 R1: luồng chính đang điều phối không tự sửa file', () => {
  test('đã giao hết việc bằng Agent: cả bốn lần Edit bị từ chối, lời từ chối không quá 300 ký tự', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    for (const n of [1, 2]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'x' } as never)
    for (const file of ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']) {
      const r = await edit($, file)
      expect(isConductDeny(r)).toBe(true)
      expect((r.deny ?? '').length).toBeLessThanOrEqual(300)
      expect(r.deny ?? '').toContain('/conductor solo')
    }
  })

  test('router trả tasks rỗng: ba lần Edit đều bị từ chối', FABLE, async ($, on) => {
    setup(on, $, () => EMPTY)
    await submit($, A)
    for (const _ of [1, 2, 3]) expect(isConductDeny(await edit($))).toBe(true)
  })

  test('còn việc chưa giao: mọi lần Edit bị từ chối, kể cả lần thứ năm', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    for (const _ of [1, 2, 3, 4, 5]) expect(isConductDeny(await edit($))).toBe(true)
  })

  test('lệnh Bash ghi file bị từ chối; Write vào file kế hoạch và git commit được chạy', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    expect(isConductDeny(await bash($, "sed -i 's/a/b/' src/phi.ts"))).toBe(true)
    expect(isConductDeny(await bash($, 'echo x > src/ghi.txt'))).toBe(true)
    expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.claude/plans/p.md', content: 'x' } as never)).deny).toBeUndefined()
    expect((await bash($, 'git commit -m "x"')).deny).toBeUndefined()
  })

  test('Edit do subagent gọi được chạy', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    expect((await edit($, 'src/phi.ts', 'a-1')).deny).toBeUndefined()
  })

  test('sau /conductor solo: Edit được chạy; sau /conductor solo off: bị từ chối lại', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    await run($, 'solo')
    expect((await edit($)).deny).toBeUndefined()
    await run($, 'solo off')
    expect(isConductDeny(await edit($))).toBe(true)
  })

  test('lời gọi Agent bị từ chối trước khi chạy: Edit kế tiếp được chạy; sau một lời gọi Agent chạy được: bị từ chối lại', FABLE, async ($, on) => {
    const { agent } = setup(on, $, () => BIG)
    await submit($, A)
    agent.how = 'deny'
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Việc 1: làm', prompt: 'x' } as never)
    expect((await edit($)).deny).toBeUndefined()
    agent.how = 'run'
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description: 'Việc 1: làm', prompt: 'x' } as never)
    expect(isConductDeny(await edit($))).toBe(true)
  })

  test('năm lần bị từ chối liên tiếp: không cảnh báo lặp lỗi, không ghi sổ lỗi', FABLE, async ($, on) => {
    const { writes } = setup(on, $, () => BIG)
    await submit($, A)
    for (const _ of [1, 2, 3, 4, 5]) expect(isConductDeny(await edit($))).toBe(true)
    expect(writes.some(path => path.endsWith('errors.json'))).toBe(false)
    const status = String(((await run($, 'status')) as { text?: string }).text ?? '')
    expect(status).not.toContain('tool call lỗi')
  })
})

describe('0.8.6 R1: không điều phối hay cổng khác giữ như 0.8.5', () => {
  test('conductor fable, mục tiêu light: theo option, Edit không bị từ chối', FABLE, async ($, on) => {
    setup(on, $, () => LIGHT)
    await submit($, 'Sửa chú thích README')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('conductor mặc định, strictDelegation block: hai lần từ chối rồi cho chạy', { options: { planApproval: 'off', strictDelegation: 'block' } }, async ($, on) => {
    setup(on, $, () => DELEGATED)
    await submit($, A)
    expect((await edit($)).deny ?? '').toContain('Còn việc ghi giao subagent chưa giao')
    expect((await edit($)).deny ?? '').toContain('lần chặn cuối')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('cổng duyệt đang planning khi đang điều phối: lời từ chối là của cổng duyệt', { options: { planApproval: 'auto', conductor: 'fable' } }, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    const r = await edit($)
    expect(r.deny ?? '').toContain('Kế hoạch chưa được duyệt')
    expect(isConductDeny(r)).toBe(false)
  })
})
