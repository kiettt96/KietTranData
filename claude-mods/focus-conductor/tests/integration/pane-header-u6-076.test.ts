// 0.7.6 U6: phần đầu pane chỉ còn mục tiêu và thanh tiến độ; độ sâu, khối lượng, loại việc và lý do của router dời xuống mục
// "Điều phối" ở cuối pane (thay mục "Điều phối luồng chính"), mỗi ý một dòng cắt gọn. Band không ghi tên giai đoạn.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FOUR, PANE, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return texts
}

describe('0.7.6 U6: phần đầu pane gọn, chi tiết điều phối ở cuối', () => {
  test('phần đầu (trước Danh sách bước) không có độ sâu, khối lượng, loại hay lý do router', async ($, on) => {
    base(on)
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: tìm' }, { title: 'Việc 2: đổi tên' }] } as never)
    const texts = await paneTexts($)
    const head = texts.slice(0, texts.findIndex(t => /^Danh sách bước/.test(t)))
    expect(head.length).toBeGreaterThan(0)
    for (const word of ['độ sâu', 'khối lượng', 'loại', 'việc vừa']) expect(head.some(t => t.includes(word)), word).toBe(false)
  })

  test('mục "Điều phối" ở cuối pane, sau Tiêu chí chất lượng: model luồng chính, độ sâu, khối lượng, loại, lý do router', async ($, on) => {
    base(on)
    await submit($, FOUR)
    const texts = await paneTexts($)
    expect(texts.some(t => /^Điều phối luồng chính/.test(t))).toBe(false)
    const at = texts.findIndex(t => /^Điều phối ─/.test(t))
    const quality = texts.findIndex(t => /^Tiêu chí chất lượng/.test(t))
    expect(at).toBeGreaterThan(quality)
    const section = texts.slice(at)
    expect(section.some(t => t === 'độ sâu hard · khối lượng medium · loại mixed')).toBe(true)
    expect(section.some(t => t === 'việc vừa')).toBe(true)
  })

  test('uiLanguage en: mục "Routing"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on)
    await submit($, FOUR)
    const texts = await paneTexts($)
    const at = texts.findIndex(t => /^Routing ─/.test(t))
    expect(at).toBeGreaterThan(texts.findIndex(t => /^Quality criteria/.test(t)))
    expect(texts.slice(at).some(t => t === 'depth hard · volume medium · kind mixed')).toBe(true)
  })
})
