// Test tái hiện review sau merge PR #13 (0.5.2): bằng chứng gắn đúng lệnh, báo cáo đạt phải là khối hoàn chỉnh của
// đúng trình chạy, ghi file kế hoạch qua Bash không tính là thay đổi mã. Chỉ dùng API đã có ở f6a6804; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief } from '../types'
import { acceptsVerified, evidenceStrength, isMutation, newEvidenceLog, newTracker, noteEvidence, observe } from '../hooks/lib/drift'
import { CARGO, GO, JS, NODE, PYTEST, tailLines } from './fixtures/runner-output'

function makeBrief(): Brief {
  return {
    goalId: 1, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'substantial', volume: 'medium',
    kind: 'edit', tier: 'complex', main: { family: 'opus', effort: 'high' }, why: '', relation: 'new', source: 'router', isFollowUp: false,
    isReadOnly: false, isReference: false, scopePaths: [], prompt: '', at: 1,
  } as Brief
}
const bash = (command: string, extra: { isError?: boolean; output?: string } = {}) => ({
  tool: 'Bash', input: { command }, isError: extra.isError ?? false, isReadOnly: false, ...(extra.output !== undefined ? { output: extra.output } : {}),
})
const edit = (path = '/repo/src/a.ts') => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })

/** verified có được nhận không: sửa một file, chạy các lệnh, rồi đối chiếu evidence. */
function accepted(runs: Array<[string, { isError?: boolean; output?: string }?]>, evidence: string): boolean {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const [command, extra] of runs) noteEvidence(log, bash(command, extra ?? {}))
  return acceptsVerified(evidenceStrength(evidence, log), log)
}

/** Trạng thái đã kiểm tra sau: sửa một file, rồi chạy lệnh có output cho trước (mã thoát 0). */
function verifiedAfter(command: string, output: string): boolean {
  const tracker = newTracker('t')
  const brief = makeBrief()
  observe(tracker, edit(), brief, [])
  observe(tracker, bash(command, { output }), brief, [])
  return tracker.isVerified
}

describe('0.5.2 P1a: bằng chứng của lệnh này không xác minh lệnh khác', () => {
  test('npm run test đạt không xác minh bước npm run lint (lint lỗi, hay lint chưa chạy)', () => {
    expect(accepted([['npm run test'], ['npm run lint', { isError: true, output: '3 problems' }]], 'npm run lint: đạt')).toBe(false)
    expect(accepted([['npm run test']], 'npm run lint: 0 problems')).toBe(false)
    for (const pm of ['pnpm', 'yarn', 'bun']) expect(accepted([[`${pm} run test`]], `${pm} run lint passed`), pm).toBe(false)
  })

  test('tên script phải khớp trọn: test không khớp tests, lint không khớp lint:fix', () => {
    expect(accepted([['npm run tests']], 'npm run test: đạt')).toBe(false)
    expect(accepted([['npm run lint:fix']], 'npm run lint: đạt')).toBe(false)
  })

  test('cùng trình chạy, khác đối số: node --test src/a.test.ts không xác minh src/b.test.ts', () => {
    expect(accepted([['node --test src/a.test.ts']], 'node --test src/b.test.ts: pass')).toBe(false)
    expect(accepted([['go test ./a/...']], 'go test ./b/...: ok')).toBe(false)
  })

  test('evidence nêu một lệnh đạt và một lệnh mà lần chạy cuối lỗi: không nhận', () => {
    expect(accepted([['npm test'], ['npm run lint', { isError: true }]], 'npm test đạt, npm run lint đạt')).toBe(false)
    expect(accepted([['npm test'], ['npm test', { isError: true }]], 'npm test: 12 pass')).toBe(false)
  })

  test('đối chứng: đúng lệnh thì nhận, kể cả dạng viết khác của cùng script', () => {
    expect(accepted([['npm test']], 'npm test: 12 pass')).toBe(true)
    expect(accepted([['npm test']], 'npm run test: 12 pass')).toBe(true)
    expect(accepted([['npm run lint']], 'npm run lint: 0 problems')).toBe(true)
    expect(accepted([['npx tsc --noEmit']], 'npx tsc --noEmit: 0 lỗi')).toBe(true)
    expect(accepted([['node --test src/a.test.ts']], 'node --test src/a.test.ts: 3 pass')).toBe(true)
    expect(accepted([['node --test']], 'node --test: 3 pass')).toBe(true)
  })
})

describe('0.5.2: ca biên do kiểm đột biến chỉ ra', () => {
  test('evidence chỉ nhắc lệnh khi các token liền nhau (chỉ tùy chọn chen giữa); npm run test và npm test là một', () => {
    expect(accepted([['npm run lint']], 'npm run test đạt, lint để sau')).toBe(false)
    expect(accepted([['npm run test']], 'npm test: 12 pass')).toBe(true)
  })

  test('Node: dòng bộ đếm lạ ngoài khối, sai thứ tự, lẫn tiền tố, thiếu TAP version, sai số dòng spec: không đạt', () => {
    expect(verifiedAfter('node --test --test-reporter=spec | tail -n 9', `ℹ pass 9\n${tailLines(NODE.pass_spec, 8)}`)).toBe(false)
    expect(verifiedAfter('node --test | cat', NODE.pass_tap.replace('# pass 3\n# fail 0', '# fail 0\n# pass 3'))).toBe(false)
    expect(verifiedAfter('node --test | cat', NODE.pass_tap.replace('# todo 0', 'ℹ todo 0'))).toBe(false)
    expect(verifiedAfter('node --test | cat', NODE.pass_tap.replace('TAP version 13\n', ''))).toBe(false)
    expect(verifiedAfter('node --test --test-reporter=spec | cat', NODE.pass_spec.replace(/✔ c[^\n]*\n/, ''))).toBe(false)
  })

  test('ghi file kế hoạch kèm đích không xác định, hay thứ tự đoạn ngược: phần mã vẫn được đếm đúng', () => {
    expect(isMutation(bash('echo x | tee .claude/plans/x.md $OUT'))).toBe(true)
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('printf y > src/a.ts; printf x > .claude/plans/x.md'))
    expect(log.mutations).toBe(1)
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

describe('0.5.2 P2a: ghi file kế hoạch qua Bash không phải thay đổi mã', () => {
  test('chỉ ghi file kế hoạch (tương đối, tuyệt đối, heredoc, tee): không tính là thay đổi', () => {
    for (const command of [
      "printf '%s\\n' 'Step 1' > .claude/plans/implementation.md",
      "printf x > /root/.claude/plans/x.md",
      "cat > /root/.claude/plans/x.md <<'EOF'\n# Kế hoạch\nEOF",
      'echo x | tee .claude/plans/x.md',
    ]) {
      expect(isMutation(bash(command)), command).toBe(false)
    }
  })

  test('test đạt rồi ghi file kế hoạch qua Bash: vẫn giữ trạng thái đã kiểm tra', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit(), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash('printf x > .claude/plans/x.md'), brief, [])
    expect(tracker.isVerified).toBe(true)
    expect(tracker.mutations).toBe(1)
  })

  test('ghi cả file kế hoạch và file mã: phần mã vẫn được đếm, đúng số lần', () => {
    expect(isMutation(bash('echo x | tee .claude/plans/x.md src/a.ts'))).toBe(true)
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('printf x > .claude/plans/x.md; printf y > src/a.ts'))
    expect(log.mutations).toBe(1)
    expect(isMutation(bash('printf x > .claude/plans/x.md; printf y > $OUT'))).toBe(true)
  })
})
