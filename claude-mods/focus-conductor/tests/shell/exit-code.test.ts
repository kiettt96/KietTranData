// Mã thoát của lệnh kiểm tra (hooks/lib/drift/classify): bị che bởi lệnh đứng sau, bộ lọc chỉ đọc từ ống, chuyển hướng ngoài 2>&1.
// Gom từ test của review PR #13; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { evidenceStrength, newEvidenceLog, noteEvidence } from '../../hooks/lib/drift'
import { CARGO, GO, NODE, tailLines } from '../fixtures/runner-output'
import { bash, edit, verifiedAfter } from '../support/commands'

describe('PR #13 P1: mã thoát của lệnh kiểm tra bị che bởi lệnh đứng sau', () => {
  test('kiểm tra trước ; hoặc || (output không rõ, mã thoát 0): chưa kiểm tra', () => {
    for (const command of ['npm test; echo done', 'npm test || echo fallback', 'npm test && echo ok || echo bad', 'npm test; true']) {
      expect(verifiedAfter(command, { output: 'done' }), command).toBe(false)
    }
  })

  test('mã thoát bị che (; hay ||) không bao giờ được tính là đạt, kể cả khi output có báo cáo đạt', () => {
    expect(verifiedAfter('npm test; echo done', { output: 'Tests: 12 passed, 12 total\ndone' })).toBe(false)
    expect(verifiedAfter('node --test || echo fallback', { output: '# tests 3\n# pass 3\n# fail 0' })).toBe(false)
  })

  test('npm test; printf "1 passed" (lệnh sau tự in báo đạt): chưa xác minh', () => {
    expect(verifiedAfter("npm test; printf '1 passed\\n'", { output: '1 passed' })).toBe(false)
  })

  test('lọc ống: sed, grep, head, tee không xác nhận; tail hoặc cat chỉ khi có báo cáo tổng kết đầy đủ', () => {
    expect(verifiedAfter('npm test | sed \'s/failed/passed/\'', { output: '12 passed' })).toBe(false)
    expect(verifiedAfter('npm test | grep -v FAIL', { output: '12 passed' })).toBe(false)
    expect(verifiedAfter('npm test 2>&1 | head -40', { output: '# tests 3\n# pass 3\n# fail 0' })).toBe(false)
    expect(verifiedAfter('node --test | tail -n 12', { output: tailLines(NODE.pass_tap, 12) })).toBe(true)
    expect(verifiedAfter('node --test | tail -n 5', { output: '1 passed' })).toBe(false)
    expect(verifiedAfter('npx jest | cat', { output: 'Tests:       12 passed, 12 total' })).toBe(true)
    expect(verifiedAfter('node --test | tail -n 5', { output: '# tests 3\n# pass 2\n# fail 1' })).toBe(false)
  })

  test('mỗi lệnh kiểm tra gắn với đoạn của chính nó: evidence cho lint không xác nhận test và ngược lại', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit('/repo/src/a.ts'))
    noteEvidence(log, { ...bash('npm test && npm run lint | tail -3'), output: '# tests 3\n# pass 3\n# fail 0\nlint: problem' })
    expect(evidenceStrength('npm run lint: đạt', log).level).not.toBe('strong')
    expect(evidenceStrength('npm test: 3 pass', log).level).toBe('strong')
  })

  test('đối chứng: kiểm tra mà mọi lệnh sau đều nối bằng && thì mã thoát phản ánh kiểm tra', () => {
    expect(verifiedAfter('npm test && echo done', { output: 'done' })).toBe(true)
    expect(verifiedAfter('npm test && npm run lint', { output: 'done' })).toBe(true)
  })
})

describe('PR #13 vòng 3: bộ lọc chỉ đọc từ ống', () => {
  test('tail hay cat có file, chuyển hướng đọc, hay tùy chọn ngoài danh sách: chưa xác minh', () => {
    for (const filter of [
      'cat /tmp/fake.log', 'tail -n 5 /tmp/fake.log', 'cat < /tmp/fake.log', 'tail -n 12 < /tmp/fake.log', 'cat 0< /tmp/fake.log',
      'cat <<< x', 'cat <(echo x)', 'cat -', 'tail -f', 'tail -c 200', 'tail +3', 'tail -n +3', 'tail -n 0', 'tail -n 12 2>/dev/null',
    ]) {
      expect(verifiedAfter(`node --test | ${filter}`, NODE.pass_tap), filter).toBe(false)
    }
  })

  test('cat đọc heredoc hay có đối số trong nháy (kể cả rỗng): chưa xác minh', () => {
    expect(verifiedAfter(`node --test | cat <<EOF\n${NODE.pass_tap}EOF`, NODE.pass_tap)).toBe(false)
    expect(verifiedAfter(`node --test | cat <<'EOF'\n${NODE.pass_tap}EOF`, NODE.pass_tap)).toBe(false)
    expect(verifiedAfter("node --test | cat ''", NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('node --test | tail -n "12"', tailLines(NODE.pass_tap, 12))).toBe(false)
  })

  test('tail chỉ với số dòng (-n N, -nN, -N, --lines=N, --lines N) và cat không đối số: xác minh khi báo cáo đủ', () => {
    for (const filter of ['tail -n 12', 'tail -n12', 'tail -12', 'tail --lines=12', 'tail --lines 12', 'tail']) {
      expect(verifiedAfter(`node --test | ${filter}`, tailLines(NODE.pass_tap, 12)), filter).toBe(true)
    }
    // cat giữ output đầy đủ: báo cáo phải đủ cả phần đầu (0.5.2: TAP version, đúng N dòng kết quả).
    expect(verifiedAfter('node --test | cat', NODE.pass_tap)).toBe(true)
    expect(verifiedAfter('node --test | cat', tailLines(NODE.pass_tap, 12))).toBe(false)
  })
})

describe('PR #13 vòng 3: lệnh kiểm tra nối ống không được có chuyển hướng ngoài 2>&1', () => {
  test('2>/dev/null, >file, >>file, &>file, <file trên lệnh kiểm tra: chưa xác minh', () => {
    expect(verifiedAfter('cargo test 2>/dev/null | cat', CARGO.pass)).toBe(false)
    expect(verifiedAfter('go test ./... 2>/dev/null | cat', GO.pass)).toBe(false)
    expect(verifiedAfter('npm test > /tmp/test.log | cat', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('npm test >> /tmp/test.log | cat', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('npm test &> x | cat', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('node --test < /dev/null | cat', NODE.pass_tap)).toBe(false)
  })

  test('đúng 2>&1 trước ống: xác minh khi báo cáo đủ', () => {
    expect(verifiedAfter('node --test 2>&1 | tail -n 12', tailLines(NODE.pass_tap, 12))).toBe(true)
    expect(verifiedAfter('cargo test 2>&1 | cat', CARGO.pass)).toBe(true)
  })

  test('mã thoát nhìn thấy (không ống): chuyển hướng không đổi kết quả', () => {
    expect(verifiedAfter('npm test 2>/dev/null', '')).toBe(true)
  })
})
