// Test tái hiện review PR #14 vòng 4: cờ npx và tiền tố npx là danh tính, token con không cứu claim, wrapper khác không
// bị bỏ ở evidence, biến môi trường và chuyển hướng đầu vào là danh tính, chuyển hướng đầu ra dựa vào mã thoát, đối số
// trong nháy, lệnh chạy nền không xác minh. Chỉ dùng API đã có ở 0d693c4; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief } from '../types'
import { acceptsVerified, classifyBash, completePass, evidenceStrength, newEvidenceLog, newTracker, noteEvidence, observe } from '../hooks/lib/drift'
import { CARGO, GO, JS, NODE, tailLines } from './fixtures/runner-output'

const bash = (command: string, output = '') => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output })
const edit = { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }

function strength(runs: string[], evidence: string) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit)
  for (const run of runs) noteEvidence(log, bash(run))
  const result = evidenceStrength(evidence, log)
  return { ...result, accepted: acceptsVerified(result, log) }
}
const accepted = (run: string, evidence: string) => strength([run], evidence).accepted

/** Ca âm: không nhận, mức stale, lý do trung tính nêu yêu cầu khớp chính xác. */
function rejected(run: string, evidence: string) {
  const result = strength([run], evidence)
  expect(result.accepted, `${run} / ${evidence}`).toBe(false)
  expect(result.level, `${run} / ${evidence}`).toBe('stale')
  expect(result.reason ?? '', `${run} / ${evidence}`).toContain('khớp chính xác')
}

function makeBrief(): Brief {
  return {
    goalId: 1, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'substantial', volume: 'medium',
    kind: 'edit', tier: 'complex', main: { family: 'opus', effort: 'high' }, why: '', relation: 'new', source: 'router', isFollowUp: false,
    isReference: false, scopePaths: [], prompt: '', at: 1,
  }
}
/** Trạng thái đã kiểm tra sau: sửa một file, rồi chạy lệnh (mã thoát 0) có output cho trước. */
function verifiedAfter(command: string, output = ''): boolean {
  const tracker = newTracker('t')
  observe(tracker, edit, makeBrief(), [])
  observe(tracker, bash(command, output), makeBrief(), [])
  return tracker.isVerified
}

describe('PR #14 vòng 4: tiền tố npx là danh tính, token con không cứu claim', () => {
  test('chạy trực tiếp mà evidence nêu npx (có hay không có cờ): stale', () => {
    for (const evidence of ['npx --no-install tsc -p x: sạch', 'npx --yes tsc -p x: sạch', 'npx tsc -p x: sạch']) rejected('tsc -p x', evidence)
  })

  test('chạy npx mà evidence bỏ hay đổi tiền tố: stale', () => {
    rejected('npx --no-install tsc -p x', 'tsc -p x: sạch')
    rejected('npx --no-install tsc -p x', 'npx tsc -p x: sạch')
    rejected('npx --no-install tsc -p x', 'npx --yes tsc -p x: sạch')
    rejected('npx tsc -p x', 'tsc -p x: sạch')
  })

  test('đối chứng: cùng tiền tố, alias thật (-y là --yes, --no-install là --no)', () => {
    expect(accepted('npx tsc -p x', 'npx tsc -p x: sạch')).toBe(true)
    expect(accepted('npx -y tsc -p x', 'npx --yes tsc -p x: sạch')).toBe(true)
    expect(accepted('npx --no-install tsc -p x', 'npx --no tsc -p x: sạch')).toBe(true)
  })

  test('wrapper khác không bị bỏ ở evidence, kể cả đứng sau npx', () => {
    for (const wrapper of ['sudo', 'time', 'command', 'exec', 'nohup']) rejected('npm test', `${wrapper} npm test: 12 pass`)
    rejected('npx tsc -p x', 'npx sudo tsc -p x: sạch')
  })

  test('claim con chỉ hợp lệ trong python -m <module>; đối số của lệnh khác không là claim độc lập', () => {
    rejected('pytest tests/', 'python -m pytest tests/: đạt')
    expect(accepted('python -m pytest tests/', 'python -m pytest tests/: đạt')).toBe(true)
    rejected('npm test -- npm run lint', 'npm test -- npm run lint: 12 pass')
    rejected('npm test', 'npm test -- npm run lint: 12 pass')
  })
})

