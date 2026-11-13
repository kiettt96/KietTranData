// 0.8.7 B1: bước đóng sau chuỗi sửa, test đạt, test lỗi không được tự nâng verified kèm nhãn "chạy đạt"; chạy test đạt lần nữa thì nâng.
// Cùng luật cho lần kiểm mang cờ shared của subagent chung thư mục khi Fable điều phối. Bước đã nâng trước lần test lỗi giữ như 0.8.6.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-fresh-b1-087.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Chạy kiểm', 'agent', 'haiku', 'low', { kind: 'investigate' })] })
const AUTO = 'tự động'

/** Engine giả: `bun test` đạt, `bun test --fail` lỗi; Agent sinh subagent `a-<tool_use_id>` ngay trong lời gọi. */
function setup(on: On, $: Engine) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG) })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return command.includes('--fail') ? { result: JS.bun_fail, text: JS.bun_fail, isError: true } : { result: JS.bun_pass, text: JS.bun_pass }
  })
  on('tool.call', { tool: 'Agent' }, async (_x, e) => {
    await $.agent.spawn({ prompt: e.prompt, description: e.description, tool_use_id: String(e.tool_use_id) } as never)
    return { result: 'đã xong' }
  })
  on('agent.spawn', (_x, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String(e.tool_use_id)}` }))
  const writes: string[] = []
  on('fs.write', (_x, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const autos = () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).filter(line => (JSON.parse(line) as Record<string, unknown>)['kind'] === 'verify-auto').length
  return { autos }
}
const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never)
const edit = ($: Engine, agentId?: string) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b', ...(agentId !== undefined ? { agentId } : {}) } as never)
const close = async ($: Engine, step: number) => String((await $.tool.call({ tool: PLAN, action: 'update', step, status: 'done' })).result)
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const steps = ($: Engine) => $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })

describe('0.8.7 B1: test lỗi chạy sau lần đạt', () => {
  test('luồng chính: sửa, test đạt, test lỗi, đóng bước 1: bước 1 [x], không "tự động", không verify-auto; test đạt lần nữa: bước 1 [v]', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { autos } = setup(on, $)
    await submit($, A)
    await steps($)
    await edit($)
    await bash($, 'bun test')
    await bash($, 'bun test --fail')
    const out = await close($, 1)
    expect(out).toContain('[x] 1. Sửa')
    expect(out).not.toContain(AUTO)
    expect(autos()).toBe(0)
    await bash($, 'bun test')
    expect(await show($)).toContain('[v] 1. Sửa')
  })

  test('conductor fable: A sửa, B (chung thư mục) test đạt rồi test lỗi, đóng bước 1: bước 1 [x]', { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }, async ($, on) => {
    setup(on, $)
    await submit($, A)
    await steps($)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'uA', description: 'Việc 1: làm', prompt: 'x' } as never)
    await edit($, 'a-uA')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'uB', description: 'Việc 2: làm', prompt: 'x' } as never)
    await bash($, 'bun test', 'a-uB')
    await bash($, 'bun test --fail', 'a-uB')
    const out = await close($, 1)
    expect(out).toContain('[x] 1. Sửa')
    expect(out).not.toContain(AUTO)
  })

  test('sửa, test đạt, đóng bước 1 (đã [v]), rồi test lỗi: bước 1 giữ [v] như 0.8.6', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    setup(on, $)
    await submit($, A)
    await steps($)
    await edit($)
    await bash($, 'bun test')
    expect(await close($, 1)).toContain('[v] 1. Sửa')
    await bash($, 'bun test --fail')
    expect(await show($)).toContain('[v] 1. Sửa')
  })
})
