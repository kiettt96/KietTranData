// 0.6.0 hạng mục F: ca biên của bảo vệ hạn mức, viết sau lượt đột biến đầu (mỗi nhóm ghim một mẫu `060-` từng sống sót).

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { buildCheckpoint, storeKey, withNote } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, FOUR, PANE, base, conductor, submit } from '../support/engine'
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

function stored(box: { data: Map<string, unknown> }) {
  return box.data.get(storeKey('/repo')) as QuotaCheckpoint
}

function storedCheckpoint(over: Partial<QuotaCheckpoint> = {}): QuotaCheckpoint {
  const cp = withNote(
    buildCheckpoint({
      id: 'cp-old',
      now: 500,
      cwd: '/repo',
      reason: [{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }],
      brief: { goalId: 3, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'hard', volume: 'medium', kind: 'edit', tier: 'complex', main: null, why: '', relation: 'new', source: 'router', isFollowUp: false, isReference: false, scopePaths: [], prompt: '', at: 1 },
      plan: [{ id: 1, title: 'Sửa charge', status: 'doing' }],
      delegations: [],
      recent: [],
      files: [],
      denied: null,
    }),
    'Tiếp ở bước sửa charge.',
  )
  return { ...cp, ...over }
}

async function band($: Engine) {
  return $.ui.mount({
    plugin: 'focus-conductor',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
}

/** Dừng vì hạn mức rồi ghi note (như quota-resume.test.ts). */
async function pauseNow($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call(EDIT)
  meter.set([session(97)])
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
}

/** Dừng, hạn mức làm mới, prompt tiếp tục, turn r1 bắt đầu: điểm dừng đang resuming. */
async function resuming($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  await submit($, COMPLEX_PROMPT)
  await pauseNow($, meter, clock)
  meter.set([session(1)])
  await clock.advance(10_000)
  await submit($, 'tiếp tục')
  await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
}

describe('0.6.0 F: dữ liệu của điểm dừng', () => {
  test('năm tool call cuối chỉ gồm tool của luồng chính: không có tool plan, không có tool của subagent (060-F4, 060-F17)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Read', file_path: 'src/b.ts', agentId: 'ag1' } as never)
    await $.tool.call(EDIT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    expect(stored(box).recent).toEqual(['Edit src/a.ts'])
  })

  test('file đã sửa của mục tiêu trước không vào điểm dừng của mục tiêu mới (060-F15)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call(EDIT)
    await conductor($, 'goal Viết tài liệu cài đặt')
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ ...EDIT, file_path: 'docs/x.md' })
    expect(stored(box).files).toEqual([])
  })

  test('lệnh bị từ chối chỉ được ghi vào kho ở lần từ chối đầu (060-F10)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const writes = box.sets
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call(EDIT)
    expect(box.sets).toBe(writes)
    expect(stored(box).denied?.tool).toBe('Edit')
  })

  test('kho đã có năm điểm dừng mới hơn: bản vừa ghi vẫn được giữ (060-H8)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    const box = memoryStore(on)
    for (let i = 0; i < 5; i++) box.data.set(`checkpoint:x${i}`, storedCheckpoint({ id: `x${i}`, cwd: `/khac/${i}`, createdAt: 900_000 + i }))
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    expect(box.data.has(storeKey('/repo'))).toBe(true)
    expect([...box.data.keys()].filter(k => k.startsWith('checkpoint:')).length).toBe(5)
  })
})

