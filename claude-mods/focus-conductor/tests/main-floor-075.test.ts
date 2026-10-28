// 0.7.5 M5 (vòng sửa 2): (a) khi ràng buộc của brief nêu "mô hình của phiên" cho luồng chính hay cho mọi việc không nêu model khác,
// main không thấp hơn model của phiên; (b) sàn main ở prompt tiếp nối lấy main của prompt lập mục tiêu (mainBase), không lấy lựa
// chọn gần nhất, nên sàn không chỉ tăng mãi.

import { describe, expect, test } from 'claude-code/testing'
import { briefOf, nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import * as R from '../hooks/lib/route'
import type { Brief } from '../types'
import { makeBrief } from './support/commands'
import { base, plan, submit } from './support/engine'
import { normalizeCore } from '../hooks/lib/state'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const call = nextBrief as (...a: unknown[]) => ReturnType<typeof nextBrief>
const sessionFloor = (...a: unknown[]) => ((R as Record<string, unknown>)['sessionFloor'] as (...b: unknown[]) => unknown)(...a)
const lead = (family: string, effort: string) => ({ model: family, effort, why: '' })

describe('0.7.5 M5: sàn main theo mô hình của phiên', () => {
  test('sessionFloor nhận quy định cho luồng chính hay mọi việc khác; không nhận quy định cho loại việc cụ thể', () => {
    for (const rule of ['Luồng chính dùng mô hình của phiên', 'Mọi việc khác dùng model của phiên', 'Các việc còn lại chạy bằng mô hình của phiên', 'Main thread runs on the session model', 'Việc lọc tin chạy sonnet; mọi việc khác dùng mô hình của phiên']) {
      expect(sessionFloor([rule], 'opus'), rule).toBe('opus')
    }
    for (const rule of ['Đọc, giải thích và tóm tắt dùng model của phiên', 'Việc lọc tin chạy sonnet', 'Không dùng mô hình của phiên cho luồng chính', 'Luồng chính chạy sonnet']) {
      expect(sessionFloor([rule], 'opus'), rule).toBe(null)
    }
    expect(sessionFloor(['Luồng chính dùng mô hình của phiên'], null)).toBe(null)
  })

  test('mục tiêu mới: router chọn haiku/low cho luồng chính nhưng quy định "luồng chính dùng mô hình của phiên" và phiên chạy opus: main là opus', () => {
    const out = call(null, routed({ goal: 'Dọn dữ liệu', constraints: ['Luồng chính dùng mô hình của phiên'], kind: 'answer', main: lead('haiku', 'low') }), 'p', 1, { sessionFamily: 'opus' })
    expect(out.brief.main?.family).toBe('opus')
    expect(out.brief.main?.effort).toBe('low')
  })

  test('tiếp nối: ràng buộc "mọi việc khác dùng model của phiên" cũng nâng main lên model của phiên', () => {
    const prev = makeBrief({ constraints: ['Mọi việc khác dùng model của phiên'], main: { family: 'sonnet', effort: 'medium' } })
    const out = call(prev, routed({ relation: 'continue', goal: '', main: lead('sonnet', 'medium') }), 'tiếp', 2, { sessionFamily: 'opus' })
    expect(out.brief.main?.family).toBe('opus')
  })

  test('không có quy định như vậy, hay chưa biết model của phiên: không đổi gì', () => {
    const none = call(null, routed({ goal: 'x', constraints: ['Đọc dùng model của phiên'], kind: 'answer', main: lead('haiku', 'low') }), 'p', 1, { sessionFamily: 'opus' })
    expect(none.brief.main?.family).toBe('haiku')
    const unknown = call(null, routed({ goal: 'x', constraints: ['Luồng chính dùng mô hình của phiên'], kind: 'answer', main: lead('haiku', 'low') }), 'p', 1, {})
    expect(unknown.brief.main?.family).toBe('haiku')
  })
})

describe('0.7.5 M5: sàn main lấy từ prompt lập mục tiêu', () => {
  test('mainBase ghi main của prompt lập mục tiêu', () => {
    const brief = briefOf(routed({ goal: 'x', main: lead('sonnet', 'medium') }), 'p', 1, 1) as Brief & { mainBase?: unknown }
    expect(brief.mainBase).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('một lượt tiếp nối nâng main lên opus/high không làm sàn của lượt sau: lượt sau router chọn sonnet/medium thì được sonnet/medium', () => {
    let brief = briefOf(routed({ goal: 'x', main: lead('sonnet', 'medium') }), 'p', 1, 1)
    brief = nextBrief(brief, routed({ relation: 'continue', goal: '', main: lead('opus', 'high') }), 'khó', 2).brief
    expect(brief.main).toEqual({ family: 'opus', effort: 'high' })
    brief = nextBrief(brief, routed({ relation: 'continue', goal: '', main: lead('sonnet', 'medium') }), 'nhẹ', 3).brief
    expect(brief.main).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('main không thấp hơn main của prompt lập mục tiêu (sàn A7 vẫn có)', () => {
    const brief = briefOf(routed({ goal: 'x', main: lead('opus', 'high') }), 'p', 1, 1)
    const out = nextBrief(brief, routed({ relation: 'continue', goal: '', main: lead('sonnet', 'low') }), 'nhẹ', 2).brief
    expect(out.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('báo chưa đạt (dissatisfied) nâng main thì mainBase nâng theo; brief cũ không có mainBase dùng main hiện tại làm sàn', () => {
    const brief = briefOf(routed({ goal: 'x', main: lead('sonnet', 'medium') }), 'p', 1, 1)
    const up = nextBrief(brief, routed({ relation: 'dissatisfied', goal: '', main: lead('opus', 'high') }), 'sai rồi', 2).brief as Brief & { mainBase?: unknown }
    expect(up.mainBase).toEqual({ family: 'opus', effort: 'high' })
    const old = makeBrief({ main: { family: 'opus', effort: 'high' } })
    expect(nextBrief(old, routed({ relation: 'continue', goal: '', main: lead('sonnet', 'low') }), 'nhẹ', 2).brief.main).toEqual({ family: 'opus', effort: 'high' })
  })
})

describe('0.7.5 M5: qua hook và trạng thái lưu', () => {
  test('normalizeCore giữ mainBase', () => {
    const brief = normalizeCore({ brief: makeBrief({ mainBase: { family: 'sonnet', effort: 'medium' } }) }).brief
    expect(brief?.mainBase).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('phiên chạy opus, quy định "luồng chính dùng mô hình của phiên", router chọn haiku: prompt đầu chạy opus', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Trả lời câu hỏi', kind: 'answer', depth: 'none', constraints: ['Luồng chính dùng mô hình của phiên'], main: lead('haiku', 'low') }) })
    on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
    await submit($, 'Trả lời câu hỏi này, luồng chính dùng mô hình của phiên')
    expect(seen.contexts[0]?.join('\n')).toContain('Điều phối: luồng chính opus/')
  })
})
