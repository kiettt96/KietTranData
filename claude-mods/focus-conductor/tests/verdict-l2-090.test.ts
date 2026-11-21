// 0.9.0 vòng 2 L2: dòng kết luận đọc theo họ từ. Họ đạt: pass, passed, passes, passing. Họ chưa đạt: fail, failed, fails, failing, failure.
// Phủ định (not, cannot, can't, doesn't, does not, didn't, did not) đứng ngay trước một từ họ đạt, cách bằng khoảng trắng hay gạch nối,
// cho kết luận chưa đạt. Bốn dạng lấy từ kiểm độc lập trên 3259cd6.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

describe('0.9.0 vòng 2 L2: họ từ kết luận', () => {
  const cases: [string, 'pass' | 'fail'][] = [['passed', 'pass'], ['passes', 'pass'], ['cannot pass', 'fail'], ['not-pass', 'fail']]
  for (const [phrase, verdict] of cases) {
    test(`${phrase}: hoa, thường, có và không có số đếm là ${verdict === 'pass' ? 'đạt' : 'chưa đạt'}`, () => {
      for (const text of [phrase, phrase.toUpperCase(), `${phrase[0]?.toUpperCase()}${phrase.slice(1)}`, `${phrase} 13/13`, `${phrase.toUpperCase()} 13/13`]) {
        expect(verdictOf(text)?.verdict, text).toBe(verdict)
      }
    })
  }
  test('Passes 13/13 giữ số đếm 13/13', () => {
    expect(verdictOf('Passes 13/13')).toEqual({ verdict: 'pass', count: '13/13' })
  })
})
