// Test tích hợp: lệnh /conductor.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, DEFAULT_ROUTER, base, conductor, step, submit } from '../support/engine'

describe('lệnh /conductor', () => {
  test('mode off tắt điều phối, mode không hợp lệ trả trợ giúp', {}, async ($, on) => {
    const seen = base(on)
    expect((await conductor($, 'mode lung-tung')).text).toContain('auto, subagents, suggest hoặc off')
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
    await conductor($, 'mode auto')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[1]?.join('\n')).toContain('[focus-conductor]')
  })

  test('goal qua router (ép mục tiêu mới), status hiện mục tiêu và lý do của router, reset xóa', {}, async ($, on) => {
    const seen = base(on)
    const goal = await conductor($, 'goal Viết hàm parseDate cho ngày ISO, có unit test')
    expect(seen.routed[0]).toContain('relation must be "new"')
    expect(goal.text).toContain('Đã đặt mục tiêu: Viết hàm parseDate cho ngày ISO, có unit test (light, khối lượng small, luồng chính sonnet/medium)')
    expect(goal.context?.join('\n')).toContain('[focus-conductor]')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Mục tiêu: Viết hàm parseDate')
    expect(status).toContain('Đánh giá của router: độ sâu light, khối lượng small, bản chất edit (việc vừa)')
    await conductor($, 'reset')
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })

  test('goal khi router lỗi: đặt mục tiêu không có lựa chọn model, có báo checklist cũ đã được lưu', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích' }] })
    isDown = true
    const goal = await conductor($, 'goal Viết hàm parseDate')
    expect(goal.text).toContain('Router không đọc được')
    expect(goal.context?.join('\n')).toContain('Checklist cũ còn 1 bước mở đã được lưu')
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  test('/clear (session.end clear) xóa mục tiêu của phiên', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await conductor($, 'status')).text).toContain('Mục tiêu:')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })
})