describe('PR #14 vòng 4: biến môi trường và chuyển hướng đầu vào là danh tính', () => {
  test('biến môi trường có trong lệnh chạy hay trong evidence: phải nêu cả hai phía', () => {
    rejected('CI=1 npm test', 'npm test: 12 pass')
    rejected('npm test', 'CI=1 npm test: 12 pass')
    rejected('TEST_FILTER=a npm test', 'TEST_FILTER=b npm test: 12 pass')
    expect(accepted('CI=1 npm test', 'CI=1 npm test: 12 pass')).toBe(true)
  })

  test('timeout N chỉ có thể làm lệnh lỗi, không tạo đạt giả: vẫn là cùng lệnh', () => {
    expect(accepted('timeout 60 npm test', 'npm test: 12 pass')).toBe(true)
  })

  test('chuyển hướng đầu vào khác nhau hay thiếu: stale; cùng nhau (dính hay tách): nhận', () => {
    rejected('node --test < input-a', 'node --test < input-b: đạt')
    rejected('node --test < input-a', 'node --test: đạt')
    rejected('node --test', 'node --test < input-a: đạt')
    expect(accepted('node --test < input-a', 'node --test < input-a: đạt')).toBe(true)
    expect(accepted('node --test < input-a', 'node --test <input-a: đạt')).toBe(true)
    expect(accepted('node --test <<< x', 'node --test <<< x: đạt')).toBe(true)
  })

  test('heredoc làm stdin: nội dung không so được, không bao giờ khớp', () => {
    rejected("node --test <<'EOF'\nx\nEOF", 'node --test: đạt')
    rejected("node --test <<'EOF'\nx\nEOF", 'node --test <<EOF: đạt')
    // Dấu giữ chỗ của heredoc không thể bị evidence mạo danh bằng một delimiter trùng tên.
    rejected("node --test <<'H'\nx\nH", 'node --test <<H: đạt')
  })
})

describe('PR #14 vòng 4: chuyển hướng đầu ra dựa vào mã thoát, không vào danh tính', () => {
  test('không qua ống: xác minh theo mã thoát, evidence có hay không có chuyển hướng đều nhận, dấu : vẫn là ranh giới', () => {
    expect(verifiedAfter('node --test src/a.test.ts > out.log')).toBe(true)
    for (const evidence of [
      'node --test src/a.test.ts: đạt', 'node --test src/a.test.ts > out.log: đạt', 'node --test src/a.test.ts >out.log: đạt',
      'node --test src/a.test.ts 2>/dev/null: đạt', 'node --test src/a.test.ts &> out.log: đạt', 'node --test src/a.test.ts 2>&1: đạt',
    ]) {
      expect(accepted('node --test src/a.test.ts > out.log', evidence), evidence).toBe(true)
    }
  })

  test('gộp luồng và chuyển hướng dính (&>, 2>&1, >&2) không bị đọc là lệnh chạy nền', () => {
    for (const command of ['node --test &> out.log', 'node --test 2>&1', 'node --test >&2', 'node --test 2>/dev/null']) {
      expect(verifiedAfter(command), command).toBe(true)
    }
  })

  test('chuyển hướng đầu ra rồi nối ống: không xác minh (output không còn đến từ lệnh)', () => {
    expect(verifiedAfter('node --test > out.log | cat', '# tests 1')).toBe(false)
  })
})

describe('PR #14 vòng 4: đối số trong nháy là một token duy nhất', () => {
  test('toán tử shell trong nháy không bị xóa hay tách ở cả hai phía', () => {
    expect(accepted("pytest -k 'a > b' tests/", "pytest -k 'a > b' tests/: đạt")).toBe(true)
    expect(accepted("pytest -k 'a|b' tests/", "pytest -k 'a|b' tests/: đạt")).toBe(true)
    expect(accepted('pytest -k "a b" tests/', "pytest -k 'a b' tests/: đạt")).toBe(true)
    expect(accepted("pytest -k 'smoke' tests/", 'pytest -k smoke tests/: đạt')).toBe(true)
    rejected("pytest -k 'a > b' tests/", 'pytest -k a > b tests/: đạt')
    rejected("pytest -k 'a > b' tests/", "pytest -k 'a b' tests/: đạt")
  })

  test('nháy mở sau một từ thường (không có lệnh kiểm tra trong mệnh đề) vẫn là nháy bao ngoài, lệnh trong nháy vẫn là claim', () => {
    expect(accepted('npm test', 'đã chạy "npm test": 12 pass')).toBe(true)
    rejected('npm test', 'đã chạy "npm run lint": đạt')
  })

  test('lệnh không phải kiểm tra có > trong nháy không tạo lệnh kiểm tra', () => {
    expect(classifyBash(`node -e 'console.log("x > y")'`).effects.some(e => e.kind === 'check')).toBe(false)
  })
})

