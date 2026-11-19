// 0.9.0 vòng 2 M2: chuẩn hóa ký tự trước khi đọc dòng kết luận: nháy cong thành nháy thẳng, các loại gạch nối thành `-`, khoảng trắng đặc
// biệt thành khoảng trắng thường. Ba cụm nháy cong lấy từ việc tồn của L2.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 2 M2: chuẩn hóa ký tự của dòng kết luận', () => {
  for (const text of ['Doesn’t pass', 'Didn’t pass', 'Can’t pass']) {
    test(`${text}: chưa đạt`, () => {
      expect(verdictOf(text)?.verdict).toBe('fail')
      expect(verdictOf(text.toUpperCase())?.verdict).toBe('fail')
    })
  }
  test('Not‑pass (gạch nối không ngắt): chưa đạt', () => {
    expect(verdictOf('Not‑pass')?.verdict).toBe('fail')
  })
  test('PASS 13/13 (khoảng trắng không ngắt): đạt, giữ số đếm', () => {
    expect(verdictOf('PASS 13/13')).toEqual({ verdict: 'pass', count: '13/13' })
  })
})
