// 0.8.3 D1, D2: dòng tổng kết cuối của lệnh khai (mã thoát 0, đường visible). D1: dòng không dấu báo lỗi (TONG: CHUA DAT, 2 loi) là
// không đạt; phủ định không dấu (khong co loi, 0 loi) vẫn đạt. Các ca có dấu của 0.8.1 C1 giữ kết quả (tệp summary-failed-c1-081).

import { describe, expect, test } from 'claude-code/testing'
import { applyCheckCommands, newEvidenceLog, noteEvidence, parseCheckCommands } from '../hooks/lib/drift'

const RUN = '/usr/bin/python3 -B /a/tools/check_a.py'
const observation = (output: string) => ({ tool: 'Bash', input: { command: RUN }, isError: false, isReadOnly: false, output }) as never

/** Lần chạy lệnh khai (mã thoát 0) có được tính là lần kiểm đạt không. */
function passed(output: string): boolean | null {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    const log = newEvidenceLog(1)
    noteEvidence(log, observation(`K1: xong\n${output}`))
    const entry = log.commands.find(c => c.check !== null)
    return entry === undefined ? null : entry.ok
  } finally {
    applyCheckCommands([])
  }
}

describe('0.8.3 D1: dòng tổng kết không dấu báo lỗi', () => {
  for (const out of ['TONG: CHUA DAT', 'TONG: KHONG DAT | 2 loi', 'Ket qua: chua dat', 'TONG: DAT | 13 phep, 3 phep loi']) {
    test(`"${out}": không đạt`, () => expect(passed(out)).toBe(false))
  }
  for (const out of ['TONG: DAT | 0 loi', 'TONG: DAT, khong co loi', 'TONG: DAT']) {
    test(`"${out}": đạt`, () => expect(passed(out)).toBe(true))
  }
})
