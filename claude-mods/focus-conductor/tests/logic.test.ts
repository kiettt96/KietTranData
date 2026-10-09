// Test các hàm thuần: chấm độ phức tạp, đọc prompt, điều phối có tính cache,
// chọn model subagent, reducer checklist và phát hiện lạc đề.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Route } from '../types'
import { analyzeHeuristic, isMeta, isRelated, isSameIdea, mergeAnalysis, retarget, scoreComplexity, tierFromScore } from '../hooks/lib/analyze'
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

  test('nhận diện câu meta theo ý, kể cả có từ chen giữa', () => {
    const meta = [
      'tôi gửi prompt test mods vừa cài:',
      'Hãy test giúp mình prompt này',
      'Here is the prompt I am testing',
      'Đây là prompt test cho mod',
      'tôi vừa sửa xong focus-conductor, giờ test lại giúp.',
      'test lại giúp',
      'giúp tôi test',
      'giờ test lại cái này',
      'prompt test này dùng để kiểm tra mod',
      'tôi vừa sửa xong focus-conductor',
    ]
    for (const sentence of meta) expect(isMeta(sentence), sentence).toBe(true)
  })

  test('không bắt nhầm yêu cầu thật, kể cả yêu cầu nói về chính mod', () => {
    const real = [
      'Viết unit test cho plugin thanh toán',
      'Giúp anh viết nội dung email chào hàng',
      'Kiểm tra lại type trước khi commit',
      'Code sạch, có test đầy đủ',
      'Sửa hai điểm còn sót của focus-conductor trong một PR mới:',
      'Bắt được cả các câu có từ chen giữa như "test lại giúp", "giúp tôi test", "tôi vừa sửa xong..."',
      'Ưu tiên lọc theo ý (câu nói về việc test/sửa mod, không phải yêu cầu của task) chứ không chỉ khớp cụm từ cứng.',
      'Sau khi sửa: chạy lại validate + test, tạo PR vào main, không merge.',
      'tôi đã cài jsonwebtoken, hãy dùng nó',
      'chạy test lại sau khi deploy',
      'Giúp anh sửa plugin thanh toán cho đúng thuế',
    ]
    for (const sentence of real) expect(isMeta(sentence), sentence).toBe(false)
  })

  test('prompt có câu dẫn "giờ test lại giúp" không để câu đó lọt vào tiêu chí', () => {
    const prompt = `tôi vừa sửa xong focus-conductor, giờ test lại giúp.

Hãy xây một utility nhỏ bằng TypeScript:
1. Tạo file rate-limiter.ts: class RateLimiter với method tryAcquire(key: string): boolean
2. Viết unit test phủ các trường hợp: trong hạn mức, vượt hạn mức, hết thời gian thì reset

Yêu cầu:
- Code sạch, có type đầy đủ
- Không dùng thư viện ngoài`
    const brief = analyzeHeuristic(prompt, null, 1)
    const all = [brief.goal, ...brief.steps, ...brief.constraints, ...brief.quality]
    expect(all.some(s => s.includes('test lại giúp'))).toBe(false)
    expect(brief.goal).toBe('Hãy xây một utility nhỏ bằng TypeScript:')
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

  test('cùng ý thì gộp, khác ý thì giữ', () => {
    expect(isSameIdea('Checklist phải được chốt trước khi viết code', 'Chốt checklist trước khi viết code')).toBe(true)
    expect(
      isSameIdea(
        'Giới hạn: mỗi key chỉ được gọi tối đa 5 lần trong 10 giây (sliding window)',
        'Giới hạn: mỗi key tối đa 5 lần trong 10 giây (sliding window)',
      ),
    ).toBe(true)
    expect(isSameIdea('Code sạch, có type đầy đủ', 'Code phải có type đầy đủ')).toBe(true)
    expect(isSameIdea('Viết unit test cho login', 'Viết unit test cho logout')).toBe(false)
    expect(isSameIdea('Code sạch', 'Code sạch, có type đầy đủ')).toBe(false)
    expect(isSameIdea('Không merge PR', 'Không dùng thư viện ngoài')).toBe(false)
  })

  test('gộp với Haiku bỏ mục trùng ý và giữ câu gốc của người dùng', () => {
    const base = analyzeHeuristic(
      `Xây RateLimiter bằng TypeScript.
- Checklist phải được chốt trước khi viết code
- Code sạch, có type đầy đủ`,
      null,
      1,
    )
    const merged = mergeAnalysis(
      base,
      null,
      JSON.stringify({
        goal: 'Xây RateLimiter',
        steps: [],
        constraints: ['Chốt checklist trước khi viết code', 'Không dùng thư viện ngoài'],
        quality: ['Code phải có type đầy đủ', 'Tất cả test pass'],
        tier: 'moderate',
        isNewGoal: true,
      }),
    )
    expect(merged.constraints).toContain('Checklist phải được chốt trước khi viết code')
    expect(merged.constraints).not.toContain('Chốt checklist trước khi viết code')
    expect(merged.constraints).toContain('Không dùng thư viện ngoài')
    expect(merged.quality).toContain('Code sạch, có type đầy đủ')
    expect(merged.quality).not.toContain('Code phải có type đầy đủ')
    expect(merged.quality).toContain('Tất cả test pass')
  })

  test('Haiku nói "tiếp nối" cho prompt khác chủ đề thì vẫn là mục tiêu mới', () => {
    const rateLimiter = analyzeHeuristic(
      `Hãy xây một utility nhỏ bằng TypeScript:
1. Tạo file rate-limiter.ts: class RateLimiter với method tryAcquire(key: string): boolean
2. Giới hạn: mỗi key chỉ được gọi tối đa 5 lần trong 10 giây (sliding window)
3. Viết unit test phủ các trường hợp: trong hạn mức, vượt hạn mức, hết thời gian thì reset`,
      null,
      1,
    )
    const continuation = JSON.stringify({ goal: 'x', steps: [], constraints: [], quality: [], tier: 'complex', isNewGoal: false })

    const otherText = `Sửa hai điểm còn sót của focus-conductor trong một PR mới:
1. Bộ lọc câu dẫn/meta: bắt được cả các câu có từ chen giữa.
2. Trùng lặp ràng buộc / tiêu chí chất lượng: loại bỏ các mục cùng ý khi gộp với cách Haiku diễn đạt lại.
Sau khi sửa: chạy lại validate + test, tạo PR vào main, không merge.`
    const other = mergeAnalysis(analyzeHeuristic(otherText, rateLimiter, 2), rateLimiter, continuation, otherText)
    expect(other.isFollowUp).toBe(false)
    expect(other.goalId).toBe(rateLimiter.goalId + 1)
    expect(other.goal).not.toBe(rateLimiter.goal)
    expect(other.signals.some(s => s.includes('bỏ qua "tiếp nối" của Haiku'))).toBe(true)

    const newTaskText = 'Task mới: thêm hàm reset(key) cho RateLimiter để xóa hạn mức của một key và viết test cho nó'
    const newTask = mergeAnalysis(analyzeHeuristic(newTaskText, rateLimiter, 3), rateLimiter, continuation, newTaskText)
    expect(newTask.isFollowUp).toBe(false)

    const relatedText = 'Bổ sung cho RateLimiter: tryAcquire với key rỗng phải ném lỗi, và cập nhật unit test cho trường hợp vượt hạn mức với nhiều key khác nhau cùng lúc'
    const related = mergeAnalysis(analyzeHeuristic(relatedText, rateLimiter, 4), rateLimiter, continuation, relatedText)
    expect(related.isFollowUp).toBe(true)
    expect(related.goalId).toBe(rateLimiter.goalId)
    expect(related.goal).toBe(rateLimiter.goal)
  })

  test('câu dẫn nhắc tên công cụ không làm task khác chủ đề thành tiếp nối', () => {
    const prev: Brief = {
      ...analyzeHeuristic('Đưa vào PR #4 việc sửa lỗi gắn nhầm mục tiêu khi Haiku nói không phải mục tiêu mới.', null, 1),
      goal: 'Sửa focus-conductor: lọc câu dẫn/meta theo ý và loại mục trùng ý khi gộp với Haiku; validate, test, tạo PR.',
      steps: ['Viết lại bộ lọc meta theo ý', 'Thêm unit test cho bộ lọc và khử trùng', 'Chạy validate và test, tạo PR'],
    }
    const task = 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.'
    expect(isRelated(`tôi vừa sửa xong focus-conductor, giờ test lại giúp. ${task}`, prev)).toBe(false)
    expect(isRelated(task, prev)).toBe(false)
  })

  test('plan "set" đổi mục tiêu thì làm mới từ khóa, prompt sau không bị gắn vào mục tiêu cũ', () => {
    const plugin = analyzeHeuristic(
      `Tạo plugin focus-conductor cho Claude Code:
1. Viết hooks phân tích prompt và điều phối model
2. Viết README hướng dẫn cài đặt plugin
3. Viết unit test cho hooks`,
      null,
      1,
    )
    const readme = 'Sửa file README cho rõ cách cài đặt plugin.'
    // Trước khi sửa: mục tiêu đổi sang slugify nhưng từ khóa cũ (plugin, readme) còn nguyên.
    const stale: Brief = { ...plugin, goal: 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.' }
    expect(analyzeHeuristic(readme, stale, 2).isFollowUp).toBe(true)

    const slugify = retarget(plugin, 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.', [
      'slugify.ts: hàm slugify(text: string): string',
      'Unit test các trường hợp chính và biên',
    ])
    expect(slugify.keywords).toContain('slugify')
    expect(slugify.keywords).not.toContain('plugin')
    expect(analyzeHeuristic(readme, slugify, 2).isFollowUp).toBe(false)
    // Tiếp nối thật vẫn nhận ra.
    expect(analyzeHeuristic('Bổ sung cho slugify: bỏ dấu tiếng Việt và cập nhật unit test.', slugify, 3).isFollowUp).toBe(true)
  })

  test('plan "set" giữ từ khóa khi mục tiêu chỉ được diễn đạt lại', () => {
    const brief = analyzeHeuristic('Viết hàm parseDate cho ngày ISO, có unit test', null, 1)
    const same = retarget(brief, 'Viết hàm parseDate cho ngày ISO kèm unit test', [])
    expect(same.keywords).toEqual(brief.keywords)
    expect(same.steps).toEqual(brief.steps)
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
