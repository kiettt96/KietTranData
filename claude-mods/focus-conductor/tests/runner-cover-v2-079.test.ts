// 0.7.9 vòng 2 V2: lần chạy test đạt chỉ phủ lần lỗi cùng trình chạy khi nó thật sự chạy đủ phạm vi của lần lỗi: không có cờ chỉ in,
// chỉ liệt kê hay chỉ chạy lại một phần (--version, --collect-only, --listTests, --lf, -o, --no-run...), và các đường dẫn của lần đạt chứa
// mọi đường dẫn của lần lỗi (lần lỗi không có đường dẫn là gốc). Lệnh trình chạy không có parser vẫn chỉ phủ khi trùng lệnh, như 0.7.8.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { coversFailure } from '../hooks/lib/drift/evidence'
import { PYTEST } from './fixtures/runner-output'
import { base, plan, step, submit } from './support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const run = (command: string) => ({ check: 'test' as const, command })
const covers = (pass: string, fail: string) => coversFailure(run(pass), run(fail))

describe('0.7.9 V2: lần đạt không chạy test hay chạy phạm vi hẹp hơn không phủ', () => {
  const cases: Array<[string, string]> = [
    ['pytest --version', 'pytest'],
    ['pytest --collect-only', 'pytest'],
    ['pytest tests/unit', 'pytest'],
    ['jest --listTests', 'jest'],
    ['pytest --lf', 'pytest'],
    ['jest -o', 'jest'],
    ['cargo test --no-run', 'cargo test'],
    ['pytest --co', 'pytest'],
    ['pytest --deselect=tests/test_a.py::test_x', 'pytest'],
    ['go test -list . ./...', 'go test ./...'],
    ['npx vitest run --changed', 'npx vitest run'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt không phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(false))
  }
})

describe('0.7.9 V2 bổ sung: cờ bỏ bớt hay chạy thử khác (lỗ có từ trước 0.7.9)', () => {
  const cases: Array<[string, string]> = [
    ['jest --testPathIgnorePatterns=e2e', 'jest'],
    ['go test -short ./...', 'go test ./...'],
    ['npx vitest run --passWithNoTests', 'npx vitest run'],
    ['npx vitest run --exclude e2e', 'npx vitest run'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt không phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(false))
  }
  test('giá trị của --testPathIgnorePatterns ở lần lỗi không phải đường dẫn: jest đạt phủ jest --testPathIgnorePatterns e2e lỗi', () => {
    expect(covers('jest', 'jest --testPathIgnorePatterns e2e')).toBe(true)
  })
})

describe('0.7.9 V2: phạm vi đường dẫn', () => {
  test('pytest đạt phủ pytest tests/ lỗi', () => expect(covers('pytest', 'pytest tests/')).toBe(true))
  test('pytest tests đạt phủ pytest tests/unit lỗi', () => expect(covers('pytest tests', 'pytest tests/unit')).toBe(true))
  test('pytest -v đạt phủ pytest lỗi (-v là chạy đủ, in chi tiết)', () => expect(covers('pytest -v', 'pytest')).toBe(true))
  test('pytest tests/unit đạt không phủ pytest tests/unitx lỗi (so theo ranh giới thư mục)', () => expect(covers('pytest tests/unit', 'pytest tests/unitx')).toBe(false))
})

describe('0.7.9 V2: các dạng lệnh phổ biến giữ kết quả phủ như 0.7.8', () => {
  const cases: Array<[string, string, boolean]> = [
    ['npm run test', 'npm test', false],
    ['claude plugin test', 'claude plugin test .', false],
    ['make test', 'make test', true],
    ['npm test', 'npm test', true],
    ['go test ./...', 'go test ./pkg/a', true],
    ['npx vitest run', 'npx vitest run tests/a.test.ts', true],
    ['npx vitest run --config vitest.config.ts', 'npx vitest run tests/a.test.ts', true],
    ['bun test', 'bun test tests/a.test.ts', true],
    ['python -m pytest', 'pytest tests/', true],
    ['cargo test', 'cargo test --release', true],
    ['node --test', 'node --test test/a.test.js', true],
    ['pytest tests/', 'pytest tests/test_a.py::test_x', true],
    ['pytest tests/test_a.py::test_x', 'pytest tests/', false],
  ]
  for (const [pass, fail, expected] of cases) {
    test(`${pass} đạt ${expected ? 'phủ' : 'không phủ'} ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(expected))
  }
})

function hooks(on: On, passing: Set<string>) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: 'pytest 8.2.0' } : { result: PYTEST.fail, isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

describe('0.7.9 V2: đầu cuối', () => {
  test('pytest lỗi rồi pytest --version đạt: Stop vẫn chặn', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } }) })
    hooks(on, new Set(['pytest --version']))
    await submit($, 'Sửa hàm tính phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.py', old_string: 'a', new_string: 'b' } as never)
    await bash($, 'pytest')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'pytest --version')
    expect(await stop($)).toContain('pytest')
  })
})
