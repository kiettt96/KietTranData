// 0.7.5 (bắt mẫu 072-B6 sống sót ở lượt đột biến cuối): prompt tiếp nối nâng cấp mục tiêu tối thiểu (router chưa từng đọc) lấy tier
// theo router, không lấy tier đoán của mục tiêu tối thiểu làm sàn; mục tiêu do router đọc thì tier chỉ tăng (sàn là tier cũ).
// Hai ca đầu kiểm trực tiếp hàm thuần vì ca tích hợp cùng ý (tests/integration/bare-goal.test.ts) không phân biệt được hai cách tính.

import { describe, expect, test } from 'claude-code/testing'
import { bareBrief, nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { tierOf } from '../hooks/lib/scale'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!

describe('tier của prompt tiếp nối', () => {
  test('mục tiêu tối thiểu (tier đoán moderate), router đọc là việc nhẹ: tier theo router (simple), có thể thấp hơn tier đoán', () => {
    const bare = { ...bareBrief('Sửa một dòng', 3, 1), isBare: true as const }
    expect(bare.tier).toBe('moderate')
    const out = nextBrief(bare, routed({ relation: 'continue', goal: 'Sửa nhỏ', depth: 'light', volume: 'small' }), 'chỉ sửa một dòng nhỏ', 2)
    expect(out.brief.tier).toBe(tierOf('light', 'small'))
    expect(out.brief.tier).toBe('simple')
    expect(out.brief.goal).toBe('Sửa nhỏ')
    expect(out.brief.isBare).toBeUndefined()
  })

  test('mục tiêu do router đọc: tier không tụt khi prompt tiếp nối được đọc là nhẹ', () => {
    const prev = makeBrief({ tier: 'complex', depth: 'substantial', volume: 'medium' })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', depth: 'light', volume: 'small' }), 'tiếp', 2)
    expect(out.brief.tier).toBe('complex')
  })

  test('mục tiêu do router đọc: tier tăng khi prompt tiếp nối nặng hơn', () => {
    const prev = makeBrief({ tier: 'simple', depth: 'light', volume: 'small' })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', depth: 'hard', volume: 'large' }), 'tiếp', 2)
    expect(out.brief.tier).toBe('deep')
  })
})
