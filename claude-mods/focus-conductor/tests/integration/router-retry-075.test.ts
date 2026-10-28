// 0.7.5 B13: (a) /conductor reroute đọc lại prompt dài đầu tiên của mục tiêu (không phải prompt tiếp nối ngắn gần nhất);
// (b) router hết giờ thì thử lại đúng một lần nếu còn trong hạn chung; (c) router chia quá TASK_LIMIT việc thì có cảnh báo.

import { describe, expect, test } from 'claude-code/testing'
import { askRouter } from '../../hooks/lib/router'
import { DEFAULT_ROUTER, FOUR, PANE, ROUTER_TIMEOUT, base, conductor, plan, submit, task } from '../support/engine'

describe('0.7.5 B13a: reroute đọc prompt gốc của mục tiêu', () => {
  test('sau prompt tiếp nối ngắn, /conductor reroute gửi router prompt dài lập mục tiêu', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('tiếp') ? plan({ relation: 'continue', goal: '' }) : DEFAULT_ROUTER(request)) })
    await submit($, FOUR)
    await submit($, 'tiếp')
    await conductor($, 'reroute')
    expect(seen.routed.at(-1)).toContain('Mục tiêu: nâng cấp module thanh toán.')
    expect(seen.routed.at(-1)).toContain('Previous goal: none.')
  })
})

describe('0.7.5 B13b: thử lại khi router hết giờ', () => {
  test('lượt đầu hết giờ, lượt hai trả lời: dùng lượt hai, retried', async () => {
    let calls = 0
    const ask = async () => {
      calls += 1
      return calls === 1
        ? { isAnswered: false as const, reason: 'aborted' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
        : { isAnswered: true as const, text: '{"confidence": 1}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
    }
    let clock = 0
    const out = await askRouter(ask as never, { model: 'sonnet', system: [], prompt: 'p', timeoutMs: 45_000 } as never, text => JSON.parse(text) as { confidence: number }, undefined, {
      now: () => clock,
      budgetMs: 67_500,
    })
    expect(calls).toBe(2)
    expect(out.result).toEqual({ confidence: 1 })
    expect(out.retried).toBe(true)
  })

  test('hết hạn chung (còn dưới 10 giây): không thử lại', async () => {
    let calls = 0
    let clock = 0
    const ask = async () => {
      calls += 1
      clock += 60_000
      return { isAnswered: false as const, reason: 'aborted' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
    }
    const out = await askRouter(ask as never, { model: 'sonnet', system: [], prompt: 'p', timeoutMs: 45_000 } as never, () => null, undefined, { now: () => clock, budgetMs: 67_500 })
    expect(calls).toBe(1)
    expect(out.result).toBeNull()
  })

  test('tích hợp: router hết giờ lượt đầu rồi trả lời: prompt có bản đọc của router', {}, async ($, on) => {
    let calls = 0
    const seen = base(on, {
      router: request => {
        calls += 1
        return calls === 1 ? ROUTER_TIMEOUT : DEFAULT_ROUTER(request)
      },
    })
    await submit($, FOUR)
    expect(calls).toBe(2)
    expect(seen.contexts[0]?.join('\n')).toContain('Bản đọc prompt của router')
  })
})

describe('0.7.5 B13c: cắt ở TASK_LIMIT có cảnh báo', () => {
  test('router chia 25 việc: giữ 20 việc đầu, cảnh báo nêu số việc bị cắt', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Nhiều việc', depth: 'hard', volume: 'large', tasks: Array.from({ length: 25 }, (_, i) => task(`Việc số ${i + 1}`, 'main', 'sonnet', 'medium')) }) })
    await submit($, 'Làm 25 việc theo danh sách')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /chia 25 việc; giữ 20 việc đầu/ })).toBeDefined()
  })
})
