// 0.7.6 V1 (bản vá logic của 0.7.5): "0 dòng trống", "trống ở 0 dòng", "(0 dòng rỗng)" là số lỗi bằng 0 như "0 lỗi", nên lệnh kiểm vẫn
// đạt; "0 kết quả", "Không có bản ghi nào", "Không có kết quả nào" là dữ liệu rỗng, nên không đạt. Số lỗi bằng 0 theo sau "kết quả"
// ("0 kết quả lệch", "0 kết quả lỗi") và "Không có bản ghi nào bị thiếu" vẫn đạt.

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

const PASSES = [
  'Đã kiểm 120 dòng, 0 dòng trống\nĐẠT',
  'Cột ghi chú trống ở 0 dòng\nOK',
  'Tổng 120 dòng (0 dòng rỗng)\nOK',
  '0 kết quả lệch\nĐẠT',
  '0 kết quả lỗi\nOK',
  'Đối chiếu: 0 kết quả sai\nĐẠT',
  'Không có bản ghi nào bị thiếu\nOK',
]
const EMPTY = ['Truy vấn trả về 0 kết quả\nĐẠT', 'Không có bản ghi nào\nOK', 'Không có kết quả nào\nĐẠT']

describe('0.7.6 V1: dòng trống hay rỗng bằng 0 là số lỗi bằng 0', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: các đầu ra đạt`, () => {
      declared(() => {
        for (const output of PASSES) expect(run(output), output).toBe(true)
      })
    })
  }
})

describe('0.7.6 V1: 0 kết quả, không có bản ghi hay kết quả nào là dữ liệu rỗng', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    test(`${name}: các đầu ra không đạt`, () => {
      declared(() => {
        for (const output of EMPTY) expect(run(output), output).toBe(false)
      })
    })
  }
})
