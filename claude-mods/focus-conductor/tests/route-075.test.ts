// 0.7.5 A3: prompt có mã bước ("BƯỚC 0".."BƯỚC 10"): lời gọi Agent mô tả bằng đúng mã bước của một việc thì khớp việc đó
// (so nguyên số, BƯỚC 1 không khớp BƯỚC 10). "Việc N" vẫn là số thứ tự của việc; prompt không có mã giữ hành vi cũ.

import { describe, expect, test } from 'claude-code/testing'
import { matchTask, taskMatch } from '../hooks/lib/route'
import { DISCIPLINE, briefContext } from '../hooks/lib/text'
import type { Task } from '../types'
import { makeBrief } from './support/commands'

function task(index: number, title: string): Task {
  return { index, title, run: 'agent', agentType: 'general-purpose', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }
}

// Việc thứ k mang mã "BƯỚC k-1" (BƯỚC 0 là việc 1), như prompt 11 bước có mã.
const coded = Array.from({ length: 11 }, (_, i) => task(i + 1, `BƯỚC ${i}: ${i === 7 ? 'lọc tin' : `việc của bước ${i}`}`))

describe('0.7.5 A3: các dạng mã bước', () => {
  test('nhận BƯỚC N, Bước N, Step N (bỏ dấu, không phân biệt hoa thường), mã đứng đầu description', () => {
    expect(matchTask(coded, 'Bước 7 - lô 3')?.index).toBe(8)
    expect(matchTask(coded, 'step 10')?.index).toBe(11)
    expect(matchTask(coded, 'buoc 7 lo 3')?.index).toBe(8)
    expect(matchTask(coded, 'Lọc tin BƯỚC 7')).toBeUndefined()
  })
})

describe('0.7.5 A3: khớp việc theo mã bước', () => {
  test('"BƯỚC 7: lọc tin lô 3" khớp việc mang mã BƯỚC 7, không khớp BƯỚC 6', () => {
    expect(matchTask(coded, 'BƯỚC 7: lọc tin lô 3')?.title).toBe('BƯỚC 7: lọc tin')
    expect(matchTask(coded, 'BƯỚC 7: lọc tin lô 3')?.index).toBe(8)
    expect(matchTask(coded, 'Bước 6: lô 1')?.title).toBe('BƯỚC 6: việc của bước 6')
  })

  test('so nguyên số: BƯỚC 1 không khớp BƯỚC 10 và ngược lại', () => {
    expect(matchTask(coded, 'BƯỚC 1: lô 2')?.title).toBe('BƯỚC 1: việc của bước 1')
    expect(matchTask(coded, 'BƯỚC 10: tổng hợp')?.title).toBe('BƯỚC 10: việc của bước 10')
    expect(matchTask([...coded].reverse(), 'BƯỚC 1: lô 2')?.title).toBe('BƯỚC 1: việc của bước 1')
  })

  test('BƯỚC 0 khớp việc mang mã BƯỚC 0', () => {
    expect(matchTask(coded, 'BƯỚC 0: chuẩn bị dữ liệu')?.index).toBe(1)
  })

  test('mã bước không có việc nào mang: không khớp, có lý do', () => {
    const out = taskMatch(coded, 'BƯỚC 11: thêm')
    expect(out.task).toBeUndefined()
    expect(out.miss).toContain('11')
  })

  test('"Việc N" vẫn là số thứ tự: Việc 8 là việc thứ 8 (mã BƯỚC 7)', () => {
    expect(matchTask(coded, 'Việc 8: lọc tin')?.title).toBe('BƯỚC 7: lọc tin')
  })

  test('prompt không có mã bước: như cũ, "Bước N" không khớp và có lý do cũ', () => {
    const plain = [task(1, 'Tìm chỗ gọi charge'), task(2, 'Đổi tên userId thành accountId')]
    expect(matchTask(plain, 'Bước 2: chạy test')).toBeUndefined()
    expect(taskMatch(plain, 'Bước 2: chạy test')).toEqual({ miss: '"Bước 2" là số bước của checklist, không phải số việc' })
    expect(matchTask(plain, 'Việc 2: đổi tên')?.index).toBe(2)
  })
})

describe('0.7.5 A3: lời dặn về số việc và mã bước', () => {
  test('DISCIPLINE: N của "Việc N" là số thứ tự; việc có mã riêng thì dùng chính mã', () => {
    expect(DISCIPLINE).toContain('N là số thứ tự của việc trong Phân việc')
    expect(DISCIPLINE).toContain('việc mang mã riêng của prompt (như "BƯỚC 7") thì')
  })

  test('mục Phân việc nêu cùng quy ước', () => {
    const text = briefContext(makeBrief({ goal: 'Cập nhật dữ liệu', depth: 'hard', volume: 'large', tasks: [coded[7]!] }), { family: 'opus', effort: 'high' })
    expect(text).toContain('description của Agent mở đầu "Việc N: " với N là số thứ tự của việc; việc mang mã riêng như "BƯỚC 7" thì mở đầu bằng chính mã đó')
  })
})
