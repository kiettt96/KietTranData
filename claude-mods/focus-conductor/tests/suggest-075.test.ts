// 0.7.5 B8: gợi ý checkCommands chỉ nêu script có tên kiểu kiểm (kiem, check, verify, validate, test, audit, reconcile);
// tiền tố thư mục chỉ khi mọi script đã chạy trong thư mục đó đều có tên kiểu kiểm.

import { describe, expect, test } from 'claude-code/testing'
import { newEvidenceLog, noteEvidence, suggestCheckCommands } from '../hooks/lib/drift'
import { bash, edit } from './support/commands'

function logOf(...runs: string[]) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, bash(run))
  return log
}

describe('0.7.5 B8: chỉ script tên kiểu kiểm', () => {
  test('script ghi dữ liệu (ghi-du-lieu.py, build_report.py, run.sh) không được gợi ý', () => {
    expect(suggestCheckCommands(logOf('/usr/bin/python3 -B scripts/ghi-du-lieu.py --lo 1'))).toEqual([])
    expect(suggestCheckCommands(logOf('python3 build_report.py', 'bash ./run.sh x'))).toEqual([])
  })

  test('có cả script kiểm và script ghi: chỉ nêu script kiểm', () => {
    expect(suggestCheckCommands(logOf('python3 check_totals.py', 'python3 build_report.py'))).toEqual(['python3 check_totals.py'])
  })
})

describe('0.7.5 B8: tiền tố thư mục', () => {
  test('thư mục có script không phải kiểm: không gợi ý tiền tố, nêu từng script kiểm', () => {
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 tests/b-check.py', 'python3 tests/build.py'))).toEqual(['python3 tests/b-check.py', 'python3 tests/a-check.py'])
  })

  test('mọi script trong thư mục đều kiểu kiểm: gợi ý tiền tố như cũ', () => {
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 tests/b-check.py'))).toEqual(['python3 tests/'])
  })
})
