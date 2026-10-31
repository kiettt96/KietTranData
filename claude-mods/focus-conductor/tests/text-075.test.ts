// 0.7.5 A8: lời dặn và câu nhắc về kiểm tra không đẩy Claude tạo test mới: kiểm theo cách người dùng quy định (lệnh kiểm có
// sẵn, đọc lại kết quả), không tạo test hay script kiểm mới nếu không được yêu cầu; không còn tên lệnh bịa làm ví dụ.

import { describe, expect, test } from 'claude-code/testing'
import { DISCIPLINE, staticOnlyNotice, unbackedNotice } from '../hooks/lib/text'

const USER_WAY = 'theo cách người dùng quy định'
const NO_NEW = 'không tạo test hay script kiểm mới nếu người dùng không yêu cầu'

describe('0.7.5 A8: DISCIPLINE mục 4', () => {
  test('kiểm theo cách người dùng quy định, không tạo test hay script kiểm mới', () => {
    const item = DISCIPLINE.split('\n').find(line => line.startsWith('4. ')) ?? ''
    expect(item).toContain(USER_WAY)
    expect(item).toContain(NO_NEW)
    expect(item).not.toContain('(chạy test, type-check, đọc lại thay đổi)')
  })
})

describe('0.7.5 A8: câu nhắc khi verified chưa đủ bằng chứng', () => {
  test('unbackedNotice: kiểm theo cách người dùng quy định, không bảo chạy lệnh test', () => {
    const text = unbackedNotice('không có lệnh kiểm nào chạy sau thay đổi cuối')
    expect(text).toContain(USER_WAY)
    expect(text).toContain(NO_NEW)
    expect(text).not.toContain('Chạy lệnh test')
  })

  test('không có ví dụ: không có tên lệnh bịa; có ví dụ thì dùng ví dụ đó', () => {
    const none = unbackedNotice('r', [])
    expect(none).toContain('checkCommands')
    expect(none).not.toContain('check_totals')
    expect(none).not.toContain('ví dụ `')
    expect(unbackedNotice('r', ['./scripts/check.sh'])).toContain('ví dụ `./scripts/check.sh`')
  })

  test('staticOnlyNotice: không bảo chạy test, kiểm theo cách người dùng quy định', () => {
    const text = staticOnlyNotice()
    expect(text).toContain('chỉ là kiểm tĩnh')
    expect(text).toContain(USER_WAY)
    expect(text).not.toContain('chạy test tương ứng')
  })
})
