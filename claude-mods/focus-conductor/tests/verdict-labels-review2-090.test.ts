// 0.9.0 vòng 3, kiểm độc lập lần hai lỗi 2: nhãn kết luận có từ chen chứa chữ giống từ phủ định nhưng không phủ định kết luận vẫn là nhãn.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3 kiểm độc lập lần hai lỗi 2: từ chen giống từ phủ định', () => {
  for (const text of ['Kết luận không gian tên: đạt', 'Kết luận về không gian tên: đạt', 'Kết luận phần không đổi: đạt', 'Kết luận không còn lỗi: đạt', 'Verdict with no issues: PASS', 'Kết luận chẳng hạn: đạt', 'Verdict yet again: PASS']) {
    test(`${text}: đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('pass')
    })
  }
})
