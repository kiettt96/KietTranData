// 0.8.9 U3 (tích hợp): engine giả từ chối request router. Kit test không chuyển lỗi do hook test ném sang mod (tests/support/engine.ts,
// chỗ ném lỗi của engine giả): mod nhận câu của kit "no implementation for model.complete". Vì vậy các ca này kiểm câu mod thật nhận được:
// cảnh báo và dòng router-fail của nhật ký quyết định cùng chứa lý do kèm câu đó; dòng router-fail ghi maxTokens đã gửi thật. Lượt đầu bị
// từ chối mà họ dự phòng cứu được: dòng route có firstFail. Câu nguyên văn của engine thật được kiểm ở tests/router-reason-u3-089.test.ts.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { allowlistRefusal, base, plan, submit } from '../support/engine'

const GOAL = 'Mục tiêu router đọc được'
/** Lý do mod ghi khi engine giả từ chối: phần đầu cố định kèm câu mod nhận từ kit. */
const REFUSED = 'engine từ chối gửi request tới model router: no implementation for model.complete'
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
  test('router mặc định bị engine từ chối: toast và dòng router-fail chứa lý do kèm câu mod nhận; maxTokens là số đã gửi', { options: { planApproval: 'off', decisionLog: '/tmp/fc-reason-u3-089a.jsonl' } }, async ($, on) => {
    const lines = logOf(on)
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => (call.kind === 'prompt' ? allowlistRefusal(call.model) : null) })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.refusals[0] ?? '').toContain('allowlist')
    expect(seen.toasts.some(t => t.includes(REFUSED))).toBe(true)
    const fail = lines().find(line => line['kind'] === 'router-fail')
    expect(String(fail?.['reason'] ?? '')).toContain(REFUSED)
    expect(fail?.['maxTokens']).toBe(seen.requests[0]?.maxTokens)
  })

  test('conductor fable, engine từ chối họ fable, opus cứu được: dòng route có firstFail chứa lý do kèm câu mod nhận', { options: { planApproval: 'off', conductor: 'fable', decisionLog: '/tmp/fc-reason-u3-089b.jsonl' } }, async ($, on) => {
    const lines = logOf(on)
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => (call.model.includes('fable') ? allowlistRefusal(call.model) : null) })
    await submit($, 'Sửa luồng thanh toán')
    const route = lines().find(line => line['kind'] === 'route')
    expect(seen.refusals.length).toBeGreaterThan(0)
    expect(String(route?.['firstFail'] ?? '')).toContain(REFUSED)
    expect(lines().some(line => line['kind'] === 'router-fail')).toBe(false)
  })
})
