// 0.7.8 G5: việc từ mức substantial thì luồng chính không chạy haiku (luồng chính phải tổng hợp kết quả của việc khó). Áp sau G3,
// giữ effort, qua fitPick lần nữa; brief isReference giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelFamily } from '../types'
import { parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { plan, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const routed = (over: Record<string, unknown>, policy: Policy = OPEN): RouterPlan => parseRoute(JSON.stringify(plan(over)), policy)!
const HARD = { kind: 'investigate', depth: 'hard', main: { model: 'haiku', effort: 'low' }, tasks: [task('Phân tích sâu', 'agent', 'opus', 'high', { kind: 'investigate' })] }

describe('0.7.8 G5: luồng chính không chạy haiku khi việc từ mức substantial', () => {
  test('investigate, depth hard, main haiku/low: luồng chính sonnet/low kèm ghi chú', () => {
    const r = routed(HARD)
    expect(r.main).toEqual({ family: 'sonnet', effort: 'low' })
    expect(r.notes.join('; ')).toContain('việc mức hard: luồng chính không chạy haiku')
  })

  test('depth substantial cũng nâng', () => {
    expect(routed({ ...HARD, depth: 'substantial' }).main.family).toBe('sonnet')
  })

  test('depth light giữ haiku', () => {
    const r = routed({ ...HARD, depth: 'light' })
    expect(r.main.family).toBe('haiku')
    expect(r.notes.join('; ')).not.toContain('không chạy haiku')
  })

  test('brief isReference giữ nguyên', () => {
    expect(routed({ ...HARD, kind: 'answer', reference: true }).main.family).toBe('haiku')
  })

  test('model phiên fixed haiku: giữ haiku kèm ghi chú kẹp', () => {
    const r = routed(HARD, { ...OPEN, session: { family: 'haiku', policy: 'fixed' } })
    expect(r.main.family).toBe('haiku')
    expect(r.notes.join('; ')).toContain('không chạy haiku')
    expect(r.notes.length).toBeGreaterThanOrEqual(2)
  })
})
