// 0.6.0 hạng mục D: tiếp tục từ điểm dừng (cùng phiên, phiên mới, /conductor resume), vòng đời open, resuming, consumed.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { buildCheckpoint, storeKey, withNote } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, base, conductor, plan, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const EDIT = { tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as const
const DONE = (turnId: string, reason = 'answer') => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason }) as never

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
}

function storedCheckpoint(goal = 'Sửa module thanh toán'): QuotaCheckpoint {
  return withNote(
    buildCheckpoint({
      id: 'cp-old',
      now: 500,
      cwd: '/repo',
      reason: [{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }],
      brief: { goalId: 3, goal, steps: [], tasks: [], constraints: ['Không đổi API'], quality: [], depth: 'hard', volume: 'medium', kind: 'edit', tier: 'complex', main: null, why: '', relation: 'new', source: 'router', isFollowUp: false, isReference: false, scopePaths: [], prompt: '', at: 1 },
      plan: [
        { id: 1, title: 'Phân tích', status: 'done' },
        { id: 2, title: 'Sửa charge', status: 'doing' },
      ],
      delegations: [],
      recent: ['Edit src/a.ts'],
      files: [{ path: 'src/a.ts', mtimeMs: 900, size: 10 }],
      denied: { tool: 'Bash', input: '{"command":"npm test"}' },
    }),
    'Chạy npm test sau khi sửa charge; phân tích đã xong.',
  )
}

/** Dừng vì hạn mức trong phiên này rồi ghi note, trả bảng số đo để test hạ xuống. */
async function pauseNow($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
  await $.tool.call(EDIT)
  meter.set([session(97)])
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test; Sửa a.ts đã xong.' })
}

describe('0.6.0 D: tiếp tục cùng phiên', () => {
  test('hạn mức làm mới: prompt kế tiếp có khối ĐIỂM DỪNG đặt trước mọi context, đúng một lần, không quá 2000 ký tự', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(5)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    const context = seen.contexts[seen.contexts.length - 1] ?? []
    expect(context[0]?.startsWith('[focus-conductor] ĐIỂM DỪNG')).toBe(true)
    expect(context.filter(c => c.includes('ĐIỂM DỪNG')).length).toBe(1)
    expect((context[0] ?? '').length).toBeLessThanOrEqual(2000)
    expect(context[0]).toContain('chạy npm test')
    expect(context[0]).toContain('Bash {"command":"npm test"}')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('resuming')
    await submit($, 'còn gì nữa')
    expect((seen.contexts[seen.contexts.length - 1] ?? []).join('\n')).not.toContain('ĐIỂM DỪNG')
    // Đang resuming, prompt tiếp nối nữa (router xếp continue) cũng không chèn lại khối.
    await submit($, 'tiếp tục')
    expect((seen.contexts[seen.contexts.length - 1] ?? []).join('\n')).not.toContain('ĐIỂM DỪNG')
  })

  test('vẫn trong vùng dừng mà không force: không tiếp tục lặng lẽ, điểm dừng vẫn open', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    await submit($, 'tiếp tục')
    const context = (seen.contexts[seen.contexts.length - 1] ?? []).join('\n')
    expect(context).not.toContain('ĐIỂM DỪNG')
    expect(context).toContain('/conductor resume force')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
  })

  test('phát hiện file đổi sau lúc dừng, buộc đọc lại trước khi sửa', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    let mtime = 900
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }) as never)
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    mtime = 5_000
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    const block = seen.contexts[seen.contexts.length - 1]?.[0] ?? ''
    expect(block).toContain('đổi sau lúc dừng')
    expect(block).toContain('src/a.ts')
  })
})

