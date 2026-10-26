// 0.7.3 điểm 4: option netResume (mặc định TẮT). Khi bật và luồng chính có turn lỗi (điểm 3), mod dò nhẹ bằng $.http.fetch định kỳ;
// có phản hồi thì tự gửi một prompt tiếp tục đúng một lần cho mỗi mục tiêu. Tôn trọng dừng hạn mức và mode off; người dùng gõ prompt,
// turn trả lời, hay session.end thì hủy chờ. Số lần dò có trần. Test dùng $.http và đồng hồ giả.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const PROBE_MS = 30_000
const DONE = (turnId: string, reason = 'answer', agentId?: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: reason === 'aborted', reason, ...(agentId ? { agentId } : {}) }) as never
const ON = { options: { netResume: true } }

/** Mạng giả: `reach` đổi được; mỗi lần dò ghi lại url và init. Không có mạng thì $.http.fetch ném lỗi như khi mất kết nối. */
function network(on: On) {
  const net = { reach: false, calls: [] as Array<{ url: string; init: unknown }>, status: 404 }
  on('http.fetch', (_$, e) => {
    net.calls.push({ url: e.url, init: e.init })
    if (!net.reach) throw new Error('fetch failed')
    return { value: { status: net.status, ok: net.status < 300, headers: {}, text: '' } } as never
  })
  return net
}

/** Các prompt do mod tự gửi (nguồn plugin), ghi lại qua một hook có bộ lọc riêng. */
function submitted(on: On) {
  const box = { texts: [] as string[] }
  on('prompt.submit', { text: /Turn trước kết thúc vì lỗi/ }, (_$, e, next) => {
    box.texts.push(e.text)
    return next(e)
  })
  return box
}

async function setup($: Engine, on: On, extra: { quota?: boolean } = {}) {
  // Hook quan sát đăng ký trước base(): hook prompt.submit của base không gọi next nên hook đăng ký sau nó không bao giờ chạy.
  const sent = submitted(on)
  const seen = base(on, extra.quota === true ? RESUME : {})
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  const net = network(on)
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Dựng bảng tổng' }, { title: 'Kiểm tổng' }] })
  return { seen, net, sent }
}

const failTurn = async ($: Engine, id = 't1') => {
  await $.turn.start({ text: 'x', turnId: id })
  await $.turn.complete(DONE(id, 'error'))
}

describe('0.7.3 điểm 4: netResume tắt mặc định', () => {
  test('không đặt option: turn lỗi không tạo bộ đếm, không dò, không gửi prompt', {}, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await seen.clock.advance(10 * 60_000)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })

  test('netResume false: như không đặt', { options: { netResume: false } }, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await seen.clock.advance(10 * 60_000)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })
})

