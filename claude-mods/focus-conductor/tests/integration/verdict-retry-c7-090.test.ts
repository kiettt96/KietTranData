// 0.9.0 C7 (tích hợp, nối tiếp retry-rounds-w4-078 và stuck-lift-g6-078): kết luận CHƯA ĐẠT của audit hay review đi vào vòng sửa, trần 3
// vòng. Vòng 1: mod dặn chuyển nguyên văn phần lỗi cho đúng việc và agent đã làm phần đó. Sau hai vòng trượt cùng một mục, trước vòng ba: dặn
// giao một việc vai design chẩn đoán bằng model mạnh nhất được phép. Hết trần: đánh dấu (cảnh báo loop, toast) và câu dặn nêu rõ dừng lại
// hỏi người dùng. Mỗi câu dặn không quá 200 ký tự.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit, task } from '../support/engine'
import type { Seen } from '../support/engine'

const GOAL = plan({
  goal: 'Sửa luồng phí',
  depth: 'substantial',
  volume: 'medium',
  kind: 'edit',
  tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium', { role: 'build' }), task('Duyệt thay đổi', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' })],
})
type Out = { context?: string[] }
function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: /^(?:Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  return seen
}
let n = 0
async function review($: Engine, answer: string): Promise<string> {
  const id = `r${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'Việc 2: Duyệt thay đổi', prompt: 'Duyệt.' } as never)
  await $.agent.spawn({ prompt: 'Duyệt.', description: 'Việc 2: Duyệt thay đổi', tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer' } as never)
  return ((await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as never)) as Out).context?.join('\n') ?? ''
}
const FAIL = 'CHƯA ĐẠT\n- Lớn: thiếu test cho phí âm'

describe('0.9.0 C7: vòng sửa theo kết luận CHƯA ĐẠT', () => {
  test('vòng 1: dặn chuyển nguyên văn phần lỗi cho đúng việc đã làm phần đó; vòng 2 trượt: dặn giao vai design bằng opus; vòng 3 trượt: dừng hỏi người dùng', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa luồng phí')
    const first = await review($, FAIL)
    expect(first).toContain('nguyên văn')
    expect(first).toContain('vòng 1/3')
    const second = await review($, FAIL)
    expect(second).toContain('vai thiết kế')
    expect(second).toContain('opus')
    const third = await review($, FAIL)
    expect(third).toContain('dừng lại hỏi người dùng')
    for (const text of [first, second, third]) {
      const line = text.split('\n').find(l => l.includes('CHƯA ĐẠT')) ?? ''
      expect(line.length, line).toBeLessThanOrEqual(200)
    }
    expect(seen.toasts.some(t => t.includes('3 vòng'))).toBe(true)
  })
  test('allowFable bật: vòng chẩn đoán dùng fable', { options: { planApproval: 'off', allowFable: true } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng phí')
    await review($, FAIL)
    expect(await review($, FAIL)).toContain('fable')
  })
  test('kết luận ĐẠT sau một vòng trượt: không dặn thêm, vòng đếm về 0', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng phí')
    await review($, FAIL)
    expect(await review($, 'ĐẠT')).not.toContain('CHƯA ĐẠT')
    expect(await review($, FAIL)).toContain('vòng 1/3')
  })
})