describe('0.6.0 F: đọc số đo tại tool.call', () => {
  test('số đo được dùng lại đúng 3 giây: 2999 ms vẫn dùng lại, 3000 ms thì hỏi lại (060-F6)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const before = meter.calls
    await $.tool.call(EDIT)
    expect(meter.calls).toBe(before + 1)
    await seen.clock.advance(2_999)
    await $.tool.call(EDIT)
    expect(meter.calls).toBe(before + 1)
    await seen.clock.advance(1)
    await $.tool.call(EDIT)
    expect(meter.calls).toBe(before + 2)
  })

  test('số đo hỏi lại sau đúng 3 giây được lưu cho band (060-F5)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    const meter = quotaMeter(on, [session(50)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call(EDIT)
    meter.set([session(92)])
    await seen.clock.advance(3_000)
    await $.tool.call(EDIT)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /hạn mức còn 8%/ })).toBeDefined()
    await ui.unmount()
  })

  test('vùng đổi (chưa có session.measure) thì status line cập nhật nhãn ngay ở tool.call (060-F9)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    const meter = quotaMeter(on, [])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    // Từ 0.6.1 prompt.submit cũng cập nhật vùng và nhãn, nên vùng phải đổi sau prompt (chưa có số đo, rồi có) thì mới
    // chạm nhánh của tool.call.
    meter.set([session(92)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    expect(seen.statuses.some(s => (s ?? '').includes('hạn mức còn 8%'))).toBe(true)
  })
})

describe('0.6.0 F: vòng đời điểm dừng', () => {
  test('dừng lần hai rồi hạn mức làm mới trong turn tiếp tục: điểm dừng mới vẫn open khi turn xong (060-E3)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await resuming($, meter, seen.clock)
    const firstId = stored(box).id
    meter.set([session(98)])
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức')
    expect(stored(box).id).not.toBe(firstId)
    meter.set([session(2)])
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    await $.turn.complete(DONE('r1'))
    expect(stored(box).status).toBe('open')
  })

  test('turn khác kết thúc giữa chừng không tiêu thụ điểm dừng; turn tiếp tục xong thì consumed (060-E4)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await resuming($, meter, seen.clock)
    await $.turn.complete(DONE('khac'))
    expect(stored(box).status).toBe('resuming')
    await $.turn.complete(DONE('r1'))
    expect(stored(box).status).toBe('consumed')
  })

  test('subagent kết thúc (cùng turnId) không tiêu thụ điểm dừng (060-E5)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await resuming($, meter, seen.clock)
    await $.turn.complete({ turnId: 'r1', agentId: 'ag1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(stored(box).status).toBe('resuming')
  })

  test('turn tiếp tục là turn đầu tiên sau khi chèn khối: turn.start sau đó không thay nó (060-E6)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await resuming($, meter, seen.clock)
    await $.turn.start({ text: 'khác', turnId: 'r2' })
    await $.turn.complete(DONE('r1'))
    expect(stored(box).status).toBe('consumed')
  })
})

describe('0.6.0 F: nạp điểm dừng lúc session.start', () => {
  const cases: Array<[string, Partial<QuotaCheckpoint>]> = [
    ['thư mục khác dưới cùng khóa (060-J1)', { cwd: '/khac' }],
    ['phiên bản khác (060-J2)', { version: 2 as never }],
    ['đã consumed (060-J3)', { status: 'consumed' }],
  ]
  for (const [name, over] of cases) {
    test(`không nạp bản ghi ${name}`, {}, async ($, on) => {
      const seen = base(on, RESUME)
      startHooks(on)
      const box = memoryStore(on)
      box.data.set(storeKey('/repo'), storedCheckpoint(over))
      quotaMeter(on, [session(1)])
      await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
      expect(seen.toasts.some(t => t.includes('Có điểm dừng'))).toBe(false)
      expect(String((await conductor($, 'status')).text)).not.toContain('Sửa module thanh toán')
    })
  }

  test('mode off: không nạp điểm dừng (060-J7)', { options: { routing: 'off' } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    box.data.set(storeKey('/repo'), storedCheckpoint())
    quotaMeter(on, [session(1)])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect(seen.toasts.some(t => t.includes('Có điểm dừng'))).toBe(false)
  })
})

