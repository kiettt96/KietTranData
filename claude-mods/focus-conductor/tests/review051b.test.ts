// Test tái hiện các điểm của vòng review cuối 0.5.1 (lệnh kiểm tra kèm ghi file, cú pháp shell, lệnh lỗi,
// awk, nhiều lệnh không xác định đích, phạm vi theo thư mục gốc). Chỉ dùng API đã có ở 5ac2a6b; đã chạy đỏ trên đó.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief } from '../types'
import { NODE, tailLines } from './fixtures/runner-output'
import { bashWriteTargets, classifyBash, completePass, evidenceStrength, isMutation, isReadOnlyCommand, isVerification, newEvidenceLog, newTracker, noteEvidence, observe, trackVerification } from '../hooks/lib/drift'

function makeBrief(over: Partial<Brief> = {}): Brief {
  return {
    goalId: 1, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'substantial', volume: 'medium',
    kind: 'edit', tier: 'complex', main: { family: 'opus', effort: 'high' }, why: '', relation: 'new', source: 'router', isFollowUp: false,
    isReference: false, scopePaths: [], prompt: '', at: 1, ...over,
  }
}
const bash = (command: string, extra: { isError?: boolean; output?: string; isReadOnly?: boolean } = {}) => ({
  tool: 'Bash', input: { command }, isError: extra.isError ?? false, isReadOnly: extra.isReadOnly ?? false, ...(extra.output !== undefined ? { output: extra.output } : {}),
})
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })

/** Trạng thái đã kiểm tra sau: sửa một file, rồi chạy lệnh. */
function verifiedAfter(command: string, extra: { isError?: boolean; output?: string } = {}): boolean {
  const tracker = newTracker('t')
  const brief = makeBrief()
  observe(tracker, edit('/repo/src/a.ts'), brief, [])
  observe(tracker, bash(command, extra), brief, [])
  return tracker.isVerified
}

describe('vòng cuối: lệnh kiểm tra kèm ghi file theo đúng cú pháp shell', () => {
  test('chuỗi trong nháy không tạo lệnh kiểm tra hay đoạn lệnh', () => {
    expect(isVerification(bash('echo "x && npm test"'))).toBe(false)
    expect(isMutation(bash('echo "a|b"'))).toBe(false)
  })

  test('lệnh có cả kiểm tra và ghi file là thay đổi', () => {
    expect(isMutation(bash('npm test && echo x > ../outside.txt'))).toBe(true)
    expect(isMutation(bash('npm test | tee ../out.log'))).toBe(true)
    expect(isMutation(bash('npm test > out.log'))).toBe(true)
  })

  test('trạng thái cuối theo thứ tự và toán tử', () => {
    expect(verifiedAfter('npm test && echo x > f')).toBe(false)
    expect(verifiedAfter('npm test || echo x > f')).toBe(false)
    expect(verifiedAfter('npm test; rm f')).toBe(false)
    expect(verifiedAfter('echo x > src/f && npm test')).toBe(true)
    // Kiểm tra sau || có thể đã không chạy.
    expect(verifiedAfter('echo x > f || npm test')).toBe(false)
    expect(verifiedAfter('bash -c "npm test"')).toBe(false)
  })

  test('kiểm tra nối ống: cần dấu hiệu đạt rõ trong output, không đủ thông tin thì chưa kiểm tra', () => {
    expect(verifiedAfter('node --test | tail -n 12', { output: tailLines(NODE.pass_tap, 12) })).toBe(true)
    expect(verifiedAfter('node --test | tail -n 5', { output: '# tests 3\n# pass 2\n# fail 1' })).toBe(false)
    expect(verifiedAfter('node --test | tail -n 5', { output: 'done' })).toBe(false)
    expect(verifiedAfter('npm test', { output: 'done' })).toBe(true)
  })

  test('thông tin chỉ đọc của engine không phủ định ghi xác định', () => {
    expect(isMutation(bash('echo x > f', { isReadOnly: true }))).toBe(true)
    expect(isMutation(bash('python gen.py', { isReadOnly: true }))).toBe(false)
  })
})

