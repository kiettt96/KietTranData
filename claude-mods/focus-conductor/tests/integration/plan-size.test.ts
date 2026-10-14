// 0.5.6 hạng mục D (tích hợp): kết quả tool plan gọn, action show, và kích thước kết quả (đo qua đường tool thật).
// Số "trước": chạy cùng tệp này trên cây 0611fae (assert kích thước đỏ, giá trị Received là số đo; bước hàng loạt không có ở đó).

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const twelve = Array.from({ length: 12 }, (_, i) => ({ title: `Bước ${i + 1}: xử lý nhóm dữ liệu ${i + 1}`, check: 'đạt khi số dòng khớp nguồn' }))
const NOTE = 'Người dùng yêu cầu tạm dừng, chờ lệnh tiếp tục lại'

describe('0.5.6 D6: kích thước kết quả', () => {
  test('12 lần update đơn sang blocked kèm note khoảng 50 ký tự: tổng dưới 4000 ký tự', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: twelve })
    let total = 0
    for (let step = 1; step <= 12; step += 1) {
      const text = String((await $.tool.call({ tool: PLAN, action: 'update', step, status: 'blocked', note: NOTE })).result)
      total += text.length
    }
    expect(total).toBeLessThan(4000)
  })

  test('một lần hàng loạt cho 12 bước: dưới 400 ký tự', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: twelve })
    const text = String((await $.tool.call({ tool: PLAN, action: 'update', allOpen: true, status: 'waiting', note: NOTE })).result)
    expect(text.length).toBeLessThan(400)
  })
})

describe('0.5.6 D2, D3: update, add và set', () => {
  test('update chỉ in hàng của bước đổi, không in tiêu đề bước khác và không có dòng Mục tiêu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Dựng pipeline', steps: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }] })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' })).result)
    expect(out).toContain('[~] 2. Beta')
    expect(out).toContain('Checklist (0/3 đã đóng):')
    expect(out).toContain('Bước tiếp theo: 1. Alpha')
    expect(out).not.toContain('Alpha;')
    expect(out).not.toContain('[ ] 1. Alpha')
    expect(out).not.toContain('Gamma')
    expect(out).not.toContain('Mục tiêu:')
  })

  test('add chỉ in bước mới', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Alpha' }, { title: 'Beta' }] })
    const out = String((await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'Gamma' }] })).result)
    expect(out).toContain('[ ] 3. Gamma')
    expect(out).toContain('Checklist (0/3 đã đóng):')
    expect(out).not.toContain('[ ] 1. Alpha')
    expect(out).not.toContain('[ ] 2. Beta')
  })

  test('set và restore vẫn in đủ checklist', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const set = String((await $.tool.call({ tool: PLAN, action: 'set', goal: 'Dựng pipeline', steps: [{ title: 'Alpha' }, { title: 'Beta' }] })).result)
    expect(set).toContain('Mục tiêu: Dựng pipeline')
    expect(set).toContain('[ ] 1. Alpha')
    expect(set).toContain('[ ] 2. Beta')
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết slugify' }] })
    const restored = String((await $.tool.call({ tool: PLAN, action: 'restore' })).result)
    expect(restored).toContain('[ ] 1. Alpha')
    expect(restored).toContain('[ ] 2. Beta')
  })
})

describe('0.5.6 D4, D5: action show', () => {
  test('show in đủ checklist có dòng Mục tiêu, không đổi trạng thái', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Dựng pipeline', steps: [{ title: 'Alpha' }, { title: 'Beta' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(out).toContain('Mục tiêu: Dựng pipeline')
    expect(out).toContain('[x] 1. Alpha')
    expect(out).toContain('[ ] 2. Beta')
    const again = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(again).toBe(out)
  })

  test('show trên checklist rỗng', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('Checklist trống.')
  })

  test('show không tính là cập nhật: turn hỏi đáp không bị cổng Stop chặn', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Alpha' }] })
    await $.turn.start({ text: 'checklist đang thế nào', turnId: 't2' })
    await $.tool.call({ tool: PLAN, action: 'show' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('action không hợp lệ liệt kê cả show trong thông báo lỗi', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call({ tool: PLAN, action: 'xyz' })).deny).toContain('show')
  })
})