describe('0.6.0 F: prompt và thông báo cuối turn khi đang dừng', () => {
  test('prompt lúc đang dừng nêu lý do đã lưu lúc dừng, không lấy số đo mới (060-K4)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(96)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    meter.set([session(97), week(99)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp')
    const context = (seen.contexts[seen.contexts.length - 1] ?? []).join('\n')
    expect(context).toContain('chỉ còn 4%')
    expect(context).not.toContain('hạn mức tuần')
  })

  test('turn có thay đổi chưa kiểm rồi dừng: cuối turn không nhắc kiểm tra (060-L8)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call(EDIT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const before = seen.toasts.length
    await $.turn.complete(DONE('t1'))
    expect(seen.toasts.slice(before).filter(t => t.includes('kiểm tra'))).toEqual([])
  })

  test('đối chứng: không dừng thì cuối turn có cảnh báo việc chưa giao subagent', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call(EDIT)
    await $.turn.complete(DONE('t1'))
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /ghi giao subagent nhưng chưa được giao/ })).toBeDefined()
    await pane.unmount()
  })

  test('đang dừng: cuối turn không cảnh báo việc chưa giao subagent (060-L9)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call(EDIT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    await $.turn.complete(DONE('t1'))
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /ghi giao subagent nhưng chưa được giao/ })).toBeUndefined()
    await pane.unmount()
  })
})

describe('0.6.0 F: lệnh pause và resume', () => {
  test('quotaGuard tắt: /conductor pause báo đang tắt, tool vẫn chạy (060-M1)', { options: { quotaGuard: false } }, async ($, on) => {
    base(on, RESUME)
    quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'pause')).text)).toContain('đang tắt')
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('pause lần hai chỉ báo đang tạm dừng, không ghi điểm dừng mới (060-M2)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await conductor($, 'pause')
    const firstId = stored(box).id
    await seen.clock.advance(1_000)
    expect(String((await conductor($, 'pause')).text)).toContain('Đang tạm dừng theo yêu cầu')
    expect(stored(box).id).toBe(firstId)
  })

  test('pause rồi resume force: tool chạy lại được ngay (060-M6)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await conductor($, 'pause')
    expect((await $.tool.call(EDIT)).deny).toBeDefined()
    await conductor($, 'resume force')
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('điểm dừng đã consumed: resume, discard và force đều coi như không có điểm dừng (060-M5)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await resuming($, meter, seen.clock)
    await $.turn.complete(DONE('r1'))
    expect(stored(box).status).toBe('consumed')
    expect(String((await conductor($, 'resume')).text)).toContain('Không có điểm dừng')
    expect(String((await conductor($, 'resume discard')).text)).toContain('Không có điểm dừng')
    expect(String((await conductor($, 'resume force')).text)).not.toContain('Điểm dừng giữ nguyên')
  })

  test('discard: đúng 10 giây sau lần đầu là hết hạn, lần sau chỉ chờ xác nhận lại (060-M7)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseNow($, meter, seen.clock)
    expect(String((await conductor($, 'resume discard')).text)).toContain('gõ lại')
    await seen.clock.advance(10_000)
    expect(String((await conductor($, 'resume discard')).text)).toContain('gõ lại')
    expect(stored(box).status).toBe('open')
  })
})

describe('0.6.0 F: band', () => {
  test('nhãn đậm khi đang dừng, thường khi chỉ gần ngưỡng (060-O1)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    const meter = quotaMeter(on, [session(92)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call(EDIT)
    let ui = await band($)
    expect((await ui.find({ type: 'Text', text: /hạn mức còn 8%/ }))?.props.bold).toBeFalsy()
    await ui.unmount()
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    ui = await band($)
    expect((await ui.find({ type: 'Text', text: /tạm dừng: hạn mức/ }))?.props.bold).toBe(true)
    await ui.unmount()
  })

  test('mục tiêu khôi phục từ điểm dừng (chưa có route, chưa có chi phí) và đang tạm dừng: band vẫn hiện nhãn (060-O3)', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    box.data.set(storeKey('/repo'), storedCheckpoint())
    quotaMeter(on, [session(1)])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    await conductor($, 'pause')
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /tạm dừng: hạn mức/ })).toBeDefined()
    await ui.unmount()
  })

  test('đã dừng vì hạn mức, số đo mới dưới ngưỡng nhưng chưa có tool call hay prompt: band vẫn báo đang dừng (060-O4)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(10)], changed: ['rateLimits'] } as never)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /tạm dừng: hạn mức/ })).toBeDefined()
    await ui.unmount()
  })
})
