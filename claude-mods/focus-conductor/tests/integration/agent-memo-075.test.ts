// 0.7.5 B6: router chấm subagent ít lượt hơn với hàng trăm lô: kết quả nhớ khóa theo description bỏ chữ số và mã lô, loại
// agent, model và effort Claude ghi (không gồm prompt); lời gọi mà model Claude ghi khớp quy định model của loại việc trong
// brief thì không gọi router.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { base, plan, submit } from '../support/engine'

type Sent = { model?: string; effort?: unknown }
function capture(on: On): Sent[] {
  const calls: Sent[] = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    calls.push({ model: e.model, effort: e.effort })
    return { result: 'xong' }
  })
  return calls
}
const agent = ($: Engine, description: string, prompt: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Agent', description, prompt, ...over } as never)
const RULED = () => plan({ goal: 'Cập nhật dữ liệu theo các lô', constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'], depth: 'hard', volume: 'large' })

describe('0.7.5 B6: khóa nhớ bỏ chữ số, không gồm prompt', () => {
  test('150 lô "Lọc tin lô N" khác prompt: router chấm một lần', {}, async ($, on) => {
    const seen = base(on, { router: RULED })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin lô ${n}`, `Lọc tin của lô ${n} trong thư mục data/lo${n}`)
    expect(seen.agentRouted.length).toBe(1)
  })

  test('khác loại agent hay khác model Claude ghi: chấm riêng', {}, async ($, on) => {
    const seen = base(on, { router: RULED })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Tổng hợp lô 1', 'p1')
    await agent($, 'Tổng hợp lô 2', 'p2', { subagent_type: 'Explore' })
    await agent($, 'Tổng hợp lô 3', 'p3', { model: 'opus' })
    expect(seen.agentRouted.length).toBe(3)
  })

  test('description khác chữ (không chỉ khác số): chấm riêng', {}, async ($, on) => {
    const seen = base(on, { router: RULED })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Tổng hợp lô 1', 'p')
    await agent($, 'Kiểm số lô 1', 'p')
    expect(seen.agentRouted.length).toBe(2)
  })
})

describe('0.7.5 B6: model Claude ghi khớp quy định model của loại việc', () => {
  test('quy định "Việc lọc tin chạy sonnet", Claude ghi sonnet: không gọi router, gửi sonnet', {}, async ($, on) => {
    const seen = base(on, { router: RULED })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin lô ${n}`, `Lọc tin lô ${n}`, { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls.every(c => c.model === 'sonnet')).toBe(true)
  })

  test('Claude ghi model khác quy định, hay việc không thuộc quy định: vẫn gọi router', {}, async ($, on) => {
    const seen = base(on, { router: RULED })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Lọc tin lô 1', 'p', { model: 'haiku' })
    await agent($, 'Ghi báo cáo lô 1', 'p', { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(2)
  })
})
