// Test tái hiện review PR #14 vòng 2: evidence nhắc một lệnh kiểm tra chưa chạy thì không được verified; tùy chọn thu
// hẹp phạm vi (--test-name-pattern, -run, -k) là một phần danh tính lệnh, so khớp nghiêm ngặt; `./...` không bị cắt.
// Chỉ dùng API đã có ở cdb0e11; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import { acceptsVerified, evidenceStrength, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'

const bash = (command: string, extra: { isError?: boolean } = {}) => ({ tool: 'Bash', input: { command }, isError: extra.isError ?? false, isReadOnly: false, output: '' })
const edit = (path = '/repo/src/a.ts') => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })

/** Sửa một file, chạy các lệnh (lệnh có `!` ở đầu là lần chạy lỗi), rồi đối chiếu evidence. */
function strength(runs: string[], evidence: string) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, run.startsWith('!') ? bash(run.slice(1), { isError: true }) : bash(run))
  const result = evidenceStrength(evidence, log)
  return { ...result, accepted: acceptsVerified(result, log) }
}
const accepted = (runs: string[], evidence: string) => strength(runs, evidence).accepted

describe('PR #14 vòng 2, P1-1: mọi lệnh kiểm tra được nhắc phải có lần chạy hợp lệ', () => {
  test('một lệnh đạt và một lệnh chưa chạy, ở đầu hay cuối evidence: không nhận', () => {
    expect(accepted(['npm test'], 'npm test: đạt, npm run lint: đạt')).toBe(false)
    expect(accepted(['npm test'], 'npm run lint: đạt, npm test: đạt')).toBe(false)
    expect(accepted(['go test ./...'], 'go test ./...: ok; cargo test: ok')).toBe(false)
  })

  test('lệnh A đạt, lệnh B chạy nhưng lần cuối lỗi: không nhận', () => {
    expect(accepted(['npm test', 'npm run lint', '!npm run lint'], 'npm test: đạt, npm run lint: đạt')).toBe(false)
  })

  test('lệnh chưa chạy kèm file đã sửa: không nhận nhờ file khớp, lý do nêu đúng lệnh (vòng 3: lý do trung tính, khớp chính xác)', () => {
    const result = strength([], 'đã sửa src/a.ts, npm test: đạt')
    expect(result.accepted).toBe(false)
    expect(result.level).toBe('stale')
    expect(result.reason ?? '').toContain('npm test')
    expect(result.reason ?? '').toContain('khớp chính xác')
  })

  test('phủ định không được phân tích: lệnh chưa chạy nhắc trong câu "chưa chạy" vẫn không cho verified', () => {
    expect(accepted(['npm test'], 'npm test: đạt; npm run lint: chưa chạy')).toBe(false)
  })

  test('đối chứng: mọi lệnh được nhắc đều đạt sau thay đổi cuối thì nhận', () => {
    expect(accepted(['npm test', 'npm run lint'], 'npm test: đạt, npm run lint: đạt')).toBe(true)
    expect(accepted(['npx tsc --noEmit'], 'đã chạy npx tsc --noEmit: sạch')).toBe(true)
  })
})

