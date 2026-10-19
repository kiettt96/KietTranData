// 0.7.0 điểm 1: checklist còn bước mở nhưng mục tiêu chưa có brief (router lỗi ở prompt đầu, Claude tự `plan set`) vẫn được lưu
// khi prompt sau là mục tiêu mới, đúng như thông báo "đã được lưu" nói; `plan restore` khôi phục được.
// Router lỗi hai prompt liên tiếp thì bị bỏ qua 3 prompt tới (router tạm ngừng), nên mục tiêu mới đầu tiên là prompt thứ sáu.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DEFAULT_ROUTER, base, conductor, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'

/** Prompt thứ hai (router lỗi lần hai, nên tạm ngừng) và ba prompt bị bỏ qua: không prompt nào được route. */
async function whilePaused($: Engine) {
  for (const text of ['Giải thích hàm parseDate', 'Liệt kê các file test', 'Xem log lỗi hôm qua', 'Mở lại tài liệu v10']) await submit($, text)
}

describe('0.7.0 1: lưu checklist khi mục tiêu chưa có brief', () => {
  test('router lỗi ở prompt đầu, plan set, prompt sau là mục tiêu mới: thông báo "đã được lưu" đúng và restore khôi phục được', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) <= 2 ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Cập nhật skill taichinh-dongchilong lên v10.0.0, đối chiếu đủ các mục trong tài liệu đính kèm')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Cập nhật skill', steps: [{ title: 'Đọc tài liệu v10' }, { title: 'Sửa skill' }] })
    await whilePaused($)
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(seen.toasts.some(t => t.includes('đã được lưu'))).toBe(true)
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' })
    expect(restored.deny).toBeUndefined()
    expect(String(restored.result)).toContain('Đọc tài liệu v10')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('2. Sửa skill')
    expect(status).toContain('Mục tiêu: Đọc tài liệu v10')
  })

  test('không có brief và checklist không còn bước mở: không có gì để lưu', {}, async ($, on) => {
    let n = 0
    base(on, { router: request => ((n += 1) <= 2 ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Cập nhật skill taichinh-dongchilong lên v10.0.0')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Cập nhật skill', steps: [{ title: 'Đọc tài liệu v10' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await whilePaused($)
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
  })
})
