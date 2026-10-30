// 0.7.5 S2 (vòng rà soát 4): quy định model mang sang mục tiêu mới chỉ dùng cho định tuyến subagent, không tạo sàn model phiên cho
// luồng chính. Sàn model phiên chỉ áp cho mục tiêu mà prompt lập mục tiêu (hay prompt tiếp nối của chính nó) nêu quy định đó.

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { ruleFamily } from '../hooks/lib/route'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const lead = (model: string, effort: string) => ({ model, effort, why: '' })
const RULE = 'Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'
const OPUS = { sessionFamily: 'opus' as const }

function ruledGoal() {
  return nextBrief(null, routed({ goal: 'Cập nhật kho tri thức', constraints: [RULE], kind: 'edit', main: lead('sonnet', 'medium') }), 'p', 1, OPUS).brief
}

describe('0.7.5 S2: quy định mang sang mục tiêu mới không tạo sàn luồng chính', () => {
  test('mục tiêu có quy định: luồng chính lên model phiên như R4', () => {
    expect(ruledGoal().main?.family).toBe('opus')
  })

  test('câu hỏi nhỏ thật sự mới, router chọn haiku/low: luồng chính giữ haiku/low, quy định vẫn mang sang', () => {
    const out = nextBrief(ruledGoal(), routed({ relation: 'new', confidence: 0.95, goal: 'Giá vàng hôm nay', constraints: [], kind: 'answer', main: lead('haiku', 'low') }), 'Giá vàng hôm nay bao nhiêu?', 2, OPUS)
    expect(out.isNewGoal).toBe(true)
    expect(out.brief.main).toEqual({ family: 'haiku', effort: 'low' })
    expect(out.brief.constraints).toContain(RULE)
  })

  test('quy định mang sang vẫn định tuyến subagent: "Lọc tin lô 1" chốt sonnet ở mục tiêu mới', () => {
    const out = nextBrief(ruledGoal(), routed({ relation: 'new', confidence: 0.95, goal: 'Việc khác', constraints: [], kind: 'answer', main: lead('haiku', 'low') }), 'việc khác', 2, OPUS)
    expect(ruleFamily(out.brief.constraints, 'Lọc tin lô 1', 'opus')).toBe('sonnet')
  })

  test('prompt tiếp nối của mục tiêu mới đó: vẫn không có sàn model phiên', () => {
    const fresh = nextBrief(ruledGoal(), routed({ relation: 'new', confidence: 0.95, goal: 'Việc khác', constraints: [], kind: 'answer', main: lead('haiku', 'low') }), 'việc khác', 2, OPUS).brief
    const out = nextBrief(fresh, routed({ relation: 'continue', goal: '', kind: 'answer', main: lead('haiku', 'low') }), 'tiếp', 3, OPUS)
    expect(out.brief.main?.family).toBe('haiku')
  })

  test('mục tiêu mới tự nêu lại quy định ở prompt tiếp nối: sàn áp lại', () => {
    const fresh = nextBrief(ruledGoal(), routed({ relation: 'new', confidence: 0.95, goal: 'Việc khác', constraints: [], kind: 'answer', main: lead('haiku', 'low') }), 'việc khác', 2, OPUS).brief
    const out = nextBrief(fresh, routed({ relation: 'refine', goal: '', constraints: ['Đọc tài liệu dùng mô hình của phiên'], kind: 'answer', main: lead('haiku', 'low') }), 'đọc bằng model phiên', 3, OPUS)
    expect(out.brief.main?.family).toBe('opus')
  })
})
