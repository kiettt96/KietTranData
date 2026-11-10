// 0.8.4 C5: khi luồng chính điều phối, khối brief của mục tiêu kèm đúng một đoạn dặn vai điều phối (tối đa CONDUCTOR_CHARS ký tự):
// giao từng việc bằng Agent đúng loại, model, effort đã phân, description mở đầu bằng Việc N, lời giao tự đứng được. Chỉ chèn một lần
// mỗi mục tiêu; mục tiêu không lớn hay option mặc định thì không có. Cảnh báo fan-out chỉ đếm lời gọi không khớp việc đã phân.

import { describe, expect, test } from 'claude-code/testing'
import { CONDUCTOR_CHARS } from '../../hooks/lib/text'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const MARK = '[focus-conductor] Điều phối'
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', ...over })
const marks = (contexts: string[][]) => (contexts.at(-1) ?? []).filter(c => c.includes(MARK))

describe('0.8.4 C5: đoạn dặn vai điều phối', () => {
  test('luồng chính điều phối, prompt mới: đúng một đoạn, không quá CONDUCTOR_CHARS ký tự; prompt tiếp nối: không chèn lần hai', FABLE, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (n++ === 0 ? BIG() : plan({ relation: 'continue', goal: '', depth: 'substantial', kind: 'edit' })) })
    await submit($, 'Sửa luồng thanh toán')
    const first = marks(seen.contexts)
    expect(first.length).toBe(1)
    const paragraph = (first[0] ?? '').slice((first[0] ?? '').indexOf(MARK))
    expect(paragraph.length).toBeLessThanOrEqual(CONDUCTOR_CHARS)
    expect(CONDUCTOR_CHARS).toBe(480)
    expect(paragraph).toContain('Việc N')
    await submit($, 'làm tiếp phần còn lại nhé')
    expect(marks(seen.contexts).length).toBe(0)
  })

  test('mục tiêu không lớn: không có đoạn dặn', FABLE, async ($, on) => {
    const seen = base(on, { router: () => BIG({ depth: 'light', volume: 'small' }) })
    await submit($, 'Sửa chú thích')
    expect(marks(seen.contexts).length).toBe(0)
  })

  test('conductor mặc định: không có đoạn dặn', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => BIG() })
    await submit($, 'Sửa luồng thanh toán')
    expect(marks(seen.contexts).length).toBe(0)
  })

  test('giao 7 subagent đều khớp việc đã phân (Việc 1 tới Việc 7): không có cảnh báo fan-out', FABLE, async ($, on) => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(`Việc ${i + 1}: sửa module ${i + 1}`, 'agent', 'sonnet', 'medium'))
    const seen = base(on, { router: () => BIG({ tasks }) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Sửa luồng thanh toán')
    for (let i = 1; i <= 7; i++) await $.tool.call({ tool: 'Agent', description: `Việc ${i}: sửa module ${i}`, prompt: `Sửa module ${i}`, subagent_type: 'general-purpose' } as never)
    expect(seen.toasts.some(t => t.includes('subagent; mỗi agent có chi phí riêng'))).toBe(false)
  })
})
