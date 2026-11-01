// 0.7.6 U11: trạng thái rỗng. Pane chỉ tự mở ở mục tiêu substantial hay hard (việc nhỏ none, light thường không có checklist); chưa có
// checklist thì bước dự kiến của router nằm dưới tiêu đề "Danh sách bước (dự kiến)", không còn mục "Việc dự kiến (router)"; không có
// bước nào thì không có mục checklist và không có câu "Claude chưa chốt checklist.".

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, submit, task } from '../support/engine'

const PANE_ID = 'focus-conductor'

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return texts
}

describe('0.7.6 U11: pane chỉ tự mở ở mục tiêu substantial, hard', () => {
  for (const depth of ['none', 'light'] as const) {
    test(`độ sâu ${depth}: không tự mở`, async ($, on) => {
      const seen = base(on, { router: () => plan({ goal: 'Sửa một dòng', depth }) })
      await submit($, 'Sửa lỗi chính tả trong README')
      expect(seen.opened.filter(o => o.id === PANE_ID)).toEqual([])
    })
  }
  for (const depth of ['substantial', 'hard'] as const) {
    test(`độ sâu ${depth}: tự mở`, async ($, on) => {
      const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth }) })
      await submit($, 'Sửa module thanh toán')
      expect(seen.opened.filter(o => o.id === PANE_ID).length).toBe(1)
    })
  }
})

describe('0.7.6 U11: pane khi chưa có checklist', () => {
  test('bước dự kiến của router nằm dưới "Danh sách bước (dự kiến)", không còn mục "Việc dự kiến (router)"', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'hard', tasks: [task('Đọc mã', 'main', 'opus', 'high'), task('Sửa', 'main', 'opus', 'high')] }) })
    await submit($, 'Sửa module thanh toán')
    const texts = await paneTexts($)
    expect(texts.some(t => /^Việc dự kiến/.test(t))).toBe(false)
    expect(texts.some(t => /^Danh sách bước \(dự kiến\) ─/.test(t))).toBe(true)
    expect(texts).toContain('Đọc mã')
  })

  test('uiLanguage en: "Checklist (planned)"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Fix the payment module', depth: 'hard', tasks: [task('Read the code', 'main', 'opus', 'high'), task('Fix', 'main', 'opus', 'high')] }) })
    await submit($, 'Fix the payment module')
    const texts = await paneTexts($)
    expect(texts.some(t => /^Planned work/.test(t))).toBe(false)
    expect(texts.some(t => /^Checklist \(planned\) ─/.test(t))).toBe(true)
  })

  test('không có bước nào: không có mục checklist, không có "Claude chưa chốt checklist."', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'hard', tasks: [] }) })
    await submit($, 'Sửa module thanh toán')
    const texts = await paneTexts($)
    expect(texts.some(t => /^(Danh sách bước|Việc dự kiến)/.test(t))).toBe(false)
    expect(texts).not.toContain('Claude chưa chốt checklist.')
  })
})
