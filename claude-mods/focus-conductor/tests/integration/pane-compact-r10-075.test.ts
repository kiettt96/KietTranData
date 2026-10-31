// 0.7.5 R10 (vòng rà soát 3): pane tự mở ở 16 dòng với checklist 11 bước: ở 0, 1 và 6 bước đóng dòng tiêu đề tiến độ từng việc vẫn
// nằm trong 16 dòng. Khi không đủ chỗ, checklist chỉ hiện bước đang làm, 3 bước mở kế tiếp và dòng "+N bước", ẩn chú giải ký hiệu.
// Tiêu đề "Checklist" đi qua nhãn theo ngôn ngữ.

import { describe, expect, test } from 'claude-code/testing'
import { PANE_ROWS } from '../../hooks/lib/pane'
import { labels } from '../../hooks/ui/labels'
import { PLAN, checklistOf, drawn, longGoal, rowOf, stepRow } from '../support/pane-long'

const HEADING = /^Danh sách bước/
const LEGEND = /đã kiểm chứng|chờ kết quả|bỏ qua/

describe('0.7.5 R10: dòng tiến độ từng việc nằm trong 16 dòng ở checklist 11 bước', () => {
  for (const closed of [0, 1, 2, 6, 8]) {
    // 0.7.6 U1: checklist và tiến độ từng việc là một danh sách; bước đang làm (mang số lô của việc) phải nằm trong 16 dòng.
    test(`${closed} bước đóng: bước đang làm nằm trong ${PANE_ROWS} dòng`, {}, async ($, on) => {
      await longGoal($, on, closed)
      const { tree } = await drawn($)
      const section = stepRow(tree, closed)
      expect(section, `${closed} bước đóng`).toBeGreaterThanOrEqual(0)
      expect(section).toBeLessThan(PANE_ROWS)
    })
  }
})

describe('0.7.5 R10: dạng gọn khi không đủ chỗ', () => {
  test('0 bước đóng: bước đang làm và 3 bước mở kế tiếp, dòng "+N bước", không có chú giải ký hiệu', {}, async ($, on) => {
    await longGoal($, on, 0)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 0: chuẩn bị')
    expect(list).toContain('BƯỚC 1: chuẩn hóa đơn vị')
    expect(list).toContain('BƯỚC 3: lọc tin lô 1')
    expect(list).not.toContain('BƯỚC 4: lọc tin lô 2')
    expect(list).toContain('+7 bước mở')
    expect(list.some(t => LEGEND.test(t))).toBe(false)
  })

  // S6 (vòng rà soát 4): "+N bước" tách thành "k bước đã đóng" và "+m bước mở".
  test('6 bước đóng: chỉ bước đang làm và 3 bước kế tiếp, kèm "6 bước đã đóng" và "+1 bước mở"', {}, async ($, on) => {
    await longGoal($, on, 6)
    // 0.7.6 U1: pane 16 dòng đủ cho dạng đầy đủ ở 6 bước đóng; U6 bỏ hai dòng ở phần đầu nên dạng gọn đo ở 10 dòng.
    const { texts } = await drawn($, 10)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 6: đọc và giải thích')
    expect(list).toContain('BƯỚC 9: bản tổng hợp tuần')
    expect(list).not.toContain('BƯỚC 10: kết thúc phiên')
    expect(list).not.toContain('BƯỚC 5: lọc tin lô 3')
    expect(list).toContain('6 bước đã đóng')
    expect(list).toContain('+1 bước mở')
    expect(list.some(t => LEGEND.test(t))).toBe(false)
  })

  test('bước đang làm không phải bước mở đầu tiên: cửa sổ bắt đầu từ bước đang làm, "+N" gồm cả các bước mở đứng trước', {}, async ($, on) => {
    await longGoal($, on, 0)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'todo' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 5, status: 'doing' })
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 4: lọc tin lô 2')
    expect(list).toContain('BƯỚC 7: tóm tắt tin')
    expect(list).not.toContain('BƯỚC 0: chuẩn bị')
    expect(list).not.toContain('BƯỚC 8: bảng giá tuần')
    expect(list).toContain('+7 bước mở')
  })

  test('bước đang làm gần cuối: chỉ hiện các bước còn lại của cửa sổ, "+N" đếm đủ phần ẩn', {}, async ($, on) => {
    await longGoal($, on, 0)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'todo' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 10, status: 'doing' })
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 9: bản tổng hợp tuần')
    expect(list).toContain('BƯỚC 10: kết thúc phiên')
    expect(list).toContain('+9 bước mở')
  })

  test('đủ chỗ (3 bước còn mở trở xuống): giữ từng bước và chú giải ký hiệu như cũ', {}, async ($, on) => {
    await longGoal($, on, 8)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 10: kết thúc phiên')
    expect(list.some(t => /^\+\d+ bước/.test(t))).toBe(false)
    // 0.7.6 U7: chú giải chỉ ghi các loại ký hiệu đang thấy (đang làm, chờ).
    expect(list).toContain(' đang làm')
  })

  test('checklist ngắn (6 bước): giữ từng bước và chú giải ký hiệu', {}, async ($, on) => {
    await longGoal($, on, 1, 6)
    const { texts } = await drawn($)
    const list = checklistOf(texts)
    expect(list).toContain('BƯỚC 0: chuẩn bị')
    expect(list.some(t => /^\+\d+ bước/.test(t))).toBe(false)
    // 0.7.6 U7: chú giải chỉ ghi các loại ký hiệu đang thấy (xong, đang làm, chờ).
    expect(list).toContain(' đang làm')
  })

  test('dạng gọn không đổi số liệu tiến độ: dòng đếm vẫn hiện', {}, async ($, on) => {
    await longGoal($, on, 6)
    const { texts } = await drawn($)
    expect(texts.some(t => /^6\/11/.test(t))).toBe(true)
  })
})

describe('0.7.5 R10: nhãn theo ngôn ngữ', () => {
  test('tiêu đề checklist và dòng "+m bước mở" (S6) có nhãn tiếng Việt và tiếng Anh', () => {
    expect(labels('vi').checklist).toBe('Danh sách bước')
    expect(labels('en').checklist).toBe('Checklist')
    expect(labels('vi').stepsOpenMore(7)).toBe('+7 bước mở')
    expect(labels('en').stepsOpenMore(1)).toBe('+1 open step')
    expect(labels('en').stepsOpenMore(7)).toBe('+7 open steps')
  })

  test('tiêu đề checklist hiện bằng nhãn tiếng Việt trong pane', {}, async ($, on) => {
    await longGoal($, on, 2)
    const { texts } = await drawn($)
    expect(texts.some(t => HEADING.test(t))).toBe(true)
    expect(texts.some(t => /^Checklist/.test(t))).toBe(false)
  })
})
