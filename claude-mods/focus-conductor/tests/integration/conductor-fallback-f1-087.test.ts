// 0.8.7 F1 (tích hợp): Fable không dùng được giữa chừng thì họ dự phòng (mặc định opus) nhận vai điều phối với đủ kỷ luật của 0.8.6:
// router dùng họ dự phòng với biến thể điều phối, luồng chính chạy <họ>/medium, sửa file và lệnh kiểm của luồng chính bị từ chối. Fable dùng
// lại được thì quay về Fable. conductorFallback off, nguyên nhân là cấu hình, mục tiêu nhỏ, hay họ dự phòng cũng lỗi: như 0.8.6.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { ROUTER_TIMEOUT, base, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const LOG = '/tmp/fc-conductor-fallback-f1-087.jsonl'
const A = 'Sửa luồng thanh toán'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const BIG = (over: Json = {}) => plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium'), task('Viết test', 'agent', 'sonnet', 'medium'), task('Cập nhật tài liệu', 'agent', 'haiku', 'low')], ...over })
const FOLLOW = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN })
const LIGHT = plan({ goal: 'Sửa lỗi chính tả README', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const opts = (over: Record<string, unknown> = {}) => ({ options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG, ...over } })
const PRESENTATION = { isFullscreen: false, columns: 80 }
type Out = { deny?: string; context?: string[]; result?: unknown }
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>
const isEditDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự sửa file')
const isCheckDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự chạy lệnh kiểm')
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const prompts = (seen: Seen) => seen.routerCalls.filter(c => c.kind === 'prompt')
const MARK = 'DAU_CHO_GIUA_XQ'
const LONG = `${A}. ${'a'.repeat(70_000)}${MARK}${'b'.repeat(30_000)}`

/** Router giả theo model: `reply(model, n)` với n là số lượt của model đó; null là lỗi API. */
function setup(on: On, reply: (model: string, n: number) => Json | string | null, engine: { failFamily?: string } = {}) {
  const counts = new Map<string, number>()
  const seen: Seen = base(on, {
    router: request => {
      if (request.startsWith('Requirements:')) return { missing: [], extra: [], issues: [] }
      const model = seen.routerModels.at(-1) ?? ''
      const n = counts.get(model) ?? 0
      counts.set(model, n + 1)
      return reply(model, n)
    },
    ...engine,
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => (String((e as { command?: unknown }).command ?? '').startsWith('bun test') ? { result: JS.bun_pass, text: JS.bun_pass } : { result: 'ok', isReadOnly: true }))
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

describe('0.8.7 F1: router Fable tạm ngừng thì opus nhận vai điều phối', () => {
  test('router Fable lỗi hai lần: prompt kế router opus effort medium; luồng chính opus/medium; Edit và bun test bị từ chối; status ghi opus và dự phòng', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual(['fable', 'fable', 'fable', 'opus'])
    expect(prompts(seen).at(-1)).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(pick(await step($, seen, { turnId: 't4' }))).toBe('claude-opus-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(true)
    expect(isCheckDeny(await bash($, 'bun test'))).toBe(true)
    const status = await run($, 'status')
    const line = status.split('\n').find(l => l.startsWith('Điều phối')) ?? ''
    expect(line).toContain('opus')
    expect(line).toContain('dự phòng')
  })

  test('hết thời gian tạm ngừng của router Fable: prompt kế router là Fable, luồng chính fable/medium; có toast và dòng nhật ký quay về', opts(), async ($, on) => {
    const { seen, lines } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : n <= 2 ? null : FOLLOW) : FOLLOW))
    for (let i = 0; i < 6; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual(['fable', 'fable', 'fable', 'opus', 'opus', 'opus'])
    await submit($, 'làm tiếp bước 6')
    expect(prompts(seen).at(-1)?.model).toBe('fable')
    expect(pick(await step($, seen, { turnId: 't7' }))).toBe('claude-fable-5-2/medium')
    expect(seen.toasts.some(t => t.includes('opus') && t.includes('fable'))).toBe(true)
    expect(lines().some(l => l['kind'] === 'conductor' && l['from'] === 'opus' && l['to'] === 'fable')).toBe(true)
  })
})

describe('0.8.7 F1: Fable không phản hồi ở turn của luồng chính', () => {
  for (const [engine, model] of [['2.1.296', 'claude-opus-5-5'], ['2.1.323', 'opus']] as const) {
    test(`engine ${engine}: phần còn lại của turn chạy ${model}/medium, không phải model của phiên`, opts(), async ($, on) => {
      const { seen } = setup(on, () => BIG(), { failFamily: 'fable' })
      on('session.version', () => ({ value: { version: engine } }) as never)
      await submit($, A)
      await step($, seen, { turnId: 't1' })
      expect(pick(seen.steps.at(-1))).toBe(`${model}/medium`)
    })
  }

  test('không phản hồi hai turn liên tiếp: họ fable bị chặn, turn sau chạy opus/medium với vai điều phối', opts(), async ($, on) => {
    const { seen } = setup(on, () => BIG(), { failFamily: 'fable' })
    await submit($, A)
    await step($, seen, { turnId: 't1' })
    await step($, seen, { turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't3' }))).toBe('claude-opus-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(true)
  })
})

