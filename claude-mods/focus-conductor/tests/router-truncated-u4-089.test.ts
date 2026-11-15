// 0.8.9 U4: lượt đọc trọn (có opts.fallback) chạy hết các bước mà không có kết quả đọc được, fallback và apiFallback chưa gửi: gửi fallback
// đúng một lần, kết quả kèm fellBack. Áp cho câu trả lời hỏng hay bị cắt mà không đủ hạn để hỏi lại, đã hỏi lại vẫn hỏng, câu trả lời rỗng.
// Request thường (không có fallback) giữ như 0.8.8.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteRequest } from 'claude-code'
import { askRouter, parseRoute } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { plan } from './support/engine'

const COND: Policy = { allowFable: false, blocked: new Set(), session: null, conductor: true }
const REPLY = JSON.stringify(plan({ goal: 'Sửa luồng thanh toán' }))
const parse = (text: string) => parseRoute(text, COND)
const FULL: ModelCompleteRequest = { model: 'fable', prompt: 'TRỌN', maxTokens: 64_000, timeoutMs: 300_000 } as ModelCompleteRequest
const CUT: ModelCompleteRequest = { model: 'fable', prompt: 'CẮT', maxTokens: 16_000, timeoutMs: 120_000 } as ModelCompleteRequest
const usage = (output: number) => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

type Reply = { text: string; output?: number } | 'empty'
/** ask trả lần lượt các câu trả lời; request fallback (prompt CẮT) luôn trả kế hoạch đúng. */
function scripted(replies: Reply[]) {
  const sent: string[] = []
  const ask = async (r: ModelCompleteRequest) => {
    const prompt = String(r.prompt)
    sent.push(prompt.startsWith('CẮT') ? 'CẮT' : prompt.startsWith('TRỌN') && prompt.length > 4 ? 'HỎI LẠI' : 'TRỌN')
    if (prompt.startsWith('CẮT')) return { isAnswered: true as const, text: REPLY, usage: usage(50) }
    const reply = replies.shift() ?? { text: '{"goal":' }
    if (reply === 'empty') return { isAnswered: false as const, reason: 'empty', usage: usage(0) } as never
    return { isAnswered: true as const, text: reply.text, usage: usage(reply.output ?? 50) }
  }
  return { ask, sent }
}

describe('0.8.9 U4: lượt đọc trọn không ra kết quả thì dùng fallback', () => {
  test('câu trả lời đầu bị cắt, lượt hỏi lại trả JSON hỏng: request thứ ba là fallback; có kết quả; fellBack và retried; ba usage', async () => {
    const { ask, sent } = scripted([{ text: '{"goal": "Sửa', output: 64_000 }, { text: '{"goal":' }])
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, full: { tokenCap: 64_000 } })
    expect(sent).toEqual(['TRỌN', 'HỎI LẠI', 'CẮT'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBe(true)
    expect(outcome.retried).toBe(true)
    expect(outcome.usages.length).toBe(3)
  })

  test('câu trả lời đầu bị cắt, lượt hỏi lại đọc được: hai request, không gửi fallback', async () => {
    const { ask, sent } = scripted([{ text: '{"goal": "Sửa', output: 64_000 }, { text: REPLY }])
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT, full: { tokenCap: 64_000 } })
    expect(sent).toEqual(['TRỌN', 'HỎI LẠI'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBeUndefined()
  })

  test('câu trả lời đầu hỏng và hạn chung đã hết: request thứ hai là fallback', async () => {
    let clock = 0
    const { ask, sent } = scripted([{ text: '{"goal":' }])
    const timed = async (r: ModelCompleteRequest) => {
      const reply = await ask(r)
      clock += 1_000_000
      return reply
    }
    const outcome = await askRouter(timed, FULL, parse, undefined, { now: () => clock, fallback: CUT })
    expect(sent).toEqual(['TRỌN', 'CẮT'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBe(true)
  })

  test('câu trả lời đầu rỗng: request thứ hai là fallback', async () => {
    const { ask, sent } = scripted(['empty'])
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0, fallback: CUT })
    expect(sent).toEqual(['TRỌN', 'CẮT'])
    expect(outcome.result).not.toBeNull()
    expect(outcome.fellBack).toBe(true)
  })

  test('request thường trả JSON hỏng hai lần: đúng hai request, kết quả rỗng như 0.8.8', async () => {
    const { ask, sent } = scripted([{ text: '{"goal":' }, { text: '{"goal":' }])
    const outcome = await askRouter(ask, FULL, parse, undefined, { now: () => 0 })
    expect(sent).toEqual(['TRỌN', 'HỎI LẠI'])
    expect(outcome.result).toBeNull()
    expect(outcome.failure).toBe('format')
  })
})
