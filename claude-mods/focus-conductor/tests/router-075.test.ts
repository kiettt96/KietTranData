// 0.7.5 A7: prompt tiếp nối: router nhận ràng buộc của mục tiêu trước (quy định model đứng đầu, cắt gọn), và với continue,
// refine thì model luồng chính không thấp hơn lượt trước; dissatisfied và new tính lại như cũ.

import { describe, expect, test } from 'claude-code/testing'
import { followUpOf, parseRoute, routerRequest } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const prev = makeBrief({ goal: 'Cập nhật dữ liệu theo 11 bước', constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'], main: { family: 'opus', effort: 'high' } })

describe('0.7.5 A7: ràng buộc của mục tiêu trước trong request tiếp nối', () => {
  test('request có dòng Previous constraints, quy định model đứng đầu', () => {
    const prompt = routerRequest({ text: 'Làm tiếp BƯỚC 7', prev, ran: 'opus/high', policy: OPEN, model: 'sonnet' }).prompt
    expect(prompt).toContain('Previous constraints')
    expect(prompt).toContain('  - Việc lọc tin chạy sonnet\n  - Không tạo bộ kiểm mới')
  })

  test('nhiều ràng buộc dài: cắt gọn, ràng buộc đầu còn', () => {
    const many = makeBrief({ goal: 'g', constraints: Array.from({ length: 12 }, (_, i) => `Ràng buộc ${i} ${'x'.repeat(200)}`) })
    const prompt = String(routerRequest({ text: 'tiếp', prev: many, ran: null, policy: OPEN, model: 'sonnet' }).prompt)
    const lines = prompt.split('\n').filter(line => line.startsWith('  - Ràng buộc'))
    expect(lines[0]).toContain('Ràng buộc 0')
    expect(lines.join('\n').length).toBeLessThanOrEqual(700)
    expect(lines.length).toBeLessThan(12)
  })

  test('không có mục tiêu trước hay không có ràng buộc: không có dòng đó', () => {
    expect(routerRequest({ text: 'x', prev: null, ran: null, policy: OPEN, model: 'sonnet' }).prompt).not.toContain('Previous constraints')
    expect(routerRequest({ text: 'x', prev: makeBrief({ constraints: [] }), ran: null, policy: OPEN, model: 'sonnet' }).prompt).not.toContain('Previous constraints')
  })
})

describe('0.7.5 A7: sàn model luồng chính của prompt tiếp nối', () => {
  test('continue và refine: router chọn thấp hơn lượt trước thì giữ lượt trước', () => {
    for (const relation of ['continue', 'refine'] as const) {
      const out = followUpOf(prev, routed({ relation, main: { model: 'haiku', effort: 'low' } }), 2)
      expect(out.brief.main, relation).toEqual({ family: 'opus', effort: 'high' })
    }
  })

  test('continue: router nâng thì nhận mức nâng; chỉ hạ effort thì giữ effort trước', () => {
    expect(followUpOf(prev, routed({ relation: 'continue', main: { model: 'opus', effort: 'xhigh' } }), 2).brief.main).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(followUpOf(prev, routed({ relation: 'continue', main: { model: 'opus', effort: 'medium' } }), 2).brief.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('dissatisfied: tính lại theo router', () => {
    expect(followUpOf(prev, routed({ relation: 'dissatisfied', main: { model: 'sonnet', effort: 'medium' } }), 2).brief.main).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('lượt trước không có lựa chọn luồng chính: dùng lựa chọn mới', () => {
    const none = makeBrief({ main: null })
    const fresh = routed({ relation: 'continue', main: { model: 'haiku', effort: 'low' } })
    expect(followUpOf(none, fresh, 2).brief.main).toEqual(fresh.main)
  })
})
