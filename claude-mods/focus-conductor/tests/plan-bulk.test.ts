// 0.5.6 hạng mục C: cập nhật hàng loạt qua ids hoặc allOpen (hàm thuần applyPlan và kết quả tool).

import { describe, expect, test } from 'claude-code/testing'

import type { PlanStep, StepStatus } from '../types'
import { applyPlan } from '../hooks/lib/plan'

const planOf = (...statuses: StepStatus[]): PlanStep[] => statuses.map((status, i) => ({ id: i + 1, title: `Bước ${i + 1}`, status }))
const statusesOf = (plan: readonly PlanStep[] | undefined) => (plan ?? []).map(s => s.status)

describe('0.5.6 C1: chọn đúng một trong step, ids, allOpen', () => {
  test('thiếu cả ba: lỗi nêu rõ', () => {
    expect(applyPlan(planOf('todo'), { action: 'update', status: 'waiting', note: 'x' }).error).toContain('đúng một trong step, ids hoặc allOpen')
  })

  test('thừa: step cùng ids, step cùng allOpen, ids cùng allOpen đều lỗi', () => {
    const plan = planOf('todo', 'todo')
    expect(applyPlan(plan, { action: 'update', step: 1, ids: [1], status: 'waiting', note: 'x' }).error).toContain('chỉ nhận một')
    expect(applyPlan(plan, { action: 'update', step: 1, allOpen: true, status: 'waiting', note: 'x' }).error).toContain('chỉ nhận một')
    expect(applyPlan(plan, { action: 'update', ids: [1], allOpen: true, status: 'waiting', note: 'x' }).error).toContain('chỉ nhận một')
  })

  test('allOpen false không tính là chọn; ids rỗng hay sai kiểu lỗi', () => {
    const plan = planOf('todo')
    expect(applyPlan(plan, { action: 'update', step: 1, allOpen: false, status: 'done' }).error).toBeUndefined()
    expect(applyPlan(plan, { action: 'update', ids: [], status: 'waiting', note: 'x' }).error).toContain('ids')
    expect(applyPlan(plan, { action: 'update', ids: ['1'], status: 'waiting', note: 'x' }).error).toContain('ids')
  })

  test('đường đơn lẻ giữ nguyên: id không tồn tại vẫn báo như cũ', () => {
    expect(applyPlan(planOf('todo'), { action: 'update', step: 9, status: 'done' }).error).toContain('Không có bước id 9')
  })
})

describe('0.5.6 C2: allOpen', () => {
  test('chọn mọi bước todo hoặc doing, không đụng bước khác', () => {
    const out = applyPlan(planOf('done', 'todo', 'doing', 'blocked', 'waiting', 'skipped'), { action: 'update', allOpen: true, status: 'waiting', note: 'tạm dừng' })
    expect(out.error).toBeUndefined()
    expect(statusesOf(out.plan)).toEqual(['done', 'waiting', 'waiting', 'blocked', 'waiting', 'skipped'])
    expect(out.changed).toEqual([2, 3])
  })

  test('không có bước mở: lỗi, không im lặng', () => {
    expect(applyPlan(planOf('done', 'waiting'), { action: 'update', allOpen: true, status: 'waiting', note: 'x' }).error).toContain('Không có bước mở nào')
  })
})

describe('0.5.6 C3: trạng thái hợp lệ khi hàng loạt', () => {
  const plan = planOf('todo', 'todo', 'waiting')

  test('waiting, blocked, skipped bắt buộc note dùng chung', () => {
    for (const status of ['waiting', 'blocked', 'skipped'] as const) {
      expect(applyPlan(plan, { action: 'update', ids: [1, 2], status }).error).toContain('cần note')
      const ok = applyPlan(plan, { action: 'update', ids: [1, 2], status, note: 'lý do chung' })
      expect(statusesOf(ok.plan).slice(0, 2)).toEqual([status, status])
      expect(ok.plan?.[1]?.note).toBe('lý do chung')
    }
  })

  test('todo chỉ với ids, không bắt buộc note', () => {
    const ok = applyPlan(plan, { action: 'update', ids: [3], status: 'todo' })
    expect(ok.error).toBeUndefined()
    expect(statusesOf(ok.plan)).toEqual(['todo', 'todo', 'todo'])
    expect(applyPlan(plan, { action: 'update', allOpen: true, status: 'todo' }).error).toContain('allOpen')
  })

  test('doing, done, verified bị từ chối kèm lý do, cho cả ids và allOpen', () => {
    for (const status of ['doing', 'done', 'verified'] as const) {
      expect(applyPlan(plan, { action: 'update', ids: [1], status, note: 'x', evidence: 'x' }).error).toContain(status)
      expect(applyPlan(plan, { action: 'update', allOpen: true, status, note: 'x', evidence: 'x' }).error).toContain(status)
    }
  })

  test('status sai lỗi như cũ', () => {
    expect(applyPlan(plan, { action: 'update', ids: [1], status: 'xyz', note: 'x' }).error).toContain('status phải là')
  })
})

