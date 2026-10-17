// 0.6.1 mục 2: điểm dừng được ghi cả khi không có tool call (session.measure, prompt.submit, session.end);
// câu nhắc khi người dùng tự dừng.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const DONE = (turnId: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' }) as never
const END = { reason: 'exit', sessionId: 's1', resume: { id: 's1' } } as never

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
}

function openCheckpoints(box: { data: Map<string, unknown> }): QuotaCheckpoint[] {
  return [...box.data.entries()].filter(([k]) => k.startsWith('checkpoint:')).map(([, v]) => v as QuotaCheckpoint).filter(cp => cp.status === 'open')
}

async function measure($: Engine, used: number) {
  await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(used)], changed: ['rateLimits'] } as never)
}

/** Một mục tiêu có checklist còn bước mở, lúc hạn mức còn thoải mái. */
async function goalWithSteps($: Engine) {
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
}

describe('0.6.1 2.1: điểm dừng được ghi cả khi không có tool call', () => {
  test('hạn mức 97%, session.measure, prompt trả lời bằng chữ, turn.complete: đúng một điểm dừng open, phiên mới khôi phục được', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await measure($, 97)
    await submit($, 'giải thích ngắn kiến trúc hiện tại')
    await $.turn.start({ text: 'giải thích', turnId: 't2' })
    await $.turn.complete(DONE('t2'))
    const open = openCheckpoints(box)
    expect(open.length).toBe(1)
    expect(open[0]?.plan.map(s => s.title)).toEqual(['Sửa', 'Kiểm'])
    await conductor($, 'reset')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Refactor module thanh toán')
    expect(status).toContain('[~] 1. Sửa')
  })

  test('chỉ session.measure (không prompt, không tool call): đã có đúng một điểm dừng open', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await seen.clock.advance(10_000)
    await measure($, 97)
    const open = openCheckpoints(box)
    expect(open.length).toBe(1)
    expect(open[0]?.plan[0]?.status).toBe('doing')
  })

  test('session.measure qua ngưỡng mà checklist trống: không tạo điểm dừng', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await seen.clock.advance(10_000)
    await measure($, 97)
    expect(openCheckpoints(box).length).toBe(0)
  })

  test('prompt đến khi đang ở vùng dừng mà chưa có lần dừng: ghi điểm dừng, không cần tool call', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp')
    expect(openCheckpoints(box).length).toBe(1)
  })

  test('session.end khi đang ở vùng dừng và checklist còn mở: ghi điểm dừng; gọi lần hai chỉ cập nhật, không tạo bản trùng', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.session.end(END)
    const first = openCheckpoints(box)
    expect(first.length).toBe(1)
    expect(first[0]?.plan[0]?.status).toBe('doing')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await seen.clock.advance(10_000)
    await $.session.end(END)
    const second = openCheckpoints(box)
    expect(second.length).toBe(1)
    expect(second[0]?.id).toBe(first[0]?.id)
    expect(second[0]?.plan[0]?.status).toBe('done')
  })

  test('session.end ở vùng dừng mà checklist trống: không ghi gì', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.session.end(END)
    expect(openCheckpoints(box).length).toBe(0)
  })

  test('session.end ngoài vùng dừng: không ghi gì', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await $.session.end(END)
    expect(openCheckpoints(box).length).toBe(0)
  })

  test('quotaGuard false: session.measure, prompt và session.end không ghi gì', { options: { quotaGuard: false } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(99)])
    await seen.clock.advance(10_000)
    await measure($, 99)
    await submit($, 'tiếp')
    await $.session.end(END)
    expect(box.data.size).toBe(0)
  })
})

describe('0.6.1 2.3: câu nhắc theo nguồn dừng', () => {
  test('người dùng tự dừng: prompt được nhắc /conductor resume, không phải resume force', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await conductor($, 'pause')
    await submit($, 'tiếp')
    const context = (seen.contexts[seen.contexts.length - 1] ?? []).join('\n')
    expect(context).toContain('/conductor resume')
    expect(context).not.toContain('resume force')
    expect(seen.toasts.at(-1)).not.toContain('resume force')
  })

  test('dừng vì hạn mức: vẫn nhắc /conductor resume force', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(97)])
    await submit($, COMPLEX_PROMPT)
    expect((seen.contexts[seen.contexts.length - 1] ?? []).join('\n')).toContain('/conductor resume force')
  })
})