describe('0.6.0 D: chỉ prompt tiếp nối mới tiếp tục điểm dừng (góp ý PR 21)', () => {
  test('prompt không liên quan (router xếp mục tiêu mới): không chèn khối, chỉ nhắc một dòng, điểm dừng vẫn open sau turn', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await submit($, 'Giải thích file README')
    const context = (seen.contexts[seen.contexts.length - 1] ?? []).join('\n')
    expect(context).not.toContain('ĐIỂM DỪNG')
    expect(context).toContain('Có điểm dừng chưa tiếp tục')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    await $.turn.start({ text: 'Giải thích file README', turnId: 'q1' })
    await $.turn.complete(DONE('q1'))
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    await submit($, 'tiếp tục')
    expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
  })

  for (const relation of ['refine', 'dissatisfied']) {
    test(`router xếp ${relation}: tiếp tục điểm dừng`, {}, async ($, on) => {
      const seen = base(on, { router: request => (request.startsWith('chỉnh') ? plan({ relation }) : plan()) })
      startHooks(on)
      const box = memoryStore(on)
      const meter = quotaMeter(on, [session(10)])
      on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
      await submit($, COMPLEX_PROMPT)
      await pauseNow($, meter, seen.clock)
      meter.set([session(1)])
      await seen.clock.advance(10_000)
      await submit($, 'chỉnh lại phần test cho gọn')
      expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
      expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('resuming')
    })
  }

  test('câu trong routerSkip: tiếp tục điểm dừng mà không hỏi router', { options: { routerSkip: 'tiếp' } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    const routed = seen.routed.length
    await submit($, 'tiếp')
    expect(seen.routed.length).toBe(routed)
    expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
  })

  test('vừa gõ /conductor resume: prompt kế tiếp tiếp tục điểm dừng dù router xếp mục tiêu mới, giữ mục tiêu cũ', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await conductor($, 'resume')
    await submit($, 'làm nốt phần còn dở')
    expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('resuming')
    expect(String((await conductor($, 'status')).text)).toContain('Refactor module thanh toán')
    await submit($, 'Giải thích file README')
    expect((seen.contexts[seen.contexts.length - 1] ?? []).join('\n')).not.toContain('ĐIỂM DỪNG')
  })
})

describe('0.6.0 D: vòng đời', () => {
  test('consumed chỉ sau turn.complete không lỗi của turn tiếp tục; turn lỗi thì quay về open', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
    await $.turn.complete(DONE('r1', 'error'))
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    await submit($, 'tiếp tục')
    await $.turn.start({ text: 'tiếp tục', turnId: 'r2' })
    await $.turn.complete(DONE('r2'))
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('consumed')
  })

  // Góp ý PR 21: chỉ reason "answer" là turn tiếp tục đã xong; người dùng ngắt (Esc) hay model từ chối thì việc chưa xong.
  for (const reason of ['aborted', 'refusal']) {
    test(`turn tiếp tục kết thúc với reason ${reason}: điểm dừng quay về open, không consumed`, {}, async ($, on) => {
      const seen = base(on, RESUME)
      startHooks(on)
      const box = memoryStore(on)
      const meter = quotaMeter(on, [session(10)])
      on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
      await submit($, COMPLEX_PROMPT)
      await pauseNow($, meter, seen.clock)
      meter.set([session(1)])
      await seen.clock.advance(10_000)
      await submit($, 'tiếp tục')
      await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
      await $.turn.complete({ turnId: 'r1', answer: '', durationMs: 5, isAborted: reason === 'aborted', reason } as never)
      expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    })
  }

  test('dừng lần hai trong turn tiếp tục: điểm dừng mới thay thế, giữ nguyên checklist', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    const firstId = (box.data.get(storeKey('/repo')) as QuotaCheckpoint).id
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    meter.set([session(98)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    await $.turn.complete(DONE('r1'))
    const second = box.data.get(storeKey('/repo')) as QuotaCheckpoint
    expect(second.id).not.toBe(firstId)
    expect(second.status).toBe('open')
    expect(second.plan.map(s => s.title)).toEqual(['Sửa', 'Kiểm'])
    expect(second.plan[0]?.status).toBe('done')
  })
})

