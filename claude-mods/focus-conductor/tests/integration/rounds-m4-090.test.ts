// 0.9.0 vòng 2 M4: khóa đếm vòng chưa đạt là mục tiêu cộng vai, thêm số việc khi lượt gắn với một việc đã phân; không dùng description. Người
// duyệt đổi description giữa các vòng thì số vòng vẫn cộng dồn; hai việc đã phân khác nhau đếm riêng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit, task } from '../support/engine'

const GOAL = plan({
  goal: 'Sửa luồng phí',
  depth: 'substantial',
  volume: 'medium',
  kind: 'edit',
  tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium', { role: 'build' }), task('Duyệt phí', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' }), task('Duyệt thuế', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' })],
})
const FAIL = 'CHƯA ĐẠT\n- Lớn: thiếu test cho phí âm'
type Out = { context?: string[] }
function setup(on: On) {
  base(on, { router: () => GOAL })
  on('tool.call', { tool: /^(?:Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
}
let n = 0
async function review($: Engine, description: string, answer = FAIL): Promise<string> {
  const id = `m4-${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Duyệt.' } as never)
  await $.agent.spawn({ prompt: 'Duyệt.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer' } as never)
  return ((await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as never)) as Out).context?.join('\n') ?? ''
}

describe('0.9.0 vòng 2 M4: vòng sửa đếm theo vai', () => {
  test('hai lượt Kiểm độc lập có description khác nhau cùng CHƯA ĐẠT: lượt thứ hai là vòng 2', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng phí')
    expect(await review($, 'Kiểm độc lập: rà phí')).toContain('vòng 1/3')
    expect(await review($, 'Kiểm độc lập: rà lại phí sau sửa')).toContain('vòng 2/3')
  })
  test('lượt gắn hai việc đã phân khác nhau: đếm riêng', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng phí')
    expect(await review($, 'Việc 2: Duyệt phí')).toContain('vòng 1/3')
    expect(await review($, 'Việc 3: Duyệt thuế')).toContain('vòng 1/3')
  })
})
