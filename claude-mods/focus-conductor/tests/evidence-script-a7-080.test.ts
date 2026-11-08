// 0.8.0 A7: evidence nhắc đường dẫn script (đoạn đuôi theo ranh giới `/` của đường dẫn đã giải) của lệnh khai là nhắc lệnh kiểm đó. Lệnh không
// khai giữ luật khớp nghiêm; tên file trần chỉ tính khi đúng một lệnh khai mang tên đó.

import { describe, expect, test } from 'claude-code/testing'
import * as drift from '../hooks/lib/drift'
import { strength } from './support/commands'

const RUN_B = '/usr/bin/python3 -B /a/tools/check_b.py'

function declared(commands: string, body: () => void): void {
  drift.applyCheckCommands(drift.parseCheckCommands(commands))
  try {
    body()
  } finally {
    drift.applyCheckCommands([])
  }
}

describe('0.8.0 A7: evidence nhắc đường dẫn script của lệnh khai', () => {
  test('tools/check_b.py: 13/13 với lần chạy đạt sau thay đổi cuối: strong và được nhận verified', () =>
    declared(RUN_B, () => {
      const result = strength([RUN_B], 'tools/check_b.py: 13/13')
      expect(result.level).toBe('strong')
      expect(result.accepted).toBe(true)
    }))
  test('tools/check_b.py ĐẠT 13/13 thoát 0 (không dấu hai chấm): strong', () =>
    declared(RUN_B, () => expect(strength([RUN_B], 'tools/check_b.py ĐẠT 13/13 thoát 0').level).toBe('strong')))
  test('tên file trần khi chỉ một lệnh khai mang tên đó: strong', () =>
    declared(RUN_B, () => expect(strength([RUN_B], 'check_b.py: ok').level).toBe('strong')))
  test('tên file trần khi hai lệnh khai cùng tên file (khác thư mục): không tính', () =>
    declared(`${RUN_B}\n/usr/bin/python3 -B /a/other/check_b.py`, () => {
      const result = strength([RUN_B], 'check_b.py: ok')
      expect(result.accepted).toBe(false)
      expect(result.level).not.toBe('strong')
    }))
  test('ools/check_b.py không khớp (ranh giới /)', () =>
    declared(RUN_B, () => {
      const result = strength([RUN_B], 'ools/check_b.py: ok')
      expect(result.accepted).toBe(false)
      expect(result.level).not.toBe('strong')
    }))
  test('lần chạy lỗi vẫn không strong', () =>
    declared(RUN_B, () => expect(strength([`!${RUN_B}`], 'tools/check_b.py: 13/13').level).toBe('stale')))
  test('lệnh không khai: đường dẫn đuôi không thay lệnh, giữ luật nghiêm', () => {
    const result = strength(['pytest tests/unit'], 'pytest: ok')
    expect(result.level).toBe('stale')
    expect(result.accepted).toBe(false)
    declared(RUN_B, () => {
      const loose = strength(['pytest /a/tests/test_x.py'], 'tests/test_x.py: ok')
      expect(loose.accepted).toBe(false)
      expect(loose.level).not.toBe('strong')
      const other = strength(['/usr/bin/python3 -B /a/tools/check_c.py'], 'tools/check_c.py: ok')
      expect(other.level).not.toBe('strong')
    })
  })
})
