// 0.8.6 R5: số đo vai điều phối trên dòng Điều phối của /conductor status (số bằng 0 bỏ khỏi dòng) và nhật ký quyết định: conduct-deny mỗi
// lần từ chối, conduct-exempt mỗi lần đổi cờ miễn, conduct-self mỗi lần luồng chính tự sửa hay tự chạy kiểm khi được miễn. Số tự làm chỉ
// cộng khi lời gọi thật sự chạy (cổng khác không từ chối). Band và pane không đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const LOG = '/tmp/fc-conduct-r5.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium')] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [] })
const opts = (extra: Json = {}) => ({ options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG, ...extra } })
const PRESENTATION = { isFullscreen: false, columns: 80 }
type Out = { deny?: string }
const run = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never) as Promise<{ text?: string }>
const conductLine = async ($: Engine) => String((await run($, 'status')).text ?? '').split('\n').find(line => line.startsWith('Điều phối')) ?? ''
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>

function setup(on: On, reply: Json = BIG) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply) })
  const writes: string[] = []
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass, text: JS.bun_pass }))
  on('fs.write', (_x, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { lines }
}

describe('0.8.6 R5: số đo vai điều phối', () => {
  test('hai lần bị từ chối sửa file, một lần bị từ chối chạy kiểm: dòng Điều phối có đúng hai số; nhật ký có ba dòng conduct-deny đúng loại', opts(), async ($, on) => {
    const { lines } = setup(on)
    await submit($, A)
    await edit($)
    await edit($)
    await bash($, 'bun test')
    const line = await conductLine($)
    expect(line).toContain('từ chối sửa file 2')
    expect(line).toContain('từ chối chạy kiểm 1')
    expect(line).not.toContain('tự sửa file')
    expect(line).not.toContain('tự chạy kiểm')
    expect(line).not.toContain('đọc')
    const denies = lines().filter(l => l['kind'] === 'conduct-deny')
    expect(denies.map(l => [l['type'], l['n']])).toEqual([['write', 1], ['write', 2], ['check', 1]])
  })

  test('sau /conductor solo, một lần Edit và một lần bun test: dòng ghi đang miễn, một lần tự sửa, một lần tự chạy kiểm; nhật ký có conduct-exempt và conduct-self', opts(), async ($, on) => {
    const { lines } = setup(on)
    await submit($, A)
    await run($, 'solo')
    expect((await edit($)).deny).toBeUndefined()
    expect((await bash($, 'bun test')).deny).toBeUndefined()
    const line = await conductLine($)
    expect(line).toContain('đang miễn (lệnh solo)')
    expect(line).toContain('tự sửa file 1')
    expect(line).toContain('tự chạy kiểm 1')
    expect(lines().filter(l => l['kind'] === 'conduct-exempt').map(l => [l['state'], l['reason']])).toEqual([['on', 'solo']])
    expect(lines().filter(l => l['kind'] === 'conduct-self').map(l => [l['type'], l['n']])).toEqual([['write', 1], ['check', 1]])
    await run($, 'solo off')
    expect(lines().filter(l => l['kind'] === 'conduct-exempt').map(l => [l['state'], l['reason']])).toEqual([['on', 'solo'], ['off', 'solo']])
  })

  test('số lần đọc hiện trên dòng Điều phối', opts(), async ($, on) => {
    setup(on)
    await submit($, A)
    for (const n of [1, 2, 3]) await $.tool.call({ tool: 'Read', file_path: `src/f${n}.ts` } as never)
    expect(await conductLine($)).toContain('đọc 3')
  })

  test('được miễn nhưng cổng duyệt đang planning từ chối: số tự sửa giữ 0, không có conduct-self', opts({ planApproval: 'auto' }), async ($, on) => {
    const { lines } = setup(on)
    await submit($, A)
    await run($, 'solo')
    expect((await edit($)).deny ?? '').toContain('Kế hoạch chưa được duyệt')
    expect(await conductLine($)).not.toContain('tự sửa file')
    expect(lines().some(l => l['kind'] === 'conduct-self')).toBe(false)
  })

  test('được miễn nhưng tầng dưới từ chối (quyền của engine): số tự sửa giữ 0, không có conduct-self', opts(), async ($, on) => {
    base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG) })
    const writes: string[] = []
    on('tool.call', { tool: 'Edit' }, () => ({ deny: 'quyền: người dùng từ chối' }))
    on('fs.write', (_x, e) => {
      if (e.path === LOG) writes.push(e.text)
      return { value: undefined }
    })
    await submit($, A)
    await run($, 'solo')
    expect((await edit($)).deny ?? '').toContain('quyền')
    expect(await conductLine($)).not.toContain('tự sửa file')
    expect((writes.at(-1) ?? '').includes('conduct-self')).toBe(false)
  })

  test('Agent bị từ chối bật rồi lời gọi chạy được tắt cờ: nhật ký có hai dòng conduct-exempt lý do agent', opts(), async ($, on) => {
    const { lines } = setup(on)
    const agent = { deny: true }
    on('tool.call', { tool: 'Agent' }, () => (agent.deny ? { deny: 'quyền: người dùng từ chối' } : { result: 'đã giao' }))
    await submit($, A)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Việc 1: làm', prompt: 'x' } as never)
    agent.deny = false
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description: 'Việc 1: làm', prompt: 'x' } as never)
    expect(lines().filter(l => l['kind'] === 'conduct-exempt').map(l => [l['state'], l['reason']])).toEqual([['on', 'agent'], ['off', 'agent']])
  })

  test('vòng 2 V1: hai lần bị từ chối sửa file rồi Fable tạm ngừng (không điều phối): dòng Điều phối không có số đo', opts({ conductorFallback: 'off' }), async ($, on) => {
    const ID = 'fable'
    const FOLLOW = plan({ goal: '', relation: 'continue', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN })
    let fable = 0
    const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : seen.routerModels.at(-1) === ID ? (fable++ === 0 ? BIG : null) : FOLLOW) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, A)
    for (const _ of [1, 2]) expect((await edit($)).deny ?? '').toContain('vai điều phối không tự sửa file')
    expect(await conductLine($)).toContain('từ chối sửa file 2')
    await submit($, 'làm tiếp bước 1')
    await submit($, 'làm tiếp bước 2')
    const line = await conductLine($)
    expect(line).toContain('Fable tạm ngừng')
    expect(line).not.toContain('từ chối sửa file')
  })

  test('không điều phối (mục tiêu light): dòng Điều phối như 0.8.5', opts(), async ($, on) => {
    setup(on, LIGHT)
    await submit($, 'Sửa chú thích README')
    await edit($)
    const line = await conductLine($)
    expect(line.startsWith('Điều phối: tắt')).toBe(true)
    expect(line).not.toContain(';')
  })
})
