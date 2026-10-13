// Báo cáo của Jest, Vitest, Mocha, Bun và Pytest (hooks/lib/drift/output): tổng kết cuối, không có lỗi theo sau.
// Gom từ test của review PR #13 vòng 4; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { completePass } from '../../hooks/lib/drift'
import type { Runner } from '../../hooks/lib/drift'
import { CARGO, GO, JS, NODE, PYTEST, VERSIONS, tailLines } from '../fixtures/runner-output'
import { verifiedAfter } from '../support/commands'

const PASS = {
  mocha: ['npx mocha | cat', JS.mocha_pass],
  jest: ['npx jest | cat', JS.jest_pass],
  vitest: ['npx vitest run | cat', JS.vitest_pass],
  bun: ['bun test | cat', JS.bun_pass],
  pytest: ['pytest | cat', PYTEST.pass],
} as const

describe('PR #13 vòng 4: fixture thật của các trình chạy chung', () => {
  test('ghi lại phiên bản công cụ đã sinh fixture', () => {
    expect([VERSIONS.mocha, VERSIONS.jest, VERSIONS.vitest, VERSIONS.bun, VERSIONS.pytest]).toEqual(['12.0.3', '30.5.2', '5.0.3', '1.4.2', '9.1.1'])
  })

  test('output đạt đầy đủ qua cat: xác minh', () => {
    for (const [name, [command, output]] of Object.entries(PASS)) expect(verifiedAfter(command, output), name).toBe(true)
  })

  test('output có test lỗi hay lỗi collection: không đạt ở mọi mức cắt', () => {
    for (const [name, output] of Object.entries({ ...JS, ...PYTEST })) {
      if (name.endsWith('pass')) continue
      const lines = output.split('\n').length
      for (let n = 1; n <= lines; n++) expect(completePass(tailLines(output, n), (name.includes('_') ? name.split('_')[0] : 'pytest') as Runner), `${name} tail ${n}`).toBe(false)
    }
  })
})

describe('PR #13 vòng 4: dòng đạt phải là tổng kết cuối, không có lỗi theo sau', () => {
  test('ca của review: "12 passing" rồi "Error: setup failed" qua cat: chưa xác minh', () => {
    expect(completePass('12 passing\nError: setup failed', 'mocha')).toBe(false)
    expect(verifiedAfter('mocha | cat', '12 passing\nError: setup failed')).toBe(false)
  })

  test('tổng kết đạt thật kèm lỗi phía sau (Error:, TypeError, Traceback, npm ERR!, exit code): không đạt', () => {
    expect(completePass(`${JS.mocha_pass}\n/fx/a.js:3\n  throw new TypeError("x")\nTypeError: x\n`, 'mocha')).toBe(false)
    expect(completePass(`${JS.jest_pass}Error: boom\n`, 'jest')).toBe(false)
    expect(completePass(`${PYTEST.pass}Traceback (most recent call last):\n  File "x.py", line 1\n`, 'pytest')).toBe(false)
    expect(completePass(`${JS.vitest_pass}npm ERR! code ELIFECYCLE\n`, 'vitest')).toBe(false)
    expect(completePass(`${JS.bun_pass}\nscript "test" exited with code 1\n`, 'bun')).toBe(false)
    expect(completePass(`${JS.mocha_pass}AssertionError [ERR_ASSERTION]: 1 == 2\n`, 'mocha')).toBe(false)
  })

  test('dấu hiệu lỗi chung áp cho mọi parser và mọi vị trí (trước tổng kết, Node, Cargo): không đạt', () => {
    expect(completePass(`Error: setup failed\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`Traceback (most recent call last):\n${PYTEST.pass}`, 'pytest')).toBe(false)
    expect(completePass(`${NODE.pass_tap}Error: setup failed\n`, 'node')).toBe(false)
    expect(completePass(`${NODE.pass_spec}Uncaught TypeError: x\n`, 'node')).toBe(false)
    expect(completePass(`${CARGO.pass}npm ERR! code ELIFECYCLE\n`, 'cargo')).toBe(false)
    expect(completePass(`${CARGO.pass}Command failed with exit code 1.\n`, 'cargo')).toBe(false)
    expect(completePass(`${GO.pass}script "test" exited with code 2\n`, 'go')).toBe(false)
  })

  test('ca biên do kiểm đột biến chỉ ra: 0 test đạt, hai lượt chạy đạt liên tiếp, dòng npm ERR! của npm cũ', () => {
    expect(completePass('\n\n  0 passing (1ms)\n\n', 'mocha')).toBe(false)
    expect(completePass('Tests:       0 passed, 0 total\nSnapshots:   0 total\n', 'jest')).toBe(false)
    // Hai lượt jest đạt (ví dụ workspaces): khối tổng kết cuối là khối được xét.
    expect(completePass(`${JS.jest_pass}${JS.jest_pass}`, 'jest')).toBe(true)
    expect(completePass(`${JS.jest_pass}npm ERR! Test failed.  See above for more details.\n`, 'jest')).toBe(false)
    expect(completePass(`${CARGO.pass}npm ERR! Test failed.  See above for more details.\n`, 'cargo')).toBe(false)
  })

  test('tổng kết đạt không nằm cuối (sau nó còn dòng lạ không thuộc trình chạy): không đạt', () => {
    for (const [name, [, output]] of Object.entries(PASS)) {
      expect(completePass(`${output}\nsomething else happened\n`, name as Runner), name).toBe(false)
    }
  })

  test('dòng đạt không đúng dạng tổng kết: không đạt', () => {
    expect(completePass('12 passing', 'mocha')).toBe(false)
    expect(completePass('  12 passing (3ms) extra\n', 'mocha')).toBe(false)
    expect(completePass(' 2 pass\n 2 expect() calls\n', 'bun')).toBe(false)
  })

  test('qua tail: còn đủ khối tổng kết thì xác minh, cắt mất phần đầu khối thì không', () => {
    expect(verifiedAfter('npx jest | tail -n 5', tailLines(JS.jest_pass, 5))).toBe(true)
    expect(verifiedAfter('bun test | tail -n 4', tailLines(JS.bun_pass, 4))).toBe(true)
    expect(verifiedAfter('bun test | tail -n 3', tailLines(JS.bun_pass, 3))).toBe(false)
  })
})
