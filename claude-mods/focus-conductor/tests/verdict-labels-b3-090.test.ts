// 0.9.0 vòng 3 B3: nhãn có một cụm trong ngoặc đơn ngay trước dấu hai chấm được nhận, cụm đó không tính vào bốn từ chen; nhãn "Final verdict"
// và "Overall verdict" được nhận. Cụm trong ngoặc nói điều kiện thì không là nhãn (B2).

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3 B3: nhãn có cụm trong ngoặc, Final verdict, Overall verdict', () => {
  const cases: [string, 'pass' | 'fail'][] = [
    ['Kết luận kiểm độc lập (lần 2): đạt', 'pass'],
    ['Kết luận (vòng 2): không đạt', 'fail'],
    ['Final verdict: PASS', 'pass'],
    ['Overall verdict: FAIL', 'fail'],
    ['Kết luận kiểm độc lập (lần 2): đạt, còn 1 lỗi nặng', 'fail'],
  ]
  for (const [text, verdict] of cases) {
    test(`${text}: ${verdict === 'pass' ? 'đạt' : 'chưa đạt'}`, () => {
      expect(verdictOf(text)?.verdict).toBe(verdict)
    })
  }

  test('Kết luận (nếu sửa xong): đạt: không là đạt', () => {
    expect(verdictOf('Kết luận (nếu sửa xong): đạt')?.verdict).not.toBe('pass')
  })

  test('nhãn chen năm từ ngoài ngoặc: giữ như trước sửa (không có kết luận)', () => {
    expect(verdictOf('Kết luận của lượt kiểm độc lập này (lần 2): đạt')).toBeNull()
  })
})
