// 0.7.9 L1 (V7): chuẩn hóa thông điệp lỗi cũng thay đường dẫn tương đối thành `<path>`, để tên tệp của người dùng không nằm trong nhật ký.

import { describe, expect, test } from 'claude-code/testing'
import { normalizeMessage } from '../hooks/lib/errlog'

describe('normalizeMessage: đường dẫn tương đối', () => {
  test('tên tệp trong nháy đơn thành <path>, giữ nháy', () => {
    expect(normalizeMessage("ENOENT: no such file, open 'src/private-client/acme.ts'")).toBe("ENOENT: no such file, open '<path>'")
  })

  test('./a/b và ../x/y thành <path>', () => {
    expect(normalizeMessage('./a/b')).toBe('<path>')
    expect(normalizeMessage('../x/y')).toBe('<path>')
  })

  test('src/x/a.ts thành <path>', () => {
    expect(normalizeMessage('src/x/a.ts')).toBe('<path>')
  })

  test('a/b không đuôi và true/false giữ nguyên', () => {
    expect(normalizeMessage('a/b')).toBe('a/b')
    expect(normalizeMessage('true/false')).toBe('true/false')
  })

  test('tỉ số 1.5/2.0 không phải đường dẫn: vẫn thành <n>/<n>', () => {
    expect(normalizeMessage('ratio 1.5/2.0')).toBe('ratio <n>/<n>')
  })

  test('đường dẫn có số thành <path>, không thành src/v<n>/a<n>.ts', () => {
    expect(normalizeMessage('src/v2/a1.ts')).toBe('<path>')
  })
})
