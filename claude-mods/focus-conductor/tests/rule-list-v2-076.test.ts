// 0.7.6 V2 (bản vá logic của 0.7.5): danh sách trong vế ghi đè. Số trần sau một mã là cùng loại mã ("Riêng BƯỚC 3, 5": BƯỚC 5); phần
// không phải mã trong danh sách vẫn là từ khóa ngoại lệ ("BƯỚC 5 và tin pháp lý"); mỗi mục của danh sách cách nhau dấu phẩy là một ngoại
// lệ riêng ("Riêng tin pháp lý, tin tài chính"). BƯỚC 4 và "Lọc tin lô 2" vẫn chốt sonnet.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.6 V2: danh sách trong vế ghi đè', () => {
  test('"Riêng BƯỚC 3, 5 dùng opus": BƯỚC 3 và BƯỚC 5 không chốt sonnet', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng BƯỚC 3, 5 dùng opus']
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 5: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
    // Thêm ở commit sửa để ghim mẫu đột biến: số trần là mã bước, không phải số 5 bất kỳ trong description.
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 5', null)).toBe('sonnet')
  })

  test('mã ngắn: "Riêng K4, 6 dùng opus" là K4 và K6', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng K4, 6 dùng opus']
    expect(ruleFamily(rules, 'K6: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'K5: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('"Riêng BƯỚC 3, BƯỚC 5 và tin pháp lý dùng opus": tin pháp lý cũng là ngoại lệ', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng BƯỚC 3, BƯỚC 5 và tin pháp lý dùng opus']
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 5: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('"Riêng tin pháp lý, tin tài chính dùng opus": mỗi mục là một ngoại lệ riêng', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng tin pháp lý, tin tài chính dùng opus']
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin tài chính lô 1', null)).not.toBe('sonnet')
    // Mục cuối vẫn là loại việc của cặp nêu model: "Tin tài chính lô 1" chốt opus như trước.
    expect(ruleFamily(rules, 'Tin tài chính lô 1', null)).toBe('opus')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
  })
})
