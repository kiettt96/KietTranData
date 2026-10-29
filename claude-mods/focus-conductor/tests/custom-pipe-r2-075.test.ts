// 0.7.5 R2 (vòng rà soát 3): lệnh kiểm đã khai qua ống không pipefail, luật H1 kín hơn. (a) "Lỗi = 0.5%", "Chênh lệch: 0,3 tỷ" không
// phải số lỗi bằng 0 (sau số 0 là phần thập phân). (b) Dấu hiệu lỗi thêm: ❌ ✖, missing, not match, do not match, invalid, exception,
// không đúng, khác biệt, cảnh báo kèm số khác 0, "thiếu: N" với N khác 0 ở bất kỳ vế nào, tỷ lệ bằng chữ "N trên M" với N nhỏ hơn M.

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

const FAILS = [
  'Lỗi = 0.5%\nOK',
  'Chênh lệch: 0,3 tỷ\nOK',
  'Thiếu: 0 cũ, 12 mới chưa ghi\nOK',
  'Đạt 115 trên 120 dòng',
  'Missing 5 rows\nOK',
  'Rows do not match: 5\nOK',
  'Invalid: 7\nOK',
  'Exception in K4\nOK',
  '❌ K4: 115 vs 120\n✅ OK',
  'Không đúng 5 dòng\nOK',
  'Khác biệt 5 dòng\nĐẠT',
  'Cảnh báo: 5 dòng trùng\nOK',
]

describe('0.7.5 R2: mười hai đầu ra lỗi', () => {
  for (const output of FAILS) {
    test(`không đạt: ${JSON.stringify(output)}`, () => {
      declared(() => {
        expect(piped(output)).toBe(false)
        expect(withPipefail(output)).toBe(false)
      })
    })
  }
})

describe('0.7.5 R2: ca đạt vẫn đạt', () => {
  test('KẾT QUẢ: ĐẠT, 0 lỗi, số 0 đứng riêng, cảnh báo bằng 0, tỷ lệ đủ', () => {
    declared(() => {
      for (const output of ['KẾT QUẢ: ĐẠT', 'Đã kiểm 1200 tin\nKẾT QUẢ: ĐẠT', '0 lỗi\nOK', 'Lỗi = 0\nOK', 'Thiếu: 0 cũ, 0 mới\nOK', 'Cảnh báo: 0\nOK', '0 cảnh báo\nOK', 'Đạt 120 trên 120 dòng\nOK', 'Missing: 0\nOK', 'Tổng: 120/120 khớp']) {
        expect(piped(output), output).toBe(true)
      }
    })
  })

  test('chữ thông thường gần dấu hiệu lỗi không bị bắt nhầm: "khác", "cảnh" đứng riêng, "valid", "matched"', () => {
    declared(() => {
      for (const output of ['Đã đối chiếu với bản khác\nOK', 'Tất cả hợp lệ (valid)\nOK', '120 rows matched\nOK', 'Đã kiểm 5 lô\nĐẠT']) {
        expect(piped(output), output).toBe(true)
      }
    })
  })
})
