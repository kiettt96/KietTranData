// 0.9.0 vòng 3 N8: hai dạng câu kết luận của người duyệt. Nhãn "Kết luận" có tối đa bốn từ chen trước dấu hai chấm là nhãn kết luận; nhãn
// "Kết luận:" đứng ngay sau một dấu kết câu trong cùng dòng cũng được nhận. Nhãn chen từ năm từ trở lên giữ kết quả như trước bản sửa.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3 N8: nhãn Kết luận chen từ và nhãn sau dấu kết câu', () => {
  const cases: [string, 'pass' | 'fail'][] = [
    ['Kết luận kiểm độc lập: đạt kèm lỗi nhẹ (1 lỗi nhẹ)', 'pass'],
    ['Kết luận chung: không đạt', 'fail'],
    ['Không có lỗi. Kết luận: đạt.', 'pass'],
    ['Còn 1 lỗi vừa. Kết luận: không đạt', 'fail'],
    ['Kết luận kiểm độc lập: đạt, còn 1 lỗi nặng', 'fail'],
  ]
  for (const [text, verdict] of cases) {
    test(`${text}: ${verdict === 'pass' ? 'đạt' : 'chưa đạt'}`, () => {
      expect(verdictOf(text)?.verdict).toBe(verdict)
    })
  }

  test('Chưa có kết luận: đạt thì báo sau: không là đạt', () => {
    expect(verdictOf('Chưa có kết luận: đạt thì báo sau')?.verdict).not.toBe('pass')
  })

  test('nhãn chen năm từ trở lên: giữ kết quả như trước bản sửa (không có kết luận)', () => {
    expect(verdictOf('Kết luận của lượt kiểm độc lập này: đạt')).toBeNull()
    expect(verdictOf('Kết luận sau khi chạy lại toàn bộ bộ kiểm: không đạt')).toBeNull()
  })
})
