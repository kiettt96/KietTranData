// 0.5.6 hạng mục D: renderPlan chỉ in hàng đổi khi được truyền changed; mọi chỗ gọi cũ giữ nguyên kết quả.

import { describe, expect, test } from 'claude-code/testing'

import type { PlanStep } from '../types'
import { applyPlan } from '../hooks/lib/plan'
import { renderPlan } from '../hooks/lib/text'
import { makeBrief } from './support/commands'

const brief = makeBrief({ goal: 'Dựng pipeline' })
const plan: PlanStep[] = [
  { id: 1, title: 'Một', status: 'done', note: 'đã xong' },
  { id: 2, title: 'Hai', status: 'blocked', note: 'thiếu quyền ghi vào thư mục báo cáo', check: 'số dòng khớp' },
  { id: 3, title: 'Ba', status: 'todo' },
]

describe('0.5.6 D1: tham số changed của renderPlan', () => {
  test('không truyền: in đủ như cũ, kể cả dòng Mục tiêu', () => {
    expect(renderPlan(brief, plan)).toBe(
      'Mục tiêu: Dựng pipeline\nChecklist (1/3 đã đóng, 1 bị chặn):\n[x] 1. Một (đã xong)\n[b] 2. Hai [nghiệm thu: số dòng khớp] (thiếu quyền ghi vào thư mục báo cáo)\n[ ] 3. Ba\nBước tiếp theo: 3. Ba',
    )
  })

  test('truyền changed: bỏ dòng Mục tiêu, chỉ in hàng của bước đổi, giữ dòng tổng và bước tiếp theo', () => {
    const out = renderPlan(brief, plan, [2])
    expect(out).toBe('Checklist (1/3 đã đóng, 1 bị chặn):\n[b] 2. Hai [nghiệm thu: số dòng khớp] (thiếu quyền ghi vào thư mục báo cáo)\nBước tiếp theo: 3. Ba')
    expect(out).not.toContain('Một')
    expect(out).not.toContain('[ ] 3.')
  })

  test('changed nhiều id: in theo thứ tự trong checklist', () => {
    const out = renderPlan(brief, plan, [3, 1])
    expect(out.indexOf('1. Một')).toBeLessThan(out.indexOf('3. Ba'))
    expect(out).not.toContain('2. Hai')
  })

  test('checklist rỗng: giống cũ', () => {
    expect(renderPlan(brief, [], [1])).toBe('Mục tiêu: Dựng pipeline\nChecklist trống.')
  })
})

describe('0.5.6 D2: changed của applyPlan là nguồn id hàng cần in', () => {
  test('update đơn lẻ và add trả đúng id (khớp C9)', () => {
    const upd = applyPlan(plan, { action: 'update', step: 3, status: 'done' })
    expect(upd.changed).toEqual([3])
    const add = applyPlan(plan, { action: 'add', steps: [{ title: 'Bốn' }] })
    expect(renderPlan(brief, add.plan ?? [], add.changed)).toContain('[ ] 4. Bốn')
    expect(renderPlan(brief, add.plan ?? [], add.changed)).not.toContain('1. Một')
  })
})
