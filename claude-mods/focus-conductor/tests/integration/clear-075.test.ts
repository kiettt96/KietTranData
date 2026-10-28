// 0.7.5 C4: /clear (session.end lý do clear; engine không phát session.start với /clear) khi có điểm dừng đang mở: prompt đầu
// sau đó không nhận khối ĐIỂM DỪNG, chỉ nhận dòng gợi ý /conductor resume; /conductor resume vẫn tiếp tục được. Cờ đã báo hạn
// mức mềm đặt lại khi /clear.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
}

async function pauseThenRefresh($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  meter.set([session(97)])
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
  meter.set([session(10)])
  await clock.advance(10_000)
}

describe('0.7.5 C4: /clear khi có điểm dừng đang mở', () => {
  test('prompt đầu sau /clear: không có khối ĐIỂM DỪNG, có dòng gợi ý /conductor resume', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseThenRefresh($, meter, seen.clock)
    await $.session.end({ reason: 'clear' } as never)
    await submit($, 'tiếp tục')
    const context = (seen.contexts.at(-1) ?? []).join('\n')
    expect(context).not.toContain('ĐIỂM DỪNG')
    expect(context).toContain('/conductor resume')
    expect(context).toContain('/clear')
  })

  test('sau /clear, /conductor resume rồi prompt: tiếp tục từ điểm dừng', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseThenRefresh($, meter, seen.clock)
    await $.session.end({ reason: 'clear' } as never)
    await conductor($, 'resume')
    await submit($, 'làm tiếp')
    expect((seen.contexts.at(-1) ?? [])[0]).toContain('ĐIỂM DỪNG')
  })
})

describe('0.7.5 C4: /clear đặt lại cờ đã báo hạn mức mềm', () => {
  test('đã báo trước /clear: lời gọi tool sau /clear báo lại', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [week(81)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const notice = (out: { context?: string[] }) => (out.context ?? []).some(c => c.includes('quy tắc dừng theo hạn mức'))
    expect(notice((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)) as { context?: string[] })).toBe(true)
    await $.session.end({ reason: 'clear' } as never)
    await clock.advance(10_000)
    expect(notice((await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' } as never)) as { context?: string[] })).toBe(true)
  })
})
