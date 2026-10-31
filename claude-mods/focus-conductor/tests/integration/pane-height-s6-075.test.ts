// 0.7.5 S6 (vòng rà soát 4): dạng gọn của checklist chỉ dùng khi dạng đầy đủ đẩy tiêu đề tiến độ từng việc ra ngoài số dòng thân của pane
// (props.scroll.bodyRows); pane 30 và 40 dòng hiện checklist đầy đủ. Dòng "+N bước" tách thành "k bước đã đóng" và "+m bước mở". Danh sách
// bước dự kiến của router trước khi có checklist cũng theo cùng luật.

import { describe, expect, test } from 'claude-code/testing'
import { labels } from '../../hooks/ui/labels'
import { TITLES, checklistOf, drawn, longGoal, rowOf, stepRow } from '../support/pane-long'
import { base, plan, task, submit } from '../support/engine'

/** Nhãn "+m bước mở" (S6); đọc qua kiểu rộng để tệp nạp được trước khi nhãn có. */
const openMore = (lang: 'vi' | 'en', n: number) => (labels(lang) as unknown as { stepsOpenMore?: (k: number) => string }).stepsOpenMore?.(n) ?? `(chưa có nhãn ${n})`
const OPEN_MORE = { vi: /^\+\d+ bước mở$/, en: /^\+\d+ open steps?$/ }

for (const lang of ['vi', 'en'] as const) {
  const opts = { options: { uiLanguage: lang } }
  describe(`0.7.5 S6 (${lang}): dạng gọn theo số dòng của pane`, () => {
    for (const rows of [16, 30, 40]) {
      for (const closed of [0, 6, 10]) {
        // 0.7.6 U1: một danh sách; bước đang làm (mang số lô của việc) nằm trong số dòng của pane.
        test(`${rows} dòng, 11 bước, ${closed} bước đóng: bước đang làm nằm trong ${rows} dòng`, opts, async ($, on) => {
          await longGoal($, on, closed)
          const { tree, texts } = await drawn($, rows)
          const section = stepRow(tree, closed)
          expect(section).toBeGreaterThanOrEqual(0)
          expect(section).toBeLessThan(rows)
          const list = checklistOf(texts, lang)
          const isCompact = list.some(t => OPEN_MORE[lang].test(t))
          if (rows >= 30) {
            expect(isCompact).toBe(false)
            for (const title of TITLES.slice(closed)) expect(list, title).toContain(title)
          }
        })
      }
    }

    // 0.7.6 U1: không còn chừa chỗ cho mục tiến độ riêng nên pane 16 dòng đủ cho dạng đầy đủ ở 6 bước đóng; dạng gọn đo ở 12 dòng.
    // 0.7.6 U6: phần đầu pane ngắn hơn hai dòng nên ranh giới dạng gọn đo ở 10 dòng thay 12.
    test('10 dòng, 6 bước đóng: dạng gọn có dòng "6 bước đã đóng" và "+1 bước mở" riêng, không còn "+7 bước"', opts, async ($, on) => {
      await longGoal($, on, 6)
      const { texts } = await drawn($, 10)
      const list = checklistOf(texts, lang)
      const l = labels(lang)
      expect(list).toContain(l.stepsClosed(6))
      expect(list).toContain(openMore(lang, 1))
      expect(list.some(t => /^\+\d+ (bước|steps?)$/.test(t))).toBe(false)
    })

    test('16 dòng, 0 bước đóng: dạng gọn không có dòng bước đã đóng, có "+7 bước mở"', opts, async ($, on) => {
      await longGoal($, on, 0)
      const { texts } = await drawn($, 16)
      const list = checklistOf(texts, lang)
      expect(list).toContain(openMore(lang, 7))
      expect(list.some(t => t === labels(lang).stepsClosed(0))).toBe(false)
    })

    test('40 dòng, 0 bước đóng: chú giải ký hiệu có, không có dòng "+m bước mở"', opts, async ($, on) => {
      await longGoal($, on, 0)
      const { texts } = await drawn($, 40)
      const list = checklistOf(texts, lang)
      // 0.7.6 U7: chú giải chỉ ghi các loại ký hiệu đang thấy; bước đang làm luôn có.
      expect(list.some(t => t.includes(labels(lang).legend.doing))).toBe(true)
    })
  })
}

describe('0.7.5 S6: bước dự kiến của router trước khi có checklist', () => {
  const router = () => plan({ goal: 'Cập nhật sổ giá theo các bước', depth: 'hard', volume: 'large', tasks: TITLES.map((title, k) => (k === 3 ? task(title, 'agent', 'sonnet', 'medium') : task(title, 'main', 'opus', 'high'))) })

  // 0.7.6 U6: phần đầu pane ngắn hơn hai dòng, 11 bước dự kiến vừa 16 dòng; dạng gọn đo ở 14 dòng.
  test('14 dòng: 11 bước dự kiến dùng dạng gọn, bước dự kiến đầu nằm trong 14 dòng', {}, async ($, on) => {
    base(on, { router })
    await submit($, 'Cập nhật sổ giá theo các bước')
    const { tree, texts } = await drawn($, 14)
    expect(stepRow(tree, 0)).toBeLessThan(14)
    const planned = texts.slice(texts.findIndex(t => /^Việc dự kiến/.test(t)) + 1)
    expect(planned).toContain(openMore('vi', 7))
    expect(planned).not.toContain('BƯỚC 10: kết thúc phiên')
  })

  test('40 dòng: 11 bước dự kiến hiện đủ', {}, async ($, on) => {
    base(on, { router })
    await submit($, 'Cập nhật sổ giá theo các bước')
    const { texts } = await drawn($, 40)
    expect(texts).toContain('BƯỚC 10: kết thúc phiên')
    expect(texts.some(t => /^\+\d+ bước mở$/.test(t))).toBe(false)
  })
})

describe('0.7.5 S6: ranh giới đúng của dạng gọn', () => {
  const LONG_GOAL = 'Cập nhật sổ giá theo các bước, đối chiếu từng lô với bảng giá tuần trước và ghi lại mọi chênh lệch cho kế toán kiểm'

  test('dạng gọn đúng khi dạng đầy đủ không vừa: so với vị trí đo được của dạng đầy đủ (pane 100 dòng), mục tiêu dài nhiều dòng', {}, async ($, on) => {
    await longGoal($, on, 0, TITLES.length, LONG_GOAL)
    // 0.7.6 U1: dạng đầy đủ vừa khi cả danh sách, tới dòng chú giải ký hiệu, nằm trong số dòng của pane.
    // 0.7.6 U7: chú giải chỉ ghi các loại đang thấy, đo theo mục "đang làm".
    const full = rowOf((await drawn($, 100)).tree, new RegExp(labels('vi').legend.doing))
    for (let rows = 14; rows <= 32; rows++) {
      const { texts } = await drawn($, rows)
      const isCompact = checklistOf(texts).some(t => /^\+\d+ bước mở$/.test(t))
      expect(isCompact, `${rows} dòng`).toBe(!(full < rows))
    }
  })

  // 0.7.6 U6: phần đầu pane ngắn hơn hai dòng, dạng gọn đo ở 10 dòng.
  test('dạng gọn mà mọi bước mở đều hiện: không có dòng "+0 bước mở"', {}, async ($, on) => {
    await longGoal($, on, 7)
    const { texts } = await drawn($, 10)
    const list = checklistOf(texts)
    expect(list).toContain('7 bước đã đóng')
    expect(list.some(t => /^\+0 /.test(t))).toBe(false)
    expect(list.some(t => t.includes(labels('vi').legend.doing))).toBe(false)
  })
})
