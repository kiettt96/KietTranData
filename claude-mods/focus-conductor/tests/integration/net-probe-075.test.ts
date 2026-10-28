// 0.7.5 C5: netResume không dò khi số đo đã lưu có cửa sổ chạm ngưỡng dừng cứng (dù chưa vào trạng thái dừng), và phản hồi 429
// (quá giới hạn) không tính là có mạng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { session } from '../support/quota'

const PROBE_MS = 30_000
const DONE = (turnId: string, reason = 'answer') => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason }) as never
const ON = { options: { netResume: true } }

function network(on: On) {
  const net = { reach: true, calls: 0, status: 200 }
  on('http.fetch', () => {
    net.calls += 1
    if (!net.reach) throw new Error('fetch failed')
    return { value: { status: net.status, ok: net.status < 300, headers: {}, text: '' } } as never
  })
  return net
}

function submitted(on: On) {
  const box = { texts: [] as string[] }
  on('prompt.submit', { text: /Turn trước kết thúc vì lỗi/ }, (_$, e, next) => {
    box.texts.push(e.text)
    return next(e)
  })
  return box
}

const failTurn = async ($: Engine, id = 't1') => {
  await $.turn.start({ text: 'x', turnId: id })
  await $.turn.complete(DONE(id, 'error'))
}

describe('0.7.5 C5: 429 không tính là có mạng', () => {
  test('phản hồi 429: không tự tiếp tục; phản hồi 200 sau đó thì tiếp tục', ON, async ($, on) => {
    const sent = submitted(on)
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    const net = network(on)
    net.status = 429
    await submit($, COMPLEX_PROMPT)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    expect(net.calls).toBe(1)
    expect(sent.texts).toEqual([])
    net.status = 200
    await seen.clock.advance(PROBE_MS)
    expect(sent.texts.length).toBe(1)
  })
})

describe('0.7.5 C5: số đo đã lưu chạm ngưỡng dừng cứng', () => {
  test('cửa sổ phiên còn 3% (ngưỡng 5%) mà chưa dừng: không dò, không gửi', ON, async ($, on) => {
    const sent = submitted(on)
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    const net = network(on)
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await submit($, COMPLEX_PROMPT)
    // Không có checklist: số đo chạm ngưỡng chỉ được lưu, không vào trạng thái dừng.
    await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(97)], changed: ['rateLimits'] } as never)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    await seen.clock.advance(PROBE_MS)
    expect(net.calls).toBe(0)
    expect(sent.texts).toEqual([])
  })
})