describe('vòng cuối: lệnh lỗi vẫn có thể đã ghi', () => {
  test('test đạt rồi lệnh ghi lỗi ở bước cuối: mất trạng thái đã kiểm tra; dấu vết ghi nhận thay đổi', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash('echo x > src/a.ts && false', { isError: true }), brief, [])
    expect(tracker.isVerified).toBe(false)
    const log = newEvidenceLog(1)
    noteEvidence(log, edit('/repo/src/a.ts'))
    noteEvidence(log, bash('npm test'))
    noteEvidence(log, bash('echo x > src/a.ts && false', { isError: true }))
    expect(evidenceStrength('npm test: 12 pass', log).level).toBe('stale')
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

describe('vòng cuối: phạm vi theo thư mục gốc', () => {
  const focus = (root: string | null) => ({ goal: 'g', scopePaths: ['src/'], tier: 'complex' as const, root })
  const scopeTexts = (root: string | null, path: string) =>
    observe(newTracker('t'), edit(path), focus(root) as never, []).filter(f => f.kind === 'scope').map(f => f.text)

  test('có thư mục gốc: dự án khác có src là ngoài phạm vi; trong gốc là trong phạm vi', () => {
    expect(scopeTexts('/repo', '/tmp/another-project/src/x.ts').length).toBe(1)
    expect(scopeTexts('/repo', '/repo/src/x.ts')).toEqual([])
    expect(scopeTexts('/repo', 'src/x.ts')).toEqual([])
    expect(scopeTexts('/repo', 'src/../config/a.json').length).toBe(1)
  })

  test('lệnh Bash: đường dẫn sau cd nối với thư mục gốc', () => {
    const run = (command: string) => observe(newTracker('t'), bash(command), focus('/repo') as never, []).filter(f => f.kind === 'scope').map(f => f.text)
    expect(run('cd src && touch a.ts')).toEqual([])
    expect(run('cd .. && touch other/x').length).toBe(1)
  })

  test('không có thư mục gốc: không khẳng định trong phạm vi', () => {
    expect(scopeTexts(null, '/tmp/another-project/src/x.ts').join('\n')).toMatch(/không xác định được phạm vi/i)
    expect(scopeTexts(null, '/repo/src/x.ts').join('\n')).toMatch(/không xác định được phạm vi/i)
  })
})

describe('vòng cuối: API mới (phân loại chung, theo dõi theo tác giả)', () => {
  test('hiệu ứng theo thứ tự và toán tử; chuyển hướng trên lệnh kiểm tra là ghi trước kiểm tra', () => {
    const kinds = (command: string) => classifyBash(command).effects.map(e => (e.kind === 'check' ? `check${e.trusted ? '' : '?'}:${e.exit}` : `write:${e.level}`))
    expect(kinds('npm test > out.log')).toEqual(['write:definite', 'check:visible'])
    // || đứng sau che mã thoát của lệnh kiểm tra (PR #13 P1).
    expect(kinds('npm test || echo x > f')).toEqual(['check:hidden', 'write:definite'])
    expect(kinds('npm test && echo done')).toEqual(['check:visible'])
    expect(kinds('echo x > f || npm test')).toEqual(['write:definite', 'check?:visible'])
    expect(kinds('node --test | tail -n 5')).toEqual(['check:filtered'])
    // Chỉ đoạn đầu tiên được lọc qua tail/cat thành filtered; lint đứng sau && và nối ống thì hidden.
    expect(kinds('npm test && npm run lint | tail -3')).toEqual(['check:visible', 'check:hidden'])
    expect(kinds('npm test | grep -v FAIL')).toEqual(['check:hidden'])
    expect(kinds('bash -c "npm test"')).toEqual(['write:possible', 'write:possible'])
    expect(verifiedAfter('npm test > out.log')).toBe(true)
  })

  test('kiểm tra của subagent chỉ xóa phần của nó; kiểm tra của luồng chính xóa tất cả; ghi trong tool lỗi vẫn tính', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'), 'main')
    trackVerification(tracker, edit('/repo/src/b.ts'), 'agent-1')
    trackVerification(tracker, bash('npm test'), 'agent-1')
    expect(tracker.isVerified).toBe(false)
    expect([...tracker.pending]).toEqual(['main'])
    trackVerification(tracker, bash('npm test'), 'main')
    expect(tracker.isVerified).toBe(true)
    trackVerification(tracker, bash('echo x > src/c.ts && false', { isError: true }), 'agent-2')
    expect(tracker.isVerified).toBe(false)
    expect(trackVerification(tracker, { ...edit('/repo/src/d.ts'), isError: true }, 'agent-2')).toBe(0)
  })

  test('dấu vết: test của subagent là bằng chứng mạnh chỉ khi nó phủ mọi thay đổi kể từ lần kiểm tra trước của luồng chính', () => {
    const own = newEvidenceLog(1)
    noteEvidence(own, edit('/repo/src/b.ts'), 'agent-1')
    noteEvidence(own, bash('npm test'), 'agent-1')
    expect(evidenceStrength('npm test: 3 pass', own).level).toBe('strong')
    const mixed = newEvidenceLog(1)
    noteEvidence(mixed, edit('/repo/src/a.ts'), 'main')
    noteEvidence(mixed, edit('/repo/src/b.ts'), 'agent-1')
    noteEvidence(mixed, bash('npm test'), 'agent-1')
    const strength = evidenceStrength('npm test: 3 pass', mixed)
    expect(strength.level).toBe('stale')
    expect(strength.reason).toContain('chỉ phủ thay đổi của chính nó')
  })
})

describe('vòng cuối: ca biên do kiểm đột biến chỉ ra', () => {
  test('phạm vi chỉ là tên file: file trùng tên ngoài thư mục gốc là ngoài phạm vi', () => {
    const texts = observe(newTracker('t'), edit('/tmp/x/app.ts'), { goal: 'g', scopePaths: ['app.ts'], tier: 'complex', root: '/repo' }, [])
    expect(texts.filter(f => f.kind === 'scope').length).toBe(1)
    expect(observe(newTracker('t'), edit('/repo/src/app.ts'), { goal: 'g', scopePaths: ['app.ts'], tier: 'complex', root: '/repo' }, []).filter(f => f.kind === 'scope')).toEqual([])
  })

  test('cấu trúc chưa hỗ trợ: kiểm tra không được tin, kể cả khi engine báo chỉ đọc', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, bash('D=$(pwd) npm test', { isReadOnly: true }), brief, [])
    expect(tracker.isVerified).toBe(false)
  })
})

