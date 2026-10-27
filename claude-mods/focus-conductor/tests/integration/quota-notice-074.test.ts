// 0.7.4 điểm 3 (tích hợp): báo hạn mức mềm gắn một lần vào kết quả tool của luồng chính, không chặn tool, báo lại ở
// cửa sổ mới, không báo cho subagent, ở vùng dừng cứng, khi số đo cũ hay thiếu, khi quotaGuard tắt hay ngưỡng không hợp lệ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

const EDIT = { tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as const
const NOTICE = 'Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay'
const noticed = (out: { context?: readonly string[] }) => (out.context ?? []).filter(c => c.includes(NOTICE))
const edit = ($: Engine, over: Record<string, unknown> = {}) => $.tool.call({ ...EDIT, ...over } as never) as Promise<{ deny?: string; context?: string[] }>

describe('0.7.4 3: báo hạn mức mềm', () => {
  test('báo đúng một lần khi vào vùng báo, tool không bị từ chối', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [week(70)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($))).toEqual([])
    meter.set([week(81)])
    await clock.advance(10_000)
    const first = await edit($)
    expect(first.deny).toBeUndefined()
    expect(noticed(first).length).toBe(1)
    expect(noticed(first)[0]).toContain('[focus-conductor] Hạn mức tuần còn 19% (làm mới lúc')
    await clock.advance(10_000)
    const second = await edit($)
    expect(second.deny).toBeUndefined()
    expect(noticed(second)).toEqual([])
  })

  test('cửa sổ mới (resetsAt khác) báo lại', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [week(81)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($)).length).toBe(1)
    meter.set([week(85, '2100-01-08T00:00:00.000Z')])
    await clock.advance(10_000)
    expect(noticed(await edit($)).length).toBe(1)
  })

  test('subagent không nhận; luồng chính vẫn nhận lần báo đó', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(81)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($, { agentId: 'agent-1' }))).toEqual([])
    expect(noticed(await edit($)).length).toBe(1)
  })

  test('vùng dừng cứng: chỉ thông báo dừng như cũ, không có câu báo mềm', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const out = await edit($)
    expect(out.deny).toContain('hạn mức tuần')
    expect(out.deny).not.toContain(NOTICE)
    expect(noticed(out)).toEqual([])
  })

  test('số đo cũ hay thiếu: không báo', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [week(90, '1970-01-01T00:00:00.000Z')])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($))).toEqual([])
    meter.set([])
    await clock.advance(10_000)
    expect(noticed(await edit($))).toEqual([])
  })

  test('quotaGuard tắt: không báo', { options: { noticeWeekRemainingPct: 20, quotaGuard: false } }, async ($, on) => {
    base(on)
    quotaMeter(on, [week(90)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($))).toEqual([])
  })

  test('mặc định (không đặt option): không báo', {}, async ($, on) => {
    base(on)
    quotaMeter(on, [week(90)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($))).toEqual([])
  })

  test('ngưỡng mềm không lớn hơn ngưỡng dừng: bỏ qua, cảnh báo đúng một lần', { options: { noticeWeekRemainingPct: 2 } }, async ($, on) => {
    const seen = base(on)
    quotaMeter(on, [week(97.5)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect(noticed(await edit($))).toEqual([])
    expect(noticed(await edit($))).toEqual([])
    expect(seen.toasts.filter(t => t.includes('noticeWeekRemainingPct')).length).toBe(1)
  })

  test('status line có nhãn báo hạn mức khi ở vùng báo', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const seen = base(on)
    quotaMeter(on, [week(81)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await edit($)
    expect(seen.statuses.some(s => (s ?? '').includes('báo hạn mức: tuần còn 19%'))).toBe(true)
  })
})