describe('0.8.7 F1: lượt đọc prompt của Fable lỗi', () => {
  test('bị API từ chối: lượt dự phòng gửi request trọn cho opus, không cắt; mục tiêu theo opus; không cảnh báo cắt prompt', opts(), async ($, on) => {
    const OPUS_GOAL = plan({ goal: 'Mục tiêu theo opus', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN })
    const { seen } = setup(on, model => (model === 'fable' ? null : OPUS_GOAL))
    await submit($, LONG)
    expect(seen.routerModels.slice(0, 2)).toEqual(['fable', 'opus'])
    expect((seen.routed[1] ?? '').includes(MARK)).toBe(true)
    expect(await run($, 'status')).toContain('Mục tiêu theo opus')
    expect((seen.contexts.at(-1) ?? []).join('\n')).not.toContain('router chưa đọc phần giữa')
  })

  test('hết giờ: lượt dự phòng cắt 80.000 ký tự như L3', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' && n === 0 ? ROUTER_TIMEOUT : BIG()))
    await submit($, LONG)
    expect((seen.routed[1] ?? '').includes(MARK)).toBe(false)
    expect((seen.routed[1] ?? '').includes('lược')).toBe(true)
  })
})

describe('0.8.7 F1: chuyển giao giữ nguyên trạng thái', () => {
  test('checklist 5 bước, 2 lần bị từ chối sửa file, /conductor solo đặt trước: đổi sang opus giữ checklist, số đo và solo', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
    await submit($, A)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [1, 2, 3, 4, 5].map(i => ({ title: `Bước ${i}` })) } as never)
    await step($, seen, { turnId: 't1' })
    expect(isEditDeny(await edit($))).toBe(true)
    expect(isEditDeny(await edit($))).toBe(true)
    const before = await run($, 'status')
    await run($, 'solo')
    for (let i = 1; i <= 3; i++) await submit($, `làm tiếp bước ${i}`)
    expect(prompts(seen).at(-1)?.model).toBe('opus')
    const after = await run($, 'status')
    expect(after).toContain('Bước 5')
    const denied = (text: string) => (text.split('\n').find(l => l.startsWith('Điều phối')) ?? '').match(/từ chối sửa file \d+/)?.[0]
    expect(denied(before)).toBe('từ chối sửa file 2')
    expect(denied(after)).toBe(denied(before))
    expect(isEditDeny(await edit($))).toBe(false)
  })
})

describe('0.8.7 F1: như 0.8.6 khi không có dự phòng', () => {
  test('conductorFallback off: router là option router, luồng chính theo router và tự sửa file được', opts({ conductorFallback: 'off' }), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).at(-1)?.model).toBe('sonnet')
    expect(pick(await step($, seen, { turnId: 't4' }))).toBe('claude-sonnet-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(false)
  })

  test('conductorFallback sonnet: router và luồng chính dự phòng là sonnet/medium, vẫn từ chối sửa file', opts({ conductorFallback: 'sonnet' }), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).at(-1)).toMatchObject({ model: 'sonnet', effort: 'medium' })
    expect(pick(await step($, seen, { turnId: 't4' }))).toBe('claude-sonnet-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(true)
  })

  test('router opus cũng lỗi hai lần: như 0.8.6 khi Fable không sẵn sàng (router sonnet, luồng chính tự sửa file được)', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : model === 'opus' ? null : FOLLOW))
    for (let i = 0; i < 6; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual(['fable', 'fable', 'fable', 'opus', 'opus', 'sonnet'])
    expect(isEditDeny(await edit($))).toBe(false)
  })

  test('họ opus bị chặn (không phản hồi hai turn) rồi Fable tạm ngừng: như 0.8.6', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW), { failFamily: 'opus' })
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    await step($, seen, { turnId: 't4' })
    await step($, seen, { turnId: 't5' })
    await submit($, 'làm tiếp bước 4')
    expect(prompts(seen).at(-1)?.model).toBe('sonnet')
    expect(isEditDeny(await edit($))).toBe(false)
  })

  for (const [name, options, before] of [
    ['routing khác auto', opts(), 'mode suggest'],
    ['phiên không tương tác', opts({ headlessRouting: 'off' }), null],
    ['sessionModel giữ model của phiên', opts({ sessionModel: 'fixed' }), null],
    ['conductor tắt', { options: { planApproval: 'off', decisionLog: LOG } }, null],
  ] as const) {
    test(`Fable không điều phối vì ${name}: không kích hoạt dự phòng`, options, async ($, on) => {
      const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
      if (name === 'phiên không tương tác') {
        on('session.start', (_$, e) => ({ cwd: e.cwd }))
        await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
      }
      if (name === 'sessionModel giữ model của phiên') await step($, seen, { turnId: 't0', model: 'claude-sonnet-5-5' })
      if (before !== null) await run($, before)
      for (let i = 0; i < 5; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
      expect(seen.routerModels.includes('opus')).toBe(false)
    })
  }

  test('mục tiêu light khi Fable không dùng được: không có vai điều phối', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? LIGHT : null) : plan({ relation: 'continue', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? 'Sửa lỗi chính tả README' : `làm tiếp bước ${i}`)
    expect(prompts(seen).at(-1)?.model).toBe('opus')
    expect(pick(await step($, seen, { turnId: 't4' }))).toBe('claude-sonnet-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(false)
  })
})

describe('0.8.7 F1: đoạn dặn khi đổi model điều phối', () => {
  test('mục tiêu lớn đang Fable điều phối, đổi sang opus: đoạn dặn ghi opus chèn lại đúng một lần', opts(), async ($, on) => {
    const { seen } = setup(on, (model, n) => (model === 'fable' ? (n === 0 ? BIG() : null) : FOLLOW))
    for (let i = 0; i < 5; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    const briefs = seen.contexts.flat().filter(c => c.startsWith('[focus-conductor] Điều phối:'))
    expect(briefs.filter(c => c.includes('fable/medium')).length).toBe(1)
    expect(briefs.filter(c => c.includes('opus/medium')).length).toBe(1)
  })
})
