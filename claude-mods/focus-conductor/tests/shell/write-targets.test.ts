// File đích của lệnh Bash có ghi (hooks/lib/drift/classify): đích đọc được, awk, nhiều lệnh không xác định đích, file kế hoạch.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { bashWriteTargets, isMutation, isReadOnlyCommand, newEvidenceLog, newTracker, noteEvidence, observe } from '../../hooks/lib/drift'
import { bash, edit, makeBrief } from '../support/commands'

describe('02: đích ghi của lệnh Bash', () => {
  test('đọc đích của từng loại lệnh ghi; lệnh lạ và đường dẫn chứa biến là không xác định', () => {
    expect(bashWriteTargets('cp -r a b/c').paths).toEqual(['b/c'])
    expect(bashWriteTargets('cp -t out/ a b').paths).toEqual(['out'])
    expect(bashWriteTargets('chmod +x scripts/run.sh').paths).toEqual(['scripts/run.sh'])
    expect(bashWriteTargets('git checkout -- src/a.ts').paths).toEqual(['src/a.ts'])
    expect(bashWriteTargets('git commit -m "x > y"')).toEqual({ paths: [], isUnknown: false })
    expect(bashWriteTargets('git checkout main').isUnknown).toBe(true)
    expect(bashWriteTargets('echo x > $OUT').isUnknown).toBe(true)
    expect(bashWriteTargets('npm install lodash').isUnknown).toBe(true)
    expect(bashWriteTargets('cd /repo/src && touch ../config/a.json').paths).toEqual(['/repo/config/a.json'])
    expect(bashWriteTargets('cat a 2>&1 > out.log').paths).toEqual(['out.log'])
    expect(bashWriteTargets('sudo tee /etc/hosts < x').paths).toEqual(['/etc/hosts'])
    expect(bashWriteTargets("cat > config/a.json <<'EOF'\n{ \"a\": 1 }\nrm -rf /\nEOF")).toEqual({ paths: ['config/a.json'], isUnknown: false })
  })
})

describe('vòng cuối: awk và nhiều lệnh không xác định đích', () => {
  test('awk có print chuyển hướng hoặc nối ống là có ghi, đích không xác định', () => {
    expect(isReadOnlyCommand(`awk '{print > "out.txt"}' f`)).toBe(false)
    expect(isReadOnlyCommand(`awk '{print | "sh"}' f`)).toBe(false)
    expect(isReadOnlyCommand(`awk 'BEGIN{system("rm x")}'`)).toBe(false)
    expect(isReadOnlyCommand(`awk '{print $1}' f`)).toBe(true)
    expect(bashWriteTargets(`awk '{print > "out.txt"}' f`).isUnknown).toBe(true)
  })

  test('mỗi lệnh ghi không xác định đích khác nhau được cảnh báo một lần', () => {
    const tracker = newTracker('t')
    const brief = makeBrief({ scopePaths: ['src/'] })
    const count = (command: string) => observe(tracker, bash(command), brief, []).filter(f => f.text.includes('không xác định được file đích')).length
    expect(count('python gen.py')).toBe(1)
    expect(count('node build.js')).toBe(1)
    expect(count('bash gen.sh')).toBe(1)
    expect(count('python gen.py')).toBe(0)
  })
})

describe('0.5.2 P2a: ghi file kế hoạch qua Bash không phải thay đổi mã', () => {
  test('chỉ ghi file kế hoạch (tương đối, tuyệt đối, heredoc, tee): không tính là thay đổi', () => {
    for (const command of [
      "printf '%s\\n' 'Step 1' > .claude/plans/implementation.md",
      "printf x > /root/.claude/plans/x.md",
      "cat > /root/.claude/plans/x.md <<'EOF'\n# Kế hoạch\nEOF",
      'echo x | tee .claude/plans/x.md',
    ]) {
      expect(isMutation(bash(command)), command).toBe(false)
    }
  })

  test('test đạt rồi ghi file kế hoạch qua Bash: vẫn giữ trạng thái đã kiểm tra', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit(), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash('printf x > .claude/plans/x.md'), brief, [])
    expect(tracker.isVerified).toBe(true)
    expect(tracker.mutations).toBe(1)
  })

  test('ghi cả file kế hoạch và file mã: phần mã vẫn được đếm, đúng số lần', () => {
    expect(isMutation(bash('echo x | tee .claude/plans/x.md src/a.ts'))).toBe(true)
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('printf x > .claude/plans/x.md; printf y > src/a.ts'))
    expect(log.mutations).toBe(1)
    expect(isMutation(bash('printf x > .claude/plans/x.md; printf y > $OUT'))).toBe(true)
  })
})
