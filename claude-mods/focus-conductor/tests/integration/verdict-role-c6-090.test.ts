// 0.9.0 C6, kết luận theo vai (chỉ dẫn của chủ mod sau kiểm độc lập): "ĐẠT HẾT" và "ALL PASS" chỉ là kết luận của bước kiểm; subagent có
// tiền tố "Kiểm: " hay "Audit: " không bao giờ cho kết luận duyệt hay sẵn sàng. Kết luận duyệt chỉ nhận khi subagent không ghi file ngoài
// thư mục tạm, hoàn tất sau thay đổi không nhẹ cuối, dòng kết luận là "ĐẠT", "PASS" hay "đạt kèm lỗi nhẹ", và model đã chạy từ sonnet trở
// lên; tiền tố không bắt buộc. Kết luận sẵn sàng cùng điều kiện, với "SẴN SÀNG" hay "READY".

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off', checkCommands: 'bun test' } }
const BLOCK = 'duyệt độc lập'
const MODELS: Record<string, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
let next = 'sonnet'

function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: MODELS[next], agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function answer($: Engine, description: string, text: string, family: string) {
  const id = `v${(n += 1)}`
  next = family
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: MODELS[family], input_tokens: 10, output_tokens: 10 } } as never)
}
async function start($: Engine, seen: Seen) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

describe('0.9.0 C6: kết luận theo vai', () => {
  test('lượt "Kiểm: " trả "ĐẠT HẾT": cổng vẫn chặn vì thiếu duyệt', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Kiểm: bun test', 'ĐẠT HẾT 12/12', 'opus')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('lượt "Audit: " trả "ĐẠT": không là kết luận duyệt, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Audit: lint and tests', 'ĐẠT', 'opus')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('subagent haiku không tiền tố trả "ĐẠT": không tính, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà lại phí', 'ĐẠT', 'haiku')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('subagent sonnet không tiền tố, chỉ đọc, trả "đạt kèm lỗi nhẹ": tính, cổng cho qua', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    // Đổi đặc tả (vòng sửa 1 sau kiểm độc lập của dấu file, 18/11): không tiền tố trên mục tiêu sửa mã là vai build, không được tính;
    // cùng câu trả lời với tiền tố "Kiểm độc lập: " thì được tính.
    await answer($, 'Rà lại phí', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến', 'sonnet')
    await close($)
    expect(await stop($)).toContain(BLOCK)
    await answer($, 'Kiểm độc lập: phí', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến', 'sonnet')
    expect(await stop($)).toBe('')
  })
  test('subagent sonnet trả "ĐẠT HẾT": không tính là duyệt, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà lại phí', 'ĐẠT HẾT 3/3', 'sonnet')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('hard: lượt "Kiểm: " trả "SẴN SÀNG" không là kết luận sẵn sàng; subagent opus trả "READY" thì tính', OPTS, async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await start($, seen)
    await answer($, 'Duyệt: phí', 'ĐẠT', 'opus')
    await answer($, 'Kiểm: sẵn sàng', 'SẴN SÀNG', 'opus')
    await close($)
    expect(await stop($)).toContain('SẴN SÀNG')
    await answer($, 'Đánh giá phát hành', 'READY', 'opus')
    expect(await stop($)).toBe('')
  })
})
