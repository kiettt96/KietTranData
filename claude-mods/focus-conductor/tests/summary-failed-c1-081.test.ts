// 0.8.1 C1: lệnh khai (checkCommands) trả mã thoát 0 ở đường visible hay chained mà dòng không rỗng cuối là dòng tổng kết báo lỗi thì không
// đạt. Dòng tổng kết chỉ là dòng bắt đầu bằng nhãn đã biết (tổng, tổng kết, tổng cộng, kết quả, summary, total, result, results) rồi dấu
// hai chấm. Dấu hiệu lỗi: kết luận CHƯA ĐẠT, KHÔNG ĐẠT, FAIL, FAILED; số đếm lỗi khác 0; tỷ lệ N/M với N nhỏ hơn M. Chỉ xét dòng cuối,
// nên chữ "lỗi" ở thân output không làm lệnh đạt thành lỗi. Lệnh không khai giữ nguyên, vẫn tin mã thoát.

import { describe, expect, test } from 'claude-code/testing'
import { applyCheckCommands, newEvidenceLog, noteEvidence, parseCheckCommands } from '../hooks/lib/drift'
import { classifyBash } from '../hooks/lib/drift/classify'
import type { CheckEffect } from '../hooks/lib/drift/classify'
import { rejectReason } from '../hooks/lib/drift/output'

const RUN = '/usr/bin/python3 -B /a/tools/check_a.py'

function declared<T>(body: () => T): T {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    return body()
  } finally {
    applyCheckCommands([])
  }
}
const observation = (command: string, output: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output }) as never

/** Lần chạy (mã thoát 0) có được tính là lần kiểm đạt không; null khi lệnh không phải lệnh kiểm. */
function passed(command: string, output: string): boolean | null {
  return declared(() => {
    const log = newEvidenceLog(1)
    noteEvidence(log, observation(command, output))
    const entry = log.commands.find(c => c.check !== null)
    return entry === undefined ? null : entry.ok
  })
}

describe('0.8.1 C1: lệnh khai, mã thoát 0, dòng tổng kết cuối báo lỗi thì không đạt', () => {
  for (const out of ['TỔNG: 13 phép, 3 phép đỏ', 'TỔNG: CHƯA ĐẠT | 2 lỗi', 'Summary: 11/13 checks']) {
    test(`"${out}": không đạt`, () => expect(passed(RUN, out)).toBe(false))
  }
  test('lệnh khai nối && (chained), dòng cuối "TỔNG: 13 phép, 2 phép đỏ": không đạt', () => expect(passed(`${RUN} && ls`, 'TỔNG: 13 phép, 2 phép đỏ')).toBe(false))
  test('lý do không đạt là failed', () => {
    const reason = declared(() => {
      const effect = classifyBash(RUN).effects.find((e): e is CheckEffect => e.kind === 'check') as CheckEffect
      return rejectReason(effect, observation(RUN, 'TỔNG: 13 phép, 3 phép đỏ'))
    })
    expect(reason).toBe('failed')
  })
})

describe('0.8.1 C1: các output vẫn đạt', () => {
  const cases: Array<[string, string]> = [
    ['ba mục đạt rồi tổng đạt', 'K1: ĐẠT (0 dòng đỏ)\nK2: ĐẠT (0 dòng đỏ)\nK3: ĐẠT (0 dòng đỏ)\nTỔNG: ĐẠT | 13 phép, 0 phép đỏ'],
    ['"không có lỗi nào" rồi tỷ lệ đủ', 'không có lỗi nào\nTỔNG: ĐẠT 5/5'],
    ['"0 lỗi, 0 cảnh báo" rồi OK', '0 lỗi, 0 cảnh báo\nOK'],
    ['chữ lỗi ở thân: báo cáo lỗi chính tả', 'ghi xong báo cáo lỗi chính tả\nTỔNG: ĐẠT | 4 phép'],
    ['chữ lỗi ở thân: đã sửa lỗi', 'đã sửa lỗi ở mục 3\nTỔNG: ĐẠT'],
    ['chữ lỗi ở thân: cột Lỗi trống', 'Bảng: cột "Lỗi" trống\nTỔNG: ĐẠT | 2 phép'],
    ['số đỏ của lượt trước ở thân', 'Lượt trước: 3 phép đỏ\nTỔNG: ĐẠT | 13 phép, 0 phép đỏ'],
    ['không có dòng tổng kết', 'Đang kiểm\nxong'],
    ['nhãn không phải nhãn tổng kết: ghi chú', 'Ghi chú: đã sửa 3 lỗi'],
    ['nhãn không phải nhãn tổng kết: đường dẫn', 'Tải về: https://x/fail.html'],
    ['giờ đứng đầu dòng', '12:30 xong'],
    ['dòng của một mục, không phải tổng kết', 'K1: CHƯA ĐẠT (3 dòng đỏ)'],
  ]
  for (const [name, out] of cases) test(`${name}: đạt`, () => expect(passed(RUN, out)).toBe(true))
  test('lệnh không khai (pytest) mã 0: giữ như cũ, tin mã thoát', () => expect(passed('pytest', 'TỔNG: 13 phép, 3 phép đỏ')).toBe(true))
})
