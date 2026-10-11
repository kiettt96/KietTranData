// Test tái hiện các lỗ hổng chuyên gia nêu ở lần rà 0.5.0 (01 đến 06) và các phần siết của 0.5.1.
// Mỗi describe ứng với một điểm; test viết trước khi sửa và đã chạy đỏ trên 0.5.0.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, ModelFamily } from '../types'
import { acceptsVerified, bashWriteTargets, checkKindOf, evidenceStrength, outputFailed, isExecuting, isInScope, newEvidenceLog, newTracker, noteEvidence, observe, summarize } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { fitPick, taskRoute } from '../hooks/lib/router'
import { liftPick } from '../hooks/lib/route'
import type { Policy } from '../hooks/lib/router'
import { NODE, tailLines } from './fixtures/runner-output'

function makeBrief(over: Partial<Brief> = {}): Brief {
  return {
    goalId: 1,
    goal: 'Sửa module thanh toán',
    steps: [],
    tasks: [],
    constraints: [],
    quality: [],
    depth: 'substantial',
    volume: 'medium',
    kind: 'edit',
    tier: 'complex',
    main: { family: 'opus', effort: 'high' },
    why: '',
    relation: 'new',
    source: 'router',
    isFollowUp: false,
    isReference: false,
    scopePaths: [],
    prompt: '',
    at: 1,
    ...over,
  }
}

const bash = (command: string, isError = false) => ({ tool: 'Bash', input: { command }, isError, isReadOnly: false })
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }

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

