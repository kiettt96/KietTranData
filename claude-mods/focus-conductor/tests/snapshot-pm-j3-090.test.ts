// 0.9.0 vòng 2, kiểm độc lập vòng 2 lỗi 5: cờ cập nhật snapshot đi qua trình quản lý gói khi có cờ đứng trước tên script (`pnpm -r test -u`)
// hay ở dạng có giá trị (`--updateSnapshot=true`) vẫn được tính là lệnh kiểm. Sửa theo quyết định của chủ mod 19/11/2026: cờ cập nhật
// snapshot đi qua npm, pnpm, yarn, bun, kể cả sau `--`, là lệnh tự sửa.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'

const isCheck = (command: string) => classifyBash(command, '/repo').effects.some(e => e.kind === 'check')

describe('0.9.0 vòng 2 J3: cờ cập nhật snapshot qua trình quản lý gói', () => {
  for (const command of ['pnpm -r test -u', 'pnpm -r test -- --updateSnapshot', 'npm test -- --ci --updateSnapshot=true', 'yarn test --updateSnapshot=all', 'pnpm --filter web test -- -u', 'npx jest --updateSnapshot=true']) {
    test(`tự sửa, không là lệnh kiểm: ${command}`, () => {
      expect(isCheck(command)).toBe(false)
    })
  }
  test('đối chứng: pnpm -r test, npm test -- --ci vẫn là lệnh kiểm', () => {
    expect(isCheck('pnpm -r test')).toBe(true)
    expect(isCheck('npm test -- --ci')).toBe(true)
  })
})
