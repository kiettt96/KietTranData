// 0.7.5 S7 (vòng rà soát 4): gợi ý checkCommands loại thêm script có patch, apply, import, load, sync trong tên (từ trọn vẹn) và từ có
// hậu tố gen (testgen.py, datagen.py).

import { describe, expect, test } from 'claude-code/testing'
import { newEvidenceLog, noteEvidence, suggestCheckCommands } from '../hooks/lib/drift'
import { bash, edit } from './support/commands'

function logOf(...runs: string[]) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, bash(run))
  return log
}

describe('0.7.5 S7: thêm từ ghi dữ liệu', () => {
  test('patch, apply, import, load, sync ở bất kỳ chỗ nào trong tên', () => {
    for (const word of ['patch', 'apply', 'import', 'load', 'sync']) {
      for (const file of [`check_${word}.py`, `verify-${word}-db.py`, `test_${word}.py`]) {
        expect(suggestCheckCommands(logOf(`python3 scripts/${file}`)), file).toEqual([])
      }
    }
  })

  test('hậu tố gen: testgen.py, check_datagen.py, verify_codegen.py', () => {
    for (const file of ['testgen.py', 'check_datagen.py', 'verify_codegen.py']) {
      expect(suggestCheckCommands(logOf(`python3 scripts/${file}`)), file).toEqual([])
    }
  })

  test('từ chỉ chứa các chữ đó mà không phải từ đó vẫn được gợi ý: check_payload.py, verify_general.py, test_asynchronous.py, check_applications.py', () => {
    for (const file of ['check_payload.py', 'verify_general.py', 'test_asynchronous.py', 'check_applications.py']) {
      expect(suggestCheckCommands(logOf(`python3 scripts/${file}`)), file).toEqual([`python3 scripts/${file}`])
    }
  })
})
