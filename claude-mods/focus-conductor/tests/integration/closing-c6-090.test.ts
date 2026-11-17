// 0.9.0 C6 (tích hợp): cổng đóng mục tiêu theo thứ tự, cho mục tiêu substantial hay hard, edit hay mixed, khi mọi bước đã đóng và phiên giao
// được subagent: lệnh kiểm đạt sau thay đổi cuối; một kết luận review ĐẠT sau thay đổi không nhẹ cuối cùng; mục tiêu hard thêm một kết luận
// design SẴN SÀNG sau review. Thiếu thì cổng Stop chặn (lý do không quá 600 ký tự, nêu bước còn thiếu đầu tiên), mỗi trạng thái thiếu một lần,
// tối đa 3 lần mỗi mục tiêu; /conductor waive review bỏ qua. Phiên không giao được subagent: không chặn, pane ghi chưa có duyệt độc lập.
// Option closingReview (auto, off).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { PANE, base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
const BLOCK = 'duyệt độc lập'

function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
const check = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
let n = 0
async function verdict($: Engine, description: string, answer: string) {
  const id = `v${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer' } as never)
}
const offer = ($: Engine) => $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
async function work($: Engine, seen: Seen) {
  await offer($)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await edit($)
  await check($)
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

describe('0.9.0 C6: cổng đóng mục tiêu', () => {
  test('đủ thứ tự (kiểm đạt, review ĐẠT sau thay đổi cuối): không chặn', OPTS(), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await verdict($, 'Kiểm độc lập: rà phí', 'ĐẠT\nKhông lỗi.')
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('thiếu review: chặn một lần, lý do nêu bước còn thiếu, không quá 600 ký tự; lần dừng kế tiếp cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await close($)
    const reason = await stop($)
    expect(reason).toContain(BLOCK)
    expect(reason).toContain('Kiểm độc lập: ')
    expect(reason.length).toBeLessThanOrEqual(600)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('sửa file không nhẹ sau review: chặn thêm đúng một lần', OPTS(), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await verdict($, 'Kiểm độc lập: rà phí', 'ĐẠT')
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
    await edit($)
    await check($)
    expect(await stop($)).toContain(BLOCK)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('lần chặn thứ tư của cùng mục tiêu không xảy ra', OPTS(), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await close($)
    let blocks = 0
    for (let i = 0; i < 5; i++) {
      if ((await stop($)).includes(BLOCK)) blocks += 1
      await edit($)
      await check($)
    }
    expect(blocks).toBe(3)
  })
  test('mục tiêu hard: review ĐẠT mà thiếu design SẴN SÀNG thì chặn nêu đánh giá sẵn sàng; có thì qua', OPTS(), async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await work($, seen)
    await verdict($, 'Kiểm độc lập: rà phí', 'ĐẠT')
    await close($)
    const reason = await stop($)
    expect(reason).toContain('SẴN SÀNG')
  })
  test('mục tiêu light: không chặn; closingReview off: không chặn', OPTS(), async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'light' }))
    await work($, seen)
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('closingReview off: không chặn', OPTS({ closingReview: 'off' }), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('/conductor waive review: bỏ qua cổng', OPTS(), async ($, on) => {
    const seen = setup(on)
    await work($, seen)
    await close($)
    await conductor($, 'waive review')
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('phiên chưa được mời loại agent nào: không chặn; pane ghi chưa có duyệt độc lập', OPTS(), async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await edit($)
    await check($)
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
    const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(pane.toLowerCase()).toContain('chưa có duyệt độc lập')
  })
  test('/conductor solo (không giao được subagent): không chặn; pane ghi chưa có duyệt độc lập', OPTS({ conductor: 'opus' }), async ($, on) => {
    const seen = setup(on)
    await offer($)
    await submit($, 'Sửa luồng phí')
    await conductor($, 'solo')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await edit($)
    await check($)
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
    const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(pane.toLowerCase()).toContain('chưa có duyệt độc lập')
  })
})
