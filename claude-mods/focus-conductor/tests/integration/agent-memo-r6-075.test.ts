// 0.7.5 R6 và R11 (vòng rà soát 3): đo lại B6 với 150 lô sau khi ruleFamily tách vế và khóa nhớ chỉ giữ mã có trong brief. Số lượt router
// không tăng so với vòng sửa 2 (1 lượt khi Claude không ghi model, 0 lượt khi Claude ghi đúng model quy định), trừ lô khớp vế ngoại lệ.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { base, plan, submit } from '../support/engine'

function capture(on: On): void {
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
}
const agent = ($: Engine, description: string, prompt: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Agent', description, prompt, ...over } as never)
const rulesOf = (...constraints: string[]) => () => plan({ goal: 'Cập nhật dữ liệu theo các lô', constraints, depth: 'hard', volume: 'large' })
/** Vòng 150 lô gọi engine liên tiếp: hạn riêng, không phụ thuộc tải máy (R12). */
const LOOP = { timeoutMs: 60_000 }
const EXCEPTION = 'Lọc tin dùng sonnet trừ khi tin pháp lý thì dùng opus'
const REAL = 'Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'

describe('0.7.5 R6: 150 lô với quy tắc có vế ngoại lệ', () => {
  test('"Lọc tin lô N" Claude ghi sonnet: 0 lượt router; không ghi model: 1 lượt', LOOP, async ($, on) => {
    const seen = base(on, { router: rulesOf(EXCEPTION) })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin lô ${n}`, `Lọc tin lô ${n}`, { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(0)
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin lô ${n}`, `Lọc tin của lô ${n}`)
    expect(seen.agentRouted.length).toBe(1)
  })

  test('lô khớp vế ngoại lệ ("Lọc tin pháp lý lô N") để router chấm: 1 lượt cho 150 lô cùng dạng', LOOP, async ($, on) => {
    const seen = base(on, { router: rulesOf(EXCEPTION) })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin pháp lý lô ${n}`, `Lọc tin pháp lý lô ${n}`, { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(1)
  })
})

describe('0.7.5 R6, R11: 150 lô với quy tắc thật và mã ngắn', () => {
  test('quy tắc thật: "Lọc tin lô N" Claude ghi sonnet: 0 lượt router', LOOP, async ($, on) => {
    const seen = base(on, { router: rulesOf(REAL) })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Lọc tin lô ${n}`, `Lọc tin lô ${n}`, { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(0)
  })

  test('150 lô mang mã ngắn "Lọc tin b<N>" không có trong brief: 1 lượt router', LOOP, async ($, on) => {
    const seen = base(on, { router: rulesOf(REAL) })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các lô')
    for (let n = 1; n <= 150; n++) await agent($, `Đọc b${n} và ghi chú`, `Đọc b${n}`)
    expect(seen.agentRouted.length).toBe(1)
  })
})
