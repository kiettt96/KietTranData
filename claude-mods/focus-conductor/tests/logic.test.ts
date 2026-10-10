// Test các hàm thuần: điều phối có tính cache, nâng theo bằng chứng, khớp việc đã phân,
// đọc trạng thái cũ, reducer checklist và phát hiện lạc đề.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Route, Task } from '../types'
import { evidenceMatches, isPlanFile, isReadOnlyCommand, newEvidenceLog, newTracker, noteEvidence, observe, summarize } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { decideMain, liftPick, matchTask, resolveModelId, taskMatch } from '../hooks/lib/route'
import { normalizeCore, retarget } from '../hooks/lib/state'
import { droppedPlanNotice, statusLine } from '../hooks/lib/text'

/** Brief tối thiểu do router đọc; mỗi test chỉ đổi phần mình cần. */
function makeBrief(over: Partial<Brief> = {}): Brief {
  return {
    goalId: 1,
    goal: 'Tạo plugin điều phối model cho Claude Code',
    steps: [],
    tasks: [],
    constraints: [],
    quality: [],
    depth: 'substantial',
    volume: 'medium',
    kind: 'mixed',
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

function task(index: number, title: string, over: Partial<Task> = {}): Task {
  return {
    index,
    title,
    run: 'agent',
    agentType: 'general-purpose',
    pick: { family: 'sonnet', effort: 'medium' },
    depth: 'light',
    volume: 'small',
    kind: 'edit',
    why: '',
    ...over,
  }
}

function route(family: Route['family'], effort: Route['effort']): Route {
  return { family, effort, tier: 'complex', goalId: 1, reason: '' }
}

describe('khớp lời gọi Agent với việc đã phân (chỉ theo cấu trúc)', () => {
  const tasks = [
    task(1, 'Tìm chỗ gọi charge'),
    task(2, 'Đổi tên userId thành accountId'),
    task(5, 'Cập nhật README'),
  ]
  const coded = [task(1, 'K4.1. Kiểm kê dữ liệu'), task(10, 'K4.10. Kiểm trên số liệu thật'), task(9, 'K4.9 Báo cáo')]

  test('"Việc N" và "Task N" khớp theo số; "Bước N" không khớp', () => {
    expect(matchTask(tasks, 'Việc 2: đổi tên userId')?.index).toBe(2)
    expect(matchTask(tasks, 'viec 2 doi ten')?.index).toBe(2)
    expect(matchTask(tasks, 'Task 5')?.index).toBe(5)
    expect(matchTask(tasks, 'Task #5: README')?.index).toBe(5)
    expect(matchTask(tasks, 'Bước 2: chạy test')).toBeUndefined()
    expect(matchTask(tasks, 'Việc 7: không có')).toBeUndefined()
  })

  test('không đoán theo ý: mô tả cùng ý mà không có số hay mã thì không khớp', () => {
    expect(matchTask(tasks, 'Đổi tên userId thành accountId')).toBeUndefined()
    expect(matchTask(tasks, '3 file controller cần đổi tên')).toBeUndefined()
  })

  test('không khớp mà có dấu hiệu nhắm một việc thì có lý do để ghi log (vẫn không khớp)', () => {
    expect(taskMatch(tasks, 'Bước 2: chạy test')).toEqual({ miss: '"Bước 2" là số bước của checklist, không phải số việc' })
    expect(taskMatch(tasks, 'Việc 7: không có').miss).toBe('không có việc 7')
    const near = taskMatch(tasks, 'Đổi tên userId thành accountId')
    expect(near.task).toBeUndefined()
    expect(near.miss).toContain('tên gần giống việc 2')
    expect(taskMatch(tasks, 'Viết tài liệu kiến trúc')).toEqual({})
    expect(taskMatch([], 'Việc 1')).toEqual({})
  })

  test('mã mục so nguyên mã: K4.1 không khớp K4.10', () => {
    expect(matchTask(coded, 'K4.10 kiểm trên số liệu thật')?.index).toBe(10)
    expect(matchTask(coded, 'K4.1 kiểm kê')?.index).toBe(1)
    expect(matchTask([...coded].reverse(), 'K4.1 kiểm kê')?.index).toBe(1)
    expect(matchTask(coded, 'K4.9')?.index).toBe(9)
  })
})

describe('trạng thái và chốt lại mục tiêu', () => {
  test('brief 0.3.x (heuristic, có prompt đính kèm) đọc được: không có lựa chọn của router, không ép', () => {
    const old = {
      goalId: 3,
      goal: 'Đối chiếu',
      steps: ['a'],
      subtasks: [{ index: 1, title: 'x', depth: 'light', volume: 'small', kind: 'edit', hardSignals: [] }],
      constraints: [],
      quality: [],
      depth: 'light',
      volume: 'small',
      kind: 'answer',
      hardSignals: [],
      tier: 'simple',
      score: 10,
      signals: [],
      source: 'heuristic',
      isFollowUp: false,
      keywords: [],
      scopePaths: [],
      prompt: 'p',
      at: 5,
      attached: { depth: 'hard', volume: 'large', kind: 'mixed', subtasks: [] },
    }
    const brief = normalizeCore({ brief: old as unknown as Brief }).brief
    expect(brief?.main).toBeNull()
    expect(brief?.tasks).toEqual([])
    expect(brief?.isReference).toBe(true)
    expect(brief?.source).toBe('none')
    expect(brief?.relation).toBe('new')
    expect(brief?.steps).toEqual(['a'])
    expect('subtasks' in (brief ?? {})).toBe(false)
  })

  test('brief 0.1.x chỉ có tier vẫn suy ra độ sâu và khối lượng', () => {
    const brief = normalizeCore({ brief: { goalId: 1, goal: 'g', tier: 'deep' } as unknown as Brief }).brief
    expect(brief?.depth).toBe('hard')
    expect(brief?.volume).toBe('large')
    expect(brief?.main).toBeNull()
  })

  test('chốt lại mục tiêu qua tool plan chỉ thay mục tiêu và bước; việc đã phân và lựa chọn giữ nguyên', () => {
    const brief = makeBrief({ tasks: [task(1, 'a')] })
    const next = retarget(brief, '  Mục tiêu mới  ', ['b', 'c'])
    expect(next.goal).toBe('Mục tiêu mới')
    expect(next.steps).toEqual(['b', 'c'])
    expect(next.tasks).toEqual(brief.tasks)
    expect(next.main).toEqual(brief.main)
    expect(retarget(brief, undefined, []).goal).toBe(brief.goal)
  })
})

describe('điều phối có tính cache', () => {
  const quiet = { haiku: 1, sonnet: 1, opus: 1, fable: 1 }
  // Mặc định: opus/xhigh đang chạy, ngữ cảnh 100k, một turn còn lại; mỗi test chỉ đổi một ý.
  const decide = (over: Partial<Parameters<typeof decideMain>[0]>) =>
    decideMain({
      current: route('opus', 'xhigh'),
      wanted: { family: 'sonnet', effort: 'medium' },
      volume: 'small',
      tier: 'moderate',
      goalId: 1,
      context: 100_000,
      window: 200_000,
      turnsLeft: 1,
      isFree: false,
      calib: quiet,
      ...over,
    })

  test('hạ cấp giữa chừng khi ngữ cảnh dài: chi phí ghi lại cache lớn hơn lợi ích nên giữ lại', () => {
    const d = decide({})
    expect(d.isHeld).toBe(true)
    expect(d.route.family).toBe('opus')
  })

  test('hạ cấp ở hội thoại ngắn với nhiều turn còn lại: lợi ích vượt chi phí ghi lại nên đổi', () => {
    const d = decide({ context: 5_000, turnsLeft: 2 })
    expect(d.isHeld).toBe(false)
    expect(d.route.family).toBe('sonnet')
  })

  test('nâng cấp luôn được đổi, kể cả khi ngữ cảnh dài', () => {
    expect(decide({ current: route('sonnet', 'low'), wanted: { family: 'opus', effort: 'xhigh' } }).route.family).toBe('opus')
  })

  test('cache đã nguội thì đổi không mất chi phí ghi lại', () => {
    expect(decide({ isFree: true }).route.family).toBe('sonnet')
  })

  test('ngữ cảnh gần đầy thì không đổi sang model khác, kể cả khi đổi không tốn chi phí cache', () => {
    const d = decide({ context: 180_000, isFree: true })
    expect(d.isHeld).toBe(true)
    expect(d.route.family).toBe('opus')
  })

  test('cùng model, chỉ khác effort: đổi effort khi ngữ cảnh dài không đáng để ghi lại cache', () => {
    expect(decide({ wanted: { family: 'opus', effort: 'high' } }).isHeld).toBe(true)
  })

  test('model ID giữ tiền tố nhà cung cấp và giữ nguyên khi cùng họ', () => {
    expect(resolveModelId('sonnet', 'claude-opus-5-5', {})).toBe('claude-sonnet-5-5')
    expect(resolveModelId('opus', 'claude-opus-5-5[1m]', {})).toBe('claude-opus-5-5[1m]')
    expect(resolveModelId('haiku', 'us.anthropic.claude-opus-5-5', {})).toBe('us.anthropic.claude-haiku-5-5')
    expect(resolveModelId('haiku', 'claude-opus-5-5', { haiku: 'my-haiku' })).toBe('my-haiku')
  })

  test('nâng theo bằng chứng: lặp lỗi nâng họ model, vượt ngân sách nâng effort; fable chỉ khi được phép', () => {
    expect(liftPick({ family: 'sonnet', effort: 'medium' }, { depth: 1, effort: 0 }, false)).toEqual({ family: 'opus', effort: 'medium' })
    expect(liftPick({ family: 'haiku', effort: 'low' }, { depth: 2, effort: 1 }, false)).toEqual({ family: 'opus', effort: 'medium' })
    expect(liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 1 }, false)).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 0 }, true)).toEqual({ family: 'fable', effort: 'high' })
    expect(liftPick({ family: 'sonnet', effort: 'xhigh' }, { depth: 0, effort: 2 }, false)).toEqual({ family: 'sonnet', effort: 'xhigh' })
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
      'timeout 300 claude plugin test . 2>&1 | grep pass',
      'FOO=1 npm run build',
      'sed -i s/a/b/ f && npm test',
      'npx --no-install tsc -p tsconfig.json 2>&1 | head',
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
})

