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

import { applyCheckCommands, parseCheckCommands } from '../hooks/lib/drift'
import { strength } from './support/commands'

describe('0.9.0 B10 (phiên thật D1): evidence viết theo dạng check `lệnh => kết quả`', () => {
  test('"bash tests/kiem.sh => TỔNG: ĐẠT" sau lần chạy đạt của lệnh khai: strong, được nhận', () => {
    applyCheckCommands(parseCheckCommands('bash tests/kiem.sh'))
    try {
      const out = strength([['bash tests/kiem.sh', { output: 'K1: ĐẠT\nTỔNG: ĐẠT' }]], 'bash tests/kiem.sh => TỔNG: ĐẠT')
      expect(out.level).toBe('strong')
      expect(out.accepted).toBe(true)
    } finally {
      applyCheckCommands([])
    }
  })
  test('đối chứng: dạng "lệnh: kết quả" vẫn như cũ', () => {
    applyCheckCommands(parseCheckCommands('bash tests/kiem.sh'))
    try {
      expect(strength([['bash tests/kiem.sh', { output: 'TỔNG: ĐẠT' }]], 'bash tests/kiem.sh: TỔNG: ĐẠT').accepted).toBe(true)
    } finally {
      applyCheckCommands([])
    }
  })
})
