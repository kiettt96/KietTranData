// Theo dõi một turn của luồng chính (hooks/lib/drift/tracker): sửa file rồi kiểm tra, Stop xét cả turn giao subagent, checkpoint, lặp lại lệnh lỗi, lạc đề, lệnh chỉ đọc và file kế hoạch.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { isExecuting, isPlanFile, isReadOnlyCommand, newTracker, observe, summarize } from '../hooks/lib/drift'
import { bash, edit, makeBrief } from './support/commands'

describe('01: sửa file sau lần kiểm tra cuối thì không còn là đã kiểm tra', () => {
  test('test đạt, sửa tiếp, không test lại: cuối turn có cảnh báo chưa kiểm tra', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    expect(tracker.isVerified).toBe(true)
    observe(tracker, edit('/repo/src/b.ts'), brief, [])
    expect(tracker.isVerified).toBe(false)
    const unverified = summarize(tracker, brief, []).find(f => f.kind === 'unverified')
    expect(unverified?.text).toContain('sau lần kiểm tra cuối')
  })

  test('test lại sau thay đổi cuối thì hết cảnh báo; chưa kiểm tra lần nào thì giữ câu báo cũ', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    expect(summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.text).toContain('không chạy bước kiểm tra nào')
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, edit('/repo/src/b.ts'), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    expect(summarize(tracker, brief, []).some(f => f.kind === 'unverified')).toBe(false)
  })

  test('lệnh kiểm tra lỗi không xóa trạng thái chưa kiểm tra', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, bash('npm test', true), brief, [])
    expect(tracker.isVerified).toBe(false)
    expect(summarize(tracker, brief, []).some(f => f.kind === 'unverified')).toBe(true)
  })
})

describe('03: Stop xét cả turn giao subagent và turn làm tiếp mục tiêu', () => {
  test('turn chỉ giao subagent là turn đang thực thi', () => {
    const tracker = newTracker('t')
    observe(tracker, { tool: 'Agent', input: { description: 'Việc 1: sửa', prompt: 'x' }, isError: false, isReadOnly: false }, makeBrief(), [])
    expect(isExecuting(tracker)).toBe(true)
  })

  test('turn chỉ đọc cho prompt tiếp nối mục tiêu là đang thực thi; câu hỏi chỉ trả lời hoặc mục tiêu mới thì không', () => {
    const tracker = newTracker('t')
    observe(tracker, { tool: 'Read', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: true }, makeBrief(), [])
    expect(isExecuting(tracker, { relation: 'continue', kind: 'investigate' })).toBe(true)
    expect(isExecuting(tracker, { relation: 'continue', kind: 'answer' })).toBe(false)
    expect(isExecuting(tracker, { relation: 'new', kind: 'investigate' })).toBe(false)
    expect(isExecuting(tracker, null)).toBe(false)
    expect(isExecuting(newTracker('t'), { relation: 'continue', kind: 'edit' })).toBe(false)
  })
})

