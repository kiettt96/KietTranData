// Độ mạnh của evidence (hooks/lib/drift/claims): mọi lệnh kiểm tra được nhắc phải có lần chạy hợp lệ sau thay đổi cuối; tùy chọn thu hẹp phạm vi là danh tính; dấu câu quanh đường dẫn.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { acceptsVerified, checkKindOf, evidenceMatches, evidenceStrength, isMutation, isReadOnlyCommand, newEvidenceLog, noteEvidence } from '../../hooks/lib/drift'
import { NODE, tailLines } from '../fixtures/runner-output'
import { accepted, bash, strength, verifiedAfter } from '../support/commands'

describe('04: độ mạnh của bằng chứng', () => {
  test('strong, stale, weak, none theo kết quả và thứ tự thật của lệnh', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false })
    noteEvidence(log, { tool: 'Bash', input: { command: 'npm test' }, isError: true, isReadOnly: false })
    expect(evidenceStrength('npm test', log).level).toBe('stale')
    noteEvidence(log, { tool: 'Bash', input: { command: 'npm test' }, isError: false, isReadOnly: false })
    expect(evidenceStrength('npm test: 12 pass', log)).toEqual({ level: 'strong', check: 'test' })
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/src/b.ts' }, isError: false, isReadOnly: false })
    expect(evidenceStrength('npm test: 12 pass', log).level).toBe('stale')
    expect(evidenceStrength('đã đọc lại a.ts', log).level).toBe('weak')
    expect(evidenceStrength('ổn', log).level).toBe('none')
    expect(acceptsVerified({ level: 'weak' }, log)).toBe(false)
    expect(acceptsVerified({ level: 'weak' }, newEvidenceLog(2))).toBe(true)
    expect(checkKindOf('cd mod && npx tsc --noEmit')).toBe('static')
    expect(checkKindOf('npx tsc && npm test')).toBe('test')
    expect(checkKindOf('ls tests/')).toBe(null)
  })
})

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
      ['npx vitest run --reporter=verbose', 'npx vitest run: đạt'],
      ['npx mocha --reporter dot', 'npx mocha: đạt'],
      ['npx jest --verbose', 'npx jest: đạt'],
      // Vòng 3: cờ của npx là một phần danh tính (xem review052c); evidence phải nêu cờ đó. Vòng 4: cả tiền tố npx.
      ['npx --no-install tsc -p tsconfig.json', 'npx --no-install tsc -p tsconfig.json: sạch'],
      ['npx -y tsc -p tsconfig.json', 'npx --yes tsc -p tsconfig.json: sạch'],
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

describe('0.5.0: đối chiếu evidence và lệnh in biến môi trường', () => {
  test('env và printenv không kèm lệnh là chỉ đọc; env kèm lệnh thì không', () => {
    expect(isReadOnlyCommand('env | grep -i claude | sed -E \'s/=.*/=…/\' | head -30')).toBe(true)
    expect(isReadOnlyCommand('printenv PATH')).toBe(true)
    expect(isReadOnlyCommand('printenv')).toBe(true)
    expect(isReadOnlyCommand('env FOO=1 make build')).toBe(false)
    expect(isReadOnlyCommand('env -0')).toBe(true)
  })

  test('evidence khớp khi nhắc vài từ đầu của lệnh đã chạy, đối số dạng đường dẫn, hoặc file đã đụng tới', () => {
    const log = newEvidenceLog(1)
    const bash = (command: string) => noteEvidence(log, { tool: 'Bash', input: { command }, isError: false, isReadOnly: false })
    bash('cd /repo/mod && claude plugin test . 2>&1 | tail -3')
    bash('npx --no-install tsc -p scratchpad/tc/tsconfig.repo.json')
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/mod/hooks/lib/drift.ts' }, isError: false, isReadOnly: false })
    expect(evidenceMatches('claude plugin test . 184 pass 0 fail', log)).toBe(true)
    // 0.5.2: phải nêu đủ danh tính lệnh (kể cả đối số); `npx tsc` không nêu file cấu hình nên là lệnh kiểm tra chưa chạy.
    expect(evidenceStrength('npx tsc sạch', log).level).toBe('stale')
    expect(evidenceMatches('tsc -p scratchpad/tc/tsconfig.repo.json không lỗi', log)).toBe(true)
    expect(evidenceMatches('đã đọc lại drift.ts', log)).toBe(true)
    expect(evidenceMatches('đã kiểm tra kỹ, chạy ổn', log)).toBe(false)
    // PR #14: nhắc một lệnh kiểm tra chưa chạy là stale (bị từ chối có lý do), không còn là none.
    expect(evidenceStrength('npm test 12 pass', log).level).toBe('stale')
    expect(evidenceMatches('anything', newEvidenceLog(1))).toBe(false)
  })
})
