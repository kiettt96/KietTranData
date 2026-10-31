// 0.7.5 T9 (vòng rà soát 5): lệnh kiểm chạy trên dữ liệu rỗng không được tính là đạt: "0 dòng", "0 bản ghi", "0 rows", "0 records" (theo
// ranh giới số, trừ số lỗi bằng 0 như "Lỗi: 0 dòng", "0 dòng lệch"), cả kết quả hay cả bảng rỗng ("Bảng X trống", "Rỗng:", "dữ liệu
// rỗng", "no data", "Không có dữ liệu" đầu dòng; không tính "Không có ô trống", "0 ô trống", "Số ô trống: 0"), và N/M với M bằng 0. Đồng
// thời "0 skipped, 120 passed" và "Lỗi: 0 | Thiếu: 0 | Lệch: 0⏎PASS" đạt.

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

const EMPTY = [
  'Đã kiểm 0 dòng\nĐẠT',
  'Đã ghi 0 bản ghi\nĐẠT',
  'Tổng 0 dòng\nOK',
  'Rỗng: không có dữ liệu\nĐẠT',
  'Bảng K4 trống\nĐẠT',
  'ĐẠT (10/0)',
  'ĐẠT (00/00)',
]
const PASSES = [
  'Lỗi: 0 dòng\nĐẠT',
  '0 dòng lệch\nĐẠT',
  'Thiếu 0 dòng\nOK',
  'Không rỗng\nOK',
  'ĐẠT (120/120)',
  'Không có ô trống\nĐẠT',
  '0 ô trống\nOK',
  'Số ô trống: 0\nĐẠT',
  'Checked 120 rows, 0 empty\nOK',
]
const FALSE_NEGATIVES = ['0 skipped, 120 passed', 'Lỗi: 0 | Thiếu: 0 | Lệch: 0\nPASS']

describe('0.7.5 T9: dữ liệu rỗng không đạt', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: bảy đầu ra rỗng đều không đạt`, () => {
      declared(() => {
        for (const output of EMPTY) expect(run(output), output).toBe(false)
      })
    })
  }
})

describe('0.7.5 T9: số lỗi bằng 0, phủ định và tỷ lệ đủ vẫn đạt', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: chín đầu ra đạt`, () => {
      declared(() => {
        for (const output of PASSES) expect(run(output), output).toBe(true)
      })
    })
  }
})

describe('0.7.5 T9: hai âm tính giả', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: "0 skipped, 120 passed" và "Lỗi: 0 | Thiếu: 0 | Lệch: 0⏎PASS" đạt`, () => {
      declared(() => {
        for (const output of FALSE_NEGATIVES) expect(run(output), output).toBe(true)
      })
    })
  }
})
