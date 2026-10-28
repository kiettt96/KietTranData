// 0.7.5 A6: dừng cứng vì hạn mức vẫn cho luồng chính ghi vào các đường dẫn của option pauseAllowPaths (file checkpoint theo
// quy tắc dừng của prompt); turn đã nhận câu báo hạn mức mềm thì Stop không chặn vì checklist còn mở; lời chặn Stop đưa
// hướng dẫn waiting lên trước.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'
import { stopBlockReason } from '../../hooks/lib/text'

const PLAN = 'mcp__focus-conductor__plan'
type Out = { deny?: string; context?: string[] }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Out>
const engineTools = (on: Parameters<typeof base>[0]) => {
  for (const tool of ['Write', 'Edit', 'Bash', 'Read']) on('tool.call', { tool }, () => ({ result: 'ok' }))
}

describe('0.7.5 A6: pauseAllowPaths khi dừng cứng', () => {
  test('Write, Edit và Bash có đích nằm hết trong pauseAllowPaths được qua', { options: { pauseAllowPaths: '.checkpoint/, /tmp/ck' } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Write', file_path: '/repo/.checkpoint/state.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Edit', file_path: '.checkpoint/state.md', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/tmp/ck/run.json', content: '{}' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Bash', command: 'cat > .checkpoint/note.md <<EOF\nbước 7\nEOF' })).deny).toBeUndefined()
  })

  test('đích ngoài, đích không xác định hay không có đích: vẫn bị từ chối', { options: { pauseAllowPaths: '.checkpoint/' } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })).deny).toContain('Tạm dừng')
    expect((await call($, { tool: 'Bash', command: '/usr/bin/python3 -B scripts/ghi.py > .checkpoint/a.md' })).deny).toContain('Tạm dừng')
    expect((await call($, { tool: 'Bash', command: 'ls /repo' })).deny).toContain('Tạm dừng')
    expect((await call($, { tool: 'Write', file_path: '/repo/.checkpointx/a.md', content: 'x' })).deny).toContain('Tạm dừng')
  })

  test('câu từ chối nêu các đường dẫn được ghi', { options: { pauseAllowPaths: '.checkpoint/' } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })).deny).toContain('pauseAllowPaths: .checkpoint/')
  })

  test('không đặt option: như cũ, mọi lệnh ghi bị từ chối', {}, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    const out = await call($, { tool: 'Write', file_path: '/repo/.checkpoint/state.md', content: 'x' })
    expect(out.deny).toContain('Tạm dừng')
    expect(out.deny).not.toContain('pauseAllowPaths')
  })

  test('subagent: vẫn bị từ chối dù đích nằm trong pauseAllowPaths', { options: { pauseAllowPaths: '.checkpoint/' } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Write', file_path: '/repo/.checkpoint/a.md', content: 'x', agentId: 'agent-1' })).deny).toContain('Tạm dừng')
  })
})

describe('0.7.5 A6: Stop sau câu báo hạn mức mềm', () => {
  test('turn đã nhận câu báo mềm: Stop không chặn dù checklist còn mở', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    on('classic.Stop', () => ({}))
    const meter = quotaMeter(on, [week(50)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    await call($, { tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    meter.set([week(81)])
    await clock.advance(10_000)
    const edited = await call($, { tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edited.context ?? []).some(c => c.includes('Hạn mức tuần còn 19%'))).toBe(true)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('turn sau (chưa nhận câu báo trong turn đó): Stop chặn như cũ', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    on('classic.Stop', () => ({}))
    const meter = quotaMeter(on, [week(50)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    await call($, { tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    meter.set([week(81)])
    await clock.advance(10_000)
    const edited = await call($, { tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edited.context ?? []).some(c => c.includes('Hạn mức tuần còn 19%'))).toBe(true)
    await $.turn.start({ text: 'tiếp', turnId: 't2' })
    await clock.advance(10_000)
    await call($, { tool: 'Edit', file_path: '/repo/src/b.ts', old_string: 'a', new_string: 'b' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 1 bước mở')
  })

  test('không có câu báo mềm: Stop chặn như cũ', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    quotaMeter(on, [week(81)])
    engineTools(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    await call($, { tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await call($, { tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 1 bước mở')
  })
})

describe('0.7.5 A6: lời chặn Stop', () => {
  test('hướng dẫn waiting (kể cả dừng theo hạn mức) đứng trước câu hoàn thành các bước', () => {
    const text = stopBlockReason([{ id: 1, title: 'Phân tích', status: 'todo' }])
    const waiting = text.indexOf('thì ghi waiting')
    const finish = text.indexOf('hoàn thành các bước đó')
    expect(waiting).toBeGreaterThan(0)
    expect(finish).toBeGreaterThan(waiting)
    expect(text).toContain('quy tắc dừng theo hạn mức của prompt')
  })
})
