// 0.7.5 D1: lần kiểm đạt chỉ tự nâng verified cho các bước đóng (done) sau lần kiểm đạt trước đó của cùng mục tiêu, cho cả
// checklist plan và danh sách phản chiếu. Lần kiểm đạt đầu tiên của mục tiêu nâng mọi bước done như cũ. Bước verified bị hạ về
// done do thay đổi mới nhận mốc đóng mới, nên lần kiểm đạt sau nâng lại được. Mốc đóng là nội bộ, không có trong schema tool plan.

import { describe, expect, test } from 'claude-code/testing'
import type { Core, MirrorStep, PlanStep } from '../types'
import * as S from '../hooks/lib/state'
import { makeBrief } from './support/commands'

const planStep = (id: number, status: PlanStep['status']): PlanStep => ({ id, title: `bước ${id}`, status })
const m = (key: string, status: MirrorStep['status']): MirrorStep => ({ key, title: `việc ${key}`, status })
const coreOf = (over: Partial<Core> = {}): Core => ({ ...S.normalizeCore({}), brief: makeBrief({ goalId: 1 }), ...over })
/** Một lần kiểm đạt ở luồng chính (lệnh test chạy đạt sau thay đổi cuối). */
const pass = (c: Core): Core => S.withAutoVerified('npm test', undefined, true)(c)
const status = (c: Core, id: number) => c.plan.find(s => s.id === id)?.status
/** Bước done có mốc đóng `seq`, ghi thẳng vào state (không qua withPlan, nên không được đóng dấu lại). */
const closedAt = (c: Core, id: number, seq: number): Core => ({ ...c, plan: [...c.plan, { ...planStep(id, 'done'), closedSeq: seq } as PlanStep] })

describe('0.7.5 D1: lần kiểm đạt đầu tiên của mục tiêu', () => {
  test('nâng mọi bước done như cũ', () => {
    const c = pass(S.withPlan([planStep(1, 'done'), planStep(2, 'doing'), planStep(3, 'done')])(coreOf()))
    expect(c.plan.map(s => s.status)).toEqual(['verified', 'doing', 'verified'])
  })
})

describe('0.7.5 D1: hai lần kiểm đạt cách nhau', () => {
  test('bước đóng giữa hai lần được nâng ở lần thứ hai', () => {
    let c = pass(S.withPlan([planStep(1, 'done'), planStep(2, 'doing')])(coreOf()))
    c = S.withPlan([...c.plan.filter(s => s.id !== 2), planStep(2, 'done')])(c)
    c = pass(c)
    expect(status(c, 1)).toBe('verified')
    expect(status(c, 2)).toBe('verified')
  })

  test('bước đóng trước lần kiểm đạt trước và không bị hạ: không được nâng ở lần sau', () => {
    let c = pass(S.withPlan([planStep(1, 'done')])(coreOf()))
    c = closedAt(c, 2, 0)
    c = pass(c)
    expect(status(c, 2)).toBe('done')
  })

  test('cập nhật plan sau đó (bước khác đổi trạng thái) không làm mới mốc của bước vẫn done', () => {
    let c = pass(S.withPlan([planStep(1, 'done'), planStep(3, 'todo')])(coreOf()))
    c = closedAt(c, 2, 0)
    c = S.withPlan(c.plan.map(s => (s.id === 3 ? { ...s, status: 'doing' as const } : s)))(c)
    c = pass(c)
    expect(status(c, 2)).toBe('done')
  })

  test('lần kiểm đạt của mục tiêu khác không chặn mục tiêu này', () => {
    let c = pass(S.withPlan([planStep(1, 'done')])(coreOf()))
    c = { ...c, brief: makeBrief({ goalId: 2 }), plan: [] }
    c = closedAt(c, 1, 0)
    c = pass(c)
    expect(status(c, 1)).toBe('verified')
  })
})

describe('0.7.5 D1: bước bị hạ do thay đổi mới', () => {
  test('nâng, sửa (hạ), kiểm đạt lại thì nâng lại', () => {
    let c = pass(S.withPlan([planStep(1, 'done')])(coreOf()))
    expect(status(c, 1)).toBe('verified')
    c = S.withAutoDemoted(c)
    expect(status(c, 1)).toBe('done')
    c = pass(c)
    expect(status(c, 1)).toBe('verified')
  })

  test('chưa có lần kiểm đạt mới sau khi hạ: lần nâng khi đóng bước khác không nâng bước đã hạ', () => {
    let c = pass(S.withPlan([planStep(1, 'done'), planStep(2, 'doing')])(coreOf()))
    c = pass(S.withAutoDemoted(c))
    c = S.withAutoDemoted(c)
    c = S.withPlan([c.plan[0]!, planStep(2, 'done')])(c)
    c = S.withAutoVerified('npm test', [2])(c)
    expect(status(c, 1)).toBe('done')
    expect(status(c, 2)).toBe('verified')
  })
})

describe('0.7.5 D1: danh sách phản chiếu', () => {
  test('bước đóng giữa hai lần kiểm đạt được nâng; bước đóng trước và không bị hạ thì không', () => {
    let c = pass(S.withMirror(1, [m('a', 'done'), m('b', 'doing')])(coreOf()))
    expect(c.mirror.steps.map(s => s.status)).toEqual(['verified', 'doing'])
    c = S.withMirror(1, [c.mirror.steps[0]!, m('b', 'done')])(c)
    c = { ...c, mirror: { ...c.mirror, steps: [...c.mirror.steps, { ...m('c', 'done'), closedSeq: 0 } as MirrorStep] } }
    c = pass(c)
    expect(c.mirror.steps.map(s => s.status)).toEqual(['verified', 'verified', 'done'])
  })

  test('hạ rồi kiểm đạt lại thì nâng lại', () => {
    let c = pass(S.withMirror(1, [m('a', 'done')])(coreOf()))
    c = pass(S.withAutoDemoted(c))
    expect(c.mirror.steps.map(s => s.status)).toEqual(['verified'])
  })
})
