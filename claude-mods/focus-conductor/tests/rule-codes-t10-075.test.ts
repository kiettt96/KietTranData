// 0.7.5 T10 (vòng rà soát 5): vế ghi đè liệt kê nhiều mã nối bằng dấu phẩy, "và", "and" thì mọi mã trong danh sách là ngoại lệ, không
// chỉ mã đầu. Vế ghi đè không phải danh sách mã giữ luật cũ.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.5 T10: danh sách mã của vế ghi đè', () => {
  test('"Riêng BƯỚC 3, BƯỚC 5 dùng opus": BƯỚC 3 và BƯỚC 5 không chốt sonnet, BƯỚC 4 chốt sonnet', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng BƯỚC 3, BƯỚC 5 dùng opus']
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 5: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('"Riêng K4 và K6 dùng opus": K4, K6 không chốt sonnet, K5 chốt sonnet', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng K4 và K6 dùng opus']
    expect(ruleFamily(rules, 'K4: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'K6: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'K5: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('danh sách ba mã "Riêng BƯỚC 3, BƯỚC 5 và BƯỚC 7" và nối bằng "and" ("Riêng K4 and K6")', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng BƯỚC 3, BƯỚC 5 và BƯỚC 7 dùng opus']
    for (const step of [3, 5, 7]) expect(ruleFamily(rules, `BƯỚC ${step}: lọc tin lô 1`, null), String(step)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 6: lọc tin lô 1', null)).toBe('sonnet')
    const english = ['Lọc tin dùng sonnet. Riêng K4 and K6 dùng opus']
    expect(ruleFamily(english, 'K6: lọc tin lô 1', null)).not.toBe('sonnet')
  })

  test('dạng ràng buộc riêng ["Lọc tin dùng sonnet", "Riêng BƯỚC 3 và BƯỚC 5 dùng opus"] tương tự', () => {
    const rules = ['Lọc tin dùng sonnet', 'Riêng BƯỚC 3 và BƯỚC 5 dùng opus']
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 5: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('vế ghi đè không phải danh sách mã giữ luật cũ: "Riêng tin pháp lý và tin thuế dùng opus"', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng tin pháp lý và tin thuế dùng opus']
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).toBe('sonnet')
  })
})
