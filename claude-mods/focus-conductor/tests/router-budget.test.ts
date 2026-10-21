// 0.7.2 điểm 3: hạn chung cho cả các lượt gọi router, kiểm lại chỉ khi còn yêu cầu chưa được phủ (ở effort medium, vì effort high hết giờ
// chờ ở prompt dài), thử lại khi câu trả lời bị cắt vì hết token. Số đo cơ sở (Claude Code 2.1.296, router sonnet, prompt tiếng Việt
// 6.000 ký tự, 28 yêu cầu): lượt đầu trung vị 21,7 giây, p95 26,8 giây, tối đa 2.959 token; kiểm lại ở effort high hết giờ 45 giây
// ở 4 trên 5 lượt, ở effort medium 30 tới 45 giây và 5.000 tới 6.700 token (xem docs/VERIFICATION.md).

import { describe, expect, test } from 'claude-code/testing'
import type { ModelFamily } from '../types'
import { askRouter, needsCoverageRecheck, parseRoute, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { plan, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const reqs = (n: number) => Array.from({ length: n }, (_, i) => `Yêu cầu ${i + 1}`)
const parse = (text: string) => parseRoute(text, OPEN)
const request = routerRequest({ text: 'Cập nhật skill lên v10', prev: null, ran: null, policy: OPEN, model: 'sonnet' })
const textOf = (value: unknown): string => (typeof value === 'string' ? value : Array.isArray(value) ? value.map(b => (b as { text: string }).text).join('') : '')

/** Phần việc phủ các yêu cầu từ 1 tới `upto` trong tổng `n` yêu cầu. */
const partial = (n: number, upto: number, goal = 'Mục tiêu') =>
  JSON.stringify(plan({ goal, requirements: reqs(n), tasks: [task('Việc', 'main', 'sonnet', 'medium', { covers: Array.from({ length: upto }, (_, i) => i + 1) })] }))

/** Router giả: mỗi lượt tốn `costs[i]` mili giây của đồng hồ giả, trả `replies[i]` (hoặc báo hết giờ / bị cắt). */
function scripted(replies: Array<string | 'timeout' | { truncated: string }>, costs: number[]) {
  let clock = 0
  const calls: Array<{ effort: string; timeoutMs: number | undefined; maxTokens: number | undefined; prompt: string }> = []
  const ask = async (r: typeof request) => {
    const i = calls.length
    calls.push({ effort: String(r.effort), timeoutMs: r.timeoutMs, maxTokens: r.maxTokens, prompt: textOf(r.prompt) })
    clock += costs[i] ?? 0
    const reply = replies[i]
    if (reply === 'timeout' || reply === undefined) return { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE }
    if (typeof reply === 'object') return { isAnswered: true as const, text: reply.truncated, usage: { ...USAGE, output_tokens: r.maxTokens ?? 0 } }
    return { isAnswered: true as const, text: reply, usage: USAGE }
  }
  return { ask, calls, now: () => clock }
}

describe('0.7.2 3: needsCoverageRecheck', () => {
  const planOf = (n: number, upto: number) => parse(partial(n, upto))!
  test('quá 8 yêu cầu mà còn yêu cầu không việc nào phủ: kiểm lại', () => {
    expect(needsCoverageRecheck(planOf(12, 11))).toBe(true)
  })
  test('quá 8 yêu cầu nhưng đã phủ đủ: không kiểm lại', () => {
    expect(needsCoverageRecheck(planOf(12, 12))).toBe(false)
  })
  test('8 yêu cầu hay ít hơn dù còn thiếu phủ: không kiểm lại (mod đã nhắc yêu cầu chưa phủ cho Claude)', () => {
    expect(needsCoverageRecheck(planOf(8, 5))).toBe(false)
  })
  test('không có việc nào (một khối) hay việc không ghi covers: không có gì để so, không kiểm lại', () => {
    expect(needsCoverageRecheck(parse(JSON.stringify(plan({ goal: 'x', requirements: reqs(12), tasks: [] })))!)).toBe(false)
    expect(needsCoverageRecheck(parse(JSON.stringify(plan({ goal: 'x', requirements: reqs(12), tasks: [task('Việc', 'main', 'sonnet', 'medium')] })))!)).toBe(false)
  })
})

describe('0.7.2 3: kiểm lại ở effort medium trong hạn chung', () => {
  const recheck = needsCoverageRecheck

  test('còn yêu cầu chưa phủ: lượt kiểm lại ở effort medium, kèm câu trả lời trước; lần hai được dùng', async () => {
    const s = scripted([partial(12, 11, 'Lần một'), partial(12, 12, 'Lần hai')], [20_000, 30_000])
    const outcome = await askRouter(s.ask, request, parse, recheck, { now: s.now })
    expect(outcome.result?.goal).toBe('Lần hai')
    expect(outcome.retried).toBe(true)
    expect(s.calls[1]?.effort).toBe('medium')
    expect(s.calls[1]?.prompt).toContain('<previous_answer>')
    expect(s.calls[1]?.prompt).toContain('every requirement')
  })

  test('đã phủ đủ: chỉ một lượt gọi dù có nhiều yêu cầu', async () => {
    const s = scripted([partial(30, 30)], [22_000])
    const outcome = await askRouter(s.ask, request, parse, recheck, { now: s.now })
    expect(outcome.retried).toBe(false)
    expect(s.calls.length).toBe(1)
  })

  test('lượt đầu đã tốn quá nửa hạn chung: bỏ lượt kiểm lại, giữ câu trả lời đầu', async () => {
    // Hạn chung mặc định bằng 1,5 lần timeout của request (45 giây thành 67,5 giây); nửa hạn là 33,75 giây.
    const s = scripted([partial(12, 11, 'Lần một'), partial(12, 12, 'Lần hai')], [34_000, 10_000])
    const outcome = await askRouter(s.ask, request, parse, recheck, { now: s.now })
    expect(outcome.result?.goal).toBe('Lần một')
    expect(outcome.retried).toBe(false)
    expect(s.calls.length).toBe(1)
  })

  test('timeout của lượt kiểm lại là phần còn lại của hạn chung, không quá timeout của request', async () => {
    const quick = scripted([partial(12, 11), partial(12, 12)], [20_000, 1_000])
    await askRouter(quick.ask, request, parse, recheck, { now: quick.now })
    expect(quick.calls[1]?.timeoutMs).toBe(45_000)
    const slow = scripted([partial(12, 11), partial(12, 12)], [30_000, 1_000])
    await askRouter(slow.ask, request, parse, recheck, { now: slow.now })
    expect(slow.calls[1]?.timeoutMs).toBe(37_500)
  })

  test('lượt kiểm lại hết giờ: giữ câu trả lời đầu', async () => {
    const s = scripted([partial(12, 11, 'Lần một'), 'timeout'], [20_000, 37_500])
    const outcome = await askRouter(s.ask, request, parse, recheck, { now: s.now })
    expect(outcome.result?.goal).toBe('Lần một')
    expect(outcome.retried).toBe(true)
  })

  test('hạn chung tùy chỉnh được qua tham số budgetMs', async () => {
    const s = scripted([partial(12, 11), partial(12, 12)], [20_000, 1_000])
    await askRouter(s.ask, request, parse, recheck, { now: s.now, budgetMs: 30_000 })
    expect(s.calls.length).toBe(1)
  })
})

describe('0.7.2 3: thử lại JSON và tin cậy trong hạn chung', () => {
  test('JSON hỏng và còn thời gian: thử lại một lần ở effort low, timeout là phần còn lại', async () => {
    const s = scripted(['{"hỏng', partial(3, 3)], [10_000, 5_000])
    const outcome = await askRouter(s.ask, request, parse, undefined, { now: s.now })
    expect(outcome.result).not.toBeNull()
    expect(s.calls[1]?.effort).toBe('low')
    expect(s.calls[1]?.timeoutMs).toBe(45_000)
  })

  test('JSON hỏng mà lượt đầu đã ăn gần hết hạn chung (còn dưới 10 giây): không thử lại', async () => {
    const s = scripted(['{"hỏng', partial(3, 3)], [60_000, 1_000])
    const outcome = await askRouter(s.ask, request, parse, undefined, { now: s.now })
    expect(outcome.result).toBeNull()
    expect(s.calls.length).toBe(1)
    expect(outcome.failure).toBe('format')
  })
})

describe('0.7.2 3: câu trả lời bị cắt vì hết token', () => {
  test('chạm maxTokens mà không đọc được JSON: thử lại với maxTokens gấp rưỡi và lời dặn viết ngắn', async () => {
    const s = scripted([{ truncated: '{"goal": "x", "requirements": ["a", "b' }, partial(3, 3)], [20_000, 20_000])
    const outcome = await askRouter(s.ask, request, parse, undefined, { now: s.now })
    expect(outcome.result).not.toBeNull()
    expect(s.calls[1]?.maxTokens).toBe(12_000)
    expect(s.calls[1]?.prompt).toContain('concise')
  })

  test('không bị cắt (hỏng vì lý do khác): maxTokens giữ nguyên', async () => {
    const s = scripted(['{"hỏng', partial(3, 3)], [1_000, 1_000])
    await askRouter(s.ask, request, parse, undefined, { now: s.now })
    expect(s.calls[1]?.maxTokens).toBe(8_000)
  })

  test('maxTokens thử lại có trần 32.000', async () => {
    const big = { ...request, maxTokens: 30_000 }
    const s = scripted([{ truncated: '{"goal' }, partial(3, 3)], [1_000, 1_000])
    await askRouter(s.ask, big, parse, undefined, { now: s.now })
    expect(s.calls[1]?.maxTokens).toBe(32_000)
  })

  test('lần thử lại cũng bị cắt: thất bại, không thử lần ba', async () => {
    const s = scripted([{ truncated: '{"goal' }, { truncated: '{"goal' }], [1_000, 1_000])
    const outcome = await askRouter(s.ask, request, parse, undefined, { now: s.now })
    expect(outcome.result).toBeNull()
    expect(s.calls.length).toBe(2)
  })
})

describe('0.7.2 3: giới hạn của request giữ theo số đo', () => {
  test('prompt tới 12.000 ký tự: 45 giây và 8.000 token (p95 đo được 27 giây, tối đa 3.300 token)', () => {
    expect(routerRequest({ text: 'x'.repeat(11_900), prev: null, ran: null, policy: OPEN, model: 'sonnet' })).toMatchObject({ timeoutMs: 45_000, maxTokens: 8_000 })
  })
  test('prompt trên 12.000 ký tự: 120 giây và 16.000 token', () => {
    expect(routerRequest({ text: 'x'.repeat(12_100), prev: null, ran: null, policy: OPEN, model: 'sonnet' })).toMatchObject({ timeoutMs: 120_000, maxTokens: 16_000 })
  })
})
