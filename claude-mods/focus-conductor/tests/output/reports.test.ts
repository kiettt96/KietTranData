// Báo cáo đạt của lệnh kiểm tra (hooks/lib/drift/output): fixture là output thật, báo cáo kèm dấu hiệu lỗi, completePass trực tiếp, khối hoàn chỉnh của đúng trình chạy.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { completePass, evidenceStrength, newEvidenceLog, newTracker, noteEvidence, observe, outputFailed } from '../../hooks/lib/drift'
import { CARGO, GO, JS, NODE, PYTEST, VERSIONS, tailLines } from '../fixtures/runner-output'
import { bash, edit, makeBrief, verifiedAfter } from '../support/commands'

describe('04: kết quả thật của lệnh kiểm tra (từ phiên chạy thật)', () => {
  test('lệnh test qua | tail có mã thoát 0 nhưng output báo lỗi: không tính là kiểm tra đạt', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, { ...bash('node --test src/ 2>&1 | tail -15'), output: '# tests 1\n# pass 0\n# fail 1' }, brief, [])
    expect(tracker.isVerified).toBe(false)
    const log = newEvidenceLog(1)
    noteEvidence(log, { ...edit('/repo/src/a.ts') })
    noteEvidence(log, { ...bash('node --test src/ 2>&1 | tail -15'), output: '# pass 0\n# fail 1' })
    expect(evidenceStrength('node --test src/: 1 pass', log).level).toBe('stale')
    noteEvidence(log, { ...bash('node --test src/add.test.js 2>&1 | tail -12'), output: tailLines(NODE.pass_tap, 12) })
    expect(evidenceStrength('node --test src/add.test.js: 1 pass', log).level).toBe('strong')
    // 0.5.2: evidence phải nêu đúng phạm vi (đối số) của lệnh; chỉ nêu trình chạy là nhắc một lệnh chưa chạy (PR #14).
    expect(evidenceStrength('node --test: 1 pass', log).level).toBe('stale')
  })

  test('dấu hiệu lỗi của các trình chạy phổ biến; số 0 không phải lỗi', () => {
    for (const out of ['Tests: 2 failed, 10 passed', '3 failing', 'src/a.ts(1,1): error TS2322: x', 'FAILED tests/test_a.py::t', '\u2716 4 problems', 'test result: FAILED. 1 passed', '--- FAIL: TestX', ' 12 pass\n 1 fail']) {
      expect(outputFailed(out), out).toBe(true)
    }
    for (const out of ['12 pass\n0 fail', '# fail 0', 'Tests: 10 passed', 'Found 0 errors', '']) expect(outputFailed(out), out).toBe(false)
  })
})

describe('PR #13 vòng 2: báo cáo đầy đủ nhưng có dấu hiệu lỗi kèm theo', () => {
  test('báo cáo jest đạt mà có dòng FAILED: không xác nhận', () => {
    expect(verifiedAfter('npx jest | cat', { output: 'Tests:       12 passed, 12 total\nFAILED  src/x.test.ts' })).toBe(false)
  })
})

describe('PR #13 vòng 2: completePass trực tiếp', () => {
  test('báo cáo đầy đủ nhưng có dòng lỗi: không đạt, kể cả khi bỏ qua bước lọc lỗi bên ngoài', () => {
    expect(completePass('Tests: 12 passed, 12 total\nFAILED src/x.test.ts', 'jest')).toBe(false)
    // 0.5.2: khối tổng kết phải kết thúc output; dòng lạ phía sau thì không đạt.
    expect(completePass(`${NODE.pass_tap}not a report`, 'node')).toBe(false)
    expect(completePass(NODE.pass_tap, 'node')).toBe(true)
    expect(completePass(`${NODE.pass_tap}FAILED src/x.test.ts`, 'node')).toBe(false)
    expect(completePass('1 passed', 'jest')).toBe(false)
  })
})

describe('PR #13 vòng 3: fixture là output thật', () => {
  test('ghi lại phiên bản công cụ đã sinh fixture', () => {
    expect(VERSIONS.node).toBe('v22.22.0')
    expect(VERSIONS.go).toBe('go1.24.7')
    expect(VERSIONS.cargo).toBe('1.97.0')
  })
})

describe('0.5.2 P1b: báo cáo đạt phải là khối hoàn chỉnh của đúng trình chạy', () => {
  const six = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'

  test('sáu bộ đếm trơn, không có khối tổng kết hoàn chỉnh: không xác minh', () => {
    expect(verifiedAfter('node --test | cat', six)).toBe(false)
    expect(verifiedAfter('node --test | tail -n 6', six)).toBe(false)
  })

  test('bộ đếm ghép từ hai khối (khối cuối thiếu): không xác minh', () => {
    expect(verifiedAfter('node --test | cat', `${NODE.pass_tap}TAP version 13\n# tests 3\n# pass 3\n`)).toBe(false)
  })

  test('khối đủ nhưng dòng plan 1..N thiếu hay không khớp số dòng kết quả: không xác minh', () => {
    expect(verifiedAfter('node --test | cat', NODE.pass_tap.replace('1..3\n', ''))).toBe(false)
    expect(verifiedAfter('node --test | cat', NODE.pass_tap.replace('1..3\n', '1..4\n'))).toBe(false)
  })

  test('script đóng gói (npm, pnpm, yarn, bun run, make) qua ống: không xác minh, kể cả output thật đầy đủ', () => {
    expect(verifiedAfter('npm test | cat', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('npm test 2>&1 | tail -n 12', tailLines(NODE.pass_tap, 12))).toBe(false)
    expect(verifiedAfter('npm run test | cat', JS.jest_pass)).toBe(false)
    expect(verifiedAfter('npm test | cat', 'ok  \texample.com/x\t0.01s\n')).toBe(false)
    expect(verifiedAfter('pnpm test | cat', JS.vitest_pass)).toBe(false)
    expect(verifiedAfter('make test | cat', PYTEST.pass)).toBe(false)
  })

  test('trình chạy không khớp báo cáo: không xác minh', () => {
    expect(verifiedAfter('node --test | cat', JS.jest_pass)).toBe(false)
    expect(verifiedAfter('npx jest | cat', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('pytest | cat', GO.pass)).toBe(false)
    expect(verifiedAfter('go test ./... | cat', CARGO.pass)).toBe(false)
  })

  test('đối chứng: output thật đầy đủ qua đúng lệnh trực tiếp thì xác minh (kể cả describe lồng)', () => {
    for (const [command, output] of [
      ['node --test | cat', NODE.pass_tap], ['node --test --test-reporter=spec | cat', NODE.pass_spec], ['node --test | cat', NODE.suite_tap],
      ['node --test --test-reporter=spec | cat', NODE.suite_spec], ['node --test | cat', NODE.skip_tap], ['npx jest | cat', JS.jest_pass],
      ['npx vitest run | cat', JS.vitest_pass], ['npx mocha | cat', JS.mocha_pass], ['bun test | cat', JS.bun_pass], ['pytest | cat', PYTEST.pass],
      ['go test ./... | cat', GO.pass], ['cargo test | cat', CARGO.pass], ['node --test | tail -n 12', tailLines(NODE.pass_tap, 12)],
    ] as const) {
      expect(verifiedAfter(command, output), command).toBe(true)
    }
  })

  test('Cargo: số dòng test result phải khớp số binary và doctest đã chạy', () => {
    expect(verifiedAfter('cargo test | cat', CARGO.pass.replace(/ {5}Running tests\/a_ok\.rs[^\n]*\n/, ''))).toBe(false)
  })
})