describe('PR #14 vòng 2, P1-2: tùy chọn thu hẹp phạm vi là một phần danh tính lệnh', () => {
  const narrow = [
    ['node --test --test-name-pattern=smoke src/a.test.ts', 'node --test src/a.test.ts: đạt', 'node --test --test-name-pattern smoke src/a.test.ts: đạt'],
    ['node --test --test-name-pattern smoke src/a.test.ts', 'node --test src/a.test.ts: đạt', 'node --test --test-name-pattern=smoke src/a.test.ts: đạt'],
    ['go test -run=TestPayment ./...', 'go test ./...: ok', 'go test -run TestPayment ./...: ok'],
    ['go test -run TestPayment ./...', 'go test ./...: ok', 'go test -run=TestPayment ./...: ok'],
    ['pytest -k smoke tests/', 'pytest tests/: đạt', 'pytest -k=smoke tests/: đạt'],
    ['pytest -k=smoke tests/', 'pytest tests/: đạt', 'pytest -k smoke tests/: đạt'],
  ] as const

  test('lần chạy bị lọc không xác minh evidence nêu phạm vi rộng; evidence nêu đúng bộ lọc (dạng = hay tách) thì nhận', () => {
    for (const [run, broad, exact] of narrow) {
      expect(accepted([run], broad), `${run} / ${broad}`).toBe(false)
      expect(accepted([run], exact), `${run} / ${exact}`).toBe(true)
    }
  })

  test('evidence nêu phạm vi rộng hơn lần chạy (thêm file, thêm gói): không nhận', () => {
    expect(accepted(['node --test src/a.test.ts'], 'node --test src/a.test.ts src/b.test.ts: đạt')).toBe(false)
    expect(accepted(['go test ./a/...'], 'go test ./a/... ./b/...: ok')).toBe(false)
  })

  test('cờ chưa được đặc tả giữ nguyên trong danh tính (so khớp nghiêm ngặt)', () => {
    expect(accepted(['go test -count=0 ./...'], 'go test ./...: ok')).toBe(false)
    expect(accepted(['go test -short ./...'], 'go test ./...: ok')).toBe(false)
    expect(accepted(['npm test -- --grep smoke'], 'npm test: đạt')).toBe(false)
    expect(accepted(['npm test -- --grep smoke'], 'npm test -- --grep smoke: đạt')).toBe(true)
  })

  test('cờ chỉ đổi cách trình bày, theo từng trình chạy (dạng = và dạng tách): vẫn là cùng lệnh', () => {
    for (const [run, evidence] of [
      ['node --test --test-reporter=tap src/a.test.ts', 'node --test src/a.test.ts: đạt'],
      ['node --test --test-reporter tap src/a.test.ts', 'node --test src/a.test.ts: đạt'],
      ['node --test src/a.test.ts', 'node --test --test-reporter=spec src/a.test.ts: đạt'],
      ['go test -v ./...', 'go test ./...: ok'],
      ['pytest -v tests/', 'pytest tests/: đạt'],
      ['pytest -q tests/', 'pytest tests/: đạt'],
      ['pytest --tb=short tests/', 'pytest tests/: đạt'],
      ['pytest --tb short tests/', 'pytest tests/: đạt'],
      ['npx vitest run --reporter=verbose', 'vitest run: đạt'],
      ['npx mocha --reporter dot', 'mocha: đạt'],
      ['npx jest --verbose', 'jest: đạt'],
      // Vòng 3: cờ của npx là một phần danh tính (xem review052c); evidence phải nêu cờ đó.
      ['npx --no-install tsc -p tsconfig.json', 'npx --no-install tsc -p tsconfig.json: sạch'],
      ['npx -y tsc -p tsconfig.json', 'npx --yes tsc -p tsconfig.json: sạch'],
      ['npx tsc -p tsconfig.json', 'tsc -p tsconfig.json: sạch'],
    ] as const) {
      expect(accepted([run], evidence), `${run} / ${evidence}`).toBe(true)
    }
  })

  test('cờ trình bày của trình chạy này không được bỏ ở trình chạy khác', () => {
    expect(accepted(['go test --tb=short ./...'], 'go test ./...: ok')).toBe(false)
    expect(accepted(['pytest --test-reporter=tap tests/'], 'pytest tests/: đạt')).toBe(false)
  })
})

describe('PR #14 vòng 2: dấu câu quanh đường dẫn trong evidence', () => {
  test('./... giữ nguyên trước dấu câu; dấu chấm cuối câu sau tên file được bỏ', () => {
    for (const evidence of ['go test ./...', 'go test ./...: ok', 'go test ./...; passed', '(go test ./...), passed', 'đã chạy go test ./....']) {
      const expected = evidence !== 'đã chạy go test ./....'
      expect(accepted(['go test ./...'], evidence), evidence).toBe(expected)
    }
    expect(accepted(['node --test src/a.test.ts'], 'Đã chạy node --test src/a.test.ts.')).toBe(true)
  })
})

describe('PR #14 vòng 2: ca biên do kiểm đột biến chỉ ra', () => {
  test('lệnh không phải kiểm tra (chuỗi trong nháy) không làm chỗ dựa cho evidence nhắc lệnh kiểm tra', () => {
    // Không sửa file: evidence chỉ nhắc lệnh khác vẫn có thể được nhận ở mức weak, nên chỗ dựa phải là lệnh kiểm tra thật.
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('echo "x\nnpm test\n"'))
    expect(acceptsVerified(evidenceStrength('npm test: đạt', log), log)).toBe(false)
  })

  test('lệnh kiểm tra chứa một lệnh kiểm tra khác bên trong (python -m pytest): cả câu lệnh là chỗ dựa', () => {
    expect(accepted(['python -m pytest tests/'], 'python -m pytest tests/: đạt')).toBe(true)
  })

  test('ranh giới mệnh đề kết thúc lệnh: đường dẫn ở mệnh đề sau không mở rộng phạm vi', () => {
    expect(accepted(['npm test'], 'npm test, src/a.ts đã sửa')).toBe(true)
  })

  test('evidence nêu thêm tùy chọn sau lệnh: so khớp nghiêm ngặt, không nhận', () => {
    expect(accepted(['go test ./...'], 'go test ./... -run TestX: ok')).toBe(false)
  })

  test('lần chạy cuối của lệnh được tính, không phải lần đầu', () => {
    expect(accepted(['!npm test', 'npm test'], 'npm test: đạt')).toBe(true)
    expect(accepted(['npm test', '!npm test'], 'npm test: đạt')).toBe(false)
  })
})
