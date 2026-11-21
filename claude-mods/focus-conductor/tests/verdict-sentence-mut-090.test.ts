// 0.9.0 vòng 3, đột biến: "phần lớn", "mostly" ở câu sau của dòng kết luận không làm mất kết luận (chỉ câu đầu của dòng kết luận được xét).
// Bắt mẫu 090-C6zy (xét cả dòng thay vì câu đầu). Nhãn chen đúng năm từ không là nhãn (bắt mẫu 090-N8b).

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3: câu sau của dòng kết luận là bình luận', () => {
  for (const text of ['ĐẠT. Phần lớn ca đã chạy lại.', 'PASS. Mostly reran.']) {
    test(`${text}: đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('pass')
    })
  }
})

describe('0.9.0 vòng 3: nhãn chen đúng năm từ', () => {
  test('Kết luận của lượt kiểm độc lập: đạt (năm từ chen): không có kết luận', () => {
    expect(verdictOf('K\u1ebft lu\u1eadn c\u1ee7a l\u01b0\u1ee3t ki\u1ec3m \u0111\u1ed9c l\u1eadp: \u0111\u1ea1t')).toBeNull()
  })
})
