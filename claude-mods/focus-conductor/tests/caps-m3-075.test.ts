// 0.7.5 M3 (vòng sửa 2): ràng buộc (trần 12) và yêu cầu (trần 30) đầy ở prompt tiếp nối: mục mới thay mục ở CUỐI danh sách (ít quan
// trọng nhất) không phải quy định model; không bao giờ bỏ hay thay mục đến từ prompt lập mục tiêu (constraintsBase,
// requirementsBase là số mục đầu của prompt đó); không còn mục thay được thì mục mới bị bỏ. Từ vòng rà soát 3 (R1) mục đó vào phần
// tràn thay vì bị bỏ (xem tests/integration/caps-r1-075.test.ts).

import { describe, expect, test } from 'claude-code/testing'
import { briefOf, nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import type { Brief } from '../types'
import { normalizeCore } from '../hooks/lib/state'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const first = (n: number) => Array.from({ length: n }, (_, i) => `Đầu ${i}`)
const later = (n: number) => Array.from({ length: n }, (_, i) => `Sau ${i}`)
const withBase = (over: Partial<Brief>) => makeBrief(over as Partial<Brief>)

describe('0.7.5 M3: ràng buộc đầy trần', () => {
  test('mục mới thay mục cuối của phần thêm sau, không phải mục cũ nhất; mục của prompt đầu và quy định model còn', () => {
    const constraints = ['Việc lọc tin chạy sonnet', ...first(3), ...later(8)]
    const prev = withBase({ constraints, constraintsBase: 4 } as Partial<Brief>)
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', constraints: ['Không tạo bộ kiểm mới'] }), 'tiếp', 2)
    expect(out.brief.constraints.length).toBe(12)
    expect(out.brief.constraints).toContain('Không tạo bộ kiểm mới')
    expect(out.brief.constraints).toContain('Sau 0')
    expect(out.brief.constraints).not.toContain('Sau 7')
    for (const item of ['Việc lọc tin chạy sonnet', ...first(3)]) expect(out.brief.constraints).toContain(item)
    expect(out.replaced).toEqual(['Sau 7'])
  })

  test('toàn bộ mười hai mục đến từ prompt đầu: không thay, mục mới vào phần tràn (R1)', () => {
    const constraints = [...first(12)]
    const out = nextBrief(withBase({ constraints, constraintsBase: 12 } as Partial<Brief>), routed({ relation: 'continue', goal: '', constraints: ['Mục mới'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual([...constraints, 'Mục mới'])
    expect(out.replaced).toEqual([])
  })

  test('mục lập mục tiêu mới ghi số mục của prompt đầu; prompt tiếp nối giữ số đó', () => {
    const brief = briefOf(routed({ goal: 'Cập nhật', constraints: ['A', 'B', 'C'], requirements: ['R1', 'R2'] }), 'p', 1, 1) as Brief & { constraintsBase?: number; requirementsBase?: number }
    expect(brief.constraintsBase).toBe(3)
    expect(brief.requirementsBase).toBe(2)
    const out = nextBrief(brief, routed({ relation: 'continue', goal: '', constraints: ['D'], requirements: ['R3'] }), 'tiếp', 2).brief as Brief & { constraintsBase?: number; requirementsBase?: number }
    expect(out.constraints).toEqual(['A', 'B', 'C', 'D'])
    expect(out.constraintsBase).toBe(3)
    expect(out.requirementsBase).toBe(2)
  })
})

describe('0.7.5 M3: nguồn gốc của số mục đầu', () => {
  test('brief không ghi số mục đầu (trạng thái cũ): coi mọi mục hiện có là của prompt đầu, mục mới vào phần tràn khi đầy trần (R1)', () => {
    const constraints = [...first(12)]
    const out = nextBrief(makeBrief({ constraints, requirements: ['R1', 'R2'] }), routed({ relation: 'continue', goal: '', constraints: ['Mục mới'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual([...constraints, 'Mục mới'])
    expect((out.brief as Brief & { constraintsBase?: number }).constraintsBase).toBe(12)
    expect((out.brief as Brief & { requirementsBase?: number }).requirementsBase).toBe(2)
  })

  test('mục tiêu mới mang quy định model của mục tiêu trước: số mục đầu gồm cả quy định mang theo', () => {
    const prev = makeBrief({ constraints: ['Việc lọc tin chạy sonnet'], constraintsBase: 1 })
    const out = nextBrief(prev, routed({ relation: 'new', goal: 'Việc khác', constraints: ['A', 'B'] }), 'khác', 2)
    expect(out.brief.constraints).toEqual(['Việc lọc tin chạy sonnet', 'A', 'B'])
    expect((out.brief as Brief & { constraintsBase?: number }).constraintsBase).toBe(3)
  })

  test('chạy thật prompt đã đối chiếu: mọi mục gộp đều thuộc phần không bị thay', () => {
    const prev = makeBrief({ isReference: true, constraints: ['A'], constraintsBase: 1, requirements: ['R1'], requirementsBase: 1 })
    const out = nextBrief(prev, routed({ relation: 'new', runReference: true, goal: 'Chạy', constraints: ['B'], requirements: ['R2'] }), 'chạy đi', 2).brief as Brief & { constraintsBase?: number; requirementsBase?: number }
    expect(out.constraints).toEqual(['A', 'B'])
    expect(out.constraintsBase).toBe(2)
    expect(out.requirementsBase).toBe(2)
  })
})

describe('0.7.5 M3: yêu cầu đầy trần', () => {
  const requirements = Array.from({ length: 30 }, (_, i) => `Yêu cầu ${i + 1}`)
  const task = { index: 1, title: 'Việc 1', run: 'main' as const, pick: { family: 'sonnet' as const, effort: 'medium' as const }, depth: 'light' as const, volume: 'small' as const, kind: 'edit' as const, why: '' }

  test('yêu cầu mới thay tại chỗ yêu cầu cuối của phần thêm sau; yêu cầu đầu danh sách giữ nguyên số thứ tự', () => {
    const prev = withBase({ requirements, requirementsBase: 10, tasks: [{ ...task, covers: [1, 30] }] } as Partial<Brief>)
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', requirements: ['Yêu cầu mới'], tasks: [{ title: 'Việc mới', run: 'main', model: 'sonnet', effort: 'medium', kind: 'edit', covers: [1] }] }), 'tiếp', 2)
    expect(out.brief.requirements?.length).toBe(30)
    expect(out.brief.requirements?.[0]).toBe('Yêu cầu 1')
    expect(out.brief.requirements?.[29]).toBe('Yêu cầu mới')
    expect(out.brief.tasks[0]?.covers).toEqual([1])
    expect(out.brief.tasks[1]?.covers).toEqual([30])
    expect(out.replaced).toEqual(['Yêu cầu 30'])
  })

  test('mọi yêu cầu cũ đến từ prompt đầu: yêu cầu mới vào phần tràn (R1)', () => {
    const out = nextBrief(withBase({ requirements, requirementsBase: 30 } as Partial<Brief>), routed({ relation: 'continue', goal: '', requirements: ['Yêu cầu mới'] }), 'tiếp', 2)
    expect(out.brief.requirements).toEqual([...requirements, 'Yêu cầu mới'])
    expect(out.replaced).toEqual([])
  })
})

describe('0.7.5 M3: trạng thái lưu giữ số mục của prompt đầu', () => {
  test('normalizeCore giữ constraintsBase và requirementsBase', () => {
    const brief = normalizeCore({ brief: makeBrief({ constraints: ['A'], constraintsBase: 1, requirements: ['R'], requirementsBase: 1 }) }).brief
    expect(brief?.constraintsBase).toBe(1)
    expect(brief?.requirementsBase).toBe(1)
    expect(normalizeCore({ brief: makeBrief() }).brief?.constraintsBase).toBeUndefined()
  })
})
