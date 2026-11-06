// 0.7.9 Y1: giá trị của cờ nhận giá trị (--config, -p, --manifest-path, --timeout...) không phải tệp test, nên không làm lệnh kiểm thành hẹp.

import { describe, expect, test } from 'claude-code/testing'
import { coversFailure, isNarrow } from '../hooks/lib/drift/evidence'

describe('Y1: cờ nhận giá trị không làm lệnh hẹp', () => {
  test('npx vitest run --config vitest.config.ts là rộng', () => expect(isNarrow('npx vitest run --config vitest.config.ts')).toBe(false))
  test('tsc -p tsconfig.json là rộng', () => expect(isNarrow('tsc -p tsconfig.json')).toBe(false))
  test('cargo test --manifest-path crates/a/Cargo.toml là rộng', () => expect(isNarrow('cargo test --manifest-path crates/a/Cargo.toml')).toBe(false))
  test('pytest --timeout 1.5 là rộng', () => expect(isNarrow('pytest --timeout 1.5')).toBe(false))
  test('dạng --cờ=giá trị là rộng', () => {
    expect(isNarrow('npx vitest run --config=vitest.config.ts')).toBe(false)
    expect(isNarrow('tsc --project=tsconfig.json')).toBe(false)
  })
  test('cờ viết hoa vẫn nhận ra, giá trị số là rộng', () => {
    expect(isNarrow('tsc -P tsconfig.json')).toBe(false)
    expect(isNarrow('npx vitest run --workers 4')).toBe(false)
  })
})

describe('Y1: phủ lần lỗi', () => {
  test('tsc -p tsconfig.json đạt phủ tsc --noEmit lỗi', () => {
    expect(coversFailure({ check: 'static', command: 'tsc -p tsconfig.json' }, { check: 'static', command: 'tsc --noEmit' })).toBe(true)
  })
  test('tsc --noEmit đạt không phủ eslint . lỗi (khác công cụ)', () => {
    expect(coversFailure({ check: 'static', command: 'tsc --noEmit' }, { check: 'static', command: 'eslint .' })).toBe(false)
  })
  test('npx vitest run --config vitest.config.ts đạt phủ npx vitest run tests/a.test.ts lỗi', () => {
    expect(coversFailure({ check: 'test', command: 'npx vitest run --config vitest.config.ts' }, { check: 'test', command: 'npx vitest run tests/a.test.ts' })).toBe(true)
  })
})

describe('Y1: lệnh vẫn hẹp hoặc vẫn rộng như cũ', () => {
  test('tệp test sau cờ nhận giá trị vẫn hẹp', () => expect(isNarrow('npx vitest run --config vitest.config.ts tests/a.test.ts')).toBe(true))
  test('cờ lọc và tệp cụ thể vẫn hẹp', () => {
    expect(isNarrow('bun test -t phí')).toBe(true)
    expect(isNarrow('pytest tests/test_a.py::test_x')).toBe(true)
    expect(isNarrow('bun test tests/a.test.ts')).toBe(true)
  })
  test('go test ./... và pytest tests/ vẫn rộng', () => {
    expect(isNarrow('go test ./...')).toBe(false)
    expect(isNarrow('pytest tests/')).toBe(false)
  })
})
