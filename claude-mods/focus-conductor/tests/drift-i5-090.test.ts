// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 5, 6, 9: ba dạng bộ phân loại lệnh cho qua sai. make đệ quy hay `make -C` không làm gì (có dòng
// Entering, Leaving directory) vẫn được tính đạt; `npm test -- -u` cập nhật snapshot qua script test nhưng vẫn là lệnh kiểm; `set -e` (và
// `set -o pipefail`) trong subshell, hay sau `||`, `&&`, vẫn bật cho các lệnh sau dù shell không bật.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'
import { ranNothing } from '../hooks/lib/drift/output'

const checkOf = (command: string) => classifyBash(command, '/repo').effects.find(e => e.kind === 'check') as { exit?: string; pipefail?: true } | undefined
const isSelfFix = (command: string) => classifyBash(command, '/repo').effects.some(e => e.kind === 'write') && checkOf(command) === undefined

describe('0.9.0 vòng 2 I5: make đệ quy không làm gì', () => {
  test('make[1] Entering, Nothing to be done, Leaving: không kiểm gì', () => {
    expect(ranNothing("make[1]: Entering directory '/repo/sub'\nmake[1]: Nothing to be done for 'test'.\nmake[1]: Leaving directory '/repo/sub'")).toBe(true)
  })
  test('make -C: Entering, is up to date, Leaving: không kiểm gì', () => {
    expect(ranNothing("make: Entering directory '/r'\nmake: 'all' is up to date.\nmake: Leaving directory '/r'")).toBe(true)
  })
  test('đối chứng: Entering, Leaving kèm output của test: không phải không kiểm gì', () => {
    expect(ranNothing("make: Entering directory '/r'\n12 passed\nmake: Leaving directory '/r'")).toBe(false)
  })
})

describe('0.9.0 vòng 2 I5: cập nhật snapshot qua script test', () => {
  for (const command of ['npm test -- -u', 'pnpm test -- -u', 'yarn test -u', 'npm run test -- --updateSnapshot', 'bun test -u', 'bun test --update-snapshots']) {
    test(`tự sửa, không là lệnh kiểm: ${command}`, () => {
      expect(isSelfFix(command)).toBe(true)
    })
  }
  test('đối chứng: npm test, yarn test --watchAll=false vẫn là lệnh kiểm', () => {
    expect(checkOf('npm test')).toBeDefined()
    expect(checkOf('yarn test --watchAll=false')).toBeDefined()
  })
})

describe('0.9.0 vòng 2 I5: set trong subshell hay sau toán tử điều kiện', () => {
  for (const command of ['( set -e ); npm test; echo xong', '( a; set -e; b ); npm test; echo xong', 'true || set -e; npm test; echo xong', 'false && set -e; npm test; echo xong']) {
    test(`errexit không bật: ${command}`, () => {
      expect(checkOf(command)?.exit).toBe('hidden')
    })
  }
  test('pipefail trong subshell không bật: ( set -o pipefail ); npm test | tail -1', () => {
    expect(checkOf('( set -o pipefail ); npm test | tail -1')?.pipefail).toBeUndefined()
  })
  test('đối chứng: set -e; npm test; echo xong vẫn bật errexit', () => {
    expect(checkOf('set -e; npm test; echo xong')?.exit).toBe('visible')
  })
})
