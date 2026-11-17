// 0.9.0 B10: lệnh của bước đọc từ trường check: chuỗi trong cặp backtick đầu tiên; không có thì phần trước " => "; không có cả hai thì cả
// chuỗi. Kết quả mong đợi (tùy chọn): phần sau " => ".

import { describe, expect, test } from 'claude-code/testing'
import { stepCheckOf } from '../hooks/lib/drift/stepcheck'

describe('0.9.0 B10: lệnh của bước đọc từ trường check', () => {
  test('backtick, " => ", cả chuỗi, rỗng', () => {
    expect(stepCheckOf('`bun test` => 12 pass')).toEqual({ command: 'bun test', expected: '12 pass' })
    expect(stepCheckOf('`bun test`')).toEqual({ command: 'bun test' })
    expect(stepCheckOf('chạy `bun test` rồi `tsc`')).toEqual({ command: 'bun test' })
    expect(stepCheckOf('bun test => 0 fail')).toEqual({ command: 'bun test', expected: '0 fail' })
    expect(stepCheckOf('bun test')).toEqual({ command: 'bun test' })
    expect(stepCheckOf('  ')).toBeNull()
    expect(stepCheckOf(undefined)).toBeNull()
  })
})
