// Test tái hiện vòng review PR #13 lần 3: báo cáo "đạt" qua ống phải được parser chứng minh trên output THẬT của
// trình chạy (tests/fixtures/runner-output.ts), bộ lọc chỉ đọc từ ống, lệnh kiểm tra không có chuyển hướng ngoài 2>&1.
// Chỉ dùng API đã có ở aa73308; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief } from '../types'
import { completePass, observe, newTracker } from '../hooks/lib/drift'
import { CARGO, GO, NODE, VERSIONS, tailLines } from './fixtures/runner-output'

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

describe('PR #13 vòng 3: fixture là output thật', () => {
  test('ghi lại phiên bản công cụ đã sinh fixture', () => {
    expect(VERSIONS.node).toBe('v22.22.0')
    expect(VERSIONS.go).toBe('go1.24.7')
    expect(VERSIONS.cargo).toBe('1.97.0')
  })
})

describe('PR #13 vòng 3: báo cáo Node phải đủ sáu bộ đếm và khớp nhau', () => {
  test('tests khác pass + skipped + todo: không đạt', () => {
    expect(completePass('# tests 3\n# pass 2\n# fail 0')).toBe(false)
    expect(completePass(NODE.pass_tap.replace('# tests 3', '# tests 4'))).toBe(false)
    expect(completePass(NODE.pass_spec.replace('ℹ tests 3', 'ℹ tests 4'))).toBe(false)
  })

  test('thiếu bất kỳ bộ đếm nào: không đạt (không tự điền 0)', () => {
    expect(completePass('# tests 3\n# pass 3\n# fail 0')).toBe(false)
    for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
      const cut = NODE.pass_tap.replace(new RegExp(`^# ${field} \\d+\\n`, 'm'), '')
      expect(completePass(cut), field).toBe(false)
    }
  })

  test('cancelled khác 0: không đạt', () => {
    expect(completePass(NODE.pass_tap.replace('# cancelled 0', '# cancelled 1').replace('# tests 3', '# tests 4'))).toBe(false)
  })

  test('báo cáo không nhất quán hay không có test đạt (do kiểm đột biến chỉ ra): không đạt', () => {
    // cancelled 1 mà tests vẫn bằng pass + skipped + todo: điều kiện cancelled = 0 phải tự đứng được.
    expect(completePass(NODE.pass_tap.replace('# cancelled 0', '# cancelled 1'))).toBe(false)
    // Mọi test đều skip: tests = pass + skipped + todo nhưng pass = 0.
    expect(completePass(NODE.skip_tap.replace('# pass 2', '# pass 0').replace('# skipped 1', '# skipped 3'))).toBe(false)
    // Dòng not ok không kèm khối YAML có error: (reporter TAP khác): vẫn là test lỗi.
    const bare = NODE.todothrow_tap.replace(/(not ok 2 - b # TODO\n) {2}---[\s\S]*? {2}\.\.\.\n/, '$1')
    expect(bare).not.toContain('error:')
    expect(completePass(bare)).toBe(false)
  })

  test('output đạt đầy đủ (TAP và spec, kể cả có test skip hay todo không lỗi): đạt', () => {
    for (const key of ['pass_tap', 'pass_spec', 'skip_tap', 'skip_spec', 'todook_tap', 'todook_spec'] as const) {
      expect(completePass(NODE[key]), key).toBe(true)
    }
  })

  test('output có test lỗi: không đạt ở mọi mức cắt', () => {
    for (const key of ['fail_tap', 'fail_spec'] as const) {
      const lines = NODE[key].split('\n').length
      for (let n = 1; n <= lines; n++) expect(completePass(tailLines(NODE[key], n)), `${key} tail ${n}`).toBe(false)
    }
  })

  test('test TODO ném lỗi (not ok ... # TODO, tổng kết vẫn fail 0): không đạt, kể cả output đầy đủ', () => {
    expect(completePass(NODE.todothrow_tap)).toBe(false)
    expect(completePass(NODE.todothrow_spec)).toBe(false)
  })

  test('qua tail: thiếu bộ đếm thì không đạt; còn đủ tổng kết thì đạt; có todo thì không đạt', () => {
    expect(verifiedAfter('node --test --test-reporter=tap | tail -n 5', tailLines(NODE.pass_tap, 5))).toBe(false)
    expect(verifiedAfter('node --test --test-reporter=tap | tail -n 12', tailLines(NODE.pass_tap, 12))).toBe(true)
    expect(verifiedAfter('node --test --test-reporter=spec | tail -n 8', tailLines(NODE.pass_spec, 8))).toBe(true)
    expect(verifiedAfter('node --test --test-reporter=tap | tail -n 12', tailLines(NODE.todook_tap, 12))).toBe(false)
    expect(verifiedAfter('node --test --test-reporter=tap | tail -n 9', tailLines(NODE.todothrow_tap, 9))).toBe(false)
    expect(verifiedAfter('node --test --test-reporter=tap | cat', NODE.todook_tap)).toBe(true)
    expect(verifiedAfter('node --test --test-reporter=tap | cat', NODE.todothrow_tap)).toBe(false)
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
    for (const filter of ['tail -n 12', 'tail -n12', 'tail -12', 'tail --lines=12', 'tail --lines 12', 'tail', 'cat']) {
      expect(verifiedAfter(`node --test | ${filter}`, tailLines(NODE.pass_tap, 12)), filter).toBe(true)
    }
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

describe('PR #13 vòng 3: Go', () => {
  test('dòng thật (khoảng trắng và tab), (cached), kèm coverage: đạt khi output đầy đủ', () => {
    expect(completePass(GO.pass)).toBe(true)
    expect(completePass(GO.cached)).toBe(true)
    expect(completePass(GO.cover)).toBe(true)
    expect(verifiedAfter('go test ./... | cat', GO.pass)).toBe(true)
  })

  test('một gói FAIL hay lỗi biên dịch: không đạt', () => {
    expect(completePass(GO.fail)).toBe(false)
    expect(completePass(GO.build)).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\t0.002s\npanic: boom\n')).toBe(false)
  })

  test('dòng TAP "ok 1 - a" hay dòng ok không đúng dạng: không phải báo cáo Go', () => {
    expect(completePass('ok 1 - a\n')).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\n')).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\t0.002s\nok 1 - a\n')).toBe(false)
  })

  test('qua tail: không bao giờ nhận, kể cả output toàn dòng đạt', () => {
    expect(verifiedAfter('go test ./... | tail -n 5', GO.pass)).toBe(false)
    // tail cắt mất gói FAIL in trước, chỉ còn dòng đạt của gói in sau.
    expect(verifiedAfter('go test ./... | tail -n 1', 'ok  \texample.com/fx/a\t(cached)\n')).toBe(false)
  })
})

describe('PR #13 vòng 3: Cargo', () => {
  test('mọi binary và doctest đạt: đạt khi output đầy đủ', () => {
    expect(completePass(CARGO.pass)).toBe(true)
    expect(verifiedAfter('cargo test | cat', CARGO.pass)).toBe(true)
  })

  test('một binary FAILED, dòng error:, hay lỗi biên dịch: không đạt', () => {
    expect(completePass(CARGO.fail)).toBe(false)
    expect(completePass(CARGO.build)).toBe(false)
    expect(completePass(`${CARGO.pass}error: could not compile \`rs\` (test "c_broken") due to 1 previous error\n`)).toBe(false)
    expect(completePass(`error[E0308]: mismatched types\n${CARGO.pass}`)).toBe(false)
  })

  test('dòng test result không đúng dạng, hay mọi binary 0 passed (do kiểm đột biến chỉ ra): không đạt', () => {
    expect(completePass(`${CARGO.pass}test result: ok. 1 passed;\n`)).toBe(false)
    expect(completePass(CARGO.pass.replace(/test result: ok\. 1 passed/g, 'test result: ok. 0 passed'))).toBe(false)
  })

  test('qua tail: không bao giờ nhận, kể cả phần cuối chỉ có dòng đạt', () => {
    expect(verifiedAfter('cargo test | tail -n 3', tailLines(CARGO.pass, 3))).toBe(false)
    expect(verifiedAfter('cargo test --no-fail-fast | tail -n 6', tailLines(CARGO.fail, 6).replace(/error.*\n?/g, ''))).toBe(false)
  })
})
