// 0.7.9 vòng 2: ghim mẫu 078-W4f. Cờ lọc theo tên test (-run, --testNamePattern, -k, -t) làm lần chạy đạt là lệnh hẹp: nó không phủ lần lỗi của cả bộ,
// kể cả khi đường dẫn của nó (./..., gốc) chứa mọi đường dẫn của lần lỗi, nên luật đường dẫn một mình không bắt được.

import { describe, expect, test } from 'claude-code/testing'
import { coversFailure } from '../hooks/lib/drift/evidence'

const covers = (pass: string, fail: string) => coversFailure({ check: 'test', command: pass }, { check: 'test', command: fail })

describe('cờ lọc theo tên: lần đạt không phủ lần lỗi của cả bộ', () => {
  const cases: Array<[string, string]> = [
    ['go test -run TestX ./...', 'go test ./...'],
    ['jest --testNamePattern=x', 'jest'],
    ['pytest -k foo', 'pytest'],
    ['npx vitest run -t x', 'npx vitest run'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt không phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(false))
  }
})
