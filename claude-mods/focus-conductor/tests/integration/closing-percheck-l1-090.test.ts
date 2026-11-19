// 0.9.0 vòng 2 L1: bước kiểm của cổng đóng và của pane tính lần chạy gần nhất theo từng lệnh ở check của bước, sau thay đổi không nhẹ cuối.
// Lệnh nào có lần chạy gần nhất lỗi thì bước kiểm chưa đạt, dù lệnh của bước khác chạy đạt sau đó. Cùng mục tiêu mẫu với closing-stepcheck-f1-090.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa thống kê', scope: ['/repo'], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off' } }
const CMD_A = `grep -c '"tong": 6' <(bash thong-ke.sh --json mau)`
const CMD_B = 'bash tests/kiem.sh'
const STEPS = [
  { title: 'Việc 1: tổng của thống kê', check: `\`${CMD_A}\` => 1` },
  { title: 'Việc 2: bộ kiểm', check: `\`${CMD_B}\`` },
]
const A_OK = { text: '1' }
const A_FAIL = { text: '0', isError: true }
const B_OK = { text: 'C1 ĐẠT\nC2 ĐẠT\nĐẠT 2/2' }
const B_FAIL = { text: 'C1 ĐẠT\nC2 FAIL\nTỔNG: FAIL 1/2', isError: true }
type Out = { deny?: string; context?: string[] }

let outputs: Record<string, { text: string; isError?: boolean }> = {}
function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL(), root: '/repo' })
  outputs = {}
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const out = outputs[String((e as { command?: unknown }).command ?? '')] ?? { text: '' }
    return { result: out.text, ...(out.isError === true ? { isError: true } : {}) } as never
  })
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const call = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as Out
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
async function open($: Engine, seen: Seen) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa thống kê')
  await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS } as never)
  await $.turn.start({ text: 'Sửa thống kê', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const edit = ($: Engine) => call($, { tool: 'Edit', file_path: '/repo/thong-ke.sh', old_string: 'a', new_string: 'b' })
async function run($: Engine, command: string, out: { text: string; isError?: boolean }) {
  outputs[command] = out
  await call($, { tool: 'Bash', command })
}
async function closeAndReview($: Engine) {
  for (let k = 1; k <= 2; k++) await $.tool.call({ tool: PLAN, action: 'update', step: k, status: 'done' } as never)
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: 'l1', description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: 'l1' } as never)
  await $.turn.complete({ turnId: 'x-l1', agentId: 'a-l1', answer: 'ĐẠT', durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}
const mounted = new WeakMap<Engine, Awaited<ReturnType<Engine['ui']['mount']>>>()
async function paneText($: Engine): Promise<string> {
  const pane = mounted.get($) ?? (await $.ui.mount(PANE))
  mounted.set($, pane)
  return (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
}

describe('0.9.0 vòng 2 L1: bước kiểm theo lần chạy gần nhất của từng lệnh', () => {
  test('lệnh A lỗi rồi lệnh B đạt: pane có "Kiểm: chưa đạt", cổng Stop chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await edit($)
    await run($, CMD_A, A_FAIL)
    await run($, CMD_B, B_OK)
    await closeAndReview($)
    expect(await paneText($)).toContain('Kiểm: chưa đạt')
    expect(await stop($)).not.toBe('')
  })
  test('lệnh A lỗi, lệnh B đạt, rồi A chạy lại đạt: "Kiểm: đạt"', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await edit($)
    await run($, CMD_A, A_FAIL)
    await run($, CMD_B, B_OK)
    await run($, CMD_A, A_OK)
    await closeAndReview($)
    expect(await paneText($)).toContain('Kiểm: đạt')
  })
  test('lệnh A đạt, lệnh B lỗi, rồi B chạy lại đạt: "Kiểm: đạt"', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await edit($)
    await run($, CMD_A, A_OK)
    await run($, CMD_B, B_FAIL)
    await run($, CMD_B, B_OK)
    await closeAndReview($)
    expect(await paneText($)).toContain('Kiểm: đạt')
  })
})