describe('02: lệnh Bash ghi file bị đối chiếu với phạm vi', () => {
  const brief = { ...makeBrief({ scopePaths: ['src'] }), root: '/repo' }
  const scopeOf = (command: string) => observe(newTracker('t'), bash(command), brief, []).filter(f => f.kind === 'scope')

  test('sed -i, chuyển hướng, tee, cp, mv, rm, touch ngoài phạm vi thì cảnh báo', () => {
    for (const command of [
      'sed -i s/a/b/ config/app.json',
      'echo x > config/app.json',
      'echo x >> /repo/config/app.json',
      'printf x | tee -a config/app.json',
      'cp src/a.ts config/a.ts',
      'mv src/a.ts lib/a.ts',
      'rm -f config/old.json',
      'touch config/new.json',
      "sed -i -e 's/a/b/' config/app.json",
    ]) {
      const found = scopeOf(command)
      expect(found.length, command).toBeGreaterThan(0)
      expect(found[0]?.text, command).toMatch(/config\/|lib\//)
    }
  })

  test('ghi trong phạm vi (kể cả đường dẫn tương đối, sau cd) thì không cảnh báo', () => {
    for (const command of ['sed -i s/a/b/ src/app.ts', 'echo x > src/gen.ts', 'cd src && sed -i s/a/b/ app.ts', 'cp config/a.ts src/a.ts', 'echo "a > config/x" > src/y.ts', 'npm test > /dev/null 2>&1']) {
      expect(scopeOf(command).length, command).toBe(0)
    }
  })

  test('không xác định được file đích thì cảnh báo riêng, mỗi lệnh khác nhau một lần (vòng cuối), không coi là đã kiểm soát', () => {
    const tracker = newTracker('t')
    const first = observe(tracker, bash('python scripts/gen.py'), brief, []).filter(f => f.kind === 'scope')
    expect(first[0]?.text).toContain('không xác định được file đích')
    expect(observe(tracker, bash('python scripts/gen.py'), brief, []).some(f => f.kind === 'scope')).toBe(false)
    expect(observe(tracker, bash('node build.js'), brief, []).some(f => f.kind === 'scope')).toBe(true)
  })

  test('không giới hạn phạm vi thì không cảnh báo; mỗi đường dẫn chỉ báo một lần', () => {
    expect(observe(newTracker('t'), bash('echo x > config/a.json'), makeBrief(), []).some(f => f.kind === 'scope')).toBe(false)
    const tracker = newTracker('t')
    expect(observe(tracker, bash('echo x > config/a.json'), brief, []).some(f => f.kind === 'scope')).toBe(true)
    expect(observe(tracker, bash('echo y > config/a.json'), brief, []).some(f => f.kind === 'scope')).toBe(false)
  })

  test('isInScope neo theo thư mục gốc, nhận đường dẫn tương đối và chuẩn hóa ./ và ..', () => {
    expect(isInScope('src/a.ts', ['src'], '/repo')).toBe(true)
    expect(isInScope('./src/a.ts', ['src/'], '/repo')).toBe(true)
    expect(isInScope('src/../config/a.json', ['src'], '/repo')).toBe(false)
    expect(isInScope('/repo/src/a.ts', ['src'], '/repo')).toBe(true)
    expect(isInScope('config/a.json', ['src'], '/repo')).toBe(false)
    // Không có thư mục gốc thì không khẳng định trong phạm vi.
    expect(isInScope('/repo/src/a.ts', ['src'])).toBe(false)
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

describe('05: plan set với steps rỗng thay toàn bộ checklist', () => {
  const current = [
    { id: 1, title: 'a', status: 'todo' as const },
    { id: 2, title: 'b', status: 'doing' as const },
  ]

  test('steps: [] kèm goal thì xóa checklist; không truyền steps thì giữ', () => {
    expect(applyPlan(current, { action: 'set', goal: 'Mục tiêu mới', steps: [] }).plan).toEqual([])
    expect(applyPlan(current, { action: 'set', steps: [] }).plan).toEqual([])
    expect(applyPlan(current, { action: 'set', goal: 'Mục tiêu mới' }).plan).toEqual(current)
  })

  test('steps khác rỗng mà không có bước hợp lệ thì báo lỗi, không lặng lẽ giữ', () => {
    expect(applyPlan(current, { action: 'set', goal: 'G', steps: [{ title: '' }, 3] }).error).toContain('không có bước hợp lệ')
  })
})

describe('06: chính sách model của phiên giữ nguyên sau khi tránh họ bị chặn', () => {
  test('ceiling=opus, opus bị chặn, cho phép fable: không lên fable', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'ceiling' } }
    const fitted = fitPick({ family: 'opus', effort: 'high' }, 'edit', policy)
    expect(fitted.pick.family).toBe('sonnet')
  })

  test('ceiling=sonnet, sonnet bị chặn, việc sửa file: không nhảy lên opus', () => {
    const policy: Policy = { allowFable: false, blocked: new Set(['sonnet']), session: { family: 'sonnet', policy: 'ceiling' } }
    const fitted = fitPick({ family: 'opus', effort: 'high' }, 'edit', policy)
    expect(fitted.pick.family).not.toBe('opus')
    expect(fitted.notes.join('; ')).toContain('không có họ thay thế')
  })

  test('fixed=opus, opus bị chặn: giữ opus theo cấu hình và ghi rõ', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'fixed' } }
    const fitted = fitPick({ family: 'sonnet', effort: 'medium' }, 'edit', policy)
    expect(fitted.pick.family).toBe('opus')
    expect(fitted.notes.join('; ')).toContain('model cố định')
  })

  test('không bật allowFable thì đường lên khi các họ thấp hơn bị chặn không ra fable', () => {
    const policy: Policy = { allowFable: false, blocked: new Set(['haiku', 'sonnet', 'opus']), session: null }
    expect(fitPick({ family: 'sonnet', effort: 'low' }, 'answer', policy).pick.family).not.toBe('fable')
  })

  test('auto vẫn tránh họ bị chặn như trước', () => {
    const policy: Policy = { ...OPEN, blocked: new Set(['opus']) }
    expect(fitPick({ family: 'opus', effort: 'high' }, 'edit', policy).pick.family).toBe('sonnet')
    expect(fitPick({ family: 'opus', effort: 'high' }, 'edit', { ...policy, allowFable: true }).pick.family).toBe('fable')
  })
})

