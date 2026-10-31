// 0.7.5 T2 (vòng rà soát 5): vế ghi đè (riêng, đặc biệt, nhưng, còn, for ... only) viết thành một mục ràng buộc riêng áp cho quy tắc ở
// các mục khác có cùng loại việc, chỉ khi mục đó nêu model (haiku, sonnet, opus, fable hay "mô hình của phiên"). Mục "Trừ ..." không nêu
// model chỉ áp cho mục quy tắc model đứng ngay trước nó. "Còn lại" không bao giờ là vế ghi đè.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.5 T2: vế ghi đè ở mục ràng buộc riêng', () => {
  test('["Lọc tin dùng sonnet", "Đặc biệt tin pháp lý dùng opus"]: lô pháp lý không chốt sonnet, lô thường chốt sonnet', () => {
    const rules = ['Lọc tin dùng sonnet', 'Đặc biệt tin pháp lý dùng opus']
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('dạng một mục như S3 vẫn đúng', () => {
    const rules = ['Lọc tin dùng sonnet. Đặc biệt tin pháp lý dùng opus']
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('["Lọc tin dùng sonnet", "Riêng BƯỚC 3 dùng opus"]: như T1', () => {
    const rules = ['Lọc tin dùng sonnet', 'Riêng BƯỚC 3 dùng opus']
    expect(ruleFamily(rules, 'BƯỚC 3: lọc tin lô 1', null)).not.toBe('sonnet')
    expect(ruleFamily(rules, 'BƯỚC 4: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('vế ghi đè cho loại việc khác không bỏ chốt: ["Lọc tin dùng sonnet", "Riêng tóm tắt dùng opus"]', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet', 'Riêng tóm tắt dùng opus'], 'Lọc tin tóm tắt lô 1', null)).toBe('sonnet')
  })
})

describe('0.7.5 T2: mục "Trừ ..." không nêu model áp cho mục quy tắc model đứng ngay trước', () => {
  test('["Lọc tin dùng sonnet", "Trừ tin pháp lý"]: lô pháp lý không chốt, lô thường chốt sonnet', () => {
    const rules = ['Lọc tin dùng sonnet', 'Trừ tin pháp lý']
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).toBe(null)
    expect(ruleFamily(rules, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('["Đúc kết dùng opus", "Lọc tin dùng sonnet", "Trừ tin pháp lý"]: chỉ bỏ chốt của lọc tin', () => {
    const rules = ['Đúc kết dùng opus', 'Lọc tin dùng sonnet', 'Trừ tin pháp lý']
    expect(ruleFamily(rules, 'Lọc tin pháp lý lô 1', null)).toBe(null)
    expect(ruleFamily(rules, 'Đúc kết tin pháp lý lô 1', null)).toBe('opus')
  })
})

describe('0.7.5 T2: mục không nêu model và "Còn lại" không phải vế ghi đè', () => {
  test('["Lọc tin dùng sonnet", "Riêng BƯỚC 3 phải có bảng đối chiếu"]: "BƯỚC 3: lọc tin lô 1" vẫn chốt sonnet', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet', 'Riêng BƯỚC 3 phải có bảng đối chiếu'], 'BƯỚC 3: lọc tin lô 1', null)).toBe('sonnet')
  })

  test('["Lọc tin dùng sonnet", "Nhưng giữ nguyên định dạng tin"]: "Lọc tin lô 2" vẫn chốt sonnet', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet', 'Nhưng giữ nguyên định dạng tin'], 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('["Lọc tin dùng sonnet", "Còn lại dùng opus"]: "Lọc tin lô 2" chốt sonnet, cả dạng không dấu', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet', 'Còn lại dùng opus'], 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(['Loc tin dung sonnet', 'Con lai dung opus'], 'Loc tin lo 2', null)).toBe('sonnet')
  })
})
