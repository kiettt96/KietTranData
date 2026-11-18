// 0.9.0 vòng 2 (F1): bước kiểm của cổng đóng và của pane tính lần chạy khớp lệnh ở check của một bước (đủ điều kiện bằng chứng của B10),
// không chỉ lệnh kiểm mod nhận ra. Mục tiêu substantial, loại edit, planApproval off, không khai checkCommands.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa thống kê', scope: ['/repo'], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off' } }
const CMD1 = `grep -c '"tong": 6' <(bash thong-ke.sh --json mau)`
const CMD2 = 'bash tests/kiem.sh'
const STEPS = [
  { title: 'Việc 1: tổng của thống kê', check: `\`${CMD1}\` => 1` },
  { title: 'Việc 2: bộ kiểm', check: `\`${CMD2}\`` },
]
const MISSING_CHECK = 'chưa có lần kiểm đạt'
const MISSING_REVIEW = 'duyệt độc lập'
type Out = { deny?: string; context?: string[] }

/** Kết quả của lệnh Bash theo lệnh; lệnh khác trả chuỗi rỗng. */
let outputs: Record<string, { text: string; isError?: boolean }> = {}
function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL(), root: '/repo' })
  outputs = { [CMD1]: { text: '1' }, [CMD2]: { text: 'C1 ĐẠT\nC2 ĐẠT\nC3 ĐẠT\nC4 ĐẠT\nC5 ĐẠT\nĐẠT 5/5' }, [`${CMD2} | tail -1`]: { text: 'ĐẠT 5/5' } }
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
async function open($: Engine, seen: Seen, steps: ReadonlyArray<Record<string, unknown>> = STEPS) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa thống kê')
  await $.tool.call({ tool: PLAN, action: 'set', steps } as never)
  await $.turn.start({ text: 'Sửa thống kê', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const edit = ($: Engine) => call($, { tool: 'Edit', file_path: '/repo/thong-ke.sh', old_string: 'a', new_string: 'b' })
async function close($: Engine, count: number) {
  for (let k = 1; k <= count; k++) await $.tool.call({ tool: PLAN, action: 'update', step: k, status: 'done' } as never)
}
let n = 0
async function review($: Engine, text = 'ĐẠT') {
  const id = `f${(n += 1)}`
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}
/** Pane mount một lần mỗi engine, các lần sau đọc lại chữ của cùng bản đã mount. */
const mounted = new WeakMap<Engine, Awaited<ReturnType<Engine['ui']['mount']>>>()
async function paneText($: Engine): Promise<string> {
  const pane = mounted.get($) ?? (await $.ui.mount(PANE))
  mounted.set($, pane)
  return (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
}

describe('0.9.0 vòng 2 F1: cổng đóng tính bằng chứng theo từng bước', () => {
  test('kịch bản của lượt rà soát, có lượt duyệt ĐẠT: cổng Stop không chặn lần nào', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await edit($)
    await call($, { tool: 'Bash', command: CMD1 })
    await call($, { tool: 'Bash', command: CMD2 })
    await close($, 2)
    await review($)
    expect(await stop($)).toBe('')
    expect(await stop($)).toBe('')
  })
  test('cùng kịch bản, chưa có lượt duyệt: lần dừng đầu chặn vì thiếu duyệt, không nhắc thiếu kiểm', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await edit($)
    await call($, { tool: 'Bash', command: CMD1 })
    await call($, { tool: 'Bash', command: CMD2 })
    await close($, 2)
    const block = await stop($)
    expect(block).toContain(MISSING_REVIEW)
    expect(block).not.toContain(MISSING_CHECK)
  })
  test('lệnh của bước chỉ chạy trước khi sửa: chặn vì thiếu kiểm', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen)
    await call($, { tool: 'Bash', command: CMD1 })
    await call($, { tool: 'Bash', command: CMD2 })
    await edit($)
    await close($, 2)
    await review($)
    expect(await stop($)).toContain(MISSING_CHECK)
  })
  test('lệnh của bước chạy qua | tail -1: chặn vì thiếu kiểm, lý do nêu ống lệnh', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen, [STEPS[1]!])
    await edit($)
    await call($, { tool: 'Bash', command: `${CMD2} | tail -1` })
    await close($, 1)
    await review($)
    const block = await stop($)
    expect(block).toContain(MISSING_CHECK)
    expect(block).toContain('đi qua ống')
  })
  test('lần chạy gần nhất của lệnh của bước bị lỗi: bước kiểm ở trạng thái chưa đạt', OPTS, async ($, on) => {
    const seen = setup(on)
    outputs[CMD2] = { text: 'C1 ĐẠT\nC2 FAIL\nTỔNG: FAIL 1/5', isError: true }
    await open($, seen, [STEPS[1]!])
    await edit($)
    await call($, { tool: 'Bash', command: CMD2 })
    await review($)
    expect(await paneText($)).toContain('Kiểm: chưa đạt')
  })
  test('pane hiện bước kiểm đạt đúng lúc cổng coi là đạt', OPTS, async ($, on) => {
    const seen = setup(on)
    await open($, seen, [STEPS[1]!])
    await edit($)
    await review($)
    expect(await paneText($)).toContain('Kiểm: chờ')
    await call($, { tool: 'Bash', command: CMD2 })
    expect(await paneText($)).toContain('Kiểm: đạt')
    await close($, 1)
    expect(await stop($)).toBe('')
  })
})
