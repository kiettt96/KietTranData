// 0.7.5 S8 (vòng rà soát 4): cảnh báo mục của prompt tiếp nối không giữ được (R1) có kind riêng "dropped" với nhãn chip vi/en, không dùng
// kind "model" (chip trong pane từng hiện "model").

import { describe, expect, test } from 'claude-code/testing'
import { labels } from '../../hooks/ui/labels'
import { severityOf } from '../../hooks/ui/style'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'
import { PANE, base, plan, submit } from '../support/engine'

const REQUIREMENTS = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const FIRST = plan({ goal: 'Cập nhật sổ giá theo 11 bước', depth: 'hard', volume: 'large', requirements: REQUIREMENTS })
const MANY = plan({ relation: 'refine', goal: '', requirements: Array.from({ length: 12 }, (_, i) => `Tinh chỉnh ${i + 1}`) })

describe('0.7.5 S8: kind riêng cho cảnh báo mục bị bỏ', () => {
  test('pane hiện chip "mục bị bỏ" cạnh câu cảnh báo, không phải chip "model"', {}, async ($, on) => {
    base(on, { router: request => (request.includes('thêm 12 yêu cầu') ? MANY : FIRST) })
    await submit($, LONG_CODED_PROMPT)
    await submit($, 'thêm 12 yêu cầu')
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
    await pane.unmount()
    const at = texts.findIndex(t => t.includes('mục của prompt tiếp nối không giữ được'))
    expect(at).toBeGreaterThanOrEqual(0)
    const chip = texts.slice(Math.max(0, at - 2), at).join(' ')
    expect(chip).toContain('mục bị bỏ')
    expect(chip).not.toContain(' model ')
  })

  test('nhãn vi và en, mức cảnh báo (không phải lỗi)', () => {
    const vi = labels('vi').warningKind as Record<string, string>
    const en = labels('en').warningKind as Record<string, string>
    expect(vi['dropped']).toBe('mục bị bỏ')
    expect(en['dropped']).toBe('dropped items')
    expect(severityOf('dropped' as never)).toBe('warning')
  })
})
