// Bắt mẫu 075-S8a (sống sót từ trước 0.7.8, lộ ra ở lượt đột biến của 0.7.8): cảnh báo mục của prompt tiếp nối không giữ được mang kind
// "dropped" nên đứng hạng 4 trong "Cần chú ý", trên cảnh báo chưa kiểm (hạng 5); kind "model" sẽ đứng hạng 7, dưới cảnh báo chưa kiểm.

// 0.8.7 L2: yêu cầu không còn trần, nên phần tràn được dựng bằng ràng buộc (trần 12, tràn thêm 10): 10 ràng buộc của prompt đầu, rồi
// hai lượt tinh chỉnh mỗi lượt 10 ràng buộc mới; lượt thứ hai còn 2 chỗ nên 8 mục bị bỏ.
import { describe, expect, test } from 'claude-code/testing'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'
import { PANE, base, plan, submit } from '../support/engine'

const REQUIREMENTS = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const FIRST = plan({ goal: 'Cập nhật sổ giá theo 11 bước', depth: 'hard', volume: 'large', requirements: REQUIREMENTS, constraints: Array.from({ length: 10 }, (_, i) => `Ràng buộc gốc ${i + 1}`) })
const MANY = plan({ relation: 'refine', goal: '', constraints: Array.from({ length: 10 }, (_, i) => `Tinh chỉnh ${i + 1}`) })
const MANY2 = plan({ relation: 'refine', goal: '', constraints: Array.from({ length: 10 }, (_, i) => `Tinh chỉnh thêm ${i + 1}`) })

describe('kind dropped xếp trên cảnh báo chưa kiểm trong Cần chú ý', () => {
  test('mục bị bỏ (hạng 4) đứng trước cảnh báo chưa kiểm (hạng 5) dù đến trước', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: request => (request.includes('thêm 12 yêu cầu nữa') ? MANY2 : request.includes('thêm 12 yêu cầu') ? MANY : FIRST) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, LONG_CODED_PROMPT)
    await submit($, 'thêm 12 yêu cầu')
    await submit($, 'thêm 12 yêu cầu nữa')
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
