// 0.7.1: danh sách việc phản chiếu (TaskCreate, TaskUpdate, TodoWrite) cũng được mod tự nâng thành verified khi lệnh test chạy đạt
// sau thay đổi cuối, và hạ về done khi có thay đổi mới. Chỉ khi tool plan chưa có bước (tool plan luôn thắng) và danh sách thuộc
// mục tiêu hiện tại. Danh sách phản chiếu vẫn chỉ để theo dõi: cổng và lời nhắc không đọc nó.

import { describe, expect, test } from 'claude-code/testing'
import type { Core, MirrorStep, PlanStep } from '../types'
import * as S from '../hooks/lib/state'
import { shownPlan } from '../hooks/lib/mirror'
import { makeBrief } from './support/commands'

const m = (key: string, status: MirrorStep['status']): MirrorStep => ({ key, title: `việc ${key}`, status })
const planStep = (id: number, status: PlanStep['status']): PlanStep => ({ id, title: `bước ${id}`, status })
const coreOf = (over: Partial<Core> & { steps?: MirrorStep[]; mirrorGoal?: number }): Core => {
  const { steps = [], mirrorGoal = 1, ...rest } = over
  return { ...S.normalizeCore({}), brief: makeBrief({ goalId: 1 }), mirror: { goalId: mirrorGoal, steps }, ...rest }
}
const statuses = (c: Core) => c.mirror.steps.map(s => s.status)

describe('0.7.1: withAutoVerified nâng danh sách phản chiếu', () => {
  test('plan rỗng, mirror của mục tiêu hiện tại: mọi bước done thành verified, bước chưa đóng giữ nguyên', () => {
    const next = S.withAutoVerified('npm test')(coreOf({ steps: [m('1', 'done'), m('2', 'doing'), m('3', 'done'), m('4', 'todo')] }))
    expect(statuses(next)).toEqual(['verified', 'doing', 'verified', 'todo'])
  })

  test('không có bước done nào ở cả plan lẫn mirror: không đổi gì', () => {
    const core = coreOf({ steps: [m('1', 'doing'), m('2', 'todo')] })
    expect(S.withAutoVerified('npm test')(core)).toEqual(core)
  })

  test('tool plan đã có bước: mirror cũ còn trong state không bị nâng, bước plan được nâng như cũ', () => {
    const next = S.withAutoVerified('npm test')(coreOf({ steps: [m('1', 'done')], plan: [planStep(1, 'done')] }))
    expect(statuses(next)).toEqual(['done'])
    expect(next.plan[0]).toMatchObject({ status: 'verified', auto: true })
  })

  test('mirror của mục tiêu khác (goalId lệch) không bị nâng', () => {
    const next = S.withAutoVerified('npm test')(coreOf({ steps: [m('1', 'done')], mirrorGoal: 7 }))
    expect(statuses(next)).toEqual(['done'])
  })

  test('chưa có mục tiêu (brief null): không nâng mirror', () => {
    const next = S.withAutoVerified('npm test')({ ...coreOf({ steps: [m('1', 'done')] }), brief: null })
    expect(statuses(next)).toEqual(['done'])
  })

  test('tham số only chỉ áp cho bước của plan, không đụng mirror', () => {
    const next = S.withAutoVerified('npm test', [1])(coreOf({ steps: [m('1', 'done')] }))
    expect(statuses(next)).toEqual(['done'])
  })
})

describe('0.7.1: withAutoDemoted hạ danh sách phản chiếu', () => {
  test('plan rỗng: bước verified của mirror về done, bước khác giữ nguyên', () => {
    const next = S.withAutoDemoted(coreOf({ steps: [m('1', 'verified'), m('2', 'done'), m('3', 'doing')] }))
    expect(statuses(next)).toEqual(['done', 'done', 'doing'])
  })

  test('tool plan đã có bước: mirror cũ không bị hạ', () => {
    const next = S.withAutoDemoted(coreOf({ steps: [m('1', 'verified')], plan: [planStep(1, 'todo')] }))
    expect(statuses(next)).toEqual(['verified'])
  })

  test('mirror của mục tiêu khác không bị hạ', () => {
    expect(statuses(S.withAutoDemoted(coreOf({ steps: [m('1', 'verified')], mirrorGoal: 7 })))).toEqual(['verified'])
  })

  test('không có bước nào cần hạ ở cả plan lẫn mirror: không đổi gì', () => {
    const core = coreOf({ steps: [m('1', 'done')] })
    expect(S.withAutoDemoted(core)).toEqual(core)
  })

  test('bước plan mang dấu auto vẫn được hạ như 0.7.0', () => {
    const next = S.withAutoDemoted(coreOf({ plan: [{ ...planStep(1, 'verified'), auto: true }] }))
    expect(next.plan[0]).toMatchObject({ status: 'done' })
  })
})

describe('0.7.1: hiển thị và lưu trạng thái', () => {
  test('shownPlan giữ nguyên trạng thái verified của danh sách phản chiếu', () => {
    const shown = shownPlan(coreOf({ steps: [m('1', 'verified'), m('2', 'done')] }))
    expect(shown.source).toBe('mirror')
    expect(shown.plan.map(s => s.status)).toEqual(['verified', 'done'])
  })

  test('normalizeCore giữ bước verified của mirror khi đọc lại', () => {
    expect(statuses(S.normalizeCore(coreOf({ steps: [m('1', 'verified')] })))).toEqual(['verified'])
  })
})
