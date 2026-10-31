// 0.7.5 B5: câu báo hạn mức mềm: báo lại ở prompt mới do người gõ (tối đa một lần mỗi turn), kết quả tool lỗi không đánh dấu
// đã báo, và số đo đọc lại sau khi tool chạy xong nên lời gọi Agent dài nhận câu báo khi trả về.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

const NOTICE = 'Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay'
const noticed = (out: { context?: readonly string[] }) => (out.context ?? []).filter(c => c.includes(NOTICE)).length
const edit = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never) as Promise<{ context?: string[] }>

describe('0.7.5 B5: báo lại theo prompt, tối đa một lần mỗi turn', () => {
  test('prompt mới do người gõ trong cùng cửa sổ: báo lại một lần', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [week(81)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    expect(noticed(await edit($))).toBe(1)
    await clock.advance(10_000)
    expect(noticed(await edit($))).toBe(0)
    await submit($, 'làm tiếp phần còn lại')
    await $.turn.start({ text: 'làm tiếp phần còn lại', turnId: 't2' })
    await clock.advance(10_000)
    expect(noticed(await edit($))).toBe(1)
    await clock.advance(10_000)
    expect(noticed(await edit($))).toBe(0)
  })
})

describe('0.7.5 B5: kết quả lỗi không đánh dấu đã báo', () => {
  test('tool lỗi: không tính là đã báo; lời gọi kế tiếp không lỗi nhận câu báo', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [week(81)])
    let fail = true
    on('tool.call', { tool: 'Edit' }, () => (fail ? { result: 'lỗi', isError: true } : { result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    expect(noticed(await edit($))).toBe(0)
    fail = false
    await clock.advance(10_000)
    expect(noticed(await edit($))).toBe(1)
  })
})

describe('0.7.5 B5: lời gọi Agent dài', () => {
  test('hạn mức vào vùng báo trong lúc Agent chạy: kết quả Agent nhận câu báo', { options: { noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [week(50)])
    on('tool.call', { tool: 'Agent' }, async () => {
      meter.set([week(81)])
      await clock.advance(120_000)
      return { result: 'xong' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: COMPLEX_PROMPT, turnId: 't1' })
    const out = (await $.tool.call({ tool: 'Agent', description: 'Lọc tin lô 1', prompt: 'Lọc tin lô 1' } as never)) as { context?: string[] }
    expect(noticed(out)).toBe(1)
  })
})
