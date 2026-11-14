// 0.8.9 U3 (tích hợp): engine giả từ chối request router với một câu lỗi. Cảnh báo và dòng router-fail của nhật ký quyết định cùng chứa câu
// đó; dòng router-fail ghi maxTokens đã gửi thật. Lượt đầu bị từ chối mà họ dự phòng cứu được: dòng route có firstFail.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { allowlistRefusal, base, plan, submit } from '../support/engine'

const GOAL = 'Mục tiêu router đọc được'
type Line = Record<string, unknown>

function logOf(on: On): () => Line[] {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Line)
}

describe('0.8.9 U3: lý do engine từ chối tới cảnh báo và nhật ký', () => {
  test('router mặc định bị engine từ chối: toast và dòng router-fail chứa câu của engine; maxTokens là số đã gửi', { options: { planApproval: 'off', decisionLog: '/tmp/fc-reason-u3-089a.jsonl' } }, async ($, on) => {
    const lines = logOf(on)
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => (call.kind === 'prompt' ? allowlistRefusal(call.model) : null) })
    await submit($, 'Sửa luồng thanh toán')
    const message = seen.refusals[0] ?? ''
    expect(message).toContain('allowlist')
    expect(seen.toasts.some(t => t.includes(`engine từ chối gửi request tới model router: ${message}`))).toBe(true)
    const fail = lines().find(line => line['kind'] === 'router-fail')
    expect(String(fail?.['reason'] ?? '')).toContain(message)
    expect(fail?.['maxTokens']).toBe(seen.requests[0]?.maxTokens)
  })

  test('conductor fable, engine từ chối họ fable, opus cứu được: dòng route có firstFail chứa câu của engine', { options: { planApproval: 'off', conductor: 'fable', decisionLog: '/tmp/fc-reason-u3-089b.jsonl' } }, async ($, on) => {
    const lines = logOf(on)
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => (call.model.includes('fable') ? allowlistRefusal(call.model) : null) })
    await submit($, 'Sửa luồng thanh toán')
    const route = lines().find(line => line['kind'] === 'route')
    expect(String(route?.['firstFail'] ?? '')).toContain(seen.refusals[0] ?? 'thiếu')
    expect(lines().some(line => line['kind'] === 'router-fail')).toBe(false)
  })
})