describe('0.5.6 C4: không bao giờ đụng bước đã đóng; tất cả hoặc không gì', () => {
  test('ids có id không tồn tại: lỗi nêu id sai, không đổi bước nào', () => {
    const plan = planOf('todo', 'todo')
    const out = applyPlan(plan, { action: 'update', ids: [1, 7, 9], status: 'waiting', note: 'x' })
    expect(out.error).toContain('7')
    expect(out.error).toContain('9')
    expect(out.plan).toBeUndefined()
  })

  test('ids có bước done, verified hay skipped: lỗi nêu id đó', () => {
    const plan = planOf('todo', 'done', 'verified', 'skipped')
    for (const id of [2, 3, 4]) {
      const out = applyPlan(plan, { action: 'update', ids: [1, id], status: 'blocked', note: 'x' })
      expect(out.error).toContain(`${id}`)
      expect(out.plan).toBeUndefined()
    }
  })

  test('ids có thể đổi bước waiting và blocked sang trạng thái khác; id trùng chỉ tính một lần', () => {
    const out = applyPlan(planOf('waiting', 'blocked'), { action: 'update', ids: [2, 1, 1], status: 'skipped', note: 'bỏ' })
    expect(statusesOf(out.plan)).toEqual(['skipped', 'skipped'])
    expect(out.changed).toEqual([1, 2])
  })
})

describe('0.5.6 C7: note khi chuyển về todo', () => {
  test('todo hàng loạt không kèm note thì xóa note cũ; có note thì ghi note mới', () => {
    const plan: PlanStep[] = [
      { id: 1, title: 'a', status: 'waiting', note: 'chờ lệnh nền' },
      { id: 2, title: 'b', status: 'waiting', note: 'chờ CI' },
    ]
    const cleared = applyPlan(plan, { action: 'update', ids: [1, 2], status: 'todo' })
    expect(cleared.plan?.[0]).not.toHaveProperty('note')
    expect(cleared.plan?.[1]).not.toHaveProperty('note')
    expect(applyPlan(plan, { action: 'update', ids: [1], status: 'todo', note: 'tiếp tục' }).plan?.[0]?.note).toBe('tiếp tục')
  })

  test('cập nhật đơn lẻ giữ hành vi hiện tại: todo không note giữ nguyên note cũ', () => {
    const plan: PlanStep[] = [{ id: 1, title: 'a', status: 'blocked', note: 'cũ' }]
    expect(applyPlan(plan, { action: 'update', step: 1, status: 'todo' }).plan?.[0]?.note).toBe('cũ')
  })
})

describe('0.5.6 C9: changed', () => {
  test('update đơn lẻ và add trả id các bước đã đổi hoặc vừa thêm', () => {
    expect(applyPlan(planOf('todo', 'todo'), { action: 'update', step: 2, status: 'done' }).changed).toEqual([2])
    expect(applyPlan(planOf('todo'), { action: 'add', steps: [{ title: 'x' }, { title: 'y' }] }).changed).toEqual([2, 3])
  })
})

describe('0.5.6 C: ghi chú chung của hàng loạt cắt ở 200 ký tự (mẫu 056-C13)', () => {
  test('note 300 ký tự: lưu vào bước và vào bulk chỉ còn 200', () => {
    const out = applyPlan(planOf('todo', 'todo'), { action: 'update', ids: [1, 2], status: 'waiting', note: 'x'.repeat(300) })
    expect(out.plan?.[0]?.note).toHaveLength(200)
    expect(out.plan?.[1]?.note).toHaveLength(200)
    expect(out.bulk?.note).toHaveLength(200)
  })
})
