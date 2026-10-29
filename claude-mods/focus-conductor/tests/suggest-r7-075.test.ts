// 0.7.5 R7 (vòng rà soát 3): gợi ý checkCommands không gợi ý script có từ ghi dữ liệu trong tên dù tên bắt đầu bằng từ kiểm: fix,
// update, gen, ghi, write, sua, cap_nhat (test_data_gen.py, check_and_fix.py, verify_and_update_db.py).

import { describe, expect, test } from 'claude-code/testing'
import { newEvidenceLog, noteEvidence, suggestCheckCommands } from '../hooks/lib/drift'
import { bash, edit } from './support/commands'

function logOf(...runs: string[]) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, bash(run))
  return log
}

describe('0.7.5 R7: tên script có từ ghi dữ liệu không được gợi ý', () => {
  test('ba tên của đặc tả', () => {
    expect(suggestCheckCommands(logOf('python3 scripts/test_data_gen.py', 'python3 scripts/check_and_fix.py', 'python3 scripts/verify_and_update_db.py'))).toEqual([])
  })

  test('mỗi từ ghi: fix, update, gen, ghi, write, sua, sửa, cap_nhat, capnhat (đứng đâu trong tên cũng loại)', () => {
    for (const word of ['fix', 'update', 'gen', 'ghi', 'write', 'sua', 'sửa', 'cap_nhat', 'capnhat']) {
      for (const name of [`check_${word}.py`, `verify-${word}-all.py`, `test_${word}`]) {
        const file = name.endsWith('.py') ? name : `${name}.py`
        expect(suggestCheckCommands(logOf(`python3 scripts/${file}`)), file).toEqual([])
      }
    }
  })

  test('từ ghi phải là từ trọn vẹn trong tên: check_fixtures, verify_general, test_regen, check_signature vẫn được gợi ý', () => {
    for (const file of ['check_fixtures.py', 'verify_general.py', 'test_regen.py', 'check_signature.py', 'test_writer_api.py', 'check_updates.py']) {
      expect(suggestCheckCommands(logOf(`python3 scripts/${file}`)), file).toEqual([`python3 scripts/${file}`])
    }
  })

  test('"cap" hay "nhat" đứng riêng không phải cap_nhat', () => {
    expect(suggestCheckCommands(logOf('python3 scripts/check_cap.py', 'python3 scripts/verify_nhat.py'))).toEqual(['python3 scripts/verify_nhat.py', 'python3 scripts/check_cap.py'])
  })

  test('script kiểm bình thường chạy cùng script ghi: chỉ gợi ý script kiểm', () => {
    expect(suggestCheckCommands(logOf('python3 scripts/check_and_fix.py', 'python3 scripts/check_totals.py'))).toEqual(['python3 scripts/check_totals.py'])
  })
})
