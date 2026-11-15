// 0.8.9 vòng 3 E3: ghim ba hành vi của applyArrange (D2) chưa có ca test nào ghim: tiêu đề việc bị gỡ rời brief.steps; prompt chỉ bỏ việc,
// không có order mới thì thứ tự cũ được giữ trừ việc đã gỡ; mục gộp một việc vào chính nó bị bỏ qua cho riêng việc đó. Thêm một ca thuần
// cho rowStatusState (D1): việc làm trực tiếp chưa có bước riêng không tính là xong chỉ vì checklist đóng hết.

import { describe, expect, test } from 'claude-code/testing'
import { rowStatusState } from '../hooks/lib/progress'
import type { TaskRow } from '../hooks/lib/progress'
import { applyArrange } from '../hooks/lib/router'
import type { Arrange, Brief, Task } from '../types'
import { makeBrief } from './support/commands'

const taskOf = (index: number): Task => ({ index, title: `Việc số ${index}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', covers: [index] })
const goal = (count: number, over: Partial<Brief> = {}) =>
  makeBrief({ tasks: Array.from({ length: count }, (_, i) => taskOf(i + 1)), requirements: Array.from({ length: count }, (_, i) => `Yêu cầu ${i + 1}`), steps: Array.from({ length: count }, (_, i) => `Việc số ${i + 1}`), ...over })
const none: Arrange = { order: [], drop: [], merge: [] }
const indexes = (b: Brief) => b.tasks.map(t => t.index)

describe('0.8.9 vòng 3 E3: các hành vi của D2 chưa được ghim', () => {
  test('bỏ việc 2: tiêu đề việc 2 rời brief.steps, các bước khác giữ nguyên', () => {
    const out = applyArrange(goal(4), { ...none, drop: [{ task: 2, why: 'x' }] }, [])
    expect(out.brief.steps).toEqual(['Việc số 1', 'Việc số 3', 'Việc số 4'])
  })

  test('order đã lưu 5, 4, 3, 2, 1; bỏ việc 4 không kèm order: order là 5, 3, 2, 1', () => {
    const out = applyArrange(goal(5, { order: [5, 4, 3, 2, 1] } as Partial<Brief>), { ...none, drop: [{ task: 4, why: 'x' }] }, [])
    expect((out.brief as Brief & { order?: number[] }).order).toEqual([5, 3, 2, 1])
  })

  test('gộp việc 2 và 3 vào việc 2: việc 2 còn nguyên, chỉ việc 3 bị gỡ', () => {
    const out = applyArrange(goal(5), { ...none, merge: [{ tasks: [2, 3], into: 2 }] }, [])
    expect(indexes(out.brief)).toEqual([1, 2, 4, 5])
    expect(out.brief.tasks.find(t => t.index === 2)?.title).toBe('Việc số 2')
    expect((out.brief as Brief & { removed?: Array<{ index: number; into?: number }> }).removed?.map(r => [r.index, r.into])).toEqual([[3, 2]])
    expect(out.arranged?.merged).toEqual([{ tasks: [3], into: 2 }])
  })
})

describe('0.8.9 vòng 3: rowStatusState', () => {
  const row = (over: Partial<TaskRow>): TaskRow => ({ key: 'k', kind: 'direct', index: 2, title: 'Việc số 2', pick: null, bar: { kind: 'state', state: 'done' }, state: 'done', ...over })
  test('việc trực tiếp chưa có bước riêng, checklist đóng hết (dòng ghi xong): tính là chưa bắt đầu', () => {
    expect(rowStatusState(row({}))).toBe('idle')
  })
  test('việc trực tiếp có bước riêng đã xong, việc giao subagent đã xong, và dòng đang chạy: giữ đúng trạng thái của dòng', () => {
    expect(rowStatusState(row({ bar: { kind: 'steps', plan: [{ id: 1, title: 'Việc 2: Việc số 2', status: 'done' }] } }))).toBe('done')
    expect(rowStatusState(row({ kind: 'agent' }))).toBe('done')
    expect(rowStatusState(row({ bar: { kind: 'state', state: 'running' }, state: 'running' }))).toBe('running')
  })
})
