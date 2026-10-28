// 0.7.5 M1 (vòng sửa 2): ruleFamily tách ràng buộc theo vế (";" và ","), mỗi vế một cặp loại việc và họ model; loại việc phải khớp
// ở đầu description (sau nhãn "BƯỚC N:" hay "Việc N:") theo từ trọn vẹn, không khớp chuỗi con; "dung" không dấu không còn là từ cắt
// (chỉ "dùng" có dấu).

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.5 M1: mỗi vế một cặp loại việc và họ model', () => {
  const RULE = ['Việc lọc tin chạy sonnet; đúc kết dùng opus']

  test('"Đúc kết lô 3" lấy vế thứ hai; "Lọc tin lô 3" lấy vế đầu', () => {
    expect(ruleFamily(RULE, 'Đúc kết lô 3', null)).toBe('opus')
    expect(ruleFamily(RULE, 'Lọc tin lô 3', null)).toBe('sonnet')
    expect(ruleFamily(['Việc lọc tin chạy sonnet, đúc kết dùng opus'], 'Đúc kết lô 3', null)).toBe('opus')
  })

  test('"Tổng hợp kết quả lọc tin" không lấy vế lọc tin (loại việc không ở đầu description)', () => {
    expect(ruleFamily(RULE, 'Tổng hợp kết quả lọc tin', null)).toBe(null)
  })

  test('nhãn bước và việc đứng đầu description không tính', () => {
    expect(ruleFamily(RULE, 'BƯỚC 3: lọc tin lô 1', null)).toBe('sonnet')
    expect(ruleFamily(RULE, 'Việc 4: Đúc kết lô 2', null)).toBe('opus')
  })

  test('danh sách loại việc nối bằng "/", "và", dấu phẩy dùng chung họ model của vế cuối', () => {
    const rule = ['Lọc tin bằng sonnet; đọc/giải thích/tóm tắt dùng model của phiên']
    expect(ruleFamily(rule, 'Tóm tắt lô 2', 'opus')).toBe('opus')
    expect(ruleFamily(rule, 'Giải thích biến động giá', 'opus')).toBe('opus')
    expect(ruleFamily(['Đọc, giải thích và tóm tắt dùng model của phiên'], 'Đọc tài liệu', 'opus')).toBe('opus')
    expect(ruleFamily(['Đọc, giải thích và tóm tắt dùng model của phiên'], 'Tóm tắt lô 2', 'opus')).toBe('opus')
  })
})

describe('0.7.5 M1: "dung" không dấu và chuỗi con', () => {
  test('"Kết nối API" không khớp quy định "Nội dung bài viết dùng sonnet"', () => {
    expect(ruleFamily(['Nội dung bài viết dùng sonnet'], 'Kết nối API', null)).toBe(null)
    expect(ruleFamily(['Nội dung bài viết dùng sonnet'], 'Nội dung bài viết lô 2', null)).toBe('sonnet')
  })

  test('loại việc ngắn là chuỗi con của một từ khác không khớp', () => {
    expect(ruleFamily(['Việc đọc dùng opus'], 'Đọc tài liệu', null)).toBe('opus')
    expect(ruleFamily(['Việc đọc dùng opus'], 'Đọc', null)).toBe('opus')
    expect(ruleFamily(['Việc lọc dùng opus'], 'Lọc', null)).toBe('opus')
    expect(ruleFamily(['Việc tin dùng opus'], 'Tinh chỉnh bảng giá', null)).toBe(null)
  })

  test('ràng buộc viết không dấu hoàn toàn vẫn đọc được', () => {
    expect(ruleFamily(['Viec loc tin chay sonnet'], 'Loc tin lo 1', null)).toBe('sonnet')
  })
})