describe('06: mọi đường chọn model đều giữ chính sách phiên', () => {
  test('việc đã phân (taskRoute) và lựa chọn đã nâng (lift) không vượt trần khi họ bị chặn', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'ceiling' } }
    const task = { index: 1, title: 't', run: 'agent' as const, agentType: 'general-purpose', pick: { family: 'opus' as const, effort: 'high' as const }, depth: 'hard' as const, volume: 'medium' as const, kind: 'edit' as const, why: '' }
    expect(taskRoute(task, policy).pick.family).toBe('sonnet')
    const lifted = liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 0 }, true)
    expect(lifted.family).toBe('fable')
    expect(fitPick(lifted, 'edit', policy).pick.family).toBe('sonnet')
  })
})

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

describe('04: độ mạnh của bằng chứng', () => {
  test('strong, stale, weak, none theo kết quả và thứ tự thật của lệnh', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false })
    noteEvidence(log, { tool: 'Bash', input: { command: 'npm test' }, isError: true, isReadOnly: false })
    expect(evidenceStrength('npm test', log).level).toBe('stale')
    noteEvidence(log, { tool: 'Bash', input: { command: 'npm test' }, isError: false, isReadOnly: false })
    expect(evidenceStrength('npm test: 12 pass', log)).toEqual({ level: 'strong', check: 'test' })
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/src/b.ts' }, isError: false, isReadOnly: false })
    expect(evidenceStrength('npm test: 12 pass', log).level).toBe('stale')
    expect(evidenceStrength('đã đọc lại a.ts', log).level).toBe('weak')
    expect(evidenceStrength('ổn', log).level).toBe('none')
    expect(acceptsVerified({ level: 'weak' }, log)).toBe(false)
    expect(acceptsVerified({ level: 'weak' }, newEvidenceLog(2))).toBe(true)
    expect(checkKindOf('cd mod && npx tsc --noEmit')).toBe('static')
    expect(checkKindOf('npx tsc && npm test')).toBe('test')
    expect(checkKindOf('ls tests/')).toBe(null)
  })
})

describe('04: kết quả thật của lệnh kiểm tra (từ phiên chạy thật)', () => {
  test('lệnh test qua | tail có mã thoát 0 nhưng output báo lỗi: không tính là kiểm tra đạt', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/repo/src/a.ts'), brief, [])
    observe(tracker, { ...bash('node --test src/ 2>&1 | tail -15'), output: '# tests 1\n# pass 0\n# fail 1' }, brief, [])
    expect(tracker.isVerified).toBe(false)
    const log = newEvidenceLog(1)
    noteEvidence(log, { ...edit('/repo/src/a.ts') })
    noteEvidence(log, { ...bash('node --test src/ 2>&1 | tail -15'), output: '# pass 0\n# fail 1' })
    expect(evidenceStrength('node --test: 1 pass', log).level).toBe('stale')
    noteEvidence(log, { ...bash('node --test src/add.test.js 2>&1 | tail -12'), output: tailLines(NODE.pass_tap, 12) })
    expect(evidenceStrength('node --test: 1 pass', log).level).toBe('strong')
  })

  test('dấu hiệu lỗi của các trình chạy phổ biến; số 0 không phải lỗi', () => {
    for (const out of ['Tests: 2 failed, 10 passed', '3 failing', 'src/a.ts(1,1): error TS2322: x', 'FAILED tests/test_a.py::t', '\u2716 4 problems', 'test result: FAILED. 1 passed', '--- FAIL: TestX', ' 12 pass\n 1 fail']) {
      expect(outputFailed(out), out).toBe(true)
    }
    for (const out of ['12 pass\n0 fail', '# fail 0', 'Tests: 10 passed', 'Found 0 errors', '']) expect(outputFailed(out), out).toBe(false)
  })
})
