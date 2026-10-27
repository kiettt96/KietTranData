// 0.7.4 điểm 4 (thuần): khối giữ mục tiêu nối vào instructions khi nén và khối nhắc sau nén. Cả hai dựng từ trạng thái lúc
// gọi, dùng chung một hàm cắt gọn: tổng tối đa khoảng 1.500 ký tự, mỗi bước khoảng 100, mỗi yêu cầu khoảng 120 ký tự.

import { describe, expect, test } from 'claude-code/testing'

import type { PlanStep, Task } from '../types'
import { COMPACT_BLOCK_CHARS, compactKeepText, compactReminderText } from '../hooks/lib/text'
import { makeBrief } from './support/commands'

const task = (index: number, covers: number[]): Task => ({ index, title: `Việc ${index}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', covers })
const brief = makeBrief({
  goal: 'Cập nhật dữ liệu theo 11 bước có mã',
  constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'],
  requirements: ['Ghi lô 1', 'Ghi lô 2', 'Báo cáo cuối'],
  tasks: [task(1, [1, 2])],
})
const plan: PlanStep[] = [
  { id: 1, title: 'BƯỚC 0: chuẩn bị', status: 'verified' },
  { id: 2, title: 'BƯỚC 1: ghi lô 1', status: 'doing' },
  { id: 3, title: 'BƯỚC 2: ghi lô 2', status: 'todo' },
]

describe('0.7.4 4: khối nối vào instructions', () => {
  test('giữ mục tiêu, bước còn mở kèm số, ràng buộc (quy định model đứng đầu), yêu cầu chưa phủ', () => {
    const text = compactKeepText(brief, plan)
    expect(text.split('\n')).toEqual([
      '[focus-conductor] Bản tóm tắt phải giữ nguyên các mục sau (mục tiêu và checklist người dùng đang làm):',
      'Mục tiêu: Cập nhật dữ liệu theo 11 bước có mã',
      'Bước còn mở: 2. BƯỚC 1: ghi lô 1; 3. BƯỚC 2: ghi lô 2',
      'Ràng buộc: Việc lọc tin chạy sonnet; Không tạo bộ kiểm mới',
      'Yêu cầu chưa có việc nào phủ: Báo cáo cuối',
    ])
  })

  test('không có ràng buộc, bước mở hay yêu cầu chưa phủ: không có dòng đó', () => {
    expect(compactKeepText(makeBrief({ goal: 'Một việc' }), []).split('\n')).toEqual([
      '[focus-conductor] Bản tóm tắt phải giữ nguyên các mục sau (mục tiêu và checklist người dùng đang làm):',
      'Mục tiêu: Một việc',
    ])
  })
})

describe('0.7.4 4: khối nhắc sau nén', () => {
  test('mục tiêu, bước đang làm, bước còn mở, ràng buộc, yêu cầu chưa phủ', () => {
    expect(compactReminderText(brief, plan).split('\n')).toEqual([
      '[focus-conductor] Hội thoại vừa được nén. Làm tiếp đúng mục tiêu và giữ các ràng buộc đã chốt:',
      'Mục tiêu: Cập nhật dữ liệu theo 11 bước có mã',
      'Đang làm: 2. BƯỚC 1: ghi lô 1',
      'Bước còn mở: 2. BƯỚC 1: ghi lô 1; 3. BƯỚC 2: ghi lô 2',
      'Ràng buộc: Việc lọc tin chạy sonnet; Không tạo bộ kiểm mới',
      'Yêu cầu chưa có việc nào phủ: Báo cáo cuối',
    ])
  })

  test('không có bước doing: bước đang làm là bước todo đầu tiên; tối đa 10 bước còn mở', () => {
    const many: PlanStep[] = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, title: `BƯỚC ${i}`, status: 'todo' as const }))
    const lines = compactReminderText(brief, many).split('\n')
    expect(lines).toContain('Đang làm: 1. BƯỚC 0')
    const open = lines.find(line => line.startsWith('Bước còn mở: ')) ?? ''
    expect(open.split('; ').length).toBe(10)
    expect(open.endsWith('10. BƯỚC 9 (và 4 bước khác)')).toBe(true)
  })
})

describe('0.7.4 4: trần độ dài chung', () => {
  const long = (label: string, n: number) => `${label} ${n} ${'x'.repeat(300)}`
  const big = makeBrief({
    goal: long('Mục tiêu', 0),
    constraints: Array.from({ length: 6 }, (_, i) => long('Ràng buộc', i)),
    requirements: Array.from({ length: 40 }, (_, i) => long('Yêu cầu', i)),
    tasks: [task(1, [1])],
  })
  const steps: PlanStep[] = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: long('Bước', i), status: i === 0 ? 'doing' : 'todo' }))

  test('20 bước dài và 40 yêu cầu dài: cả hai khối không vượt trần, mục tiêu và bước đang làm còn', () => {
    for (const text of [compactKeepText(big, steps), compactReminderText(big, steps)]) {
      expect(text.length).toBeLessThanOrEqual(COMPACT_BLOCK_CHARS)
      expect(text).toContain('Mục tiêu: Mục tiêu 0')
      expect(text).toContain('1. Bước 0')
    }
    expect(COMPACT_BLOCK_CHARS).toBe(1500)
  })

  test('mỗi bước tối đa khoảng 100 ký tự, mỗi yêu cầu khoảng 120 ký tự', () => {
    const text = compactReminderText(big, steps)
    const open = (text.split('\n').find(line => line.startsWith('Bước còn mở: ')) ?? '').slice('Bước còn mở: '.length)
    // Mục cuối có thể kèm "(và N bước khác)": bỏ phần đó trước khi đo một bước.
    for (const item of open.split('; ')) expect(item.replace(/ \(và \d+ bước khác\)$/, '').length).toBeLessThanOrEqual(110)
    const keep = compactKeepText({ ...big, constraints: [] }, [])
    const reqs = (keep.split('\n').find(line => line.startsWith('Yêu cầu chưa có việc nào phủ: ')) ?? '').slice('Yêu cầu chưa có việc nào phủ: '.length)
    expect(reqs.length).toBeGreaterThan(0)
    for (const item of reqs.split('; ')) expect(item.replace(/ \(và \d+ yêu cầu khác\)$/, '').length).toBeLessThanOrEqual(130)
  })
})
