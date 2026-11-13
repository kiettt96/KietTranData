// 0.8.7 L1: khi router của lượt là Fable (isFable), routerRequest đọc trọn prompt tới trần FABLE_REQUEST_CHARS (phần đầu 75%, phần cuối
// 25% khi vượt); prompt dài hơn REQUEST_CHARS (80.000) thì maxTokens FABLE_FULL_MAX_TOKENS (80.000, chủ mod chốt thay cho 24.000 của
// đặc tả) và thời gian chờ FABLE_FULL_TIMEOUT_MS; lượt hỏi lại vì bị cắt được tới FABLE_FULL_RETRY_TOKENS. isClippedPrompt và
// clippedWarning dùng đúng trần của lượt đó. Router thường và prompt không quá 80.000 ký tự giữ request 0.8.6 từng byte. Lượt đọc trọn hết
// giờ thì askRouter gửi request dự phòng (đã cắt theo trần 80.000) với trọn thời gian chờ của nó, và báo fellBack.

import { describe, expect, test } from 'claude-code/testing'
import { FABLE_REQUEST_CHARS, askRouter, clippedWarning, isClippedPrompt, parseRoute, retryRequest, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { FABLE_FULL_MAX_TOKENS, FABLE_FULL_RETRY_TOKENS, FABLE_FULL_TIMEOUT_MS, FABLE_LONG_TIMEOUT_MS } from '../hooks/lib/conductor'
import type { ModelCompleteRequest } from 'claude-code'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const COND: Policy = { ...OPEN, conductor: true }
const MARK = 'DAU_CHO_GIUA_XQ'
const LONG = 'a'.repeat(120_000) + MARK + 'b'.repeat(238_489 - 120_000 - MARK.length)
const SHORT = 'Sửa luồng thanh toán. ' + 'c'.repeat(5_000 - 22)
const fable = (text: string) => routerRequest({ text, prev: null, ran: null, policy: COND, model: 'claude-fable-5-2', isFable: true })
const promptOf = (r: ModelCompleteRequest) => String(r.prompt)
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
/** SHA-256 của trường prompt của request, đo trên 45b5161 (0.8.6) bằng engine 2.1.296; trường system đổi theo 0.8.7 L2 nên không băm. */
const LONG_PLAIN_SHA = 'badf8954a7f6c9f4dece771c7745cb94e8eb4013877845db655c3661e6c876af'
const SHORT_FABLE_SHA = 'f4812dc8d3193532f8135b92d509a55ffe0d97d3d2ae85726029d636f5038345'

describe('0.8.7 L1: routerRequest khi router là Fable', () => {
  test('prompt 238.489 ký tự có dấu ở ký tự 120.000: request chứa dấu, không lược; maxTokens FABLE_FULL_MAX_TOKENS; thời gian chờ FABLE_FULL_TIMEOUT_MS', () => {
    const r = fable(LONG)
    expect(promptOf(r).includes(MARK)).toBe(true)
    expect(promptOf(r).includes('lược')).toBe(false)
    expect(r.maxTokens).toBe(FABLE_FULL_MAX_TOKENS)
    expect(r.timeoutMs).toBe(FABLE_FULL_TIMEOUT_MS)
    expect(isClippedPrompt(LONG, true)).toBe(false)
  })

  test('prompt dài hơn trần Fable 1 ký tự: request lược đúng số ký tự theo trần Fable; cảnh báo ghi hai con số của trần Fable', () => {
    const text = 'd'.repeat(FABLE_REQUEST_CHARS + 1)
    const head = Math.round(FABLE_REQUEST_CHARS * 0.75)
    const tail = FABLE_REQUEST_CHARS - head
    expect(promptOf(fable(text)).includes(`[... lược ${text.length - head - tail} ký tự ở giữa ...]`)).toBe(true)
    expect(isClippedPrompt(text, true)).toBe(true)
    expect(clippedWarning(text.length, true)).toBe(`Prompt dài ${grouped(text.length)} ký tự; router chỉ đọc ${grouped(head)} ký tự đầu và ${grouped(tail)} ký tự cuối`)
  })

  test('prompt 80.000 và 80.001 ký tự: bản 80.000 giữ 16.000 và FABLE_LONG_TIMEOUT_MS, bản 80.001 dùng FABLE_FULL_MAX_TOKENS và FABLE_FULL_TIMEOUT_MS; cả hai trọn prompt', () => {
    const at = fable('e'.repeat(80_000))
    const over = fable('e'.repeat(80_001))
    expect([at.maxTokens, at.timeoutMs]).toEqual([16_000, FABLE_LONG_TIMEOUT_MS])
    expect([over.maxTokens, over.timeoutMs]).toEqual([FABLE_FULL_MAX_TOKENS, FABLE_FULL_TIMEOUT_MS])
    expect(promptOf(at).includes('e'.repeat(80_000))).toBe(true)
    expect(promptOf(over).includes('e'.repeat(80_001))).toBe(true)
    expect(isClippedPrompt('e'.repeat(80_001), true)).toBe(false)
  })

  test('prompt 5.000 ký tự: request trùng 0.8.6 từng byte', async () => {
    const r = fable(SHORT)
    expect(await sha(promptOf(r))).toBe(SHORT_FABLE_SHA)
    expect([r.maxTokens, r.timeoutMs, r.effort]).toEqual([8_000, 45_000, 'medium'])
  })
})

describe('0.8.7 L1: hằng đã chốt theo số đo', () => {
  test('FABLE_REQUEST_CHARS 400.000, FABLE_FULL_TIMEOUT_MS 555.000, FABLE_FULL_MAX_TOKENS 80.000, FABLE_FULL_RETRY_TOKENS 120.000', () => {
    expect([FABLE_REQUEST_CHARS, FABLE_FULL_TIMEOUT_MS, FABLE_FULL_MAX_TOKENS, FABLE_FULL_RETRY_TOKENS]).toEqual([400_000, 555_000, 80_000, 120_000])
  })
})

describe('0.8.7 L1: lượt hỏi lại vì câu trả lời bị cắt', () => {
  test('lượt đọc trọn (maxTokens 80.000) bị cắt: lượt hỏi lại có maxTokens 120.000', () => {
    expect(retryRequest(fable(LONG), '{"goal":', 'json', { truncated: true }).maxTokens).toBe(FABLE_FULL_RETRY_TOKENS)
  })

  test('request 16.000 bị cắt: lượt hỏi lại 24.000 như 0.8.6; request 8.000: 12.000', () => {
    expect(retryRequest(fable('f'.repeat(20_000)), '{"goal":', 'json', { truncated: true }).maxTokens).toBe(24_000)
    expect(retryRequest(fable(SHORT), '{"goal":', 'json', { truncated: true }).maxTokens).toBe(12_000)
  })
})

describe('0.8.7 L1: router thường giữ như 0.8.6', () => {
  test('isFable vắng, prompt 238.489 ký tự: không chứa dấu, request trùng 0.8.6; maxTokens 16.000; thời gian chờ 120.000; cảnh báo 60.000 và 20.000', async () => {
    const r = routerRequest({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet' })
    expect(promptOf(r).includes(MARK)).toBe(false)
    expect(await sha(promptOf(r))).toBe(LONG_PLAIN_SHA)
    expect([r.maxTokens, r.timeoutMs]).toEqual([16_000, 120_000])
    expect(isClippedPrompt(LONG)).toBe(true)
    expect(isClippedPrompt(LONG, false)).toBe(true)
    expect(clippedWarning(LONG.length)).toBe('Prompt dài 238.489 ký tự; router chỉ đọc 60.000 ký tự đầu và 20.000 ký tự cuối')
  })

  test('isFable false: như vắng', () => {
    const r = routerRequest({ text: LONG, prev: null, ran: null, policy: COND, model: 'sonnet', isFable: false })
    expect(promptOf(r).includes(MARK)).toBe(false)
    expect([r.maxTokens, r.timeoutMs]).toEqual([16_000, 120_000])
  })
})

describe('0.8.7 L1: lượt dự phòng khi lượt đọc trọn hết giờ', () => {
  const reply = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
  const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

  test('lượt đầu hết giờ (FABLE_FULL_TIMEOUT_MS ở mức sàn 120.000): lượt dự phòng nhận đúng request dự phòng, thời gian chờ đúng 120.000; kết quả báo fellBack', async () => {
    let t = 0
    const sent: ModelCompleteRequest[] = []
    const ask = async (r: ModelCompleteRequest) => {
      sent.push(r)
      if (sent.length === 1) {
        t += r.timeoutMs ?? 0
        return { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE }
      }
      return { isAnswered: true as const, text: reply, usage: USAGE }
    }
    const full = { ...fable(LONG), timeoutMs: 120_000 }
    const fallback = { ...routerRequest({ text: LONG, prev: null, ran: null, policy: COND, model: 'claude-fable-5-2' }), timeoutMs: FABLE_LONG_TIMEOUT_MS }
    const outcome = await askRouter(ask, full, text => parseRoute(text, COND), undefined, { now: () => t, isFable: true, fallback })
    expect(sent.length).toBe(2)
    expect(promptOf(sent[1] as ModelCompleteRequest) === promptOf(fallback)).toBe(true)
    expect(promptOf(sent[1] as ModelCompleteRequest).includes(MARK)).toBe(false)
    expect(sent[1]?.timeoutMs).toBe(120_000)
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBe(true)
  })

  test('không có request dự phòng: thử lại cùng request như 0.8.6, không báo fellBack', async () => {
    let t = 0
    const sent: ModelCompleteRequest[] = []
    const ask = async (r: ModelCompleteRequest) => {
      sent.push(r)
      if (sent.length === 1) {
        t += 100_000
        return { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE }
      }
      return { isAnswered: true as const, text: reply, usage: USAGE }
    }
    const full = fable(LONG)
    const outcome = await askRouter(ask, full, text => parseRoute(text, COND), undefined, { now: () => t, isFable: true })
    expect(promptOf(sent[1] as ModelCompleteRequest) === promptOf(full)).toBe(true)
    expect(outcome.fellBack).toBeUndefined()
  })
})
