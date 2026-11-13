// 0.8.7 G1 (tích hợp): option conductor là opus thì opus giữ vai điều phối như Fable ở 0.8.6: router opus với biến thể điều phối, luồng
// chính opus/medium, không tự sửa file, không tự chạy kiểm, subagent Plan chạy alias opus, status và đoạn dặn ghi opus. Dự phòng theo F1;
// họ dự phòng trùng họ chính là không có. Giá trị không có trong bảng hay họ không có cờ điều phối là off.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const A = 'Sửa luồng thanh toán'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium'), task('Viết test', 'agent', 'sonnet', 'medium')] })
const FOLLOW = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN })
const CONDUCTOR_BLOCK = 'Large requests (the main thread is the conductor)'
const PRESENTATION = { isFullscreen: false, columns: 80 }
type Out = { deny?: string; context?: string[]; result?: unknown }
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>
const isEditDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự sửa file')
const isCheckDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự chạy lệnh kiểm')
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const prompts = (seen: Seen) => seen.routerCalls.filter(c => c.kind === 'prompt')
const opts = (over: Record<string, unknown> = {}) => ({ options: { planApproval: 'off', conductor: 'opus', ...over } })

function setup(on: On, reply: (model: string, n: number) => Json | null) {
  const counts = new Map<string, number>()
  const seen: Seen = base(on, {
    router: request => {
      if (request.startsWith('Requirements:')) return { missing: [], extra: [], issues: [] }
      const model = seen.routerModels.at(-1) ?? ''
      const n = counts.get(model) ?? 0
      counts.set(model, n + 1)
      return reply(model, n)
    },
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => (String((e as { command?: unknown }).command ?? '').startsWith('bun test') ? { result: JS.bun_pass, text: JS.bun_pass } : { result: 'ok', isReadOnly: true }))
  on('turn.complete', () => ({ text: '' }))
  return seen
}

describe('0.8.7 G1: conductor opus', () => {
  test('mục tiêu lớn: router opus với biến thể điều phối, effort medium; luồng chính opus/medium; Edit và bun test bị từ chối; đoạn dặn và status ghi opus', opts(), async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, A)
    expect(prompts(seen)[0]).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(seen.routerSystems[0] ?? '').toContain(CONDUCTOR_BLOCK)
    expect(pick(await step($, seen, { turnId: 't1' }))).toBe('claude-opus-5-5/medium')
    expect(isEditDeny(await edit($))).toBe(true)
    expect(isCheckDeny(await bash($, 'bun test'))).toBe(true)
    const brief = seen.contexts.flat().find(c => c.startsWith('[focus-conductor] Điều phối:')) ?? ''
    expect(brief).toContain('opus/medium')
    expect(brief.includes('fable')).toBe(false)
    const line = (await run($, 'status')).split('\n').find(l => l.startsWith('Điều phối')) ?? ''
    expect(line).toContain('opus')
    expect(line.toLowerCase().includes('fable')).toBe(false)
  })

  test('subagent Plan chạy alias opus', opts(), async ($, on) => {
    setup(on, () => BIG)
    const calls: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, A)
    await $.tool.call({ tool: 'Agent', description: 'Lập kế hoạch', prompt: 'Lập kế hoạch sửa luồng thanh toán', subagent_type: 'Plan' } as never)
    expect(calls[0]).toBe('opus')
  })

  test('conductorFallback sonnet, router opus lỗi hai lần: sonnet nhận vai điều phối theo F1', opts({ conductorFallback: 'sonnet' }), async ($, on) => {
    const seen = setup(on, (model, n) => (model === 'opus' ? (n === 0 ? BIG : null) : FOLLOW))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).at(-1)).toMatchObject({ model: 'sonnet', effort: 'medium' })
    expect(seen.routerSystems.at(-1) ?? '').toContain(CONDUCTOR_BLOCK)
    expect(isEditDeny(await edit($))).toBe(true)
  })

  test('conductorFallback opus trùng họ chính: không có dự phòng, như khi conductorFallback là off', opts({ conductorFallback: 'opus' }), async ($, on) => {
    const seen = setup(on, (model, n) => (model === 'opus' ? (n === 0 ? BIG : null) : FOLLOW))
    for (let i = 0; i < 4; i++) await submit($, i === 0 ? A : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual(['opus', 'opus', 'opus', 'sonnet'])
    expect(seen.routerSystems.at(-1) ?? '').not.toContain(CONDUCTOR_BLOCK)
    expect(isEditDeny(await edit($))).toBe(false)
  })
})

describe('0.8.7 G1: giá trị conductor không hợp lệ là off', () => {
  for (const value of ['haiku', 'gpt-x']) {
    test(`conductor ${value}: router là option router, không có biến thể điều phối, luồng chính tự sửa file được`, opts({ conductor: value }), async ($, on) => {
      const seen = setup(on, () => BIG)
      await submit($, A)
      expect(prompts(seen)[0]?.model).toBe('sonnet')
      expect(seen.routerSystems[0] ?? '').not.toContain(CONDUCTOR_BLOCK)
      expect(isEditDeny(await edit($))).toBe(false)
    })
  }
})
