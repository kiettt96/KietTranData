// 0.6.1, thanh tiến độ 2.1: hàm thuần phản chiếu danh sách việc của Claude Code (hooks/lib/mirror.ts).

import { describe, expect, test } from 'claude-code/testing'
import type { Core, MirrorStep } from '../types'
import { MIRROR_LIMIT, applyTaskTool, mirrorPlan, mirrorStatus, shownPlan } from '../hooks/lib/mirror'
import * as S from '../hooks/lib/state'

const steps: MirrorStep[] = [
  { key: '1', title: 'Đọc', status: 'done' },
  { key: '2', title: 'Sửa', status: 'todo' },
]

describe('0.6.1 2.1: applyTaskTool', () => {
  test('mirrorStatus: ba trạng thái của Claude Code, giá trị lạ là null, không bao giờ verified', () => {
    expect(mirrorStatus('pending')).toBe('todo')
    expect(mirrorStatus('in_progress')).toBe('doing')
    expect(mirrorStatus('completed')).toBe('done')
    expect(mirrorStatus('verified')).toBeNull()
    expect(mirrorStatus(undefined)).toBeNull()
  })

  test('TodoWrite: dùng newTodos của kết quả; không có thì dùng đầu vào; bỏ mục rỗng hoặc trạng thái lạ', () => {
    const fromResult = applyTaskTool([], 'TodoWrite', { todos: [] }, { newTodos: [{ content: 'A', status: 'in_progress' }, { content: '', status: 'pending' }, { content: 'B', status: 'weird' }] })
    expect(fromResult).toEqual([{ key: 'todo-1', title: 'A', status: 'doing' }])
    const fromInput = applyTaskTool(steps, 'TodoWrite', { todos: [{ content: 'X', status: 'completed' }, { content: 'Y', status: 'pending' }] }, {})
    expect(fromInput?.map(s => `${s.key}:${s.title}:${s.status}`)).toEqual(['todo-1:X:done', 'todo-2:Y:todo'])
    expect(applyTaskTool(steps, 'TodoWrite', {}, {})).toBeNull()
  })

  test('TaskCreate: thêm bước theo id của kết quả, cùng id thì thay; thiếu id hay tên thì không đổi', () => {
    expect(applyTaskTool(steps, 'TaskCreate', { subject: 'Kiểm' }, { task: { id: '3', subject: 'Kiểm' } })?.map(s => s.key)).toEqual(['1', '2', '3'])
    expect(applyTaskTool(steps, 'TaskCreate', { subject: 'Đọc lại' }, { task: { id: '1', subject: 'Đọc lại' } })?.map(s => s.title)).toEqual(['Sửa', 'Đọc lại'])
    expect(applyTaskTool(steps, 'TaskCreate', { subject: 'Z' }, { task: {} })).toBeNull()
    expect(applyTaskTool(steps, 'TaskCreate', {}, { task: { id: '9', subject: '' } })).toBeNull()
  })

  test('TaskUpdate: đổi trạng thái và tên theo taskId; deleted bỏ bước; success false, id lạ hay không đổi gì thì null', () => {
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true })?.[1]?.status).toBe('doing')
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '2', subject: 'Sửa lỗi' }, { success: true })?.[1]).toEqual({ key: '2', title: 'Sửa lỗi', status: 'todo' })
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '1', status: 'deleted' }, { success: true })?.map(s => s.key)).toEqual(['2'])
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: false })).toBeNull()
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '7', status: 'completed' }, { success: true })).toBeNull()
    expect(applyTaskTool(steps, 'TaskUpdate', { taskId: '2', owner: 'x' }, { success: true })).toBeNull()
  })

  test(`tối đa ${MIRROR_LIMIT} bước`, () => {
    const many = Array.from({ length: MIRROR_LIMIT + 5 }, (_, i) => ({ content: `B${i}`, status: 'pending' }))
    expect(applyTaskTool([], 'TodoWrite', { todos: many }, {})?.length).toBe(MIRROR_LIMIT)
  })

  test('tool khác: null', () => {
    expect(applyTaskTool(steps, 'TaskList', {}, {})).toBeNull()
  })
})

describe('0.6.1 2.1: shownPlan', () => {
  const brief = { goalId: 4, goal: 'g' } as unknown as Core['brief']
  test('checklist của tool plan thắng; phản chiếu chỉ dùng khi plan rỗng và cùng mục tiêu', () => {
    const base = S.normalizeCore({ brief, mirror: { goalId: 4, steps } })
    expect(shownPlan(base)).toEqual({ plan: mirrorPlan(steps), source: 'mirror' })
    expect(shownPlan({ ...base, plan: [{ id: 1, title: 'P', status: 'todo' }] }).source).toBe('plan')
    expect(shownPlan({ ...base, mirror: { goalId: 3, steps } })).toEqual({ plan: [], source: null })
    expect(shownPlan({ ...base, brief: null }).source).toBeNull()
    expect(mirrorPlan(steps).map(s => s.id)).toEqual([1, 2])
  })

  test('trạng thái từ bản cũ không có mirror: mặc định rỗng; mục tiêu mới xóa phản chiếu', () => {
    expect(S.normalizeCore({}).mirror).toEqual({ goalId: -1, steps: [] })
    const next = S.adoptGoal({ ...(brief as object), goalId: 5 } as never)(S.normalizeCore({ brief, mirror: { goalId: 4, steps } }))
    expect(next.mirror).toEqual({ goalId: 5, steps: [] })
  })
})
