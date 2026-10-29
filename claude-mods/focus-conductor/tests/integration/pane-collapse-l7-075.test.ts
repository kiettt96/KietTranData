// 0.7.5 L7 (vòng sửa 2): pane tự mở ở 16 dòng với checklist dài (11 bước): các bước đã đóng dồn thành một dòng tóm tắt để dòng
// tiến độ từng việc vẫn hiện trong 16 dòng đầu; checklist ngắn (từ 6 bước trở xuống) giữ nguyên từng bước.

import { describe, expect, test } from 'claude-code/testing'
import { checklistOf, drawn, longGoal, rowOf } from '../support/pane-long'
import { PANE_ROWS } from '../../hooks/lib/pane'
import { labels } from '../../hooks/ui/labels'

describe('0.7.5 L7: checklist dài ở pane 16 dòng', () => {
  test('11 bước, 8 bước đầu đã đóng: các bước đã đóng dồn một dòng tóm tắt, dòng đầu của tiến độ từng việc nằm trong 16 dòng đầu', {}, async ($, on) => {
    await longGoal($, on, 8)
    const { tree, texts } = await drawn($)
    expect(PANE_ROWS).toBe(16)
    const list = checklistOf(texts)
    expect(list).toContain('8 bước đã đóng')
    expect(list).not.toContain('BƯỚC 0: chuẩn bị')
    expect(list).not.toContain('BƯỚC 7: tóm tắt tin')
    expect(list).toContain('BƯỚC 8: bảng giá tuần')
    expect(list).toContain('BƯỚC 10: kết thúc phiên')
    const section = rowOf(tree, /^Tiến độ từng việc/)
    expect(section).toBeGreaterThanOrEqual(0)
    expect(section + 1).toBeLessThan(PANE_ROWS)
  })

  test('đúng hai bước đóng (đủ tiết kiệm một dòng): dồn thành "2 bước đã đóng"', {}, async ($, on) => {
    await longGoal($, on, 2)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('2 bước đã đóng')
    expect(list).not.toContain('BƯỚC 1: chuẩn hóa đơn vị')
    expect(list).toContain('BƯỚC 2: chuyển dữ liệu cũ')
  })

  test('chỉ một bước đóng (tóm tắt không tiết kiệm được dòng nào): giữ nguyên từng bước', {}, async ($, on) => {
    await longGoal($, on, 1)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(list).toContain('BƯỚC 0: chuẩn bị')
  })

  test('chưa có bước nào đóng: giữ nguyên từng bước, không có dòng tóm tắt', {}, async ($, on) => {
    await longGoal($, on, 0)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(list).toContain('BƯỚC 0: chuẩn bị')
  })

  test('checklist 6 bước (ngắn): giữ nguyên từng bước dù đã đóng', {}, async ($, on) => {
    await longGoal($, on, 4, 6)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(list).toContain('BƯỚC 0: chuẩn bị')
  })

  test('dồn bước đã đóng không đổi số liệu tiến độ: dòng đếm 8/11 của checklist vẫn hiện', {}, async ($, on) => {
    await longGoal($, on, 8)
    const { texts } = await drawn($)
    expect(texts.some(t => /^8\/11/.test(t))).toBe(true)
  })
})

describe('0.7.5 L7: nhãn dòng tóm tắt', () => {
  test('tiếng Việt và tiếng Anh (số ít, số nhiều)', () => {
    expect(labels('vi').stepsClosed(8)).toBe('8 bước đã đóng')
    expect(labels('en').stepsClosed(1)).toBe('1 step closed')
    expect(labels('en').stepsClosed(8)).toBe('8 steps closed')
  })
})