describe('status line và báo checklist bị bỏ', () => {
  test('status line không lặp tiền tố tên plugin mà engine đã thêm', () => {
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
    const brief = makeBrief({ tier: 'complex' })
    expect(statusLine(brief, [], route('opus', 'high'), 'auto')).toBe('complex · opus/high')
    expect(statusLine(brief, [], route('opus', 'high'), 'suggest')).toBe('complex · opus/high · suggest')
  })

  test('báo cho Claude biết checklist cũ còn bao nhiêu bước mở đã bị bỏ', () => {
    const notice = droppedPlanNotice([
      { id: 1, title: 'Viết hooks', status: 'todo' },
      { id: 2, title: 'Viết test', status: 'doing' },
    ])
    expect(notice).toContain('còn 2 bước mở')
    expect(notice).toContain('Viết hooks; Viết test')
    expect(notice).toContain('mcp__focus-conductor__plan')
  })
})

describe('checklist', () => {
  test('verified cần bằng chứng, skipped cần lý do', () => {
    const set = applyPlan([], { action: 'set', goal: 'G', steps: [{ title: 'a' }, { title: 'b' }] })
    expect(set.plan?.length).toBe(2)
    const plan = set.plan ?? []
    expect(applyPlan(plan, { action: 'update', step: 1, status: 'verified' }).error).toBeDefined()
    expect(applyPlan(plan, { action: 'update', step: 2, status: 'skipped' }).error).toBeDefined()
    const ok = applyPlan(plan, { action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 passed' })
    expect(ok.plan?.[0]?.status).toBe('verified')
    expect(applyPlan(plan, { action: 'update', step: 9, status: 'done' }).error).toContain('Không có bước id 9')
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

describe('0.5.0: đối chiếu evidence và lệnh in biến môi trường', () => {
  test('env và printenv không kèm lệnh là chỉ đọc; env kèm lệnh thì không', () => {
    expect(isReadOnlyCommand('env | grep -i claude | sed -E \'s/=.*/=…/\' | head -30')).toBe(true)
    expect(isReadOnlyCommand('printenv PATH')).toBe(true)
    expect(isReadOnlyCommand('printenv')).toBe(true)
    expect(isReadOnlyCommand('env FOO=1 make build')).toBe(false)
    expect(isReadOnlyCommand('env -0')).toBe(true)
  })

  test('evidence khớp khi nhắc vài từ đầu của lệnh đã chạy, đối số dạng đường dẫn, hoặc file đã đụng tới', () => {
    const log = newEvidenceLog(1)
    const bash = (command: string) => noteEvidence(log, { tool: 'Bash', input: { command }, isError: false, isReadOnly: false })
    bash('cd /repo/mod && claude plugin test . 2>&1 | tail -3')
    bash('npx --no-install tsc -p scratchpad/tc/tsconfig.repo.json')
    noteEvidence(log, { tool: 'Edit', input: { file_path: '/repo/mod/hooks/lib/drift.ts' }, isError: false, isReadOnly: false })
    expect(evidenceMatches('claude plugin test . 184 pass 0 fail', log)).toBe(true)
    expect(evidenceMatches('npx tsc sạch', log)).toBe(true)
    expect(evidenceMatches('tsc -p scratchpad/tc/tsconfig.repo.json không lỗi', log)).toBe(true)
    expect(evidenceMatches('đã đọc lại drift.ts', log)).toBe(true)
    expect(evidenceMatches('đã kiểm tra kỹ, chạy ổn', log)).toBe(false)
    expect(evidenceMatches('npm test 12 pass', log)).toBe(false)
    expect(evidenceMatches('anything', newEvidenceLog(1))).toBe(false)
  })
})
