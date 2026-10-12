// Test tái hiện review PR #14 vòng 3: chữ hoa thường chỉ chuẩn hóa theo ngữ pháp lệnh (giữ đường dẫn, giá trị bộ lọc,
// tên script); `=` chỉ tách cho cờ đã biết nhận giá trị và không tách sau `--`/`-args`; cờ của npx là một phần danh
// tính; lệnh trong evidence phải kết thúc ở ranh giới; `.` là đối số; `-count` không phải cờ trình bày.
// Chỉ dùng API đã có ở a844fbc; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import { acceptsVerified, evidenceStrength, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'

const bash = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output: '' })
const edit = { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }

function strength(runs: string[], evidence: string) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit)
  for (const run of runs) noteEvidence(log, bash(run))
  const result = evidenceStrength(evidence, log)
  return { ...result, accepted: acceptsVerified(result, log) }
}
const accepted = (run: string, evidence: string) => strength([run], evidence).accepted

/** Ca âm: không nhận, mức stale, lý do trung tính nêu yêu cầu khớp chính xác (không khẳng định "chưa chạy"). */
function rejected(run: string, evidence: string) {
  const result = strength([run], evidence)
  expect(result.accepted, `${run} / ${evidence}`).toBe(false)
  expect(result.level, `${run} / ${evidence}`).toBe('stale')
  expect(result.reason ?? '', `${run} / ${evidence}`).toContain('khớp chính xác')
  expect(result.reason ?? '', `${run} / ${evidence}`).not.toContain('chưa chạy')
}

describe('PR #14 vòng 3: chữ hoa thường theo ngữ pháp lệnh', () => {
  test('đường dẫn, giá trị bộ lọc, tên script khác chữ hoa thường: không nhận', () => {
    rejected('node --test src/a.test.ts', 'node --test SRC/A.test.ts: đạt')
    rejected('go test -run=TestPayment ./...', 'go test -run=Testpayment ./...: ok')
    rejected('npm run Lint', 'npm run lint: đạt')
    rejected('make test', 'make Test: đạt')
  })

  test('tên executable và từ khóa lệnh con viết hoa (đầu câu, cấu trúc nhiều cấp): vẫn là cùng lệnh', () => {
    for (const [run, evidence] of [
      ['node --test src/a.test.ts', 'Node --test src/a.test.ts: đạt'],
      ['go test ./...', 'Go Test ./...: ok'],
      ['cargo clippy', 'Cargo Clippy: sạch'],
      ['claude plugin validate .', 'Claude Plugin Validate .: qua'],
      ['python -m pytest tests/', 'Python -m Pytest tests/: đạt'],
      ['npm run lint', 'NPM Run lint: đạt'],
    ] as const) {
      expect(accepted(run, evidence), `${run} / ${evidence}`).toBe(true)
    }
  })
})

describe('PR #14 vòng 3: dạng --cờ=giá-trị chỉ đồng nhất với cờ đã biết', () => {
  test('cờ đã cho phép (Node, Go, pytest): dạng = và dạng tách khớp nhau', () => {
    for (const [run, evidence] of [
      ['node --test --test-name-pattern=smoke src/a.test.ts', 'node --test --test-name-pattern smoke src/a.test.ts: đạt'],
      ['node --test --test-skip-pattern slow src/a.test.ts', 'node --test --test-skip-pattern=slow src/a.test.ts: đạt'],
      ['go test -run=TestPayment ./...', 'go test -run TestPayment ./...: ok'],
      ['go test -skip TestSlow ./...', 'go test -skip=TestSlow ./...: ok'],
      ['go test -count=1 ./...', 'go test -count 1 ./...: ok'],
      ['pytest -k=smoke tests/', 'pytest -k smoke tests/: đạt'],
      ['pytest -m slow tests/', 'pytest -m=slow tests/: đạt'],
    ] as const) {
      expect(accepted(run, evidence), `${run} / ${evidence}`).toBe(true)
    }
  })

  test('cờ lạ, hay sau dấu phân cách -- và -args: không tự đồng nhất', () => {
    rejected('go test -foo=x ./...', 'go test -foo x ./...: ok')
    rejected('npm test -- --custom=smoke', 'npm test -- --custom smoke: pass')
    rejected('go test ./... -args -v', 'go test ./... -args: ok')
    expect(accepted('npm test -- --custom=smoke', 'npm test -- --custom=smoke: pass')).toBe(true)
    expect(accepted('go test ./... -args -v', 'go test ./... -args -v: ok')).toBe(true)
  })
})

