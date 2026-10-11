// Test tái hiện vòng review PR #13 lần 4: báo cáo đạt của Jest, Vitest, Mocha, Bun, Pytest phải là khối tổng kết
// cuối của output (sau nó chỉ có dòng phụ của chính trình chạy), và không có dấu hiệu lỗi nào (kể cả `Error:` viết
// hoa). Fixture là output thật (tests/fixtures/runner-output.ts). Chỉ dùng API đã có ở 664aa5d; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief } from '../types'
import { completePass, newTracker, observe } from '../hooks/lib/drift'
import { CARGO, GO, JS, NODE, PYTEST, VERSIONS, tailLines } from './fixtures/runner-output'

function makeBrief(): Brief {
  return {
    goalId: 1, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'substantial', volume: 'medium',
    kind: 'edit', tier: 'complex', main: { family: 'opus', effort: 'high' }, why: '', relation: 'new', source: 'router', isFollowUp: false,
    isReference: false, scopePaths: [], prompt: '', at: 1,
  }
}

/** Trạng thái đã kiểm tra sau: sửa một file, rồi chạy lệnh có output cho trước (mã thoát 0). */
function verifiedAfter(command: string, output: string): boolean {
  const tracker = newTracker('t')
  const brief = makeBrief()
  observe(tracker, { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }, brief, [])
  observe(tracker, { tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output }, brief, [])
  return tracker.isVerified
}

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
      for (let n = 1; n <= lines; n++) expect(completePass(tailLines(output, n)), `${name} tail ${n}`).toBe(false)
    }
  })
})

describe('PR #13 vòng 4: dòng đạt phải là tổng kết cuối, không có lỗi theo sau', () => {
  test('ca của review: "12 passing" rồi "Error: setup failed" qua cat: chưa xác minh', () => {
    expect(completePass('12 passing\nError: setup failed')).toBe(false)
    expect(verifiedAfter('mocha | cat', '12 passing\nError: setup failed')).toBe(false)
  })

  test('tổng kết đạt thật kèm lỗi phía sau (Error:, TypeError, Traceback, npm ERR!, exit code): không đạt', () => {
    expect(completePass(`${JS.mocha_pass}\n/fx/a.js:3\n  throw new TypeError("x")\nTypeError: x\n`)).toBe(false)
    expect(completePass(`${JS.jest_pass}Error: boom\n`)).toBe(false)
    expect(completePass(`${PYTEST.pass}Traceback (most recent call last):\n  File "x.py", line 1\n`)).toBe(false)
    expect(completePass(`${JS.vitest_pass}npm ERR! code ELIFECYCLE\n`)).toBe(false)
    expect(completePass(`${JS.bun_pass}\nscript "test" exited with code 1\n`)).toBe(false)
    expect(completePass(`${JS.mocha_pass}AssertionError [ERR_ASSERTION]: 1 == 2\n`)).toBe(false)
  })

  test('dấu hiệu lỗi chung áp cho mọi parser và mọi vị trí (trước tổng kết, Node, Cargo): không đạt', () => {
    expect(completePass(`Error: setup failed\n${JS.mocha_pass}`)).toBe(false)
    expect(completePass(`Traceback (most recent call last):\n${PYTEST.pass}`)).toBe(false)
    expect(completePass(`${NODE.pass_tap}Error: setup failed\n`)).toBe(false)
    expect(completePass(`${NODE.pass_spec}Uncaught TypeError: x\n`)).toBe(false)
    expect(completePass(`${CARGO.pass}npm ERR! code ELIFECYCLE\n`)).toBe(false)
    expect(completePass(`${CARGO.pass}Command failed with exit code 1.\n`)).toBe(false)
    expect(completePass(`${GO.pass}script "test" exited with code 2\n`)).toBe(false)
  })

  test('ca biên do kiểm đột biến chỉ ra: 0 test đạt, hai lượt chạy đạt liên tiếp, dòng npm ERR! của npm cũ', () => {
    expect(completePass('\n\n  0 passing (1ms)\n\n')).toBe(false)
    expect(completePass('Tests:       0 passed, 0 total\nSnapshots:   0 total\n')).toBe(false)
    // Hai lượt jest đạt (ví dụ workspaces): khối tổng kết cuối là khối được xét.
    expect(completePass(`${JS.jest_pass}${JS.jest_pass}`)).toBe(true)
    expect(completePass(`${JS.jest_pass}npm ERR! Test failed.  See above for more details.\n`)).toBe(false)
    expect(completePass(`${CARGO.pass}npm ERR! Test failed.  See above for more details.\n`)).toBe(false)
  })

  test('tổng kết đạt không nằm cuối (sau nó còn dòng lạ không thuộc trình chạy): không đạt', () => {
    for (const [name, [, output]] of Object.entries(PASS)) {
      expect(completePass(`${output}\nsomething else happened\n`), name).toBe(false)
    }
  })

  test('dòng đạt không đúng dạng tổng kết: không đạt', () => {
    expect(completePass('12 passing')).toBe(false)
    expect(completePass('  12 passing (3ms) extra\n')).toBe(false)
    expect(completePass(' 2 pass\n 2 expect() calls\n')).toBe(false)
  })

  test('qua tail: còn đủ khối tổng kết thì xác minh, cắt mất phần đầu khối thì không', () => {
    expect(verifiedAfter('npx jest | tail -n 5', tailLines(JS.jest_pass, 5))).toBe(true)
    expect(verifiedAfter('bun test | tail -n 4', tailLines(JS.bun_pass, 4))).toBe(true)
    expect(verifiedAfter('bun test | tail -n 3', tailLines(JS.bun_pass, 3))).toBe(false)
  })
})
