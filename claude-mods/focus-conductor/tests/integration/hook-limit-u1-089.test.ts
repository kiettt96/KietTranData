// 0.8.9 U1: engine giả từ chối như engine thật (maxTokens trên 64.000 bị ném lỗi trước khi gửi). Router đọc trọn prompt 100.000 ký tự với
// conductor fable, conductor opus và option router haiku: request mang maxTokens không quá 64.000, context có bản đọc prompt, không có
// cảnh báo router lỗi.

import { describe, expect, test } from 'claude-code/testing'
import { base, plan, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const GOAL = 'Mục tiêu router đọc được'
const LONG = `Sửa luồng thanh toán. ${'a'.repeat(100_000 - 22)}`
const FAIL = 'không đọc được prompt'

const promptRequests = (seen: Seen) => seen.requests.filter(r => r.kind === 'prompt')
const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')

describe('0.8.9 U1: router đọc prompt dài không bị engine từ chối', () => {
  test('conductor fable, prompt 100.000 ký tự: request mang maxTokens 64.000; context có bản đọc prompt; không cảnh báo router lỗi', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: GOAL }) })
    await submit($, LONG)
    expect(promptRequests(seen)[0]?.model).toBe('fable')
    expect(promptRequests(seen)[0]?.maxTokens).toBe(64_000)
    expect(seen.refusals).toEqual([])
    expect(lastContext(seen)).toContain(GOAL)
    expect(seen.toasts.some(t => t.includes(FAIL))).toBe(false)
  })

  for (const [name, options, model] of [
    ['conductor opus', { planApproval: 'off', conductor: 'opus' }, 'opus'],
    ['option router haiku', { planApproval: 'off', router: 'haiku' }, 'haiku'],
  ] as const) {
    test(`${name}, prompt 100.000 ký tự: đọc được; maxTokens không quá 64.000`, { options }, async ($, on) => {
      const seen = base(on, { router: () => plan({ goal: GOAL }) })
      await submit($, LONG)
      const first = promptRequests(seen)[0]
      expect(first?.model).toBe(model)
      expect(first?.maxTokens ?? Infinity).toBeLessThanOrEqual(64_000)
      expect(seen.refusals).toEqual([])
      expect(lastContext(seen)).toContain(GOAL)
      expect(seen.toasts.some(t => t.includes(FAIL))).toBe(false)
    })
  }
})
