// 0.7.9: ghim mẫu 076-V2e. Từ R1, danh sách toàn cụm chữ đi qua quy tắc riêng nên mất cặp nêu model ở cuối danh sách không còn lộ ra.
// Danh sách lẫn mã và một cụm chữ không thành quy tắc riêng (dưới 2 mục chữ), nên cụm chữ cuối vẫn phải là loại việc của cặp "dùng opus".

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.9: cụm chữ cuối danh sách ghi đè lẫn mã vẫn là loại việc của cặp nêu model', () => {
  test('"Riêng BƯỚC 3 và tin pháp lý dùng opus": việc mở đầu bằng tin pháp lý chốt opus', () => {
    const rules = ['Lọc tin dùng sonnet. Riêng BƯỚC 3 và tin pháp lý dùng opus']
    expect(ruleFamily(rules, 'Tin pháp lý lô 1', null)).toBe('opus')
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).toBeNull()
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).toBeNull()
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
  })
})
