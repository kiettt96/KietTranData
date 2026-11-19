// 0.9.0 vòng 2 M9: lệnh cập nhật snapshot và lệnh định dạng tự ghi là thay đổi, không phải lệnh kiểm; output của make chỉ có "Nothing to be
// done" hay "is up to date" là dữ liệu rỗng, không tính là đạt.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'
import { verifiedAfter } from './support/commands'

const SELF_FIX = ['jest -u', 'npx jest --updateSnapshot', 'vitest --update', 'vitest run -u', 'pytest --snapshot-update', 'npx playwright test --update-snapshots', 'go fmt ./...', 'gofmt -w main.go', 'cargo fmt']
// `gofmt -l` vốn không là lệnh kiểm (ghi mức possible, chiều an toàn): giữ như trước, ghi ở mục Giới hạn có chủ đích của DESIGN.
const STILL_CHECK = ['cargo fmt --check', 'jest', 'npx vitest run', 'pytest -q']

describe('0.9.0 vòng 2 M9: lệnh tự sửa và dữ liệu rỗng', () => {
  for (const command of SELF_FIX) {
    test(`${command}: là thay đổi, chạy đạt không nâng verified`, () => {
      const effects = classifyBash(command).effects
      expect(effects.some(e => e.kind === 'check')).toBe(false)
      expect(effects.some(e => e.kind === 'write')).toBe(true)
      expect(verifiedAfter(command, { output: 'Tests: 12 passed, 12 total' })).toBe(false)
    })
  }
  for (const command of STILL_CHECK) {
    test(`${command}: giữ nguyên là lệnh kiểm`, () => {
      expect(classifyBash(command).effects.some(e => e.kind === 'check')).toBe(true)
    })
  }
  test('make check in "Nothing to be done": không tính là đạt', () => {
    expect(verifiedAfter('make check', { output: "make: Nothing to be done for 'check'." })).toBe(false)
  })
  test('make test in "is up to date": không tính là đạt', () => {
    expect(verifiedAfter('make test', { output: "make: 'test' is up to date." })).toBe(false)
  })
})