describe('checkpoint kiểm tra', () => {
  const edit = { tool: 'Edit', input: { file_path: '/repo/a.ts' }, isError: false, isReadOnly: false }
  const bash = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false })

  test('lệnh chỉ đọc có chữ test/check/build không tính là kiểm tra', () => {
    const brief = makeBrief()
    for (const command of ['ls tests/', 'cat test.txt', 'echo check', 'git checkout main', 'grep -r test src', 'cat build.log']) {
      const tracker = newTracker('t1')
      observe(tracker, edit, brief, [])
      observe(tracker, bash(command), brief, [])
      expect(tracker.mutationsSinceCheck, command).toBeGreaterThan(0)
      expect(tracker.isVerified, command).toBe(false)
    }
  })

  test('lệnh kiểm tra thật được nhận ra, kể cả đứng sau cd && hoặc có biến môi trường', () => {
    const brief = makeBrief()
    for (const command of [
      'npm test',
      'npm run -s typecheck',
      'cd /x && npx tsc -p y',
      'node --test',
      'claude plugin test .',
      'FOO=1 npm run build',
      'sed -i s/a/b/ f && npm test',
      'npx -y vitest run',
    ]) {
      const tracker = newTracker('t1')
      observe(tracker, edit, brief, [])
      // Output có dấu hiệu đạt rõ: lệnh kiểm tra nối ống (| grep, | head) cần nó vì mã thoát bị che (0.5.1).
      observe(tracker, { ...bash(command), output: '12 pass\n0 fail' }, brief, [])
      expect(tracker.mutationsSinceCheck, command).toBe(0)
      expect(tracker.isVerified, command).toBe(true)
    }
  })

  test('kiểm tra qua grep (ống sang lệnh lọc khác tail/cat) không được tính là đã kiểm tra (PR #13)', () => {
    const tracker = newTracker('t1')
    observe(tracker, edit, makeBrief(), [])
    observe(tracker, { ...bash('timeout 300 claude plugin test . 2>&1 | grep pass'), output: '12 pass\n0 fail' }, makeBrief(), [])
    expect(tracker.isVerified).toBe(false)
  })
})

describe('phát hiện lạc đề', () => {
  test('cùng lệnh lỗi ba lần thì báo lặp kèm lời nhắc cho model', () => {
    const tracker = newTracker('t1')
    const brief = makeBrief()
    const call = { tool: 'Bash', input: { command: 'npm run build' }, isError: true, isReadOnly: false }
    observe(tracker, call, brief, [])
    observe(tracker, call, brief, [])
    const third = observe(tracker, call, brief, [])
    expect(third.find(f => f.kind === 'loop')?.context).toContain('nguyên nhân gốc')
  })

  test('sửa file ngoài phạm vi đã giới hạn thì cảnh báo một lần', () => {
    const tracker = newTracker('t1')
    const brief = { ...makeBrief({ scopePaths: ['src/app.ts'] }), root: '/repo' }
    const edit = { tool: 'Edit', input: { file_path: '/repo/src/other.ts' }, isError: false, isReadOnly: false }
    expect(observe(tracker, edit, brief, []).some(f => f.kind === 'scope')).toBe(true)
    expect(observe(tracker, edit, brief, []).some(f => f.kind === 'scope')).toBe(false)
    const inside = { tool: 'Edit', input: { file_path: '/repo/src/app.ts' }, isError: false, isReadOnly: false }
    expect(observe(tracker, inside, brief, []).some(f => f.kind === 'scope')).toBe(false)
  })

  test('năm thay đổi liên tiếp chưa kiểm tra thì nhắc checkpoint', () => {
    const tracker = newTracker('t1')
    const brief = makeBrief()
    const edit = { tool: 'Edit', input: { file_path: '/repo/a.ts' }, isError: false, isReadOnly: false }
    let last: ReturnType<typeof observe> = []
    for (let i = 0; i < 5; i++) last = observe(tracker, edit, brief, [])
    expect(last.some(f => f.kind === 'checkpoint')).toBe(true)
    observe(tracker, { tool: 'Bash', input: { command: 'npx tsc --noEmit' }, isError: false, isReadOnly: false }, brief, [])
    expect(tracker.mutationsSinceCheck).toBe(0)
    expect(tracker.isVerified).toBe(true)
  })
})

