// 0.7.5 S3 (vòng rà soát 4): vế mở đầu bằng "riêng", "đặc biệt", "nhưng", "còn", "for ... only" là ngoại lệ của vế trước, theo luật ngoại
// lệ của R6: việc có từ khóa của ngoại lệ không chốt theo vế trước; vế ngoại lệ tự có model thì chốt cho việc mở đầu bằng loại việc của
// nó, còn lại để router chấm. Hai model nối bằng "hoặc", "hay", "or" thì không chốt.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily, sessionFloor } from '../hooks/lib/route'

describe('0.7.5 S3: vế ghi đè là ngoại lệ của vế trước', () => {
  const RULE = ['Lọc tin dùng sonnet. Riêng tin pháp lý dùng opus']

  test('"Lọc tin pháp lý lô 1" không chốt sonnet; "Lọc tin lô 2" vẫn chốt sonnet', () => {
    expect(ruleFamily(RULE, 'Lọc tin pháp lý lô 1', null)).toBe(null)
    expect(ruleFamily(RULE, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('vế ngoại lệ tự có model: việc mở đầu bằng loại việc của nó chốt model đó', () => {
    expect(ruleFamily(RULE, 'Tin pháp lý lô 1', null)).toBe('opus')
  })

  test('các dấu hiệu ghi đè: riêng, đặc biệt, nhưng, còn, sau dấu chấm hay dấu phẩy', () => {
    for (const rule of [
      'Lọc tin dùng sonnet, riêng tin pháp lý dùng opus',
      'Lọc tin dùng sonnet. Đặc biệt tin pháp lý dùng opus',
      'Lọc tin dùng sonnet, nhưng tin pháp lý dùng opus',
      'Lọc tin dùng sonnet. Còn tin pháp lý thì dùng opus',
      'Lọc tin dùng sonnet; riêng tin pháp lý để opus chấm',
    ]) {
      expect(ruleFamily([rule], 'Lọc tin pháp lý lô 1', null), rule).toBe(null)
      expect(ruleFamily([rule], 'Lọc tin lô 2', null), rule).toBe('sonnet')
    }
  })

  test('"for ... only" tiếng Anh', () => {
    const rule = ['Lọc tin dùng sonnet. For legal news only, use opus']
    expect(ruleFamily(rule, 'Lọc tin legal news lô 1', null)).toBe(null)
    expect(ruleFamily(rule, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('"còn lại" không phải dấu hiệu ghi đè: "Lọc tin dùng sonnet. Còn lại dùng opus" vẫn chốt lọc tin là sonnet; "còn lại dùng mô hình của phiên" vẫn là sàn', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet. Còn lại dùng opus'], 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(sessionFloor(['Lọc tin dùng sonnet. Còn lại dùng mô hình của phiên'], 'opus')).toBe('opus')
  })
})

describe('0.7.5 S3: hai model nối bằng "hoặc" không chốt', () => {
  test('"Lọc tin dùng sonnet hoặc opus", "hay opus", "or opus": để router chấm', () => {
    for (const rule of ['Lọc tin dùng sonnet hoặc opus', 'Lọc tin dùng sonnet hay opus', 'Lọc tin dùng sonnet or opus']) {
      expect(ruleFamily([rule], 'Lọc tin lô 2', null), rule).toBe(null)
    }
  })

  test('cặp khác trong cùng ràng buộc vẫn chốt: "Lọc tin dùng sonnet hoặc opus; đúc kết dùng opus"', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet hoặc opus; đúc kết dùng opus'], 'Đúc kết lô 3', null)).toBe('opus')
  })

  test('"hoặc" qua dấu phẩy trong cùng vế cũng là lựa chọn; "hoặc" mở đầu câu sau không bỏ cặp của câu trước', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet, hoặc opus'], 'Lọc tin lô 2', null)).toBe(null)
    expect(ruleFamily(['Đúc kết dùng opus; hoặc sonnet cho lọc tin'], 'Đúc kết lô 3', null)).toBe('opus')
  })
})
