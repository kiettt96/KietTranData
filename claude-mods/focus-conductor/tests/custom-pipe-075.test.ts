// 0.7.5 H1 (vòng sửa 2): lệnh kiểm đã khai chạy qua ống không có pipefail chỉ đạt khi dòng không rỗng cuối cùng có dấu hiệu đạt
// đứng riêng (không nằm sau "chưa", "không"...) và toàn bộ phần đầu ra còn thấy không có dấu hiệu lỗi. Dấu hiệu lỗi thêm: "chưa
// đạt", "chưa khớp", "thiếu", "lệch", "chênh lệch", "không hợp lệ", "mismatch", "error", "✗" và tỷ lệ N/M với N nhỏ hơn M.

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

describe('0.7.5 H1: đầu ra lỗi nhưng có chữ đạt ở đâu đó không được tính là đạt', () => {
  const FAILS = [
    'K4 chưa đạt: 5 dòng',
    'Tổng: 115/120 khớp',
    'Thiếu 5 bản ghi\nKết thúc OK',
    'ERROR 3 rows mismatch\nDone OK',
    'Chênh lệch 12.000.000 đ\nTổng hợp xong OK',
    'Không hợp lệ: 7 dòng\nKết thúc OK',
    '✗ 3 bảng; ✓ OK',
  ]

  test('bảy đầu ra lỗi đều không đạt', () => {
    declared(() => {
      for (const output of FAILS) expect(piped(output), output).toBe(false)
    })
  })

  test('đầu ra đạt thật vẫn đạt', () => {
    declared(() => {
      for (const output of ['Đã kiểm 1200 tin\nKẾT QUẢ: ĐẠT', 'Tổng: 120/120 khớp', 'lô 3: KHỚP\nKẾT QUẢ: ĐẠT', 'Kiểm xong: 0 lỗi', 'Thiếu: 0\nLệch: 0\nOK', 'Errors: 0\nDone OK', 'OK\n']) {
        expect(piped(output), output).toBe(true)
      }
    })
  })

  test('dấu hiệu đạt không nằm ở dòng không rỗng cuối cùng, hay nằm sau chữ phủ định: không đạt', () => {
    declared(() => {
      expect(piped('KẾT QUẢ: ĐẠT\n(còn 3 cảnh báo định dạng)')).toBe(false)
      expect(piped('Kiểm xong\nkhông đạt')).toBe(false)
      expect(piped('Kiểm xong\nchưa OK')).toBe(false)
      expect(piped('Kiểm xong\nnot ok')).toBe(false)
      expect(piped('Kiểm xong\nkhông OK')).toBe(false)
      expect(piped('Kiểm xong\nnot   ok')).toBe(false)
    })
  })

  test('chữ phủ định chỉ tính khi là từ riêng: "casino OK" vẫn đạt', () => {
    declared(() => {
      expect(piped('Kiểm xong tại casino OK')).toBe(true)
      expect(piped('Kiểm xong\nknow OK')).toBe(true)
    })
  })

  test('có set -o pipefail: mã thoát 0 và đầu ra không lỗi vẫn đạt; thêm dấu hiệu lỗi mới cũng chặn', () => {
    declared(() => {
      expect(withPipefail('đã xử lý lô 12')).toBe(true)
      expect(withPipefail('Thiếu 5 bản ghi')).toBe(false)
      expect(withPipefail('Tổng: 115/120 khớp')).toBe(false)
      expect(withPipefail('K4 chưa đạt: 5 dòng')).toBe(false)
      expect(withPipefail('lô 2 chưa khớp')).toBe(false)
      expect(withPipefail('Kiểm xong, not ok')).toBe(false)
    })
  })
})
