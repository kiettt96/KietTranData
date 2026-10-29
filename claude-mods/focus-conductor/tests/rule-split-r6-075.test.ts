// 0.7.5 R6 (vòng rà soát 3): ruleFamily tách vế theo ".", ":", ";" và xuống dòng; mỗi model gắn với loại việc gần nhất đứng trước;
// vế ngoại lệ ("trừ", "ngoại trừ", "trừ khi", "except", "unless", theo ranh giới từ) chỉ bỏ chốt cho việc có từ khóa của ngoại lệ;
// "không", "tránh", "đừng", "avoid" chỉ phủ định khi đứng trước tên model trong phạm vi 3 từ.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'

describe('0.7.5 R6: dấu chấm, dấu hai chấm, xuống dòng tách vế', () => {
  const RULE = ['Đọc tri thức: mô hình của phiên. Lọc tin: sonnet.']

  test('"Đọc tri thức lô 3" lấy model của phiên, không lấy sonnet của vế sau; "Lọc tin lô 3" lấy sonnet', () => {
    expect(ruleFamily(RULE, 'Đọc tri thức lô 3', 'opus')).toBe('opus')
    expect(ruleFamily(RULE, 'Lọc tin lô 3', 'opus')).toBe('sonnet')
  })

  test('chưa biết model của phiên: "Đọc tri thức lô 3" không chốt gì (không rơi sang sonnet)', () => {
    expect(ruleFamily(RULE, 'Đọc tri thức lô 3', null)).toBe(null)
    expect(ruleFamily(RULE, 'Lọc tin lô 3', null)).toBe('sonnet')
  })

  test('xuống dòng tách vế như dấu chấm', () => {
    expect(ruleFamily(['Đọc tri thức: mô hình của phiên\nLọc tin: sonnet'], 'Đọc tri thức lô 3', 'opus')).toBe('opus')
    expect(ruleFamily(['Đọc tri thức\nLọc tin dùng sonnet'], 'Lọc tin lô 1', null)).toBe('sonnet')
  })

  test('dấu chấm trong số và tên file không tách vế', () => {
    expect(ruleFamily(['Sửa file a.ts và b.ts dùng opus'], 'Sửa file a.ts', null)).toBe('opus')
    expect(ruleFamily(['Lọc tin 0.5 điểm chạy sonnet'], 'Lọc tin 0.5 điểm lô 1', null)).toBe('sonnet')
  })

  test('đầu vế có nhãn trước dấu hai chấm: "Quy định: lọc tin dùng sonnet"', () => {
    expect(ruleFamily(['Quy định: lọc tin dùng sonnet'], 'Lọc tin lô 1', null)).toBe('sonnet')
  })
})

describe('0.7.5 R6: nhiều cặp trong một vế, mỗi model gắn với loại việc gần nhất đứng trước', () => {
  test('"Lọc tin: sonnet, đọc tri thức: mô hình của phiên"', () => {
    const rule = ['Lọc tin: sonnet, đọc tri thức: mô hình của phiên']
    expect(ruleFamily(rule, 'Lọc tin lô 2', 'opus')).toBe('sonnet')
    expect(ruleFamily(rule, 'Đọc tri thức lô 3', 'opus')).toBe('opus')
    expect(ruleFamily(rule, 'Đọc tri thức lô 3', null)).toBe(null)
  })

  test('hai cặp nối bằng "và" không dấu phẩy', () => {
    const rule = ['Lọc tin dùng sonnet và đọc tri thức dùng opus']
    expect(ruleFamily(rule, 'Lọc tin lô 1', null)).toBe('sonnet')
    expect(ruleFamily(rule, 'Đọc tri thức lô 1', null)).toBe('opus')
  })

  test('danh sách loại việc rồi một model vẫn dùng chung model đó, và không rò sang vế sau', () => {
    const rule = ['Đọc, giải thích dùng opus, lọc tin dùng sonnet']
    expect(ruleFamily(rule, 'Giải thích biến động', null)).toBe('opus')
    expect(ruleFamily(rule, 'Lọc tin lô 1', null)).toBe('sonnet')
  })
})

