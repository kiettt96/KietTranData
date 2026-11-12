// 0.8.6 R2: luồng chính đang điều phối bị từ chối lệnh kiểm (Bash theo checkKindOf, gồm checkCommands, và tool MCP khai trong checkTools);
// được miễn thì cho chạy. Lần kiểm của subagent chạy chung thư mục (lời gọi Agent không có trường isolation) khi luồng chính đang điều phối
// mang cờ shared: phủ mọi thay đổi trước nó, nên bước done tự nâng verified, tool plan nhận verified, và cảnh báo chưa kiểm không bật.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MCP_CHECK = 'mcp__ci__run_tests'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Chạy kiểm', 'agent', 'haiku', 'low', { kind: 'investigate' })] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable', checkTools: MCP_CHECK } }
const DEFAULT = { options: { planApproval: 'off', checkTools: MCP_CHECK } }
const PRESENTATION = { isFullscreen: false, columns: 80 }
type Out = { deny?: string; context?: string[]; result?: unknown }
const run = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Out>
const edit = ($: Engine, agentId?: string) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b', ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Out>
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const isCheckDeny = (r: Out) => (r.deny ?? '').includes('vai điều phối không tự chạy lệnh kiểm')
const NOT_RECHECKED = 'chưa được kiểm tra lại'
const NO_CHECK = 'không chạy bước kiểm tra nào'

