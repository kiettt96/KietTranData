// 0.7.9 V8: description "Việc 3c: ..." hay "Việc 3ab: ..." nhắm Việc 3 mà Việc 3 chỉ có phần a, b trong split thì gắn với Việc 3,
// không có part, kèm lý do (miss); trước đó trả {} nên lời gọi bị coi là ngoài kế hoạch. Việc không có split giữ hành vi cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Task } from '../types'
import { taskMatch } from '../hooks/lib/route'

const pick = { family: 'sonnet', effort: 'medium' }
const mk = (index: number, title: string, split?: { part: string; title: string; files: string[] }[]): Task =>
  ({ index, title, run: 'main', pick, depth: 'substantial', volume: 'large', kind: 'edit', ...(split ? { split } : {}) }) as unknown as Task

const tasks: Task[] = [
  mk(1, 'Liệt kê chỗ gọi'),
  mk(2, 'Viết test'),
  mk(3, 'Đổi tên hàm tính phí', [
    { part: 'a', title: 'Module thanh toán', files: ['src/pay'] },
    { part: 'b', title: 'Module kho', files: ['src/stock'] },
  ]),
]

describe('V8: mã phần không có trong split của việc', () => {
  test('1. "Việc 3c" khớp Việc 3, không part, miss nêu mã 3c', () => {
    const out = taskMatch(tasks, 'Việc 3c: đổi tên ở module báo cáo')
    expect(out.task?.index).toBe(3)
    expect(out.part).toBeUndefined()
    expect(out.miss).toContain('3c')
  })

  test('2. "Việc 3ab" khớp Việc 3, không part, miss nêu mã 3ab', () => {
    const out = taskMatch(tasks, 'Việc 3ab: đổi tên hai module')
    expect(out.task?.index).toBe(3)
    expect(out.part).toBeUndefined()
    expect(out.miss).toContain('3ab')
  })

  test('3. "Việc 3a" vẫn là phần a, không miss', () => {
    const out = taskMatch(tasks, 'Việc 3a: đổi tên ở module thanh toán')
    expect(out).toMatchObject({ task: { index: 3 }, part: 'a' })
    expect(out.miss).toBeUndefined()
  })

  test('4. "Việc 31" vẫn không khớp Việc 3', () => {
    expect(taskMatch(tasks, 'Việc 31: việc khác').task?.index).not.toBe(3)
  })

  test('5. việc không có split: "Việc 2x" không khớp Việc 2', () => {
    expect(taskMatch(tasks, 'Việc 2x: gì đó')).toEqual({})
  })
})
