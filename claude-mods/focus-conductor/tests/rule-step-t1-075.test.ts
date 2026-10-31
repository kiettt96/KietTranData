// 0.7.5 T1 (vòng rà soát 5): vế ghi đè nêu mã bước ("Riêng BƯỚC 3 dùng opus") so từ khóa ngoại lệ trên description còn nguyên nhãn
// "BƯỚC N:", theo từ trọn vẹn và liền nhau, nên "BƯỚC 3: lọc tin lô 1" không chốt sonnet còn "BƯỚC 4:", "BƯỚC 30:" vẫn chốt.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

const RULE = ['Lọc tin dùng sonnet. Riêng BƯỚC 3 dùng opus']

describe('0.7.5 T1: ghi đè theo mã bước', () => {
  test('"BƯỚC 3: lọc tin lô 1" không chốt sonnet', () => {
    expect(ruleFamily(RULE, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
  })

  test('"BƯỚC 4: lọc tin lô 1" chốt sonnet', () => {
    expect(ruleFamily(RULE, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('"BƯỚC 4: lọc tin lô 3" chốt sonnet: "BƯỚC" và "3" không liền nhau', () => {
    expect(ruleFamily(RULE, 'BƯỚC 4: lọc tin lô 3', null)).toBe('sonnet')
  })

  test('"BƯỚC 30: lọc tin lô 1" chốt sonnet: "30" không phải "3"', () => {
    expect(ruleFamily(RULE, 'BƯỚC 30: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('không dấu: "Buoc 3: loc tin lo 1" không chốt sonnet', () => {
    expect(ruleFamily(RULE, 'Buoc 3: loc tin lo 1', null)).not.toBe('sonnet')
  })
})
