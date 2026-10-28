// 0.7.5 M9 (vòng sửa 2): gợi ý checkCommands: từ kiểm chỉ khớp ở đầu tên script (cap_nhat_kiem_ke.py, ghi_test_data.py không phải
// script kiểm), "kiem_ke" (kiểm kê) không phải kiểm, và không bao giờ tự gợi ý tiền tố thư mục (chỉ từng script).

import { describe, expect, test } from 'claude-code/testing'
import { newEvidenceLog, noteEvidence, suggestCheckCommands } from '../hooks/lib/drift'
import { checkHintText } from '../hooks/lib/text'
import { bash, edit } from './support/commands'

function logOf(...runs: string[]) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, bash(run))
  return log
}

describe('0.7.5 M9: từ kiểm chỉ khớp ở đầu tên script', () => {
  test('cap_nhat_kiem_ke.py và ghi_test_data.py (từ kiểm nằm giữa tên) không được gợi ý', () => {
    expect(suggestCheckCommands(logOf('python3 scripts/cap_nhat_kiem_ke.py', 'python3 scripts/ghi_test_data.py'))).toEqual([])
    expect(suggestCheckCommands(logOf('python3 scripts/db-audit.py', 'bash ./run_check.sh'))).toEqual([])
  })

  test('tên bắt đầu bằng từ kiểm vẫn được gợi ý: kiem_tra, kiem-dinh-dang, check_totals, verify_counts, test_all, audit_db', () => {
    for (const script of ['kiem_tra.py', 'kiem-dinh-dang.py', 'check_totals.py', 'verify_counts.py', 'test_all.py', 'audit_db.py', 'validate.py', 'reconcile.py']) {
      expect(suggestCheckCommands(logOf(`python3 scripts/${script}`)), script).toEqual([`python3 scripts/${script}`])
    }
  })

  test('kiem_ke (kiểm kê, không phải kiểm tra) không được gợi ý', () => {
    expect(suggestCheckCommands(logOf('python3 scripts/kiem_ke.py', 'python3 scripts/kiem-ke-kho.py'))).toEqual([])
    expect(suggestCheckCommands(logOf('python3 scripts/kiem_ke_va_kiem_tra.py'))).toEqual([])
  })
})

describe('0.7.5 M9: bộ lọc tên không thay luật nhận dạng script', () => {
  test('lệnh dạng đường dẫn không có đuôi script (./tools/check-data) không được gợi ý dù tên kiểu kiểm', () => {
    expect(suggestCheckCommands(logOf('./tools/check-data', './tools/verify.txt'))).toEqual([])
    expect(suggestCheckCommands(logOf('./tools/check-data.sh'))).toEqual(['./tools/check-data.sh'])
  })

  test('trình thông dịch cộng đối số không có đuôi script (python3 check_data, node verify) không được gợi ý', () => {
    expect(suggestCheckCommands(logOf('python3 check_data', 'node verify', 'bash test_all'))).toEqual([])
    expect(suggestCheckCommands(logOf('python3 check_data.py'))).toEqual(['python3 check_data.py'])
  })
})

describe('0.7.5 M9: không tự gợi ý tiền tố thư mục', () => {
  test('hai script kiểm cùng thư mục: nêu từng script, không nêu "python3 tests/"', () => {
    expect(suggestCheckCommands(logOf('python3 tests/check_a.py', 'python3 tests/check_b.py'))).toEqual(['python3 tests/check_b.py', 'python3 tests/check_a.py'])
  })

  test('câu gợi ý không còn lời về tiền tố thư mục', () => {
    expect(checkHintText(['python3 tests/check_a.py'])).not.toContain('Tiền tố thư mục')
  })
})
