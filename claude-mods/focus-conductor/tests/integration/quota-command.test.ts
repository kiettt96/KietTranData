// 0.6.0 hạng mục E: /conductor pause, mục Hạn mức của /conductor status, nhãn band và status line khi dừng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'
import { memoryStore, quotaMeter, session, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const EDIT = { tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as const

async function band($: Engine) {
  return $.ui.mount({
    plugin: 'focus-conductor',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
}

describe('0.6.0 E: /conductor pause', () => {
  test('pause: từ chối tool như khi hạn mức sắp hết, ghi điểm dừng; Stop cho kết thúc; resume mở lại', {}, async ($, on) => {
    const seen = base(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call(EDIT)
    expect(String((await conductor($, 'pause')).text)).toContain('Đã tạm dừng')
    const cp = box.data.get(storeKey('/repo')) as QuotaCheckpoint
    expect(cp.status).toBe('open')
    expect(cp.recent.some(r => r.startsWith('Edit src/a.ts'))).toBe(true)
    const denied = await $.tool.call(EDIT)
    expect(denied.deny).toContain('người dùng yêu cầu tạm dừng')
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    expect((await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'tiếp ở bước Kiểm' })).deny).toBeUndefined()
    await submit($, 'tiếp đi')
    expect((seen.contexts[seen.contexts.length - 1] ?? []).join('\n')).toContain('người dùng yêu cầu tạm dừng')
    expect(String((await conductor($, 'resume')).text)).toContain('tiếp tục')
    await seen.clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })
})

describe('0.6.0 E: mục Hạn mức trong /conductor status', () => {
  test('phiên và tuần: đã dùng, còn lại, ngưỡng, trạng thái; điểm dừng đang mở', {}, async ($, on) => {
    const { clock } = base(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(40), week(97.5)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    let text = String((await conductor($, 'status')).text)
    expect(text).toContain('Hạn mức')
    expect(text).toContain('phiên (5 giờ): đã dùng 40%, còn 60%')
    expect(text).toContain('ngưỡng còn 5%')
    expect(text).toContain('tuần: đã dùng 97,5%, còn 2,5%')
    expect(text).toContain('trạng thái: ok')
    meter.set([session(99), week(50)])
    await clock.advance(10_000)
    await $.tool.call(EDIT)
    text = String((await conductor($, 'status')).text)
    expect(text).toContain('trạng thái: tạm dừng (hạn mức)')
    expect(text).toContain('điểm dừng: đang mở')
  })

  test('không có dữ liệu (không subscription): nói rõ lý do', {}, async ($, on) => {
    base(on)
    memoryStore(on)
    quotaMeter(on, [])
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'status')).text)).toContain('không có dữ liệu')
  })

  test('quotaGuard tắt: status ghi bảo vệ hạn mức đang tắt', { options: { quotaGuard: false } }, async ($, on) => {
    base(on)
    quotaMeter(on, [session(99)])
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'status')).text)).toContain('Hạn mức: bảo vệ đang tắt')
  })
})

describe('0.6.0 E: band và status line', () => {
  test('đang dừng: band hiện "tạm dừng: hạn mức", status line có nhãn', {}, async ($, on) => {
    const seen = base(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /tạm dừng: hạn mức/ })).toBeDefined()
    await ui.unmount()
    expect(seen.statuses.at(-1)).toContain('tạm dừng: hạn mức')
  })

  test('tiếng Anh: "paused: quota"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /paused: quota/ })).toBeDefined()
    await ui.unmount()
  })

  test('gần ngưỡng (còn không quá gấp đôi biên): band hiện phần còn lại', {}, async ($, on) => {
    const seen = base(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(92)])
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /hạn mức còn 8%/ })).toBeDefined()
    await ui.unmount()
  })

  test('quotaGuard tắt: band không có nhãn hạn mức', { options: { quotaGuard: false } }, async ($, on) => {
    const seen = base(on)
    quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await seen.clock.advance(10_000)
    await $.tool.call(EDIT)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /hạn mức/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('0.6.0: quotaGuard tắt thì hook mới không đổi gì', () => {
  test('không hỏi số đo khi gọi tool, không ghi kho, không thêm context, status line như cũ', { options: { quotaGuard: false } }, async ($, on) => {
    const seen = base(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(99), week(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    const callsBefore = meter.calls
    for (let i = 0; i < 3; i++) expect((await $.tool.call({ ...EDIT, file_path: `src/${i}.ts` })).deny).toBeUndefined()
    expect(meter.calls).toBe(callsBefore)
    expect(box.data.size).toBe(0)
    expect((seen.contexts[0] ?? []).join('\n')).not.toContain('hạn mức')
    expect(seen.statuses.filter(s => (s ?? '').includes('hạn mức'))).toEqual([])
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn')
    expect((await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'x' })).deny).toContain('chỉ dùng khi')
  })
})
