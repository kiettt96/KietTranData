// 0.5.6 hạng mục A: gợi ý option checkCommands khi verified bị hạ; chọn ví dụ từ lệnh script đã chạy trong mục tiêu.

import { describe, expect, test } from 'claude-code/testing'
import { acceptsVerified, applyCheckCommands, evidenceStrength, newEvidenceLog, noteEvidence, parseCheckCommands, suggestCheckCommands } from '../../hooks/lib/drift'
import { bash, edit } from '../support/commands'

function logOf(...runs: Array<string | readonly [string, boolean]>) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) {
    if (typeof run === 'string') noteEvidence(log, bash(run))
    else noteEvidence(log, bash(run[0], run[1]))
  }
  return log
}

describe('0.5.6 A2: ví dụ gợi ý lấy từ lệnh script đã chạy', () => {
  test('trình thông dịch cộng đường dẫn script, bỏ cờ và đối số sau đó', () => {
    expect(suggestCheckCommands(logOf('python3 check_totals.py --final'))).toEqual(['python3 check_totals.py'])
    expect(suggestCheckCommands(logOf('node scripts/audit.mjs --all'))).toEqual(['node scripts/audit.mjs'])
    // 0.7.5 B8: chỉ script tên kiểu kiểm được gợi ý (trước đây run.sh cũng được).
    expect(suggestCheckCommands(logOf('bash ./run-check.sh x'))).toEqual(['bash ./run-check.sh'])
  })

  test('cờ của trình thông dịch đứng trước script bị bỏ qua', () => {
    expect(suggestCheckCommands(logOf('python3 -u check_totals.py'))).toEqual(['python3 check_totals.py'])
  })

  test('đường dẫn có dấu gạch chéo và đuôi script đứng đầu lệnh', () => {
    expect(suggestCheckCommands(logOf('./tools/verify.sh --quick'))).toEqual(['./tools/verify.sh'])
  })

  test('tên khớp mẫu kiểm chạy trước được xếp trước, kể cả khi chạy sớm hơn', () => {
    const out = suggestCheckCommands(logOf('python3 check_totals.py', 'python3 build_report.py'))
    expect(out[0]).toBe('python3 check_totals.py')
    // 0.7.5 B8: script không tên kiểu kiểm (build_report.py) không còn được nêu.
    expect(out).toEqual(['python3 check_totals.py'])
  })

  test('tên tiếng Việt không dấu và tiếng Anh đều khớp mẫu', () => {
    expect(suggestCheckCommands(logOf('python3 xu_ly.py', 'python3 kiem_tra_tong.py'))[0]).toBe('python3 kiem_tra_tong.py')
    expect(suggestCheckCommands(logOf('python3 xu_ly.py', 'python3 verify_counts.py'))[0]).toBe('python3 verify_counts.py')
    expect(suggestCheckCommands(logOf('python3 xu_ly.py', 'python3 db-audit.py'))[0]).toBe('python3 db-audit.py')
  })

  test('cùng mức ưu tiên thì lệnh chạy gần nhất trước; tối đa hai ví dụ', () => {
    // 0.7.5 B8: dùng tên kiểu kiểm (a.py, b.py, c.py không còn được gợi ý).
    expect(suggestCheckCommands(logOf('python3 a-check.py', 'python3 b-check.py', 'python3 c-check.py'))).toEqual(['python3 c-check.py', 'python3 b-check.py'])
  })

  test('lệnh lỗi không là ứng viên', () => {
    expect(suggestCheckCommands(logOf(['python3 check_totals.py', true]))).toEqual([])
  })

  test('ls, git, curl, lệnh kiểm tra nhận ra và lệnh không phải script không bao giờ là ứng viên', () => {
    expect(suggestCheckCommands(logOf('ls -la', 'git status', 'curl https://x.test/a.py', 'npm test', 'python3 -c "print(1)"', 'python3 -m json.tool a.json'))).toEqual([])
  })

  test('đường dẫn chứa dấu phẩy hoặc quá dài không làm vỡ chuỗi gợi ý', () => {
    expect(suggestCheckCommands(logOf('python3 a,b.py'))).toEqual([])
    const long = `python3 ${'d/'.repeat(60)}check.py`
    for (const item of suggestCheckCommands(logOf(long))) {
      expect(item.length).toBeLessThanOrEqual(80)
      expect(item).not.toContain(',')
      expect(item).not.toContain('\n')
    }
  })

  test('script nằm sau cd hay biến môi trường vẫn được nhận', () => {
    expect(suggestCheckCommands(logOf('cd data && python3 check_totals.py'))).toEqual(['python3 check_totals.py'])
    expect(suggestCheckCommands(logOf('LC_ALL=C python3 check_totals.py'))).toEqual(['python3 check_totals.py'])
  })
})

describe('0.5.6 A: cổng verified không đổi (ghim hành vi)', () => {
  test('script riêng: chưa khai option thì weak và không nhận verified; đã khai thì strong', () => {
    const run = () => {
      const log = newEvidenceLog(1)
      noteEvidence(log, edit('/repo/build_totals.py'))
      noteEvidence(log, bash('python3 check_totals.py --final', 'ĐẠT toàn bộ'))
      const result = evidenceStrength('python3 check_totals.py --final: ĐẠT toàn bộ', log)
      return { level: result.level, accepted: acceptsVerified(result, log), mutations: log.mutations }
    }
    expect(run()).toEqual({ level: 'weak', accepted: false, mutations: 2 })
    applyCheckCommands(parseCheckCommands('python3 check_totals.py'))
    try {
      expect(run()).toEqual({ level: 'strong', accepted: true, mutations: 1 })
    } finally {
      applyCheckCommands([])
    }
  })
})

describe('0.5.6 A: ghim thêm cho ứng viên gợi ý (mẫu 056-A4, A7, A13)', () => {
  test('đường dẫn có dấu gạch chéo nhưng không có đuôi script không là ứng viên', () => {
    expect(suggestCheckCommands(logOf('./configure --prefix=/x', '/usr/bin/env'))).toEqual([])
  })

  test('lệnh mod đã nhận là lệnh kiểm tra (mặc định hay khai checkCommands) không được gợi ý lại', () => {
    expect(suggestCheckCommands(logOf('node --test tests/a.js'))).toEqual([])
    applyCheckCommands(parseCheckCommands('python3 check_totals.py'))
    try {
      expect(suggestCheckCommands(logOf('python3 check_totals.py'))).toEqual([])
    } finally {
      applyCheckCommands([])
    }
  })

  test('lệnh chạy hai lần chỉ gợi ý một lần', () => {
    // 0.7.5 B8: dùng tên kiểu kiểm.
    expect(suggestCheckCommands(logOf('python3 a-check.py', 'python3 a-check.py'))).toEqual(['python3 a-check.py'])
  })
})
