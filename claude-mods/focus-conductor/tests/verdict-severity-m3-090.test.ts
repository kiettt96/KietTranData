// 0.9.0 vòng 2 M3: trong câu đầu của dòng kết luận, sau một từ họ đạt hay họ sẵn sàng, có từ mức lỗi cao không bị phủ định thì là chưa đạt
// (chưa sẵn sàng), không cần từ tương phản. Phủ định: không, không có, không còn, no, none, và số đếm 0 đứng liền từ đó.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 2 M3: mức lỗi cao sau từ đạt', () => {
  for (const text of ['PASS, 1 critical', 'ĐẠT, chặn ở bước 2', 'PASS (2 major issues)']) {
    test(`${text}: chưa đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('fail')
    })
  }
  for (const text of ['PASS, 0 critical', 'PASS, no major issues', 'ĐẠT, không có lỗi lớn', 'ĐẠT kèm lỗi nhẹ', 'PASS. Critical issues were fixed earlier', 'PASS, Critical: 0', 'ĐẠT, Lớn: không']) {
    test(`${text}: đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('pass')
    })
  }
  test('READY, 1 blocker: chưa sẵn sàng', () => {
    expect(verdictOf('READY, 1 blocker')?.verdict).toBe('not-ready')
  })
})