/** Engine giả: Agent sinh subagent `a-<tool_use_id>` ngay trong lời gọi; `bun test` đạt, `bun test --fail` lỗi. */
function setup(on: On, $: Engine): Seen {
  const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG) })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    if (command.includes('--fail')) return { result: JS.bun_fail, text: JS.bun_fail, isError: true }
    return command.startsWith('bun test') ? { result: JS.bun_pass, text: JS.bun_pass } : { result: 'ok', isReadOnly: true }
  })
  on('tool.call', { tool: MCP_CHECK as never }, (() => ({ result: JS.bun_pass, text: JS.bun_pass })) as never)
  on('tool.call', { tool: 'Agent' }, async (_x, e) => {
    await $.agent.spawn({ prompt: e.prompt, description: e.description, tool_use_id: String(e.tool_use_id) } as never)
    return { result: 'đã xong' }
  })
  on('agent.spawn', (_x, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String(e.tool_use_id)}` }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}
const agent = ($: Engine, id: string, n: number, isolation?: string) =>
  $.tool.call({ tool: 'Agent', tool_use_id: id, description: `Việc ${n}: làm`, prompt: 'x', ...(isolation !== undefined ? { isolation } : {}) } as never)
const done = (turnId: string, agentId?: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', ...(agentId !== undefined ? { agentId } : {}) }) as never

/** A sửa file, bước 1 đóng, B chạy `command`; trả chữ của checklist. */
async function chain($: Engine, command = 'bun test', isolation?: string, after?: () => Promise<unknown>) {
  await submit($, A)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await agent($, 'uA', 1)
  await edit($, 'a-uA')
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
  await agent($, 'uB', 2, isolation)
  await bash($, command, 'a-uB')
  if (after !== undefined) await after()
  return show($)
}

describe('0.8.6 R2: luồng chính đang điều phối không tự chạy lệnh kiểm', () => {
  test('bun test của luồng chính bị từ chối, lời từ chối không quá 300 ký tự; git status được chạy; tool trong checkTools bị từ chối', FABLE, async ($, on) => {
    setup(on, $)
    await submit($, A)
    const r = await bash($, 'bun test')
    expect(isCheckDeny(r)).toBe(true)
    expect((r.deny ?? '').length).toBeLessThanOrEqual(300)
    expect(r.deny ?? '').toContain('/conductor solo')
    expect((await bash($, 'git status')).deny).toBeUndefined()
    expect((await bash($, 'ls src')).deny).toBeUndefined()
    expect(isCheckDeny((await $.tool.call({ tool: MCP_CHECK, suite: 'all' } as never)) as Out)).toBe(true)
  })

  test('sau /conductor solo: bun test được chạy', FABLE, async ($, on) => {
    setup(on, $)
    await submit($, A)
    await run($, 'solo')
    expect((await bash($, 'bun test')).deny).toBeUndefined()
  })

  test('lệnh kiểm do subagent gọi được chạy', FABLE, async ($, on) => {
    setup(on, $)
    await submit($, A)
    expect((await bash($, 'bun test', 'a-x')).deny).toBeUndefined()
  })

  test('conductor mặc định: bun test của luồng chính được chạy', DEFAULT, async ($, on) => {
    setup(on, $)
    await submit($, A)
    expect((await bash($, 'bun test')).deny).toBeUndefined()
  })
})

describe('0.8.6 R2: lần kiểm của subagent dùng chung thư mục', () => {
  test('A sửa, B (chung thư mục) chạy bun test đạt: bước done tự nâng verified; tool plan nhận verified', FABLE, async ($, on) => {
    setup(on, $)
    expect(await chain($)).toContain('[v] 1. Sửa')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'bun test' })).result)
    expect(out).toContain('[v] 2. Kiểm')
    expect(out).not.toContain('chưa tính là đã kiểm tra')
  })

  test('B chạy trong worktree riêng: không phủ, không nâng', FABLE, async ($, on) => {
    setup(on, $)
    const text = await chain($, 'bun test', 'worktree')
    expect(text).toContain('[x] 1. Sửa')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'bun test' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
  })

  test('vòng 2 V1: B chạy với isolation remote: không phủ, không nâng', FABLE, async ($, on) => {
    setup(on, $)
    const text = await chain($, 'bun test', 'remote')
    expect(text).toContain('[x] 1. Sửa')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'bun test' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
  })

  test('sau lần kiểm của B còn một thay đổi: không phủ', FABLE, async ($, on) => {
    setup(on, $)
    await chain($, 'bun test', undefined, () => edit($, 'a-uA'))
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'bun test' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
  })

  test('conductor mặc định, cùng chuỗi: không phủ như 0.8.5', DEFAULT, async ($, on) => {
    setup(on, $)
    const text = await chain($)
    expect(text).toContain('[x] 1. Sửa')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'bun test' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
  })

  test('lần kiểm của B lỗi: không phủ; lệnh kiểm chưa đạt chặn kết thúc như lần kiểm lỗi của luồng chính', FABLE, async ($, on) => {
    setup(on, $)
    expect(await chain($, 'bun test --fail')).toContain('[x] 1. Sửa')
    const block = String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
    expect(block).toContain('bun test --fail')
  })

  /** Một turn luồng chính: A sửa file, B chạy bun test đạt, cả hai trả về, turn kết thúc; trả các toast cảnh báo chưa kiểm. */
  const unverifiedTurn = async ($: Engine, seen: Seen) => {
    await submit($, A)
    await $.turn.start({ text: A, turnId: 't1' })
    await agent($, 'uA', 1)
    await edit($, 'a-uA')
    await $.turn.complete(done('tA', 'a-uA'))
    await agent($, 'uB', 2)
    await bash($, 'bun test', 'a-uB')
    await $.turn.complete(done('tB', 'a-uB'))
    await $.turn.complete(done('t1'))
    return seen.toasts.filter(t => t.includes(NOT_RECHECKED) || t.includes(NO_CHECK))
  }

  test('turn kết thúc sau lần kiểm đạt mang cờ, chạy sau thay đổi cuối: không cảnh báo chưa kiểm', FABLE, async ($, on) => {
    const seen = setup(on, $)
    expect(await unverifiedTurn($, seen)).toEqual([])
  })

  test('cùng turn với conductor mặc định (lần kiểm không mang cờ): cảnh báo như 0.8.5', DEFAULT, async ($, on) => {
    const seen = setup(on, $)
    expect((await unverifiedTurn($, seen)).length).toBeGreaterThan(0)
  })
})
