// 0.9.0 vòng 2 M21b: chế độ chạy theo tầng của scripts/mutate.ts (cờ --tiered). Luật nhận như bộ chạy ngoài đã dùng ở vòng
// G6: KILLED khi mod không nạp hoặc có ít nhất một ca lỗi không do hết giờ; mọi ca lỗi đều do hết giờ thì chưa có phán quyết,
// chạy lại tầng một lần rồi đi tiếp; TIMEOUT, ERROR chạy lại tầng một lần rồi giữ; SURVIVED chỉ khi cả bộ không có ca lỗi.
// Chỉ kiểm hàm thuần (môi trường test không spawn được tiến trình); phép chạy thật trên sáu mẫu đối chứng ghi ở VERIFICATION.

import { describe, expect, test } from 'claude-code/testing'

import { finalOf, mentionTests, parseRun, stepOf, tierPlan, versionOf } from '../scripts/tiers'

const TESTS = [
  'tests/a-061.test.ts',
  'tests/integration/b-090.test.ts',
  'tests/integration/c.test.ts',
  'tests/d-090.test.ts',
  'tests/e.test.ts',
]
const TEXTS = new Map<string, string>([
  ['tests/a-061.test.ts', "import { x } from '../hooks/lib/verdict'"],
  ['tests/integration/b-090.test.ts', 'kiểm pane'],
  ['tests/integration/c.test.ts', "import { seed } from '../support/seed'"],
  ['tests/support/seed.ts', "import { y } from '../../hooks/lib/verdict'"],
  ['tests/d-090.test.ts', 'không nhắc'],
  ['tests/e.test.ts', 'verdict.ts trong chú thích'],
])

describe('0.9.0 M21b: chọn tệp test cho từng tầng', () => {
  test('phiên bản lấy từ tiền tố ba chữ số của mã mẫu; mã không có tiền tố thì không có tầng 1', () => {
    expect(versionOf('090-M3b')).toBe('090')
    expect(versionOf('061-U1')).toBe('061')
    expect(versionOf('r5-C4')).toBeUndefined()
    expect(versionOf('P12')).toBeUndefined()
  })

  test('tầng giữa: tệp test nhắc module theo thư mục cha và tên, hay tên tệp, lan qua tệp hỗ trợ mà nó nhập', () => {
    expect(mentionTests('hooks/lib/verdict.ts', TEXTS, TESTS)).toEqual(['tests/a-061.test.ts', 'tests/integration/c.test.ts', 'tests/e.test.ts'])
  })

  test('kế hoạch: tầng 1 cùng bản, tầng giữa gồm tệp nhắc module và lịch sử diệt, tầng cuối cả bộ', () => {
    const plan = tierPlan({ id: '061-U1', file: 'hooks/lib/verdict.ts' }, TESTS, TEXTS, { 'hooks/lib/verdict.ts': ['tests/d-090.test.ts'] })
    expect(plan).toEqual([
      ['t1', ['tests/a-061.test.ts']],
      ['mid', ['tests/a-061.test.ts', 'tests/integration/c.test.ts', 'tests/d-090.test.ts', 'tests/e.test.ts']],
      ['full', TESTS],
    ])
  })

  test('mẫu không có tiền tố phiên bản: tầng 1 rỗng', () => {
    const plan = tierPlan({ id: 'P12', file: 'hooks/ui/pane.tsx' }, TESTS, TEXTS, {})
    expect(plan[0]).toEqual(['t1', []])
  })
})

const RUN_OK = 'tests/e.test.ts:\n(pass) a\n\n 1 pass\n 0 fail\n'
const RUN_FAIL = 'tests/e.test.ts:\n(fail) ca hỏng\n  expected 1\n\n 0 pass\n 1 fail\n'
const RUN_TIMEOUT_ONLY = 'tests/e.test.ts:\n(fail) ca chậm\n  this test timed out after 5000 ms\n\n 0 pass\n 1 fail\n'
const RUN_MIXED = 'tests/e.test.ts:\n(fail) ca chậm\n  this test timed out after 5000 ms\ntests/a-061.test.ts:\n(fail) ca hỏng\n  expected 1\n\n 0 pass\n 2 fail\n'

describe('0.9.0 M21b: đọc một lượt và luật nhận', () => {
  test('không ca lỗi là ZERO', () => {
    expect(parseRun(RUN_OK, false).verdict).toBe('ZERO')
  })

  test('một ca lỗi không do hết giờ là KILLED, ghi tệp chứa ca lỗi', () => {
    const run = parseRun(RUN_FAIL, false)
    expect(run.verdict).toBe('KILLED')
    expect(run.failFiles).toEqual(['tests/e.test.ts'])
  })

  test('mọi ca lỗi đều do hết giờ: chưa có phán quyết', () => {
    expect(parseRun(RUN_TIMEOUT_ONLY, false).verdict).toBe('NOVERDICT')
  })

  test('có ca hết giờ và ca lỗi thật: KILLED, chỉ ghi tệp của ca lỗi thật', () => {
    const run = parseRun(RUN_MIXED, false)
    expect(run.verdict).toBe('KILLED')
    expect(run.failFiles).toEqual(['tests/a-061.test.ts'])
  })

  test('mod không nạp là KILLED; quá hạn là TIMEOUT; không đọc được số ca lỗi là ERROR', () => {
    expect(parseRun('(fail) the file did not load\n 0 pass\n 1 fail\n', false).verdict).toBe('KILLED')
    expect(parseRun(RUN_OK, true).verdict).toBe('TIMEOUT')
    expect(parseRun('hỏng giữa chừng', false).verdict).toBe('ERROR')
  })

  test('bước tiếp: KILLED dừng; ZERO đi tầng sau; NOVERDICT, TIMEOUT, ERROR lần đầu chạy lại tầng', () => {
    expect(stepOf('KILLED', false)).toBe('killed')
    expect(stepOf('ZERO', false)).toBe('next')
    for (const v of ['NOVERDICT', 'TIMEOUT', 'ERROR'] as const) expect(stepOf(v, false)).toBe('retry')
  })

  test('lần chạy lại: NOVERDICT đi tầng sau, không nhận KILLED; TIMEOUT, ERROR giữ làm phán quyết', () => {
    expect(stepOf('NOVERDICT', true)).toBe('next')
    expect(stepOf('TIMEOUT', true)).toBe('stop')
    expect(stepOf('ERROR', true)).toBe('stop')
    expect(stepOf('KILLED', true)).toBe('killed')
  })

  test('qua hết các tầng không diệt: SURVIVED, hay EQUIVALENT khi mẫu đã ghi tương đương', () => {
    expect(finalOf(false)).toBe('SURVIVED')
    expect(finalOf(true)).toBe('EQUIVALENT')
  })
})
