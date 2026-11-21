// 0.9.0 vòng 3 B2: nhãn "Kết luận" hay "Verdict" có từ chen nói điều kiện hay chỉ lượt khác (nếu, trước, cũ, if, previous, prior, earlier,
// old) thì dòng không có kết luận; chữ "khi", "sau" đứng riêng vẫn là nhãn.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3 B2: từ chen điều kiện hay chỉ lượt khác', () => {
  for (const text of ['Kết luận nếu sửa xong: đạt', 'Kết luận của lượt trước: đạt', 'Kết luận lần trước: đạt', 'Kết luận cũ: đạt', 'Verdict if fixed: PASS', 'Verdict of previous round: PASS']) {
    test(`${text}: không là đạt`, () => {
      expect(verdictOf(text)?.verdict).not.toBe('pass')
    })
  }
  const keep: [string, 'pass' | 'fail'][] = [
    ['Kết luận kiểm độc lập: đạt kèm lỗi nhẹ (1 lỗi nhẹ)', 'pass'],
    ['Kết luận tạm thời: đạt', 'pass'],
    ['Kết luận sau khi kiểm lại: đạt', 'pass'],
    ['Kết luận không gian tên: đạt', 'pass'],
    ['Kết luận chung: không đạt', 'fail'],
  ]
  for (const [text, verdict] of keep) {
    test(`${text}: ${verdict === 'pass' ? 'đạt' : 'chưa đạt'} (giữ nguyên)`, () => {
      expect(verdictOf(text)?.verdict).toBe(verdict)
    })
  }
})
