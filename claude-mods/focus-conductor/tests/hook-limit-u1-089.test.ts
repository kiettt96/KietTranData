// 0.8.9 U1: mọi lời gọi model từ hook xin không quá 64.000 token ra. Engine 2.1.296 và 2.1.325 ném lỗi trước khi gửi request khi maxTokens
// vượt 64.000, ở cả bốn họ model [Đo trực tiếp, VERIFICATION mục 0.8.9]. Lượt đọc trọn của fable, opus, haiku trước đây xin 128.000 (mức
// `claude -p` báo cho model), nên router của prompt dài hơn 80.000 ký tự bị engine từ chối. askRouter kẹp maxTokens của mọi request nó gửi.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteRequest } from 'claude-code'
import { askRouter, parseRoute, requestPlan, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { ROUTER_MAX_WAIT_MS, fullMaxTokens, fullRetryTokens, readParamsOf } from '../hooks/lib/reading'
import type { Reading } from '../hooks/lib/reading'
import { plan } from './support/engine'

const CAP = 64_000
const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const COND: Policy = { ...OPEN, conductor: true }
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
const parse = (text: string) => parseRoute(text, COND)
const isPositiveInteger = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0

const argsOf = (family: (typeof FAMILIES)[number], length: number) => {
  const reading: Reading = { family, window: 1_000_000, maxWaitMs: ROUTER_MAX_WAIT_MS }
  return { text: 'x'.repeat(length), prev: null, ran: null, policy: family === 'fable' ? COND : OPEN, model: family, reading, ...(family === 'fable' ? { isFable: true } : {}) }
}

/** ask ghi lại request đã nhận và trả lần lượt các câu trả lời. */
function recorder(replies: Array<'aborted' | 'api-error' | { text: string; outputTokens?: number }>) {
  const sent: ModelCompleteRequest[] = []
  const ask = async (r: ModelCompleteRequest) => {
    sent.push(r)
    const reply = replies.shift() ?? { text: REPLY }
    if (reply === 'aborted') return { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE }
    if (reply === 'api-error') return { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE }
    return { isAnswered: true as const, text: reply.text, usage: { ...USAGE, output_tokens: reply.outputTokens ?? 50 } }
  }
  return { ask, sent }
}

const big = (over: Partial<ModelCompleteRequest> = {}): ModelCompleteRequest => ({ ...routerRequest(argsOf('fable', 100_000)), maxTokens: 128_000, ...over })

describe('0.8.9 U1: maxTokens của lượt đọc trọn', () => {
  test('fullMaxTokens: fable, opus, haiku ra 64.000; sonnet ra 16.000', () => {
    for (const family of ['fable', 'opus', 'haiku'] as const) expect(fullMaxTokens(readParamsOf(family)), family).toBe(CAP)
    expect(fullMaxTokens(readParamsOf('sonnet'))).toBe(16_000)
  })

  test('fullRetryTokens(64.000, fable) ra 64.000; fullRetryTokens(16.000, sonnet) ra 24.000', () => {
    expect(fullRetryTokens(64_000, readParamsOf('fable'))).toBe(CAP)
    expect(fullRetryTokens(16_000, readParamsOf('sonnet'))).toBe(24_000)
  })

  for (const length of [80_001, 238_489, 600_000]) {
    test(`routerRequest với prompt ${length} ký tự, bốn họ: maxTokens không quá 64.000 và là số nguyên dương; timeoutMs là số nguyên dương`, () => {
      for (const family of FAMILIES) {
        const r = routerRequest(argsOf(family, length))
        expect(isPositiveInteger(r.maxTokens), family).toBe(true)
        expect(r.maxTokens ?? Infinity, family).toBeLessThanOrEqual(CAP)
        expect(isPositiveInteger(r.timeoutMs), family).toBe(true)
      }
    })
  }

  test('fable: sức chứa vẫn 467.854 ký tự; timeoutMs vẫn 310.000, 920.000, 1.800.000 như 0.8.8', () => {
    const timeouts = [80_001, 238_489, 600_000].map(length => {
      expect(requestPlan(argsOf('fable', length)).capacity).toBe(467_854)
      return routerRequest(argsOf('fable', length)).timeoutMs
    })
    expect(timeouts).toEqual([310_000, 920_000, 1_800_000])
  })
})

describe('0.8.9 U1: askRouter kẹp maxTokens của mọi request', () => {
  test('request mang maxTokens 128.000: ask thấy 64.000', async () => {
    const { ask, sent } = recorder([{ text: REPLY }])
    await askRouter(ask, big(), parse)
    expect(sent.map(r => r.maxTokens)).toEqual([CAP])
  })

  test('lượt hỏi lại vì câu trả lời bị cắt (trần lượt hỏi lại 128.000): ask thấy không quá 64.000', async () => {
    const { ask, sent } = recorder([{ text: '{"goal":', outputTokens: CAP }, { text: REPLY }])
    await askRouter(ask, big(), parse, undefined, { now: () => 0, full: { tokenCap: 128_000 } })
    expect(sent.length).toBe(2)
    for (const r of sent) expect(r.maxTokens ?? Infinity).toBeLessThanOrEqual(CAP)
  })

  test('fallback mang maxTokens 128.000 (lượt đầu hết giờ): ask thấy không quá 64.000', async () => {
    const { ask, sent } = recorder(['aborted', { text: REPLY }])
    await askRouter(ask, big(), parse, undefined, { now: () => 0, fallback: big({ timeoutMs: 120_000 }) })
    expect(sent.length).toBe(2)
    for (const r of sent) expect(r.maxTokens ?? Infinity).toBeLessThanOrEqual(CAP)
  })

  test('apiFallback mang maxTokens 128.000 (lượt đầu lỗi API): ask thấy không quá 64.000', async () => {
    const { ask, sent } = recorder(['api-error', { text: REPLY }])
    await askRouter(ask, big(), parse, undefined, { now: () => 0, apiFallback: big({ model: 'opus' }) })
    expect(sent.length).toBe(2)
    for (const r of sent) expect(r.maxTokens ?? Infinity).toBeLessThanOrEqual(CAP)
  })
})
