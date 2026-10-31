// 0.7.5 T5 (vòng rà soát 5): dòng tổng kết chặt của S5 nhận thêm các dạng đạt phổ biến: tiền tố "<nhãn>:" ngắn (tối đa 4 từ, không chứa
// không, chưa, not, fail, skip), viền "=" hay "-", dấu U+2705 và U+2713 trước hoặc sau dấu hiệu đạt, "PASSED in Ns" và "N passed in Ns"
// (N lớn hơn 0). Thêm dấu hiệu lỗi: bỏ sót, thừa kèm số khác 0, số dư âm, hết hạn kèm số khác 0.

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

const CHECK = '✅'
const TICK = '✓'
const PASSES = ['=== ĐẠT ===', 'PASSED in 2.1s', '120 passed in 3.2s', 'K4: ĐẠT', `${CHECK} ĐẠT`, `Kết quả: ĐẠT ${TICK}`]
const FAILS = ['Bỏ sót 3 dòng\nOK', 'Thừa 2 dòng\nOK', 'Số dư âm ở tài khoản 131\nOK', 'Hết hạn 4 hợp đồng\nOK']

describe('0.7.5 T5: sáu dạng đạt phổ biến', () => {
  test('qua ống không pipefail: mỗi dạng là dòng tổng kết đạt', () => {
    declared(() => {
      for (const last of PASSES) expect(piped(`Đã kiểm 120 dòng\n${last}`), last).toBe(true)
    })
  })

  test('viền "-", dấu đạt đứng sau, nhãn bốn từ cũng là dòng tổng kết', () => {
    declared(() => {
      for (const last of ['--- OK ---', `PASS ${CHECK}`, 'Kiểm bảng giá tháng: OK']) expect(piped(`Đã kiểm 120 dòng\n${last}`), last).toBe(true)
    })
  })

  test('nhãn quá 4 từ, hay có chữ khác ngoài nhãn và dấu hiệu đạt, vẫn không phải dòng tổng kết', () => {
    declared(() => {
      for (const last of ['Kiểm bảng giá tháng mười: OK', 'Kiểm xong tại casino OK', 'PASSED, xem lại sau']) expect(piped(`Đã kiểm 120 dòng\n${last}`), last).toBe(false)
    })
  })
})

describe('0.7.5 T5: tiền tố nhãn không được chứa không, chưa, not, fail, skip', () => {
  test('"Chưa kiểm: OK", "Not run: PASS", "Không kiểm: ĐẠT", "Skipped: OK", "Failing: PASS" không đạt', () => {
    declared(() => {
      for (const last of ['Chưa kiểm: OK', 'Not run: PASS', 'Không kiểm: ĐẠT', 'Skipped: OK', 'Failing: PASS']) expect(piped(last), last).toBe(false)
    })
  })
})

describe('0.7.5 T5: dấu hiệu lỗi mới', () => {
  test('bỏ sót, thừa kèm số, số dư âm, hết hạn kèm số: không đạt ở cả ba đường', () => {
    declared(() => {
      for (const output of FAILS) {
        expect(piped(output), output).toBe(false)
        expect(withPipefail(output), output).toBe(false)
        expect(direct(output), output).toBe(false)
      }
    })
  })

  test('số 0 và phủ định không phải lỗi: "Thừa: 0", "Hết hạn: 0", "Bỏ sót: 0", "Không bỏ sót dòng nào"', () => {
    declared(() => {
      for (const output of ['Thừa: 0\nOK', 'Hết hạn: 0\nOK', 'Bỏ sót: 0\nOK', 'Không bỏ sót dòng nào\nOK']) expect(piped(output), output).toBe(true)
    })
  })
})
