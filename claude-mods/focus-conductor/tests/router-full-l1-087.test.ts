// 0.8.7 L3 (thay phần trần cố định của L1): mọi model router đọc trọn prompt tới sức chứa của lượt đó (readPlan, hooks/lib/reading.ts):
// số nhỏ hơn giữa sức chứa theo cửa sổ ngữ cảnh và sức chứa theo thời gian chờ tối đa (routerMaxWait), không thấp hơn 80.000. Prompt dài hơn
// 80.000 ký tự mà vừa sức chứa: gửi trọn, maxTokens và timeoutMs theo thông số của họ model. Vượt sức chứa: cắt phần giữa (75 và 25 phần
// trăm), cảnh báo ghi họ model, hai con số và giới hạn đã chạm. Lượt đọc trọn hết giờ hay bị API từ chối: lượt dự phòng cắt theo trần cũ với
// trọn 120 giây. Prompt không quá 80.000 ký tự: trường prompt, maxTokens, timeoutMs, effort trùng 0.8.6.

import { describe, expect, test } from 'claude-code/testing'
import { askRouter, clippedWarning, isClippedPrompt, parseRoute, requestPlan, retryRequest, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { BASE_CHARS, FALLBACK_TIMEOUT_MS, READ_PARAMS, ROUTER_MAX_WAIT_MS, fullMaxTokens, fullRetryTokens, readParamsOf, readPlan, routerMaxWaitOf } from '../hooks/lib/reading'
import type { Reading } from '../hooks/lib/reading'
import type { ModelCompleteRequest } from 'claude-code'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const COND: Policy = { ...OPEN, conductor: true }
const MARK = 'DAU_CHO_GIUA_XQ'
const LONG = 'a'.repeat(120_000) + MARK + 'b'.repeat(238_489 - 120_000 - MARK.length)
const SHORT = 'Sửa luồng thanh toán. ' + 'c'.repeat(5_000 - 22)
const SONNET: Reading = { family: 'sonnet', window: 1_000_000, maxWaitMs: ROUTER_MAX_WAIT_MS }
const FABLE: Reading = { family: 'fable', window: 1_000_000, maxWaitMs: ROUTER_MAX_WAIT_MS }
const plain = (text: string, reading: Reading = SONNET) => routerRequest({ text, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading })
const fable = (text: string, reading: Reading = FABLE) => routerRequest({ text, prev: null, ran: null, policy: COND, model: 'claude-fable-5-2', isFable: true, reading })
const promptOf = (r: ModelCompleteRequest) => String(r.prompt)
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
/** SHA-256 trường prompt của request prompt 5.000 ký tự, đo trên 45b5161 (0.8.6), engine 2.1.296 (router thường và Fable như nhau). */
const SHORT_PROMPT_SHA = 'f4812dc8d3193532f8135b92d509a55ffe0d97d3d2ae85726029d636f5038345'

describe('0.8.7 L3: mọi model router đọc trọn prompt vừa sức chứa', () => {
  test('router thường (sonnet), prompt 238.489 ký tự có dấu ở giữa: gửi trọn; maxTokens và timeoutMs theo thông số sonnet', () => {
    const r = plain(LONG)
    const p = readPlan(SONNET, LONG.length, 0)
    expect(promptOf(r).includes(MARK)).toBe(true)
    expect(promptOf(r).includes('lược')).toBe(false)
    expect(r.maxTokens).toBe(fullMaxTokens(READ_PARAMS.sonnet))
    expect(r.timeoutMs).toBe(p.timeoutMs)
    expect(isClippedPrompt(LONG, requestPlan({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading: SONNET }).capacity)).toBe(false)
  })

  test('Fable, cùng prompt: gửi trọn; maxTokens và timeoutMs theo thông số Fable', () => {
    const r = fable(LONG)
    expect(promptOf(r).includes(MARK)).toBe(true)
    expect(r.maxTokens).toBe(fullMaxTokens(READ_PARAMS.fable))
    expect(r.timeoutMs).toBe(readPlan(FABLE, LONG.length, 0).timeoutMs)
  })

  test('request không truyền reading: Fable theo thông số fable, router sonnet theo thông số sonnet (maxTokens 128.000 và 16.000)', () => {
    const f = routerRequest({ text: LONG, prev: null, ran: null, policy: COND, model: 'claude-fable-5-2', isFable: true })
    const s = routerRequest({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet' })
    expect([f.maxTokens, s.maxTokens]).toEqual([fullMaxTokens(READ_PARAMS.fable), fullMaxTokens(READ_PARAMS.sonnet)])
    expect([f.maxTokens, s.maxTokens]).toEqual([64_000, 16_000])
    expect(f.timeoutMs).toBe(readPlan({ family: 'fable', window: 1_000_000, maxWaitMs: ROUTER_MAX_WAIT_MS }, LONG.length, 0).timeoutMs)
  })

  test('trần lượt hỏi lại của Fable đọc trọn: 1,5 lần 128.000 kẹp về mức engine báo 128.000', () => {
    expect(fullRetryTokens(fullMaxTokens(READ_PARAMS.fable), READ_PARAMS.fable)).toBe(64_000)
  })

  test('router haiku và opus (chưa đo), prompt 100.000 ký tự: gửi trọn; thông số thận trọng hơn giữa Fable và sonnet', () => {
    const text = 'h'.repeat(50_000) + MARK + 'h'.repeat(50_000 - MARK.length)
    for (const family of ['haiku', 'opus'] as const) {
      const reading: Reading = { family, window: 1_000_000, maxWaitMs: ROUTER_MAX_WAIT_MS }
      const r = routerRequest({ text, prev: null, ran: null, policy: OPEN, model: family, reading })
      const params = readParamsOf(family)
      expect(params.secPerChar).toBe(Math.max(READ_PARAMS.fable.secPerChar, READ_PARAMS.sonnet.secPerChar))
      expect(params.charsPerToken).toBe(Math.min(READ_PARAMS.fable.charsPerToken, READ_PARAMS.sonnet.charsPerToken))
      expect(promptOf(r).includes(MARK)).toBe(true)
      expect(r.maxTokens).toBe(fullMaxTokens(params))
      expect(r.timeoutMs).toBe(readPlan(reading, text.length, 0).timeoutMs)
    }
  })

  test('prompt 80.000 và 80.001 ký tự, router thường: bản 80.000 giữ 16.000 và 120.000; bản 80.001 theo lượt đọc trọn; cả hai trọn prompt', () => {
    const at = plain('e'.repeat(80_000))
    const over = plain('e'.repeat(80_001))
    expect([at.maxTokens, at.timeoutMs]).toEqual([16_000, 120_000])
    expect([over.maxTokens, over.timeoutMs]).toEqual([fullMaxTokens(READ_PARAMS.sonnet), readPlan(SONNET, 80_001, 0).timeoutMs])
    expect(promptOf(at).includes('e'.repeat(80_000))).toBe(true)
    expect(promptOf(over).includes('e'.repeat(80_001))).toBe(true)
  })

  test('prompt 5.000 ký tự, mọi cấu hình: trường prompt, maxTokens, timeoutMs, effort trùng 0.8.6', async () => {
    for (const r of [plain(SHORT), fable(SHORT), routerRequest({ text: SHORT, prev: null, ran: null, policy: OPEN, model: 'sonnet' })]) {
      expect(await sha(promptOf(r))).toBe(SHORT_PROMPT_SHA)
      expect([r.maxTokens, r.timeoutMs, r.effort]).toEqual([8_000, 45_000, 'medium'])
    }
  })
})

describe('0.8.7 L3: hai trường hợp còn cắt', () => {
  test('cửa sổ của model nhỏ hơn mức cần nhưng sức chứa trên 80.000: cắt đúng sức chứa; cảnh báo ghi họ model, hai con số và giới hạn sức chứa', () => {
    const reading: Reading = { ...SONNET, window: fullMaxTokens(READ_PARAMS.sonnet) + Math.ceil(150_000 / READ_PARAMS.sonnet.charsPerToken) }
    const p = requestPlan({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading })
    expect(p.capacity).toBeGreaterThan(BASE_CHARS)
    expect(p.capacity).toBeLessThan(LONG.length)
    expect(p.capacity).toBeLessThanOrEqual(150_000)
    expect(p.limit).toBe('window')
    expect(promptOf(plain(LONG, reading)).includes(`[... lược ${LONG.length - p.head - p.tail} ký tự ở giữa ...]`)).toBe(true)
    expect(isClippedPrompt(LONG, p.capacity)).toBe(true)
    const warning = clippedWarning(LONG.length, { family: 'sonnet', head: p.head, tail: p.tail, limit: 'window' })
    expect(warning).toContain(`router chỉ đọc ${grouped(p.head)} ký tự đầu và ${grouped(p.tail)} ký tự cuối`)
    expect(warning).toContain('sonnet')
    expect(warning).toContain('sức chứa của model')
    expect(p.head).toBe(Math.round(p.capacity * 0.75))
    expect(promptOf(plain(LONG, reading)).includes(LONG.slice(0, p.head) + '\n[... lược')).toBe(true)
  })

  test('Fable, routerMaxWait không chia hết cho 5 giây (400.123 ms): timeoutMs không vượt thời gian chờ tối đa', () => {
    const reading: Reading = { ...FABLE, maxWaitMs: 400_123 }
    const r = fable(LONG, reading)
    expect(r.timeoutMs ?? 0).toBeLessThanOrEqual(400_123)
    expect(readPlan(reading, LONG.length, 0).timeoutMs).toBeLessThanOrEqual(400_123)
  })

  test('cửa sổ rất nhỏ (sức chứa tính ra dưới 80.000): cắt 60.000 và 20.000', () => {
    const reading: Reading = { ...SONNET, window: fullMaxTokens(READ_PARAMS.sonnet) + 1_000 }
    const p = requestPlan({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading })
    expect([p.capacity, p.head, p.tail]).toEqual([80_000, 60_000, 20_000])
    expect(promptOf(plain(LONG, reading)).includes(`[... lược ${LONG.length - 80_000} ký tự ở giữa ...]`)).toBe(true)
  })

  test('routerMaxWait 120 giây: cắt theo sức chứa thời gian (hay 60.000 và 20.000 khi dưới 80.000); cảnh báo nêu thời gian chờ và option', () => {
    const reading: Reading = { ...SONNET, maxWaitMs: 120_000 }
    const p = requestPlan({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading })
    const byTime = Math.floor(120 / 1.5 / READ_PARAMS.sonnet.secPerChar)
    expect(p.capacity).toBe(Math.max(80_000, byTime))
    expect(p.limit).toBe('time')
    expect(isClippedPrompt(LONG, p.capacity)).toBe(LONG.length > p.capacity)
    expect(clippedWarning(LONG.length, { family: 'sonnet', head: p.head, tail: p.tail, limit: 'time' })).toContain('routerMaxWait')
  })

  test('routerMaxWait 1.800 giây với cùng prompt: gửi trọn; timeoutMs đúng công thức, không vượt 1.800.000', () => {
    const reading: Reading = { ...SONNET, maxWaitMs: 1_800_000 }
    const r = plain(LONG, reading)
    expect(promptOf(r).includes(MARK)).toBe(true)
    expect(r.timeoutMs).toBe(readPlan(reading, LONG.length, 0).timeoutMs)
    expect(r.timeoutMs ?? 0).toBeLessThanOrEqual(1_800_000)
  })

  test('routerMaxWait 50 và 5.000: kẹp về 120 và 1.800 giây; vắng là 1.800', () => {
    expect([routerMaxWaitOf(50), routerMaxWaitOf(5_000), routerMaxWaitOf(undefined), routerMaxWaitOf(300)]).toEqual([120_000, 1_800_000, 1_800_000, 300_000])
  })

  test('prompt đúng bằng sức chứa: gửi trọn; dài hơn 1 ký tự: bị cắt', () => {
    const reading: Reading = { ...SONNET, window: fullMaxTokens(READ_PARAMS.sonnet) + Math.ceil(150_000 / READ_PARAMS.sonnet.charsPerToken) }
    const p = requestPlan({ text: LONG, prev: null, ran: null, policy: OPEN, model: 'sonnet', reading })
    const exact = 'x'.repeat(p.capacity)
    expect(promptOf(plain(exact, reading)).includes('lược')).toBe(false)
    expect(promptOf(plain(exact + 'y', reading)).includes('[... lược 1 ký tự ở giữa ...]')).toBe(true)
  })
})

describe('0.8.7 L3: lượt dự phòng và lượt hỏi lại', () => {
  const reply = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
  const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const fallbackOf = (r: ModelCompleteRequest, model: string, policy: Policy) => ({ ...routerRequest({ text: LONG, prev: null, ran: null, policy, model, reading: { ...SONNET, window: 1 } }), model: r.model, timeoutMs: FALLBACK_TIMEOUT_MS })

  for (const [name, request, policy] of [['router thường', plain(LONG), OPEN], ['Fable', fable(LONG), COND]] as const) {
    for (const how of ['aborted', 'api-error'] as const) {
      test(`${name}, lượt đọc trọn ${how === 'aborted' ? 'hết giờ' : 'bị API từ chối'}: lượt dự phòng cắt theo trần 80.000, timeoutMs đúng 120.000, kết quả báo fellBack`, async () => {
        let t = 0
        const sent: ModelCompleteRequest[] = []
        const ask = async (r: ModelCompleteRequest) => {
          sent.push(r)
          if (sent.length === 1) {
            t += r.timeoutMs ?? 0
            return how === 'aborted' ? { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } : { isAnswered: false as const, reason: 'api-error' as const, status: 400, error: 'invalid_request' as const, usage: USAGE }
          }
          return { isAnswered: true as const, text: reply, usage: USAGE }
        }
        const fallback = fallbackOf(request, String(request.model), policy)
        const outcome = await askRouter(ask as never, request, text => parseRoute(text, policy), undefined, { now: () => t, fallback })
        expect(sent.length).toBe(2)
        expect(promptOf(sent[1] as ModelCompleteRequest) === promptOf(fallback)).toBe(true)
        expect(promptOf(sent[1] as ModelCompleteRequest).includes(MARK)).toBe(false)
        expect(sent[1]?.timeoutMs).toBe(120_000)
        expect(outcome.result).not.toBeNull()
        expect(outcome.fellBack).toBe(true)
      })
    }
  }

  test('askRouter chuyển full sang lượt hỏi lại: câu trả lời lượt đọc trọn bị cắt thì lượt hỏi lại có maxTokens bằng tokenCap; tin cậy thấp thì effort medium', async () => {
    const request = fable(LONG)
    const tokenCap = fullRetryTokens(request.maxTokens ?? 0, READ_PARAMS.fable)
    const cut = { input_tokens: 100, output_tokens: request.maxTokens ?? 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const sent: ModelCompleteRequest[] = []
    const truncatedAsk = async (r: ModelCompleteRequest) => {
      sent.push(r)
      return sent.length === 1 ? { isAnswered: true as const, text: '{"goal":', usage: cut } : { isAnswered: true as const, text: reply, usage: USAGE }
    }
    await askRouter(truncatedAsk as never, request, text => parseRoute(text, COND), undefined, { now: () => 0, isFable: true, full: { tokenCap } })
    expect(sent.length).toBe(2)
    expect(sent[1]?.maxTokens).toBe(tokenCap)
    expect(tokenCap).toBe(64_000)
    const low = JSON.stringify({ ...plan({ goal: 'Sửa luồng thanh toán' }), confidence: 0.2 })
    const lowSent: ModelCompleteRequest[] = []
    const lowAsk = async (r: ModelCompleteRequest) => {
      lowSent.push(r)
      return { isAnswered: true as const, text: low, usage: USAGE }
    }
    const plainRequest = plain(LONG)
    await askRouter(lowAsk as never, plainRequest, text => parseRoute(text, OPEN), undefined, { now: () => 0, retryMissingConfidence: true, full: { tokenCap: fullRetryTokens(plainRequest.maxTokens ?? 0, READ_PARAMS.sonnet) } })
    expect(lowSent.length).toBe(2)
    expect(lowSent[1]?.effort).toBe('medium')
  })

  test('lượt đọc trọn bị cắt câu trả lời: lượt hỏi lại có maxTokens 1,5 lần, không vượt mức engine báo; request thường bị cắt: trần 32.000', () => {
    const full = plain(LONG)
    const tokenCap = fullRetryTokens(full.maxTokens ?? 0, READ_PARAMS.sonnet)
    expect(retryRequest(full, '{"goal":', 'json', { truncated: true, full: { tokenCap } }).maxTokens).toBe(Math.min(READ_PARAMS.sonnet.engineMaxOut, Math.round((full.maxTokens ?? 0) * 1.5)))
    expect(retryRequest(plain('f'.repeat(20_000)), '{"goal":', 'json', { truncated: true }).maxTokens).toBe(24_000)
    const big = { ...plain('f'.repeat(20_000)), maxTokens: 30_000 }
    expect(retryRequest(big, '{"goal":', 'json', { truncated: true }).maxTokens).toBe(32_000)
  })

  test('lượt hỏi lại vì tin cậy thấp: lượt đọc trọn với router thường chạy medium; prompt 5.000 ký tự như 0.8.6 (high)', () => {
    expect(retryRequest(plain(LONG), '{}', 'confidence', { full: { tokenCap: 1 } }).effort).toBe('medium')
    expect(retryRequest(plain(SHORT), '{}', 'confidence', {}).effort).toBe('high')
  })
})
