// 0.9.0 vòng 3, đột biến: "phần lớn", "mostly" ở câu sau của dòng kết luận không làm mất kết luận (chỉ câu đầu của dòng kết luận được xét).
// Bắt mẫu 090-C6zy (xét cả dòng thay vì câu đầu).

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3: câu sau của dòng kết luận là bình luận', () => {
  for (const text of ['ĐẠT. Phần lớn ca đã chạy lại.', 'PASS. Mostly reran.']) {
    test(`${text}: đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('pass')
    })
  }
})
