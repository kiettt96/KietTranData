// Báo cáo của node --test (hooks/lib/drift/output): đủ bộ đếm và khớp nhau, TAP và spec.
// Gom từ test của review PR #13 vòng 3; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { completePass } from '../../hooks/lib/drift'
import { NODE, tailLines } from '../fixtures/runner-output'
import { verifiedAfter } from '../support/commands'

describe('PR #13 vòng 3: báo cáo Node phải đủ sáu bộ đếm và khớp nhau', () => {
  test('tests khác pass + skipped + todo: không đạt', () => {
    expect(completePass('# tests 3\n# pass 2\n# fail 0', 'node')).toBe(false)
    expect(completePass(NODE.pass_tap.replace('# tests 3', '# tests 4'), 'node')).toBe(false)
    expect(completePass(NODE.pass_spec.replace('ℹ tests 3', 'ℹ tests 4'), 'node')).toBe(false)
  })

  test('thiếu bất kỳ bộ đếm nào: không đạt (không tự điền 0)', () => {
    expect(completePass('# tests 3\n# pass 3\n# fail 0', 'node')).toBe(false)
    for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
      const cut = NODE.pass_tap.replace(new RegExp(`^# ${field} \\d+\\n`, 'm'), '')
      expect(completePass(cut, 'node'), field).toBe(false)
    }
  })

  test('cancelled khác 0: không đạt', () => {
    expect(completePass(NODE.pass_tap.replace('# cancelled 0', '# cancelled 1').replace('# tests 3', '# tests 4'), 'node')).toBe(false)
  })

  test('báo cáo không nhất quán hay không có test đạt (do kiểm đột biến chỉ ra): không đạt', () => {
    // cancelled 1 mà tests vẫn bằng pass + skipped + todo: điều kiện cancelled = 0 phải tự đứng được.
    expect(completePass(NODE.pass_tap.replace('# cancelled 0', '# cancelled 1'), 'node')).toBe(false)
    // Mọi test đều skip: tests = pass + skipped + todo nhưng pass = 0.
    expect(completePass(NODE.skip_tap.replace('# pass 2', '# pass 0').replace('# skipped 1', '# skipped 3'), 'node')).toBe(false)
    // Dòng not ok không kèm khối YAML có error: (reporter TAP khác): vẫn là test lỗi.
    const bare = NODE.todothrow_tap.replace(/(not ok 2 - b # TODO\n) {2}---[\s\S]*? {2}\.\.\.\n/, '$1')
    expect(bare).not.toContain('error:')
    expect(completePass(bare, 'node')).toBe(false)
  })

  test('output đạt đầy đủ (TAP và spec, kể cả có test skip hay todo không lỗi): đạt', () => {
    for (const key of ['pass_tap', 'pass_spec', 'skip_tap', 'skip_spec', 'todook_tap', 'todook_spec'] as const) {
      expect(completePass(NODE[key], 'node'), key).toBe(true)
    }
  })

  test('output có test lỗi: không đạt ở mọi mức cắt', () => {
    for (const key of ['fail_tap', 'fail_spec'] as const) {
      const lines = NODE[key].split('\n').length
      for (let n = 1; n <= lines; n++) expect(completePass(tailLines(NODE[key], n), 'node'), `${key} tail ${n}`).toBe(false)
    }
  })

  test('test TODO ném lỗi (not ok ... # TODO, tổng kết vẫn fail 0): không đạt, kể cả output đầy đủ', () => {
    expect(completePass(NODE.todothrow_tap, 'node')).toBe(false)
    expect(completePass(NODE.todothrow_spec, 'node')).toBe(false)
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