describe('PR #13 P1: mã thoát của lệnh kiểm tra bị che bởi lệnh đứng sau', () => {
  test('kiểm tra trước ; hoặc || (output không rõ, mã thoát 0): chưa kiểm tra', () => {
    for (const command of ['npm test; echo done', 'npm test || echo fallback', 'npm test && echo ok || echo bad', 'npm test; true']) {
      expect(verifiedAfter(command, { output: 'done' }), command).toBe(false)
    }
  })

  test('mã thoát bị che (; hay ||) không bao giờ được tính là đạt, kể cả khi output có báo cáo đạt', () => {
    expect(verifiedAfter('npm test; echo done', { output: 'Tests: 12 passed, 12 total\ndone' })).toBe(false)
    expect(verifiedAfter('node --test || echo fallback', { output: '# tests 3\n# pass 3\n# fail 0' })).toBe(false)
  })

  test('npm test; printf "1 passed" (lệnh sau tự in báo đạt): chưa xác minh', () => {
    expect(verifiedAfter("npm test; printf '1 passed\\n'", { output: '1 passed' })).toBe(false)
  })

  test('lọc ống: sed, grep, head, tee không xác nhận; tail hoặc cat chỉ khi có báo cáo tổng kết đầy đủ', () => {
    expect(verifiedAfter('npm test | sed \'s/failed/passed/\'', { output: '12 passed' })).toBe(false)
    expect(verifiedAfter('npm test | grep -v FAIL', { output: '12 passed' })).toBe(false)
    expect(verifiedAfter('npm test 2>&1 | head -40', { output: '# tests 3\n# pass 3\n# fail 0' })).toBe(false)
    expect(verifiedAfter('node --test | tail -n 12', { output: tailLines(NODE.pass_tap, 12) })).toBe(true)
    expect(verifiedAfter('node --test | tail -n 5', { output: '1 passed' })).toBe(false)
    expect(verifiedAfter('npx jest | cat', { output: 'Tests:       12 passed, 12 total' })).toBe(true)
    expect(verifiedAfter('node --test | tail -n 5', { output: '# tests 3\n# pass 2\n# fail 1' })).toBe(false)
  })

  test('mỗi lệnh kiểm tra gắn với đoạn của chính nó: evidence cho lint không xác nhận test và ngược lại', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit('/repo/src/a.ts'))
    noteEvidence(log, { ...bash('npm test && npm run lint | tail -3'), output: '# tests 3\n# pass 3\n# fail 0\nlint: problem' })
    expect(evidenceStrength('npm run lint: đạt', log).level).not.toBe('strong')
    expect(evidenceStrength('npm test: 3 pass', log).level).toBe('strong')
  })

  test('đối chứng: kiểm tra mà mọi lệnh sau đều nối bằng && thì mã thoát phản ánh kiểm tra', () => {
    expect(verifiedAfter('npm test && echo done', { output: 'done' })).toBe(true)
    expect(verifiedAfter('npm test && npm run lint', { output: 'done' })).toBe(true)
  })
})

describe('PR #13 vòng 2: báo cáo đầy đủ nhưng có dấu hiệu lỗi kèm theo', () => {
  test('báo cáo jest đạt mà có dòng FAILED: không xác nhận', () => {
    expect(verifiedAfter('npx jest | cat', { output: 'Tests:       12 passed, 12 total\nFAILED  src/x.test.ts' })).toBe(false)
  })
})

describe('PR #13 vòng 2: completePass trực tiếp', () => {
  test('báo cáo đầy đủ nhưng có dòng lỗi: không đạt, kể cả khi bỏ qua bước lọc lỗi bên ngoài', () => {
    expect(completePass('Tests: 12 passed, 12 total\nFAILED src/x.test.ts')).toBe(false)
    expect(completePass(`${NODE.pass_tap}not a report`)).toBe(true)
    expect(completePass(`${NODE.pass_tap}FAILED src/x.test.ts`)).toBe(false)
    expect(completePass('1 passed')).toBe(false)
  })
})
