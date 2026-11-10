// 0.8.4 S1, S2: ghim hai chỗ của luật phủ định cách quãng trên dòng tổng kết cuối của lệnh khai (0.8.3 D2), mã thoát 0, đường
// visible. S1: pass, passed, ok chen giữa phủ định và từ lỗi làm phủ định không còn là phủ định của từ lỗi. S2: error, errors là từ lỗi
// của phủ định cách quãng.

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

describe('0.8.4 S1: pass, ok chen giữa phủ định và từ lỗi', () => {
  for (const out of ['Summary: no pass, failed', 'Summary: no ok, failed']) {
    test(`"${out}": không đạt`, () => expect(passed(out)).toBe(false))
  }
})
