// 0.7.5 T4 (vòng rà soát 5): lệnh kiểm "đạt mà không kiểm gì" không được tính là đạt: N/N với N bằng 0, "Ran 0", "0 passed", "0 tests",
// "no tests ran", và output mà số đếm duy nhất là skipped; cả khi có pipefail, không qua ống, mã thoát 0. Số 0 khớp theo ranh giới số:
// "10/10", "Ran 10", "10 passed" vẫn đạt.

import { describe, expect, test } from 'claude-code/testing'
import { applyCheckCommands, parseCheckCommands } from '../hooks/lib/drift'
import { verifiedAfter } from './support/commands'

const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
function declared(body: () => void): void {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    body()
  } finally {
    applyCheckCommands([])
  }
}
const piped = (output: string) => verifiedAfter(`${RUN} 2>&1 | tail -n 5`, { output })
const withPipefail = (output: string) => verifiedAfter(`set -o pipefail; ${RUN} 2>&1 | tail -n 5`, { output })
const direct = (output: string) => verifiedAfter(RUN, { output })
const PATHS = { piped, withPipefail, direct }

const NOTHING = [
  'ĐẠT (0/0)',
  'Ran 0 tests in 0.000s\nOK',
  'skipped 120\nOK',
  '0 passed in 0.01s\nOK',
  '0 tests\nOK',
  'collected 0 items\nno tests ran in 0.01s\nOK',
]

describe('0.7.5 T4: đạt mà không kiểm gì thì không đạt', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: mọi đầu ra không kiểm gì đều không đạt`, () => {
      declared(() => {
        for (const output of NOTHING) expect(run(output), output).toBe(false)
      })
    })
  }

  test('trình chạy chuẩn không qua ống (pytest): "no tests ran" không đạt dù mã thoát 0', () => {
    expect(verifiedAfter('pytest', { output: 'collected 0 items\n\nno tests ran in 0.01s' })).toBe(false)
  })
})

describe('0.7.5 T4: số khác 0 vẫn đạt (ranh giới số)', () => {
  const PASSES = ['ĐẠT (10/10)', 'Ran 10 tests in 0.1s\nOK', '100 tests, 0 failed\nOK', '0 failed\nOK', '120 passed, 0 skipped\nOK']

  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: các đầu ra có kiểm vẫn đạt`, () => {
      declared(() => {
        for (const output of PASSES) expect(run(output), output).toBe(true)
      })
    })
  }

  test('"10 passed in 1.2s" đạt khi có pipefail hay không qua ống; pytest "10 passed" đạt', () => {
    declared(() => {
      expect(withPipefail('10 passed in 1.2s')).toBe(true)
      expect(direct('10 passed in 1.2s')).toBe(true)
    })
    expect(verifiedAfter('pytest', { output: '10 passed in 1.2s' })).toBe(true)
  })
})
