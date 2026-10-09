// Test các hàm thuần: chấm độ phức tạp, đọc prompt, điều phối có tính cache,
// chọn model subagent, reducer checklist và phát hiện lạc đề.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Route } from '../types'
import { analyzeHeuristic, isMeta, mergeAnalysis, scoreComplexity, tierFromScore } from '../hooks/lib/analyze'
import { newTracker, observe } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { decideMain, planAgent, resolveModelId } from '../hooks/lib/route'

const LONG_PROMPT = `### Mục tiêu
Tạo một plugin điều phối model cho Claude Code theo kiến trúc hook.

### Yêu cầu
1. Phân tích prompt trước khi làm.
2. Điều phối model, effort và agent theo độ phức tạp, tối ưu chi phí.
3. Giữ nhất quán, cảnh báo khi lạc đề.
4. Viết test, type-check sạch.
- Không được sửa file ngoài thư mục plugin.
- Code phải sạch, có comment rõ ràng.`

function route(family: Route['family'], effort: Route['effort']): Route {
  return { family, effort, tier: 'complex', goalId: 1, reason: '' }
}

describe('đọc prompt', () => {
  test('việc vặt ngắn ra tier thấp, yêu cầu dài nhiều mục ra tier cao', () => {
    expect(tierFromScore(scoreComplexity('sửa typo trong README').score)).toBe('trivial')
    const big = scoreComplexity(LONG_PROMPT)
    expect(['complex', 'deep']).toContain(tierFromScore(big.score))
  })

  test('bóc mục tiêu, bước, ràng buộc và tiêu chí chất lượng', () => {
    const brief = analyzeHeuristic(LONG_PROMPT, null, 1)
    expect(brief.goal).toBe('Tạo một plugin điều phối model cho Claude Code theo kiến trúc hook.')
    expect(brief.steps.length).toBe(4)
    expect(brief.constraints.some(c => c.includes('Không được sửa file'))).toBe(true)
    expect(brief.quality.some(q => q.includes('Code phải sạch'))).toBe(true)
    expect(brief.goalId).toBe(1)
    expect(brief.isFollowUp).toBe(false)
  })

  test('prompt tiếp nối giữ mục tiêu và goalId, "tiếp tục" giữ tier', () => {
    const first = analyzeHeuristic(LONG_PROMPT, null, 1)
    const next = analyzeHeuristic('tiếp tục', first, 2)
    expect(next.isFollowUp).toBe(true)
    expect(next.goalId).toBe(first.goalId)
    expect(next.goal).toBe(first.goal)
    expect(next.tier).toBe(first.tier)
  })

  test('"sửa..." khác chủ đề là mục tiêu mới; cùng chủ đề hoặc không có nội dung là tiếp nối', () => {
    const auth = analyzeHeuristic(
      `Hãy giúp tôi xây dựng một module xác thực đơn giản bằng TypeScript:
1. Tạo file auth.ts chứa hàm login (email + password) và logout
2. Thêm JWT: tạo token khi login, verify token ở middleware
3. Viết unit test cho login, logout và verify token`,
      null,
      1,
    )
    const other = analyzeHeuristic(
      'Sửa phần phân tích prompt của focus-conductor: lọc bỏ các câu dẫn/meta của người dùng khỏi danh sách tiêu chí chất lượng và ràng buộc. Chỉ giữ các yêu cầu thực sự của task.',
      auth,
      2,
    )
    expect(other.isFollowUp).toBe(false)
    expect(other.goalId).toBe(auth.goalId + 1)

    const refine = analyzeHeuristic('sửa lại hàm login để trả lỗi rõ hơn khi token hết hạn', auth, 3)
    expect(refine.isFollowUp).toBe(true)
    expect(refine.goal).toBe(auth.goal)

    expect(analyzeHeuristic('sửa lỗi đó đi', auth, 4).isFollowUp).toBe(true)
    expect(analyzeHeuristic('viết hàm parseDate cho ngày ISO', auth, 5).isFollowUp).toBe(false)
  })

  test('"task mới" mở mục tiêu mới', () => {
    const first = analyzeHeuristic(LONG_PROMPT, null, 1)
    const next = analyzeHeuristic('task mới: viết script backup database hằng ngày', first, 2)
    expect(next.isFollowUp).toBe(false)
    expect(next.goalId).toBe(2)
  })

  test('phạm vi sửa chỉ được ghi nhận khi prompt giới hạn rõ', () => {
    expect(analyzeHeuristic('xem hooks/hooks.json giúp mình', null, 1).scopePaths).toEqual([])
    expect(analyzeHeuristic('chỉ sửa src/app.ts để thêm log', null, 1).scopePaths).toEqual(['src/app.ts'])
  })

  test('câu dẫn/meta bị loại khỏi ràng buộc, tiêu chí, bước và mục tiêu', () => {
    const prompt = `tôi gửi prompt test mods vừa cài:
Hãy giúp tôi xây dựng một module xác thực đơn giản bằng TypeScript:

1. Tạo file auth.ts chứa hàm login và logout
2. Viết unit test cho login và logout

Yêu cầu:
- Code sạch, có type đầy đủ
- Không dùng thư viện ngoài ngoài jsonwebtoken nếu cần`
    const brief = analyzeHeuristic(prompt, null, 1)
    const all = [brief.goal, ...brief.steps, ...brief.constraints, ...brief.quality]
    expect(all.some(s => s.includes('tôi gửi prompt'))).toBe(false)
    expect(brief.goal).toBe('Hãy giúp tôi xây dựng một module xác thực đơn giản bằng TypeScript:')
    expect(brief.quality.some(q => q.includes('Code sạch'))).toBe(true)
    expect(brief.constraints.some(c => c.includes('Không dùng thư viện ngoài'))).toBe(true)
    expect(brief.steps.length).toBe(2)
  })

  test('nhận diện câu meta, không bắt nhầm yêu cầu thật', () => {
    for (const meta of ['tôi gửi prompt test mods vừa cài:', 'Hãy test giúp mình prompt này', 'Here is the prompt I am testing', 'Đây là prompt test cho mod']) {
      expect(isMeta(meta)).toBe(true)
    }
    for (const real of ['Viết unit test cho plugin thanh toán', 'Giúp anh viết nội dung email chào hàng', 'Kiểm tra lại type trước khi commit', 'Code sạch, có test đầy đủ']) {
      expect(isMeta(real)).toBe(false)
    }
  })

  test('chuỗi meta trong câu trả lời Haiku cũng bị loại', () => {
    const base: Brief = analyzeHeuristic('Viết hàm parseDate có test', null, 1)
    const merged = mergeAnalysis(
      base,
      null,
      '{"goal":"tôi gửi prompt test mods vừa cài","steps":[],"constraints":[],"quality":["tôi gửi prompt test mods vừa cài","Có unit test"],"tier":"simple","isNewGoal":true}',
    )
    expect(merged.goal).toBe(base.goal)
    expect(merged.quality.some(q => q.includes('tôi gửi prompt'))).toBe(false)
    expect(merged.quality).toContain('Có unit test')
  })

  test('kết quả Haiku được gộp, tier bị kẹp trong biên một bậc', () => {
    const base: Brief = analyzeHeuristic('sửa typo trong README', null, 1)
    const merged = mergeAnalysis(
      base,
      null,
      '{"goal":"Sửa lỗi chính tả README","steps":[],"constraints":["chỉ README"],"quality":[],"tier":"deep","isNewGoal":true}',
    )
    expect(merged.goal).toBe('Sửa lỗi chính tả README')
    expect(merged.tier).toBe('simple')
    expect(merged.source).toBe('model')
    expect(mergeAnalysis(base, null, 'không phải JSON')).toEqual(base)
  })
})