describe('0.7.3 điểm 4: bật netResume', () => {
  test('chưa có mạng thì dò tiếp mà không gửi; có mạng thì gửi đúng một prompt rồi dừng dò', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    expect(net.calls.length).toBe(0)
    await seen.clock.advance(PROBE_MS)
    await seen.clock.advance(PROBE_MS)
    expect(net.calls.length).toBe(2)
    expect(sent.texts).toEqual([])
    net.reach = true
    await seen.clock.advance(PROBE_MS)
    expect(net.calls.length).toBe(3)
    expect(sent.texts.length).toBe(1)
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls.length).toBe(3)
    expect(sent.texts.length).toBe(1)
  })

  test('mã trạng thái nào có phản hồi cũng tính là có mạng (404 vẫn là có)', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    net.status = 404
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    expect(sent.texts.length).toBe(1)
  })

  test('dò chỉ đọc: GET, không gửi dữ liệu của phiên, không auth', ON, async ($, on) => {
    const { seen, net } = await setup($, on)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    const call = net.calls[0]
    expect(call?.url).toMatch(/^https:\/\//)
    const init = (call?.init ?? {}) as { method?: string; body?: string; auth?: string; headers?: unknown }
    expect(init.method === undefined || init.method === 'GET').toBe(true)
    expect(init.body).toBeUndefined()
    expect(init.auth).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  test('prompt tiếp tục ngắn, nêu mục tiêu và các bước còn mở, không chứa dữ liệu khác', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    const text = sent.texts[0] ?? ''
    expect(text.length).toBeLessThan(800)
    expect(text).toContain('Tiếp tục')
    expect(text).toContain('Mục tiêu: ')
    expect(text).toContain('Dựng bảng tổng')
    expect(text).toContain('Kiểm tổng')
  })

  test('chỉ nêu tối đa năm bước còn mở, mục tiêu quá dài bị cắt', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    await $.tool.call({ tool: PLAN, action: 'set', steps: Array.from({ length: 8 }, (_, i) => ({ title: `Bước mở số ${i + 1}` })) })
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    const text = sent.texts[0] ?? ''
    expect(text).toContain('Bước mở số 5')
    expect(text).not.toContain('Bước mở số 6')
  })

  test('prompt do plugin gửi không qua router (không đổi mục tiêu)', ON, async ($, on) => {
    const { seen, net } = await setup($, on)
    net.reach = true
    const routedBefore = seen.routed.length
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    expect(seen.routed.length).toBe(routedBefore)
  })

  test('tối đa một lần tự tiếp tục mỗi mục tiêu: lỗi lần hai cùng mục tiêu không dò, không gửi', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    await failTurn($, 't1')
    await seen.clock.advance(PROBE_MS)
    expect(sent.texts.length).toBe(1)
    await failTurn($, 't2')
    const calls = net.calls.length
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls.length).toBe(calls)
    expect(sent.texts.length).toBe(1)
  })

  test('mục tiêu mới thì được tự tiếp tục lại', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    await failTurn($, 't1')
    await seen.clock.advance(PROBE_MS)
    await conductor($, 'goal Làm việc khác hẳn')
    await failTurn($, 't2')
    await seen.clock.advance(PROBE_MS)
    expect(sent.texts.length).toBe(2)
  })

  test('số lần dò có trần: hết trần thì thôi dò', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    for (let i = 0; i < 130; i++) await seen.clock.advance(PROBE_MS)
    expect(net.calls.length).toBe(120)
    expect(sent.texts).toEqual([])
  })
})

describe('0.7.3 điểm 4: các trường hợp hủy hay bỏ qua', () => {
  test('người dùng gõ prompt sau turn lỗi: hủy chờ', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    const calls = net.calls.length
    await $.turn.start({ text: 'chạy lại giúp tôi', turnId: 't2' })
    net.reach = true
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls.length).toBe(calls)
    expect(sent.texts).toEqual([])
  })

  test('turn trả lời xong trước khi có mạng (nhãn đã xóa): không gửi', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await $.turn.start({ text: 'x', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'answer'))
    net.reach = true
    await seen.clock.advance(10 * PROBE_MS)
    expect(sent.texts).toEqual([])
  })

  test('session.end hủy bộ đếm', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    net.reach = true
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })

  test('mode off: không tạo bộ đếm', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await conductor($, 'mode off')
    net.reach = true
    await failTurn($)
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })

  test('đổi sang mode off sau khi đã có bộ đếm: không gửi', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await conductor($, 'mode off')
    net.reach = true
    await seen.clock.advance(10 * PROBE_MS)
    expect(sent.texts).toEqual([])
  })

  test('turn lỗi của subagent, aborted và refusal: không tạo bộ đếm', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    net.reach = true
    await $.turn.complete(DONE('ag-1', 'error', 'agent-1'))
    await $.turn.start({ text: 'x', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'aborted'))
    await $.turn.start({ text: 'x', turnId: 't3' })
    await $.turn.complete(DONE('t3', 'refusal'))
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })

  test('đang dừng vì hạn mức: có mạng cũng không gửi', ON, async ($, on) => {
    const sent = submitted(on)
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    const net = network(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    net.reach = true
    await failTurn($)
    await seen.clock.advance(10 * PROBE_MS)
    expect(sent.texts).toEqual([])
  })
})

