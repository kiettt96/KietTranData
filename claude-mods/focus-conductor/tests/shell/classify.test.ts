// Phân loại lệnh Bash (hooks/lib/drift/classify): lệnh kiểm tra kèm ghi file theo cú pháp shell, lệnh lỗi vẫn có thể đã ghi, API phân loại chung.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash, evidenceStrength, isMutation, isVerification, newEvidenceLog, newTracker, noteEvidence, observe, trackVerification } from '../../hooks/lib/drift'
import { NODE, tailLines } from '../fixtures/runner-output'
import { bash, edit, makeBrief, verifiedAfter } from '../support/commands'

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