describe('PR #14 vòng 3: cờ của npx là một phần danh tính', () => {
  test('--no-install, --yes, không cờ và gọi trực tiếp là bốn lệnh khác nhau', () => {
    rejected('npx --no-install tsc -p x', 'npx --yes tsc -p x: sạch')
    rejected('npx --yes tsc -p x', 'npx tsc -p x: sạch')
    rejected('npx --no-install tsc -p x', 'tsc -p x: sạch')
    rejected('npx --yes tsc -p x', 'tsc -p x: sạch')
  })

  test('alias thật được đồng nhất; bỏ tên npx (không cờ) vẫn là cùng lệnh', () => {
    expect(accepted('npx -y tsc -p x', 'npx --yes tsc -p x: sạch')).toBe(true)
    expect(accepted('npx --no-install tsc -p x', 'npx --no tsc -p x: sạch')).toBe(true)
    expect(accepted('npx tsc -p x', 'tsc -p x: sạch')).toBe(true)
  })
})

describe('PR #14 vòng 3: lệnh trong evidence phải kết thúc ở ranh giới', () => {
  test('dấu câu, ngoặc, backtick, nháy (cả nháy chữ Việt) hay hết evidence: nhận', () => {
    for (const evidence of [
      'go test ./...: ok', '`go test ./...` ok', "'go test ./...' ok", '"go test ./..." ok', '“go test ./...” ok', '‘go test ./...’ ok',
      '(go test ./...) ok', 'go test ./...; passed', 'Đã chạy go test ./...',
    ]) {
      expect(accepted('go test ./...', evidence), evidence).toBe(true)
    }
  })

  test('từ đứng ngay sau lệnh không có ranh giới (đối số thêm hay kết quả viết liền): không nhận', () => {
    rejected('go test ./...', 'go test ./... fmt: ok')
    rejected('go test ./...', 'go test ./... ok')
    rejected('npm test', 'npm test 12 pass')
    rejected('node --test src/a.test.ts', 'node --test src/a.test.ts src/b.test.ts: ok')
  })
})

describe('PR #14 vòng 3: . là đối số, -count không phải cờ trình bày', () => {
  test('. thêm vào hay bỏ đi đều là lệnh khác', () => {
    rejected('pytest tests/', 'pytest tests/ .: đạt')
    expect(accepted('claude plugin test .', 'claude plugin test .: 381 pass')).toBe(true)
    rejected('claude plugin test .', 'claude plugin test: pass')
  })

  test('go test ./... và go test -count=1 ./... khác nhau theo cả hai chiều', () => {
    rejected('go test ./...', 'go test -count=1 ./...: ok')
    rejected('go test -count=1 ./...', 'go test ./...: ok')
  })
})

describe('PR #14 vòng 3: evidence chép nguyên câu lệnh có ống và gộp luồng', () => {
  test('ống | là ranh giới và 2>&1 bị bỏ, như khi ghi lệnh vào dấu vết', () => {
    expect(accepted('cargo test', 'cargo test | cat: 3 passed')).toBe(true)
    expect(accepted('node --test src/a.test.ts', 'node --test src/a.test.ts 2>&1 | tail -n 12: đạt')).toBe(true)
    rejected('node --test src/a.test.ts', 'node --test src/a.test.ts 2>/dev/null: đạt')
  })
})

describe('PR #14 vòng 3: ca biên do kiểm đột biến chỉ ra', () => {
  test('cờ trình bày của trình chạy khác, viết dạng tách, vẫn là một phần danh tính', () => {
    rejected('go test --tb short ./...', 'go test ./...: ok')
    rejected('pytest --test-reporter tap tests/', 'pytest tests/: đạt')
    rejected('go test -q ./...', 'go test ./...: ok')
  })

  test('tên script viết tắt (yarn X) giữ chữ: chỉ từ khóa lệnh con mới được hạ chữ thường', () => {
    rejected('yarn Lint', 'yarn lint: đạt')
    expect(accepted('yarn test', 'Yarn Test: đạt')).toBe(true)
  })

  test('sau -- và -args không tách = và không bỏ cờ trình bày', () => {
    rejected('node --test -- --test-name-pattern=x', 'node --test -- --test-name-pattern x: đạt')
    rejected('go test ./... -args -run=X', 'go test ./... -args -run X: ok')
    rejected('node --test -- --test-reporter tap', 'node --test --: đạt')
  })

  test('ngoặc mở là ranh giới: kết quả trong ngoặc ngay sau lệnh', () => {
    expect(accepted('npm test', 'npm test (12 pass)')).toBe(true)
  })
})

describe('PR #14 vòng 3: tên script giữ chữ cả ở mức chỉ đọc', () => {
  test('việc chỉ đọc (chưa sửa gì): lệnh khác chữ tên script không làm evidence khớp', () => {
    // yarn Lint không phải lệnh kiểm tra đã nhận diện, nên chỉ ở mức chỉ đọc (weak) chữ hoa thường mới đổi kết quả.
    const log = newEvidenceLog(1)
    // Engine báo lệnh chỉ đọc, nên không tính là thay đổi; mục tiêu vẫn chưa sửa gì.
    noteEvidence(log, { ...bash('yarn Deploy'), isReadOnly: true })
    expect(acceptsVerified(evidenceStrength('yarn deploy: xong', log), log)).toBe(false)
    expect(acceptsVerified(evidenceStrength('yarn Deploy: xong', log), log)).toBe(true)
  })
})
