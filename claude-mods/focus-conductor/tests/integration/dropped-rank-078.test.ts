// Bắt mẫu 075-S8a (sống sót từ trước 0.7.8, lộ ra ở lượt đột biến của 0.7.8): cảnh báo mục của prompt tiếp nối không giữ được mang kind
// "dropped" nên đứng hạng 4 trong "Cần chú ý", trên cảnh báo chưa kiểm (hạng 5); kind "model" sẽ đứng hạng 7, dưới cảnh báo chưa kiểm.

import { describe, expect, test } from 'claude-code/testing'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'
import { PANE, base, plan, submit } from '../support/engine'

const REQUIREMENTS = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const FIRST = plan({ goal: 'Cập nhật sổ giá theo 11 bước', depth: 'hard', volume: 'large', requirements: REQUIREMENTS })
const MANY = plan({ relation: 'refine', goal: '', requirements: Array.from({ length: 12 }, (_, i) => `Tinh chỉnh ${i + 1}`) })

describe('kind dropped xếp trên cảnh báo chưa kiểm trong Cần chú ý', () => {
  test('mục bị bỏ (hạng 4) đứng trước cảnh báo chưa kiểm (hạng 5) dù đến trước', {}, async ($, on) => {
    base(on, { router: request => (request.includes('thêm 12 yêu cầu') ? MANY : FIRST) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, LONG_CODED_PROMPT)
    await submit($, 'thêm 12 yêu cầu')
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
    await pane.unmount()
    const dropped = texts.findIndex(t => t.includes('mục của prompt tiếp nối không giữ được'))
    const unverified = texts.findIndex(t => t.includes('không chạy bước kiểm tra nào'))
    expect(dropped).toBeGreaterThanOrEqual(0)
    expect(unverified).toBeGreaterThanOrEqual(0)
    expect(dropped).toBeLessThan(unverified)
  })
})