describe('0.6.0 D: phiên mới', () => {
  test('session.start nạp điểm dừng open, khôi phục mục tiêu và checklist khi chưa có mục tiêu, báo toast', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    box.data.set(storeKey('/repo'), storedCheckpoint())
    quotaMeter(on, [session(1)])
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect(seen.toasts.some(t => t.includes('Có điểm dừng chưa tiếp tục'))).toBe(true)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Sửa module thanh toán')
    expect(status).toContain('[~] 2. Sửa charge')
    await submit($, 'tiếp tục')
    const context = seen.contexts[seen.contexts.length - 1] ?? []
    expect(context[0]).toContain('ĐIỂM DỪNG')
    expect(context[0]).toContain('Chạy npm test sau khi sửa charge')
    // Router xếp tiếp nối: làm tiếp mục tiêu đã khôi phục.
    expect(String((await conductor($, 'status')).text)).toContain('Sửa module thanh toán')
  })

  test('bản ghi resuming của phiên trước (phiên chết giữa chừng) quay về open khi khởi động', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    box.data.set(storeKey('/repo'), { ...storedCheckpoint(), status: 'resuming' })
    quotaMeter(on, [session(1)])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
  })

  test('không đè mục tiêu đang có', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(1)])
    await submit($, COMPLEX_PROMPT)
    box.data.set(storeKey('/repo'), storedCheckpoint('Mục tiêu cũ'))
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect(String((await conductor($, 'status')).text)).not.toContain('Mục tiêu cũ')
  })

  test('điểm dừng của thư mục khác không được nạp', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    box.data.set(storeKey('/other'), { ...storedCheckpoint(), cwd: '/other' })
    quotaMeter(on, [session(1)])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect(seen.toasts.some(t => t.includes('Có điểm dừng'))).toBe(false)
  })
})

describe('0.6.0 D: /conductor resume force và discard', () => {
  test('force cho chạy tiếp dù chưa làm mới, không mất điểm dừng; hết hiệu lực đúng mốc', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    meter.set([{ kind: 'five_hour', percentUsed: 97 }])
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức')
    const forced = String((await conductor($, 'resume force')).text)
    expect(forced).toContain('ép chạy tiếp')
    await submit($, 'tiếp tục')
    expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    expect(box.data.has(storeKey('/repo'))).toBe(true)
    await seen.clock.advance(4 * 3_600_000)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức')
  })

  test('resume discard cần gõ hai lần trong 10 giây rồi mới đánh dấu consumed', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    expect(String((await conductor($, 'resume discard')).text)).toContain('gõ lại')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    expect(String((await conductor($, 'resume discard')).text)).toContain('Đã bỏ')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('consumed')
  })

  test('force chỉ miễn cửa sổ đang chạm ngưỡng: ép hạn mức phiên rồi tuần chạm 98% thì vẫn dừng (góp ý PR 21)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10), week(50)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97), week(50)])
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức phiên')
    expect(String((await conductor($, 'resume force')).text)).toContain('ép chạy tiếp')
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    meter.set([session(97), week(99.5)])
    await seen.clock.advance(10_000)
    const out = await $.tool.call(EDIT)
    expect(out.deny).toContain('hạn mức tuần')
    expect(out.deny).not.toContain('hạn mức phiên')
  })

  test('người dùng pause rồi force khi hạn mức đang chạm ngưỡng: dừng của người dùng cũng được mở', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(97)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await conductor($, 'pause')
    expect((await $.tool.call(EDIT)).deny).toContain('người dùng yêu cầu tạm dừng')
    await conductor($, 'resume force')
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('force khi đang dừng vì hạn mức: prompt kế tiếp tiếp tục điểm dừng dù router xếp việc khác', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    await conductor($, 'resume force')
    await submit($, 'làm nốt phần còn dở')
    expect(seen.contexts[seen.contexts.length - 1]?.[0]).toContain('ĐIỂM DỪNG')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('resuming')
  })

  test('cờ resume chỉ dùng một lần: turn tiếp tục bị ngắt, prompt về việc khác sau đó không tiếp tục điểm dừng', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await conductor($, 'resume')
    await submit($, 'làm nốt phần còn dở')
    await $.turn.start({ text: 'làm nốt phần còn dở', turnId: 'r1' })
    await $.turn.complete({ turnId: 'r1', answer: '', durationMs: 5, isAborted: true, reason: 'aborted' } as never)
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    await submit($, 'Giải thích file README')
    const context = (seen.contexts[seen.contexts.length - 1] ?? []).join('\n')
    expect(context).not.toContain('ĐIỂM DỪNG')
    expect(context).toContain('Có điểm dừng chưa tiếp tục')
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
  })

  test('force khi không dừng và không cửa sổ nào chạm ngưỡng: báo không có gì để ép, không đặt mốc (góp ý PR 21)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'resume force')).text)).toContain('Không có gì để ép')
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức phiên')
    expect(String((await conductor($, 'status')).text)).not.toContain('ép tiếp')
  })

  test('resume khi không có điểm dừng thì báo rõ', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'resume')).text)).toContain('Không có điểm dừng')
  })
})
