// 0.8.9 R1: timeoutMs, maxTokens và outputTokens của RouterOutcome cùng thuộc lời gọi cuối cùng đã gửi (sau khi kẹp), ở mọi nhánh của
// askRouter. Dòng router-fail lấy ba trường này, nên ghi đúng giới hạn của lời gọi đã hỏng.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteRequest } from 'claude-code'
import { askRouter, parseRoute } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { plan } from './support/engine'

const COND: Policy = { allowFable: false, blocked: new Set(), session: null, conductor: true }
const REPLY = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
const parse = (text: string) => parseRoute(text, COND)
const usage = (output: number) => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
const req = (prompt: string, maxTokens: number, timeoutMs: number, model = 'fable') => ({ model, prompt, maxTokens, timeoutMs }) as ModelCompleteRequest
const FULL = req('TRỌN', 64_000, 300_000)
const CUT = req('CẮT', 16_000, 120_000)
const API = req('API', 32_000, 600_000, 'opus')
const fields = (o: { timeoutMs: number | null; maxTokens: number | null; outputTokens: number | null }) => ({ timeoutMs: o.timeoutMs, maxTokens: o.maxTokens, outputTokens: o.outputTokens })

describe('0.8.9 R1: giới hạn của lời gọi cuối cùng đã gửi', () => {
  test('lượt đầu trả lời: giới hạn của request đầu, token ra của câu trả lời đó', async () => {
    const outcome = await askRouter(async () => ({ isAnswered: true as const, text: REPLY, usage: usage(700) }), FULL, parse, undefined, { now: () => 0 })
    expect(fields(outcome)).toEqual({ timeoutMs: 300_000, maxTokens: 64_000, outputTokens: 700 })
  })

  test('request đầu mang maxTokens 128.000: kết quả ghi 64.000 (số đã gửi sau khi kẹp)', async () => {
    const outcome = await askRouter(async () => ({ isAnswered: true as const, text: REPLY, usage: usage(700) }), req('TRỌN', 128_000, 300_000), parse, undefined, { now: () => 0 })
    expect(fields(outcome)).toEqual({ timeoutMs: 300_000, maxTokens: 64_000, outputTokens: 700 })
  })

  test('lượt đầu bị engine từ chối, fallback trả lời: giới hạn và token ra của fallback', async () => {
    const ask = async (r: ModelCompleteRequest) => {
      if (String(r.prompt) === 'TRỌN') throw new Error('focus-conductor: $.model.complete: model "claude-fable-5-2" is not in this organization\'s allowlist')
      return { isAnswered: true as const, text: REPLY, usage: usage(300) }
    }
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT })
    expect(outcome.fellBack).toBe(true)
    expect(fields(outcome)).toEqual({ timeoutMs: 120_000, maxTokens: 16_000, outputTokens: 300 })
  })

  test('lượt đầu bị từ chối, fallback hỏng, apiFallback trả lời: giới hạn và token ra của apiFallback', async () => {
    const ask = async (r: ModelCompleteRequest) => {
      const prompt = String(r.prompt)
      if (prompt === 'TRỌN') throw new Error('focus-conductor: $.model.complete: model "claude-fable-5-2" is not in this organization\'s allowlist')
      if (prompt === 'CẮT') return { isAnswered: true as const, text: '{"goal":', usage: usage(40) }
      return { isAnswered: true as const, text: REPLY, usage: usage(900) }
    }
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, apiFallback: API })
    expect(outcome.viaFallback).toBe(true)
    expect(fields(outcome)).toEqual({ timeoutMs: 600_000, maxTokens: 32_000, outputTokens: 900 })
  })

  test('lượt đầu bị từ chối, apiFallback mang maxTokens 128.000 trả lời: kết quả ghi 64.000 (số đã gửi sau khi kẹp)', async () => {
    const sent: ModelCompleteRequest[] = []
    const ask = async (r: ModelCompleteRequest) => {
      sent.push(r)
      if (String(r.prompt) === 'TRỌN') throw new Error('focus-conductor: $.model.complete: model "claude-fable-5-2" is not in this organization\'s allowlist')
      return { isAnswered: true as const, text: REPLY, usage: usage(900) }
    }
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, apiFallback: req('API', 128_000, 600_000, 'opus') })
    expect(sent[1]?.maxTokens).toBe(64_000)
    expect(fields(outcome)).toEqual({ timeoutMs: 600_000, maxTokens: 64_000, outputTokens: 900 })
  })

  test('lượt hỏi lại vì câu trả lời bị cắt: giới hạn và token ra của lượt hỏi lại', async () => {
    const sent: ModelCompleteRequest[] = []
    const ask = async (r: ModelCompleteRequest) => {
      sent.push(r)
      return sent.length === 1 ? { isAnswered: true as const, text: '{"goal": "Sửa', usage: usage(16_000) } : { isAnswered: true as const, text: REPLY, usage: usage(5_000) }
    }
    const outcome = await askRouter(ask, req('THƯỜNG', 16_000, 100_000, 'sonnet'), parse, undefined, { now: () => 0 })
    expect(sent.length).toBe(2)
    expect(outcome.retried).toBe(true)
    expect(fields(outcome)).toEqual({ timeoutMs: sent[1]?.timeoutMs ?? null, maxTokens: sent[1]?.maxTokens ?? null, outputTokens: 5_000 })
    expect(sent[1]?.maxTokens).not.toBe(16_000)
  })
})
