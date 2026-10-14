// Báo cáo của go test và cargo test (hooks/lib/drift/output): mọi gói, mọi binary, output bị cắt.
// Gom từ test của review PR #13 vòng 3; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { completePass } from '../../hooks/lib/drift'
import { CARGO, GO, tailLines } from '../fixtures/runner-output'
import { verifiedAfter } from '../support/commands'

describe('PR #13 vòng 3: Go', () => {
  test('dòng thật (khoảng trắng và tab), (cached), kèm coverage: đạt khi output đầy đủ', () => {
    expect(completePass(GO.pass, 'go')).toBe(true)
    expect(completePass(GO.cached, 'go')).toBe(true)
    expect(completePass(GO.cover, 'go')).toBe(true)
    expect(verifiedAfter('go test ./... | cat', GO.pass)).toBe(true)
  })

  test('một gói FAIL hay lỗi biên dịch: không đạt', () => {
    expect(completePass(GO.fail, 'go')).toBe(false)
    expect(completePass(GO.build, 'go')).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\t0.002s\npanic: boom\n', 'go')).toBe(false)
  })

  test('dòng TAP "ok 1 - a" hay dòng ok không đúng dạng: không phải báo cáo Go', () => {
    expect(completePass('ok 1 - a\n', 'go')).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\n', 'go')).toBe(false)
    expect(completePass('ok  \texample.com/fx/a\t0.002s\nok 1 - a\n', 'go')).toBe(false)
  })

  test('qua tail: không bao giờ nhận, kể cả output toàn dòng đạt', () => {
    expect(verifiedAfter('go test ./... | tail -n 5', GO.pass)).toBe(false)
    // tail cắt mất gói FAIL in trước, chỉ còn dòng đạt của gói in sau.
    expect(verifiedAfter('go test ./... | tail -n 1', 'ok  \texample.com/fx/a\t(cached)\n')).toBe(false)
  })
})

describe('PR #13 vòng 3: Cargo', () => {
  test('mọi binary và doctest đạt: đạt khi output đầy đủ', () => {
    expect(completePass(CARGO.pass, 'cargo')).toBe(true)
    expect(verifiedAfter('cargo test | cat', CARGO.pass)).toBe(true)
  })

  test('một binary FAILED, dòng error:, hay lỗi biên dịch: không đạt', () => {
    expect(completePass(CARGO.fail, 'cargo')).toBe(false)
    expect(completePass(CARGO.build, 'cargo')).toBe(false)
    expect(completePass(`${CARGO.pass}error: could not compile \`rs\` (test "c_broken") due to 1 previous error\n`, 'cargo')).toBe(false)
    expect(completePass(`error[E0308]: mismatched types\n${CARGO.pass}`, 'cargo')).toBe(false)
  })

  test('dòng test result không đúng dạng, hay mọi binary 0 passed (do kiểm đột biến chỉ ra): không đạt', () => {
    expect(completePass(`${CARGO.pass}test result: ok. 1 passed;\n`, 'cargo')).toBe(false)
    expect(completePass(CARGO.pass.replace(/test result: ok\. 1 passed/g, 'test result: ok. 0 passed'), 'cargo')).toBe(false)
  })

  test('qua tail: không bao giờ nhận, kể cả phần cuối chỉ có dòng đạt', () => {
    expect(verifiedAfter('cargo test | tail -n 3', tailLines(CARGO.pass, 3))).toBe(false)
    expect(verifiedAfter('cargo test --no-fail-fast | tail -n 6', tailLines(CARGO.fail, 6).replace(/error.*\n?/g, ''))).toBe(false)
  })
})