describe('0.7.5 R6: vế ngoại lệ chỉ bỏ chốt cho việc có từ khóa của ngoại lệ', () => {
  const RULE = ['Lọc tin dùng sonnet trừ khi tin pháp lý thì dùng opus']

  test('"Lọc tin lô 2" vẫn chốt sonnet; "Lọc tin pháp lý lô 1" để router chấm', () => {
    expect(ruleFamily(RULE, 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(RULE, 'Lọc tin pháp lý lô 1', null)).toBe(null)
  })

  test('chỉ có một trong các từ khóa của ngoại lệ thì chưa phải ngoại lệ', () => {
    expect(ruleFamily(RULE, 'Lọc tin pháp luật lô 1', null)).toBe('sonnet')
    expect(ruleFamily(RULE, 'Lọc tin lý do lô 1', null)).toBe('sonnet')
  })

  test('các dấu hiệu ngoại lệ: trừ, ngoại trừ, except, unless', () => {
    for (const rule of ['Lọc tin dùng sonnet, trừ tin pháp lý', 'Lọc tin dùng sonnet, ngoại trừ tin pháp lý', 'Lọc tin dùng sonnet except legal news', 'Lọc tin dùng sonnet unless legal news']) {
      const legal = rule.includes('legal') ? 'Lọc tin legal news lô 1' : 'Lọc tin pháp lý lô 1'
      expect(ruleFamily([rule], legal, null), rule).toBe(null)
      expect(ruleFamily([rule], 'Lọc tin lô 2', null), rule).toBe('sonnet')
    }
  })

  test('dấu hiệu ngoại lệ đứng đầu vế: "Trừ tin pháp lý, lọc tin dùng sonnet"', () => {
    const rule = ['Trừ tin pháp lý, lọc tin dùng sonnet']
    expect(ruleFamily(rule, 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(rule, 'Lọc tin pháp lý lô 1', null)).toBe(null)
  })

  test('"khấu trừ", "cộng trừ" không phải dấu hiệu ngoại lệ; "trừ" không có từ khóa không làm mất chốt', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet, tính thuế sau khấu trừ'], 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(['Lọc tin dùng sonnet, cộng trừ nhân chia'], 'Lọc tin lô 2', null)).toBe('sonnet')
    expect(ruleFamily(['Lọc tin dùng sonnet, tính thuế sau khấu trừ'], 'Lọc tin thuế lô 1', null)).toBe('sonnet')
    expect(ruleFamily(['Lọc tin dùng sonnet, khấu trừ thuế'], 'Lọc tin thuế lô 1', null)).toBe('sonnet')
    expect(ruleFamily(['Lọc tin dùng sonnet, cộng trừ nhân chia'], 'Lọc tin nhân chia lô 1', null)).toBe('sonnet')
  })

  test('vế ngoại lệ dừng ở dấu phẩy: cặp sau dấu phẩy vẫn là quy định', () => {
    const rule = ['Lọc tin dùng sonnet trừ tin pháp lý, đúc kết dùng opus']
    expect(ruleFamily(rule, 'Đúc kết lô 3', null)).toBe('opus')
    expect(ruleFamily(rule, 'Lọc tin pháp lý lô 1', null)).toBe(null)
    expect(ruleFamily(rule, 'Lọc tin lô 2', null)).toBe('sonnet')
  })

  test('ngoại lệ của vế này không làm mất chốt của vế khác', () => {
    const rule = ['Lọc tin dùng sonnet trừ khi tin pháp lý. Đúc kết dùng opus']
    expect(ruleFamily(rule, 'Đúc kết lô 3', null)).toBe('opus')
  })
})

describe('0.7.5 R6: phủ định chỉ tính khi đứng trước tên model trong phạm vi 3 từ', () => {
  test('"Lọc tin dùng sonnet, tránh lỗi định dạng" vẫn chốt sonnet', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet, tránh lỗi định dạng'], 'Lọc tin lô 1', null)).toBe('sonnet')
  })

  test('"Lọc tin dùng sonnet, không dùng haiku" chốt sonnet; vế phủ định không chốt haiku', () => {
    const rule = ['Lọc tin dùng sonnet, không dùng haiku']
    expect(ruleFamily(rule, 'Lọc tin lô 1', null)).toBe('sonnet')
  })

  test('mỗi từ phủ định ngay trước model làm vế đó không phải quy định', () => {
    for (const word of ['không', 'khong', 'đừng', 'cấm', 'chẳng', 'chớ', 'tránh', 'avoid', 'never', 'not', 'no', "don't"]) {
      const rule = `${word} dùng haiku cho việc lọc tin`
      expect(ruleFamily([rule], 'Lọc tin lô 1', null), rule).toBe(null)
      // Chữ phủ định đứng sau từ cắt ("chạy"): loại việc "lọc tin" vẫn khớp, nên chỉ chữ phủ định mới làm vế này không phải quy định.
      expect(ruleFamily([`Việc lọc tin chạy ${word} dùng haiku`], 'Lọc tin lô 1', null), word).toBe(null)
      expect(ruleFamily([`Việc lọc tin chạy haiku, ${word} cho việc sửa file`], 'Lọc tin lô 1', null), word).toBe('haiku')
    }
  })
})

describe('0.7.5 R6: phạm vi đúng 3 từ của phủ định, và vế bị bỏ không để lại loại việc chờ', () => {
  test('phủ định cách model 3 từ tính, cách 4 từ không tính', () => {
    expect(ruleFamily(['Lọc tin không bao giờ dùng haiku'], 'Lọc tin không bao giờ', null)).toBe(null)
    expect(ruleFamily(['Lọc tin không bao giờ được dùng haiku'], 'Lọc tin không bao giờ được', null)).toBe('haiku')
  })

  test('loại việc chờ không rò sang cặp sau: sau cặp đã nêu model, hay sau vế phủ định', () => {
    expect(ruleFamily(['Đọc dùng model của phiên, lọc tin dùng sonnet'], 'Đọc tài liệu', null)).toBe(null)
    expect(ruleFamily(['Đọc, giải thích dùng model của phiên, lọc tin dùng sonnet'], 'Đọc tài liệu', null)).toBe(null)
    expect(ruleFamily(['Đọc, không dùng haiku, lọc tin dùng sonnet'], 'Đọc tài liệu', null)).toBe(null)
  })

  test('nhiều loại việc liền nhau dùng chung một model', () => {
    expect(ruleFamily(['Đọc, giải thích, tóm tắt dùng opus'], 'Đọc tài liệu', null)).toBe('opus')
    expect(ruleFamily(['Đọc, giải thích, tóm tắt dùng opus'], 'Tóm tắt lô 2', null)).toBe('opus')
  })
})