describe('0.7.3 điểm 4: nhật ký quyết định', () => {
  test('tự tiếp tục ghi dòng net kèm lý do auto-resume', { options: { netResume: true, decisionLog: '/tmp/fc-net-resume.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const { seen, net } = await setup($, on)
    net.reach = true
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.filter(line => line['kind'] === 'net').map(line => line['reason'])).toContain('auto-resume')
  })

  test('hết trần dò ghi dòng net kèm lý do probe-gave-up', { options: { netResume: true, decisionLog: '/tmp/fc-net-resume2.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const { seen } = await setup($, on)
    await failTurn($)
    for (let i = 0; i < 130; i++) await seen.clock.advance(PROBE_MS)
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.filter(line => line['kind'] === 'net').map(line => line['reason'])).toContain('probe-gave-up')
  })
})

describe('0.7.3 điểm 4: thời điểm hủy và bộ đếm duy nhất', () => {
  test('turn của subagent bắt đầu giữa chừng không hủy chờ của luồng chính', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await $.turn.start({ text: 'việc con', turnId: 'ag-1', agentId: 'agent-1' } as never)
    net.reach = true
    await seen.clock.advance(PROBE_MS)
    expect(sent.texts.length).toBe(1)
  })

  test('session.end (lý do không phải clear) hủy bộ đếm', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($)
    await $.session.end({ reason: 'other', sessionId: 's1' } as never)
    net.reach = true
    await seen.clock.advance(10 * PROBE_MS)
    expect(net.calls).toEqual([])
    expect(sent.texts).toEqual([])
  })

  test('turn trả lời hủy bộ đếm ngay: lỗi lần sau bắt đầu chu kỳ mới, không dùng nhịp cũ', ON, async ($, on) => {
    const { seen, net } = await setup($, on)
    await failTurn($, 't1')
    await seen.clock.advance(15_000)
    await $.turn.start({ text: 'y', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'answer'))
    await seen.clock.advance(5_000)
    await $.turn.complete(DONE('t3', 'error'))
    await seen.clock.advance(PROBE_MS - 1_000)
    expect(net.calls.length).toBe(0)
    await seen.clock.advance(2_000)
    expect(net.calls.length).toBe(1)
  })

  test('bản ghi turn lỗi mất do /conductor reset: bộ đếm dừng ở nhịp kế, lỗi sau bắt đầu chu kỳ mới', ON, async ($, on) => {
    const { seen, net, sent } = await setup($, on)
    await failTurn($, 't1')
    await seen.clock.advance(10_000)
    await conductor($, 'reset')
    await seen.clock.advance(25_000)
    expect(net.calls.length).toBe(0)
    await $.turn.complete(DONE('t3', 'error'))
    await seen.clock.advance(PROBE_MS - 1_000)
    expect(net.calls.length).toBe(0)
    net.reach = true
    await seen.clock.advance(2_000)
    expect(sent.texts.length).toBe(1)
  })

  test('hủy trong lúc chờ phản hồi dò (người dùng gõ prompt): không gửi', ON, async ($, on) => {
    const sent = submitted(on)
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    // Phản hồi của lần dò bị giữ lại cho tới khi test cho qua.
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started = 0
    on('http.fetch', async () => {
      started += 1
      await gate
      return { value: { status: 200, ok: true, headers: {}, text: '' } } as never
    })
    await submit($, COMPLEX_PROMPT)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    expect(started).toBe(1)
    await $.turn.start({ text: 'tôi tự gõ', turnId: 'tu' })
    release()
    await seen.clock.advance(1_000)
    expect(sent.texts).toEqual([])
  })

  test('đối chứng: không bị hủy trong lúc chờ phản hồi thì gửi như thường', ON, async ($, on) => {
    const sent = submitted(on)
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    on('http.fetch', async () => {
      await gate
      return { value: { status: 200, ok: true, headers: {}, text: '' } } as never
    })
    await submit($, COMPLEX_PROMPT)
    await failTurn($)
    await seen.clock.advance(PROBE_MS)
    release()
    await seen.clock.advance(1_000)
    expect(sent.texts.length).toBe(1)
  })

  test('lỗi lần hai khi bộ đếm còn sống không tạo bộ đếm thứ hai: mỗi nhịp một lần dò', ON, async ($, on) => {
    const { seen, net } = await setup($, on)
    await failTurn($, 't1')
    await $.turn.complete(DONE('t2', 'error'))
    await seen.clock.advance(PROBE_MS)
    expect(net.calls.length).toBe(1)
  })
})
