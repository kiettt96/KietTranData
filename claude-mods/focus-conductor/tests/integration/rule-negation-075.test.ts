// 0.7.5 H2 (vòng sửa 2): ràng buộc có phủ định ("Không dùng haiku cho việc sửa file") không phải quy định model cho loại việc;
// khi model Claude ghi khớp một quy định thật và router được bỏ qua, lựa chọn vẫn qua fitPick (fable khi chưa bật allowFable về
// opus); riêng haiku không bỏ qua router vì việc sửa file không được chạy haiku mà chỉ router biết loại việc.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { ruleFamily } from '../../hooks/lib/route'
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
const agent = ($: Engine, description: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Agent', description, prompt: description, ...over } as never)
const briefWith = (...constraints: string[]) => () => plan({ goal: 'Cập nhật dữ liệu theo các lô', constraints, depth: 'hard', volume: 'large' })
const EDIT = { why: 'sửa', model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }
const READ = { why: 'đọc', model: 'haiku', effort: 'low', agent: 'Explore', depth: 'none', volume: 'small', kind: 'investigate' }

describe('0.7.5 H2: ràng buộc phủ định không phải quy định model', () => {
  test('ruleFamily bỏ vế có không, khong, đừng, cấm, chẳng, chớ, never, not, no, don\'t', () => {
    // R6 (vòng rà soát 3): chữ phủ định chỉ tính khi đứng trước tên model trong phạm vi 3 từ ("không dùng haiku").
    expect(ruleFamily(['Việc lọc tin chạy haiku, cho việc sửa file'], 'Lọc tin lô 1', null)).toBe('haiku')
    for (const word of ['không', 'khong', 'đừng', 'cấm', 'chẳng', 'chớ', 'never', 'not', 'no', "don't"]) {
      const rule = `Việc lọc tin: ${word} dùng haiku cho việc sửa file`
      expect(ruleFamily([rule], 'Lọc tin lô 1', null), rule).toBe(null)
    }
    expect(ruleFamily(['Không dùng haiku cho việc sửa file'], 'Sửa các file không hợp lệ', null)).toBe(null)
    expect(ruleFamily(['Việc lọc tin chạy sonnet'], 'Lọc tin lô 1', null)).toBe('sonnet')
  })

  test('"Không dùng haiku cho việc sửa file", Claude ghi haiku cho "Sửa các file không hợp lệ": gửi đi không phải haiku', {}, async ($, on) => {
    const seen = base(on, { router: briefWith('Không dùng haiku cho việc sửa file'), agent: () => EDIT })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Sửa các file không hợp lệ', { model: 'haiku' })
    expect(seen.agentRouted.length).toBe(1)
    expect(calls.at(-1)?.model).not.toBe('haiku')
  })
})

describe('0.7.5 H2: bỏ lượt router vẫn qua fitPick', () => {
  test('quy định "lọc tin chạy fable", Claude ghi fable, chưa bật allowFable: không gọi router, gửi opus', {}, async ($, on) => {
    const seen = base(on, { router: briefWith('Việc lọc tin chạy fable') })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Lọc tin lô 1', { model: 'fable' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls.at(-1)?.model).toBe('opus')
  })

  test('quy định "đọc tin chạy haiku", Claude ghi haiku: router chấm loại việc; sửa file thì lên sonnet, tra cứu thì giữ haiku', {}, async ($, on) => {
    let reply: Record<string, unknown> = EDIT
    const seen = base(on, { router: briefWith('Việc đọc tin chạy haiku'), agent: () => reply })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Đọc tin lô 1', { model: 'haiku' })
    expect(seen.agentRouted.length).toBe(1)
    expect(calls.at(-1)?.model).toBe('sonnet')
    reply = READ
    await agent($, 'Đọc tin về giá', { model: 'haiku' })
    expect(calls.at(-1)?.model).toBe('haiku')
  })

  test('quy định khớp, Claude ghi effort max: không gọi router, effort gửi đi hạ về xhigh', {}, async ($, on) => {
    const seen = base(on, { router: briefWith('Việc lọc tin chạy sonnet') })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Lọc tin lô 1', { model: 'sonnet', effort: 'max' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls.at(-1)).toEqual({ model: 'sonnet', effort: 'xhigh' })
  })

  test('quy định "lọc tin chạy sonnet", Claude ghi opus (khác quy định): router vẫn được gọi, không bỏ lượt', {}, async ($, on) => {
    const seen = base(on, { router: briefWith('Việc lọc tin chạy sonnet'), agent: () => EDIT })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await agent($, 'Lọc tin lô 1', { model: 'opus' })
    expect(seen.agentRouted.length).toBe(1)
  })

  test('quy định "lọc tin chạy sonnet", Claude ghi sonnet: vẫn không gọi router (giữ hành vi B6)', {}, async ($, on) => {
    const seen = base(on, { router: briefWith('Việc lọc tin chạy sonnet') })
    const calls = capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 5; n++) await agent($, `Lọc tin lô ${n}`, { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls.every(c => c.model === 'sonnet')).toBe(true)
  })
})
