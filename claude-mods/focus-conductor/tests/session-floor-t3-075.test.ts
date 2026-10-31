// 0.7.5 T3 (vòng rà soát 5): prompt tinh chỉnh nhắc lại đúng một quy tắc mang sang (cùng khóa) thì quy tắc đó thuộc mục tiêu hiện tại:
// ra khỏi phần mang sang (`carriedRules` giảm) nên tạo sàn model phiên cho luồng chính.

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { ruleFamily } from '../hooks/lib/route'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const lead = (model: string, effort: string) => ({ model, effort, why: '' })
const RULE = 'đọc, giải thích, đúc kết dùng mô hình của phiên'
const FILTER = 'Lọc tin dùng sonnet'
const OPUS = { sessionFamily: 'opus' as const }

/** Mục tiêu mới mang hai quy tắc sang (không sàn, haiku/low). */
function carriedGoal() {
  const first = nextBrief(null, routed({ goal: 'Cập nhật kho tri thức', constraints: [FILTER, RULE], kind: 'edit', main: lead('sonnet', 'medium') }), 'p', 1, OPUS).brief
  return nextBrief(first, routed({ relation: 'new', confidence: 0.95, goal: 'Việc khác', constraints: [], kind: 'answer', main: lead('haiku', 'low') }), 'việc khác', 2, OPUS).brief
}
const refine = (constraints: string[]) =>
  nextBrief(carriedGoal(), routed({ relation: 'refine', goal: '', constraints, kind: 'answer', main: lead('haiku', 'low') }), 'nhắc lại', 3, OPUS).brief

describe('0.7.5 T3: quy tắc mang sang được nhắc lại trong prompt tinh chỉnh', () => {
  test('mục tiêu mới không sàn: haiku/low', () => {
    const goal = carriedGoal()
    expect(goal.main).toEqual({ family: 'haiku', effort: 'low' })
    expect(goal.carriedRules).toBe(2)
  })

  test('nhắc lại "đọc, giải thích, đúc kết dùng mô hình của phiên": luồng chính lên model phiên', () => {
    expect(refine([RULE]).main?.family).toBe('opus')
  })

  test('nhắc lại khác hoa thường và dấu câu cuối vẫn là cùng quy tắc', () => {
    expect(refine(['Đọc, giải thích, đúc kết dùng mô hình của phiên.']).main?.family).toBe('opus')
  })

  test('quy tắc nhắc lại ra khỏi phần mang sang; quy tắc kia vẫn mang sang và vẫn định tuyến subagent; không trùng mục', () => {
    const brief = refine([RULE])
    expect(brief.carriedRules).toBe(1)
    expect(brief.constraints.filter(item => item.toLowerCase() === RULE.toLowerCase()).length).toBe(1)
    expect(ruleFamily(brief.constraints, 'Lọc tin lô 1', 'opus')).toBe('sonnet')
  })

  test('nhắc lại quy tắc của subagent (không phải luồng chính) không tạo sàn', () => {
    expect(refine([FILTER]).main).toEqual({ family: 'haiku', effort: 'low' })
  })
})