describe('PR #14 vòng 4: lệnh chạy nền và |& không xác minh', () => {
  test('npm test & (nền): mã thoát không thuộc về nó', () => {
    expect(verifiedAfter('npm test & echo ok', 'ok')).toBe(false)
    expect(verifiedAfter('npm test &')).toBe(false)
    expect(verifiedAfter('echo a & npm test')).toBe(true)
  })

  test('|& là ống không hỗ trợ: hidden', () => {
    const effect = classifyBash('npm test |& cat').effects.find(e => e.kind === 'check')
    expect(effect?.kind === 'check' && effect.exit).toBe('hidden')
    expect(verifiedAfter('npm test |& cat', 'Tests: 12 passed, 12 total')).toBe(false)
  })
})

describe('PR #14 vòng 4: ca biên do kiểm đột biến chỉ ra', () => {
  test('ống chỉ giữ mức filtered với bộ lọc chỉ đọc từ ống, đứng một mình: head, nhiều ống, output bị cắt đều không', () => {
    expect(verifiedAfter('node --test | cat', NODE.pass_tap)).toBe(true)
    expect(verifiedAfter('node --test | head -n 20', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('node --test | cat | true', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('cargo test | tail -n 100', CARGO.pass)).toBe(false)
    expect(verifiedAfter('go test ./... | tail -n 100', GO.pass)).toBe(false)
    expect(verifiedAfter('node --test | tail -n 12', tailLines(NODE.pass_tap, 12))).toBe(true)
  })

  test('lỗi có tiền tố tên lỗi hay Uncaught nằm TRƯỚC khối tổng kết đạt: không đạt', () => {
    expect(completePass(`TypeError: setup failed\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`Uncaught TypeError: boom\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`Uncaught Error: boom\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`AssertionError [ERR_ASSERTION]: 1 == 2\n${JS.jest_pass}`, 'jest')).toBe(false)
    expect(completePass(JS.mocha_pass, 'mocha')).toBe(true)
  })

  test('lý do từ chối nêu đoạn lệnh kiểm tra, không nêu cả câu lệnh chứa nó', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit)
    noteEvidence(log, { ...bash('cd /repo && npm test'), isError: true })
    const result = evidenceStrength('npm test: đạt', log)
    expect(result.level).toBe('stale')
    expect(result.reason ?? '').toContain('`npm test`')
    expect(result.reason ?? '').not.toContain('cd /repo')
  })

  test('mã thoát 0 nhưng output có dấu hiệu lỗi: không xác minh', () => {
    expect(verifiedAfter('npm test', 'FAIL src/a.test.ts\nTests: 1 failed, 1 total')).toBe(false)
    expect(verifiedAfter('npm test', 'Tests: 1 passed, 1 total')).toBe(true)
  })

  test('lệnh kiểm tra sau ; vẫn được xác minh, sau && ... & thì cả danh sách chạy nền', () => {
    expect(verifiedAfter('echo a; npm test')).toBe(true)
    expect(verifiedAfter('npm test && echo ok &')).toBe(false)
    expect(verifiedAfter('echo a && npm test &')).toBe(false)
    expect(verifiedAfter('sleep 1 & npm test & echo b')).toBe(false)
  })

  test('|& là toán tử riêng: đoạn sau vẫn được đọc đúng (đích ghi của tee)', () => {
    expect(classifyBash('echo x |& tee src/a.ts').paths).toContain('src/a.ts')
  })

  test('wrapper có cờ đứng trước lệnh trong evidence vẫn là một phần cụm lệnh', () => {
    rejected('npm test', 'sudo -E npm test: 12 pass')
    rejected('npm test', 'time -p npm test: 12 pass')
    rejected('npx tsc -p x', 'nohup -x npx tsc -p x: sạch')
  })

  test('nháy chữ Việt đóng luôn là ranh giới, kể cả dính chữ sau; & đứng một mình là ranh giới', () => {
    expect(accepted('npm test', '“npm test”12 pass')).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test & npm run lint: đạt').accepted).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test && npm run lint: đạt').accepted).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test |& npm run lint: đạt').accepted).toBe(true)
    rejected('npm test', 'npm test & npm run lint: đạt')
  })
})