describe('drift: lệnh chỉ đọc, file kế hoạch, checkpoint (0.3.4 lần 4)', () => {
  const FOCUS = { goal: 'Sửa module thanh toán', scopePaths: [], tier: 'complex' as const }
  const bash = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false })
  const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })

  test('lệnh chỉ đọc (kể cả có ống, chuyển hướng về /dev/null, git -C) không phải thay đổi', () => {
    for (const command of ['grep x | head', 'sed -n 1,5p a.ts', "sed -n '/e/p' a.ts", 'git status', 'ls -la src', 'git -C /repo status --short', 'grep x 2>/dev/null', 'cat a.ts 2>&1 | head', 'find . -name "*.ts"', 'echo "a > b"']) {
      expect(isReadOnlyCommand(command)).toBe(true)
    }
    const tracker = newTracker('t')
    for (const command of ['grep x | head', 'sed -n 1,5p a.ts', 'git status', 'ls -la src']) observe(tracker, bash(command), FOCUS, [])
    expect(tracker.mutations).toBe(0)
  })

  test('đoạn lệnh chỉ gán biến (D=/đường/dẫn; grep x $D) là chỉ đọc; gán rồi chạy lệnh ghi thì vẫn là thay đổi', () => {
    expect(isReadOnlyCommand('D=/tmp/a.d.ts; grep -n x $D | head')).toBe(true)
    expect(isReadOnlyCommand('A=1 B=2; sed -n 1,5p $A')).toBe(true)
    expect(isReadOnlyCommand('D=/tmp/x; rm -rf $D')).toBe(false)
    expect(isReadOnlyCommand('D=/tmp/x; echo hi > $D')).toBe(false)
  })

  test('lệnh có ghi (sed -i, chuyển hướng, rm, sort -o, find -delete, git commit, thay thế lệnh) là thay đổi', () => {
    for (const command of ["sed -n 'w out' in", "sed 's/a/b/w out' in", "sed '1e rm x' in", 'sed -i s/a/b/ f', 'cat > f', 'rm -rf x', 'echo x > f', 'echo x >> f', 'sort -o out in', 'find . -delete', 'git commit -m x', 'npm install', 'ls $(rm x)', 'awk "BEGIN{system(\"rm x\")}"']) {
      expect(isReadOnlyCommand(command)).toBe(false)
    }
    const tracker = newTracker('t')
    observe(tracker, bash('cat > f'), FOCUS, [])
    observe(tracker, bash('rm -rf x'), FOCUS, [])
    expect(tracker.mutations).toBe(2)
  })

  test('checkpoint báo đúng ở thay đổi thứ 5 và 10, các lần đọc sau đó không nhắc lại', () => {
    const tracker = newTracker('t')
    const count = (kind: string, n: number, obs: ReturnType<typeof edit>) => {
      let fired = 0
      for (let i = 0; i < n; i++) fired += observe(tracker, obs, FOCUS, []).filter(f => f.kind === kind).length
      return fired
    }
    expect(count('checkpoint', 5, edit('src/a.ts'))).toBe(1)
    // Năm lần đọc ngay sau thay đổi thứ 5: bộ đếm vẫn bằng 5, không được nhắc lại.
    expect(count('checkpoint', 5, { tool: 'Read', input: { file_path: 'a.ts' }, isError: false, isReadOnly: true })).toBe(0)
    expect(count('checkpoint', 5, edit('src/a.ts'))).toBe(1)
  })

  test('ghi file kế hoạch của plan mode không tính là thay đổi và không bị kiểm phạm vi', () => {
    expect(isPlanFile('/root/.claude/plans/ke-hoach.md')).toBe(true)
    expect(isPlanFile('/repo/src/.claude/plans-old/x.md')).toBe(false)
    const tracker = newTracker('t')
    const findings = observe(tracker, { tool: 'Write', input: { file_path: '/root/.claude/plans/ke-hoach.md' }, isError: false, isReadOnly: false }, { ...FOCUS, scopePaths: ['src'] }, [])
    expect(tracker.mutations).toBe(0)
    expect(findings.some(f => f.kind === 'scope')).toBe(false)
  })

  test('turn chỉ đọc không bị cảnh báo "có thay đổi nhưng không kiểm tra"', () => {
    const tracker = newTracker('t')
    observe(tracker, bash('grep -rn charge src | head'), FOCUS, [])
    observe(tracker, bash('git status'), FOCUS, [])
    const brief = makeBrief()
    expect(summarize(tracker, { ...brief, tier: 'complex' }, []).some(f => f.kind === 'unverified')).toBe(false)
  })
})
