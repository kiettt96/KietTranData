// 0.7.9 vòng 2 V4: /conductor reroute và /conductor goal chỉ đọc thư mục gốc phiên ($.session.root()) khi tách việc bật (maxForks từ 2). Tách tắt thì
// hai lệnh không gọi root() thêm, vì mỗi lần gọi thêm làm lệch phép neo gốc theo mục tiêu (test về gốc đổi giữa chừng đếm đúng lời gọi này).

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, conductor, step, submit } from '../support/engine'

const FORKS_ON = { options: { forks: true, maxForks: 3 } }

describe('0.7.9 vòng 2 V4: lời gọi session.root() của lệnh /conductor', () => {
  test('forks tắt: /conductor reroute không gọi session.root()', { options: { planApproval: 'off' } }, async ($, on) => {
    let calls = 0
    const seen = base(on, { root: () => ((calls += 1), '/repo') })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-opus-5-5' })
    const before = calls
    await conductor($, 'reroute')
    expect(calls).toBe(before)
  })

  test('forks tắt: /conductor goal không gọi session.root()', { options: { planApproval: 'off' } }, async ($, on) => {
    let calls = 0
    const seen = base(on, { root: () => ((calls += 1), '/repo') })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-opus-5-5' })
    const before = calls
    await conductor($, 'goal Làm một việc khác hẳn')
    expect(calls).toBe(before)
  })

  test('forks bật: /conductor reroute gọi session.root() để kẹp split theo gốc phiên', { ...FORKS_ON, options: { ...(FORKS_ON as { options?: Record<string, unknown> }).options, planApproval: 'off' } }, async ($, on) => {
    let calls = 0
    const seen = base(on, { root: () => ((calls += 1), '/repo') })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-opus-5-5' })
    const before = calls
    await conductor($, 'reroute')
    expect(calls).toBeGreaterThan(before)
  })

  test('forks bật: /conductor goal gọi session.root() để kẹp split theo gốc phiên', { ...FORKS_ON, options: { ...(FORKS_ON as { options?: Record<string, unknown> }).options, planApproval: 'off' } }, async ($, on) => {
    let calls = 0
    const seen = base(on, { root: () => ((calls += 1), '/repo') })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-opus-5-5' })
    const before = calls
    await conductor($, 'goal Làm một việc khác hẳn')
    expect(calls).toBeGreaterThan(before)
  })
})