describe('điều phối có tính cache', () => {
  test('hạ cấp giữa chừng một hội thoại dài bị giữ lại', () => {
    const d = decideMain({
      current: route('opus', 'high'),
      wanted: { family: 'haiku', effort: 'low' },
      tier: 'trivial',
      goalId: 1,
      messageCount: 40,
      isNewGoal: false,
    })
    expect(d.isHeld).toBe(true)
    expect(d.route.family).toBe('opus')
  })

  test('nâng cấp, mục tiêu mới và hội thoại ngắn đều được đổi', () => {
    const base = { tier: 'deep' as const, goalId: 1, messageCount: 40, isNewGoal: false }
    expect(decideMain({ ...base, current: route('sonnet', 'low'), wanted: { family: 'opus', effort: 'xhigh' } }).route.family).toBe('opus')
    expect(
      decideMain({ ...base, isNewGoal: true, current: route('opus', 'high'), wanted: { family: 'haiku', effort: 'low' } }).route.family,
    ).toBe('haiku')
    expect(
      decideMain({ ...base, messageCount: 2, current: route('opus', 'high'), wanted: { family: 'haiku', effort: 'low' } }).route.family,
    ).toBe('haiku')
  })

  test('model ID giữ tiền tố nhà cung cấp và giữ nguyên khi cùng họ', () => {
    expect(resolveModelId('sonnet', 'claude-opus-5-5', {})).toBe('claude-sonnet-5-5')
    expect(resolveModelId('opus', 'claude-opus-5-5[1m]', {})).toBe('claude-opus-5-5[1m]')
    expect(resolveModelId('haiku', 'us.anthropic.claude-opus-5-5', {})).toBe('us.anthropic.claude-haiku-5-5')
    expect(resolveModelId('haiku', 'claude-opus-5-5', { haiku: 'my-haiku' })).toBe('my-haiku')
  })

  test('subagent tra cứu chỉ đọc sang Explore + model rẻ; Plan dùng model mạnh', () => {
    const offered = new Set(['Explore', 'Plan', 'general-purpose'])
    const blocked = new Set<never>()
    const search = planAgent({
      description: 'Tìm nơi xử lý auth',
      prompt: 'Tìm trong codebase các file xử lý đăng nhập và liệt kê đường dẫn.',
      subagentType: undefined,
      offered,
      blocked,
    })
    expect(search.agentType).toBe('Explore')
    expect(search.family).toBe('haiku')

    const design = planAgent({
      description: 'Thiết kế kiến trúc',
      prompt:
        'Thiết kế kiến trúc phân tán cho hệ thống thanh toán, phân tích trade-off về bảo mật, hiệu năng và khả năng mở rộng, đề xuất chiến lược migrate.',
      subagentType: 'Plan',
      offered,
      blocked,
    })
    expect(design.family).toBe('opus')
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
    const brief = analyzeHeuristic(LONG_PROMPT, null, 1)
    const call = { tool: 'Bash', input: { command: 'npm run build' }, isError: true, isReadOnly: false }
    observe(tracker, call, brief, [])
    observe(tracker, call, brief, [])
    const third = observe(tracker, call, brief, [])
    expect(third.find(f => f.kind === 'loop')?.context).toContain('nguyên nhân gốc')
  })

  test('sửa file ngoài phạm vi đã giới hạn thì cảnh báo một lần', () => {
    const tracker = newTracker('t1')
    const brief = analyzeHeuristic('chỉ sửa src/app.ts để thêm log', null, 1)
    const edit = { tool: 'Edit', input: { file_path: '/repo/src/other.ts' }, isError: false, isReadOnly: false }
    expect(observe(tracker, edit, brief, []).some(f => f.kind === 'scope')).toBe(true)
    expect(observe(tracker, edit, brief, []).some(f => f.kind === 'scope')).toBe(false)
    const inside = { tool: 'Edit', input: { file_path: '/repo/src/app.ts' }, isError: false, isReadOnly: false }
    expect(observe(tracker, inside, brief, []).some(f => f.kind === 'scope')).toBe(false)
  })

  test('năm thay đổi liên tiếp chưa kiểm tra thì nhắc checkpoint', () => {
    const tracker = newTracker('t1')
    const brief = analyzeHeuristic(LONG_PROMPT, null, 1)
    const edit = { tool: 'Edit', input: { file_path: '/repo/a.ts' }, isError: false, isReadOnly: false }
    let last: ReturnType<typeof observe> = []
    for (let i = 0; i < 5; i++) last = observe(tracker, edit, brief, [])
    expect(last.some(f => f.kind === 'checkpoint')).toBe(true)
    observe(tracker, { tool: 'Bash', input: { command: 'npx tsc --noEmit' }, isError: false, isReadOnly: false }, brief, [])
    expect(tracker.mutationsSinceCheck).toBe(0)
    expect(tracker.isVerified).toBe(true)
  })
})
