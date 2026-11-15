// 0.8.9 U2: lượt đầu bị engine từ chối (ask ném lỗi hay trả null) thì askRouter có đường lùi. Có fallback: gửi fallback; không ra kết quả mà có
// apiFallback thì gửi tiếp apiFallback. Không có fallback mà có apiFallback: gửi apiFallback. Không có cả hai: như 0.8.8. Mỗi request dự phòng
// gửi nhiều nhất một lần. Usage của mỗi lời gọi đi kèm model đã nhận lời gọi đó (usageModels); lời gọi bị từ chối không có usage.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteRequest } from 'claude-code'
import { askRouter, parseRoute } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { plan } from './support/engine'

const COND: Policy = { allowFable: false, blocked: new Set(), session: null, conductor: true }
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
const parse = (text: string) => parseRoute(text, COND)
const REFUSED = 'focus-conductor: $.model.complete: model "claude-fable-5-2" is not in this organization\'s allowlist'

const FULL: ModelCompleteRequest = { model: 'fable', prompt: 'TRỌN', maxTokens: 64_000, timeoutMs: 300_000 } as ModelCompleteRequest
const CUT: ModelCompleteRequest = { model: 'fable', prompt: 'CẮT', maxTokens: 16_000, timeoutMs: 120_000 } as ModelCompleteRequest
const API: ModelCompleteRequest = { model: 'opus', prompt: 'TRỌN', maxTokens: 64_000, timeoutMs: 300_000 } as ModelCompleteRequest

type Act = 'refuse' | 'null' | 'answer' | 'api-error'
/** ask theo nhãn model/prompt của request: refuse ném lỗi như engine, null trả null, answer trả kế hoạch, api-error trả lỗi API. */
function scripted(acts: Record<string, Act>) {
  const sent: string[] = []
  const ask = async (r: ModelCompleteRequest) => {
    const label = `${r.model}/${String(r.prompt)}`
    sent.push(label)
    const act = acts[label] ?? 'answer'
    if (act === 'refuse') throw new Error(REFUSED)
    if (act === 'null') return null
    if (act === 'api-error') return { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE }
    return { isAnswered: true as const, text: REPLY, usage: USAGE }
  }
  return { ask, sent }
}

describe('0.8.9 U2: lượt đầu bị engine từ chối', () => {
  test('dòng 1, có fallback: gửi fallback; có kết quả thì trả kèm fellBack; một usage của fable', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'refuse' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, apiFallback: API })
    expect(sent).toEqual(['fable/TRỌN', 'fable/CẮT'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBe(true)
    expect(outcome.viaFallback).toBeUndefined()
    expect(outcome.usages.length).toBe(1)
    expect(outcome.usageModels).toEqual(['fable'])
  })

  test('dòng 1, fallback cũng bị từ chối và có apiFallback: ba request theo thứ tự; kết quả của apiFallback; viaFallback', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'refuse', 'fable/CẮT': 'refuse' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, apiFallback: API })
    expect(sent).toEqual(['fable/TRỌN', 'fable/CẮT', 'opus/TRỌN'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.viaFallback).toBe(true)
    expect(outcome.usages.length).toBe(1)
    expect(outcome.usageModels).toEqual(['opus'])
  })

  test('dòng 1, fallback và apiFallback đều bị từ chối: kết quả rỗng, failure engine, không có request thứ tư', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'refuse', 'fable/CẮT': 'null', 'opus/TRỌN': 'refuse' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, apiFallback: API })
    expect(sent).toEqual(['fable/TRỌN', 'fable/CẮT', 'opus/TRỌN'])
    expect(outcome.result).toBeNull()
    expect(outcome.failure).toBe('engine')
    expect(outcome.usages).toEqual([])
  })

  test('dòng 2, không có fallback, có apiFallback: gửi apiFallback; viaFallback; một usage của opus', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'refuse' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, apiFallback: API })
    expect(sent).toEqual(['fable/TRỌN', 'opus/TRỌN'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.viaFallback).toBe(true)
    expect(outcome.fellBack).toBeUndefined()
    expect(outcome.usages.length).toBe(1)
    expect(outcome.usageModels).toEqual(['opus'])
  })

  test('dòng 3, không có fallback, không có apiFallback: như 0.8.8, failure engine, không hỏi lại', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'refuse' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0 })
    expect(sent).toEqual(['fable/TRỌN'])
    expect(outcome.result).toBeNull()
    expect(outcome.failure).toBe('engine')
    expect(outcome.retried).toBe(false)
    expect(outcome.usages).toEqual([])
  })

  test('lượt đầu lỗi API, có apiFallback: như 0.8.8, hai request, viaFallback; usage đầu của fable, usage sau của opus', async () => {
    const { ask, sent } = scripted({ 'fable/TRỌN': 'api-error' })
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, apiFallback: API })
    expect(sent).toEqual(['fable/TRỌN', 'opus/TRỌN'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.viaFallback).toBe(true)
    expect(outcome.usages.length).toBe(2)
    expect(outcome.usageModels).toEqual(['fable', 'opus'])
  })
})
