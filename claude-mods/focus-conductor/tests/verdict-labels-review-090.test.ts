// 0.9.0 vòng 3, kiểm độc lập lỗi 2 và 3: nhãn "Kết luận" mà các từ chen có phủ định hay "chưa" ("Kết luận chưa có:", "Verdict not yet
// final:") không là nhãn kết luận; nhãn sau dấu kết câu không bỏ qua mức lỗi cao không bị phủ định ở câu trước trong cùng dòng.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 3 kiểm độc lập lỗi 2: từ chen có phủ định', () => {
  for (const text of ['Kết luận chưa có: đạt thì báo sau', 'Kết luận chưa thể đưa ra: đạt hay không còn chờ', 'Kết luận không phải: đạt', 'Verdict not yet final: PASS pending rerun', 'Verdict cannot be given: PASS or FAIL unknown']) {
    test(`${text}: không là đạt`, () => {
      expect(verdictOf(text)?.verdict).not.toBe('pass')
    })
  }
})

describe('0.9.0 vòng 3 kiểm độc lập lỗi 3: mức lỗi cao ở câu trước nhãn', () => {
  for (const text of ['Còn 1 lỗi nặng chưa sửa. Kết luận: đạt', 'Found 2 critical issues. Verdict: PASS', 'Lỗi nặng: 1. Kết luận: đạt']) {
    test(`${text}: không là đạt`, () => {
      expect(verdictOf(text)?.verdict).not.toBe('pass')
    })
  }
  test('Không có lỗi nặng. Kết luận: đạt: đạt', () => {
    expect(verdictOf('Không có lỗi nặng. Kết luận: đạt')?.verdict).toBe('pass')
  })
})
