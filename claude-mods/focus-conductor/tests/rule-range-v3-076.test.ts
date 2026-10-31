// 0.7.6 V3 (bản vá logic của 0.7.5): vế ghi đè dạng khoảng ("Riêng BƯỚC 3 đến BƯỚC 5", "BƯỚC 3-5", "từ BƯỚC 3 tới 5"): mọi mã trong
// khoảng là ngoại lệ; mã ngoài khoảng vẫn chốt theo quy định.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

const FORMS = ['Riêng BƯỚC 3 đến BƯỚC 5 dùng opus', 'Riêng BƯỚC 3-5 dùng opus', 'Riêng từ BƯỚC 3 tới 5 dùng opus']

describe('0.7.6 V3: khoảng mã trong vế ghi đè', () => {
  for (const form of FORMS) {
    test(`"${form}": BƯỚC 3, 4, 5 không chốt sonnet, BƯỚC 6 chốt sonnet`, () => {
      const rules = [`Lọc tin dùng sonnet. ${form}`]
      for (const step of [3, 4, 5]) expect(ruleFamily(rules, `BƯỚC ${step}: lọc tin lô 1`, null), String(step)).not.toBe('sonnet')
      expect(ruleFamily(rules, 'BƯỚC 6: lọc tin lô 1', null)).toBe('sonnet')
      expect(ruleFamily(rules, 'BƯỚC 2: lọc tin lô 1', null)).toBe('sonnet')
    })
  }
})
