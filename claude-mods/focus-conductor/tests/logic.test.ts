// Test các hàm thuần: chấm độ phức tạp, đọc prompt, điều phối có tính cache,
// chọn model subagent, reducer checklist và phát hiện lạc đề.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Route } from '../types'
import { analyzeHeuristic, analyzerRequest, assessSubtasks, isLeadIn, isMeta, isPureLookup, splitClauses, splitReference, isRelated, isSameIdea, mergeAnalysis, retarget } from '../hooks/lib/analyze'
import { newTracker, observe } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { adviseSubtasks, chooseMain, decideMain, matchSubtask, parseWindows, planAgent, raisePick, resolveModelId } from '../hooks/lib/route'
import { droppedPlanNotice, statusLine } from '../hooks/lib/text'
import { K4_META_LEAD, K4_PROMPT } from './fixtures/prompt-k4'

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
  test('việc vặt, hỏi đáp và việc khó được chia đúng độ sâu, không theo độ dài', () => {
    const typo = analyzeHeuristic('sửa typo trong README', null, 1)
    expect(typo.kind).toBe('edit')
    expect(typo.depth).toBe('light')
    expect(typo.volume).toBe('small')

    const question = analyzeHeuristic('Liệt kê các hàm export trong utils.ts', null, 1)
    expect(question.kind).toBe('answer')
    expect(question.depth).toBe('none')

    // Câu ngắn nhưng khó: race condition là việc khó dù chỉ có vài từ.
    expect(analyzeHeuristic('Fix race condition khi hai worker cùng ghi file cache', null, 1).depth).toBe('hard')

    // Câu dài nhưng dễ: đổi tên ở nhiều file là việc nhẹ, khối lượng lớn.
    const files = Array.from({ length: 20 }, (_, i) => `- src/mod${i}.ts`).join('\n')
    const rename = analyzeHeuristic(`Đổi tên biến userId thành accountId trong các file sau:\n${files}`, null, 1)
    expect(rename.depth).toBe('light')
    expect(rename.volume).toBe('large')
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

  test('prompt tiếp nối giữ mục tiêu và goalId, "tiếp tục" giữ độ sâu và khối lượng', () => {
    const first = analyzeHeuristic(LONG_PROMPT, null, 1)
    const next = analyzeHeuristic('tiếp tục', first, 2)
    expect(next.isFollowUp).toBe(true)
    expect(next.goalId).toBe(first.goalId)
    expect(next.goal).toBe(first.goal)
    expect(next.depth).toBe(first.depth)
    expect(next.volume).toBe(first.volume)
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

  test('kết quả Haiku là nguồn chính về độ sâu; sàn từ tín hiệu khó luôn giữ', () => {
    const base: Brief = analyzeHeuristic('sửa typo trong README', null, 1)
    const merged = mergeAnalysis(
      base,
      null,
      '{"why":"chỉ là sửa chữ","relation":"new","goal":"Sửa lỗi chính tả README","steps":[],"constraints":["chỉ README"],"quality":[],"hardSignals":[],"depth":"light","volume":"small","kind":"edit","confidence":"high"}',
    )
    expect(merged.goal).toBe('Sửa lỗi chính tả README')
    expect(merged.depth).toBe('light')
    expect(merged.tier).toBe('simple')
    expect(merged.source).toBe('model')
    expect(merged.signals).toContain('chỉ là sửa chữ')
    expect(mergeAnalysis(base, null, 'không phải JSON')).toEqual(base)

    const securityBrief = analyzeHeuristic('Thêm kiểm tra quyền truy cập cho endpoint báo cáo', null, 1)
    const haikuHard = mergeAnalysis(securityBrief, null, '{"relation":"new","goal":"g","depth":"hard","volume":"medium","kind":"edit","confidence":"high"}')
    expect(haikuHard.depth).toBe('hard')
    const floor = mergeAnalysis(
      securityBrief,
      null,
      '{"relation":"new","goal":"g","depth":"none","volume":"small","kind":"edit","hardSignals":["bảo mật"],"confidence":"high"}',
    )
    expect(floor.depth).toBe('hard')
  })

  test('confidence low: lấy mức cao hơn giữa Haiku và luật cục bộ', () => {
    const base: Brief = analyzeHeuristic('sửa typo trong README', null, 1)
    const low = mergeAnalysis(base, null, '{"relation":"new","goal":"g","depth":"none","volume":"small","kind":"edit","confidence":"low"}')
    expect(low.depth).toBe('light')
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

  test('subagent tra cứu chỉ đọc sang Explore + model rẻ; Plan dùng model mạnh', () => {
    const offered = new Set(['Explore', 'Plan', 'general-purpose'])
    const blocked = new Set<never>()
    const search = planAgent({
      description: 'Tìm nơi xử lý auth',
      prompt: 'Tìm trong codebase các file xử lý đăng nhập và liệt kê đường dẫn.',
      subagentType: undefined,
      offered,
      blocked,
      allowFable: false,
      parent: { depth: 'hard' },
      session: null,
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
      allowFable: false,
      parent: null,
      session: null,
    })
    expect(design.family).toBe('opus')
  })

  test('subagent tra cứu cũng theo chính sách model của phiên (fixed, ceiling)', () => {
    const lookup = (prompt: string, session: { family: 'opus' | 'haiku'; policy: 'fixed' | 'ceiling' }) =>
      planAgent({
        description: 'Tìm',
        prompt,
        subagentType: 'Explore',
        offered: new Set(['Explore']),
        blocked: new Set(),
        allowFable: false,
        parent: null,
        session,
      })
    expect(lookup('Tìm nơi gọi hàm charge', { family: 'opus', policy: 'fixed' }).family).toBe('opus')
    const wide = lookup('Tìm trong toàn bộ file các chỗ gọi hàm charge', { family: 'haiku', policy: 'ceiling' })
    expect(wide.volume).toBe('large')
    expect(wide.family).toBe('haiku')
  })

  test('việc sửa của subagent không thấp hơn một bậc so với mục tiêu cha', () => {
    const edit = {
      description: 'Đổi tên biến',
      prompt: 'Đổi tên biến userId thành accountId trong utils.ts',
      subagentType: undefined,
      offered: new Set<string>(),
      blocked: new Set<never>(),
      allowFable: false,
      session: null,
    }
    expect(planAgent({ ...edit, parent: null }).family).toBe('sonnet')
    const floored = planAgent({ ...edit, parent: { depth: 'hard' } })
    expect(floored.family).toBe('opus')
    expect(floored.reason).toContain('nâng theo mục tiêu cha')
  })

  test('giao lại việc đã lỗi nâng một bậc; fable chỉ khi được phép', () => {
    expect(raisePick({ family: 'sonnet', effort: 'medium' }, false)).toEqual({ family: 'opus', effort: 'high' })
    expect(raisePick({ family: 'opus', effort: 'xhigh' }, false)).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(raisePick({ family: 'opus', effort: 'high' }, true)).toEqual({ family: 'fable', effort: 'xhigh' })
  })
})

describe('khử trùng giữa câu người dùng và Haiku', () => {
  test('câu ngắn của người dùng không nuốt câu dài, cụ thể hơn cũng của người dùng', () => {
    const brief = analyzeHeuristic(
      `Xây module xác thực bằng TypeScript.
- Không dùng thư viện ngoài
- Không dùng thư viện ngoài trừ jsonwebtoken`,
      null,
      1,
    )
    expect(brief.constraints).toEqual(['Không dùng thư viện ngoài trừ jsonwebtoken'])
  })

  test('câu Haiku diễn đạt lại không bao giờ thay câu của người dùng, kể cả khi dài hơn', () => {
    const base = analyzeHeuristic('Xây module xác thực.\n- Không dùng thư viện ngoài', null, 1)
    const merged = mergeAnalysis(
      base,
      null,
      JSON.stringify({
        goal: 'Xây module xác thực',
        steps: [],
        constraints: ['Không dùng thư viện ngoài trừ jsonwebtoken', 'Phải có type đầy đủ'],
        quality: [],
        tier: 'moderate',
        isNewGoal: true,
      }),
    )
    expect(merged.constraints).toContain('Không dùng thư viện ngoài')
    expect(merged.constraints).not.toContain('Không dùng thư viện ngoài trừ jsonwebtoken')
    expect(merged.constraints).toContain('Phải có type đầy đủ')
  })
})

describe('checkpoint kiểm tra', () => {
  const edit = { tool: 'Edit', input: { file_path: '/repo/a.ts' }, isError: false, isReadOnly: false }
  const bash = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false })

  test('lệnh chỉ đọc có chữ test/check/build không tính là kiểm tra', () => {
    const brief = analyzeHeuristic(LONG_PROMPT, null, 1)
    for (const command of ['ls tests/', 'cat test.txt', 'echo check', 'git checkout main', 'grep -r test src', 'cat build.log']) {
      const tracker = newTracker('t1')
      observe(tracker, edit, brief, [])
      observe(tracker, bash(command), brief, [])
      expect(tracker.mutationsSinceCheck, command).toBeGreaterThan(0)
      expect(tracker.isVerified, command).toBe(false)
    }
  })

  test('lệnh kiểm tra thật được nhận ra, kể cả đứng sau cd && hoặc có biến môi trường', () => {
    const brief = analyzeHeuristic(LONG_PROMPT, null, 1)
    for (const command of [
      'npm test',
      'npm run -s typecheck',
      'cd /x && npx tsc -p y',
      'node --test',
      'claude plugin test .',
      'timeout 300 claude plugin test . 2>&1 | grep pass',
      'FOO=1 npm run build',
      'sed -i s/a/b/ f && npm test',
    ]) {
      const tracker = newTracker('t1')
      observe(tracker, edit, brief, [])
      observe(tracker, bash(command), brief, [])
      expect(tracker.mutationsSinceCheck, command).toBe(0)
      expect(tracker.isVerified, command).toBe(true)
    }
  })
})

describe('status line và báo checklist bị bỏ', () => {
  test('status line không lặp tiền tố tên plugin mà engine đã thêm', () => {
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
    const brief = { ...analyzeHeuristic('Viết hàm parseDate', null, 1), tier: 'complex' as const }
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

const SIX_TASKS = `Mục tiêu: nâng cấp module thanh toán của dự án shop-api.
1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.
2. Đổi tên userId thành accountId trong 12 file controller.
3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off, cân nhắc race condition khi hai worker cùng ghi số dư.
4. Viết unit test cho hàm refund, bao phủ trường hợp hết hạn token.
5. Rà soát lỗ hổng bảo mật trong luồng webhook của cổng thanh toán.
6. Cập nhật README phần cài đặt.`

describe('việc con được chấm trước khi làm', () => {
  test('mỗi việc có độ sâu, khối lượng và bản chất riêng, không lấy theo cả prompt', () => {
    const subtasks = analyzeHeuristic(SIX_TASKS, null, 1).subtasks
    expect(subtasks.length).toBe(6)
    expect(subtasks.map(s => s.depth)).toEqual(['light', 'light', 'hard', 'light', 'hard', 'light'])
    expect(subtasks[0]?.kind).toBe('investigate')
    expect(subtasks[1]?.volume).toBe('large')
    expect(subtasks[5]?.volume).toBe('small')
  })

  test('prompt một việc hoặc hai việc không tách thành việc con', () => {
    expect(analyzeHeuristic('Viết hàm parseDate nhận chuỗi ISO và trả về Date', null, 1).subtasks).toEqual([])
    expect(assessSubtasks(['Một việc'])).toEqual([])
  })

  test('tư vấn: việc tra cứu xuống haiku, việc sửa nhẹ xuống sonnet, việc khó làm trực tiếp ở opus', () => {
    const subtasks = analyzeHeuristic(SIX_TASKS, null, 1).subtasks
    const advice = adviseSubtasks({
      subtasks,
      main: { family: 'opus', effort: 'xhigh' },
      allowFable: false,
      blocked: new Set<never>(),
      offered: new Set(['Explore']),
      session: null,
    })
    expect(advice[0]).toMatchObject({ direct: false, subagentType: 'Explore', pick: { family: 'haiku', effort: 'low' } })
    expect(advice[1]).toMatchObject({ direct: false, pick: { family: 'sonnet', effort: 'medium' } })
    expect(advice[2]?.direct).toBe(true)
    expect(advice[4]?.direct).toBe(true)
    expect(advice[5]).toMatchObject({ direct: false, pick: { family: 'sonnet' } })
  })

  test('việc đã phân không bị sàn của mục tiêu cha kéo lên: sửa nhẹ vẫn là sonnet dưới mục tiêu hard', () => {
    const plan = planAgent({
      prompt: 'Cập nhật README phần cài đặt',
      description: 'Cập nhật README',
      subagentType: undefined,
      offered: new Set(['Explore']),
      blocked: new Set<never>(),
      allowFable: false,
      parent: null,
      session: null,
      assessed: { depth: 'light', volume: 'small', kind: 'edit', hardSignals: [] },
    })
    expect(plan.family).toBe('sonnet')
    expect(plan.effort).toBe('medium')
  })

  test('ít hơn ba việc thì không tư vấn riêng', () => {
    const subtasks = analyzeHeuristic('1. Đọc file a.ts\n2. Sửa lỗi trong b.ts', null, 1).subtasks
    expect(adviseSubtasks({ subtasks, main: { family: 'opus', effort: 'xhigh' }, allowFable: false, blocked: new Set<never>(), offered: new Set(), session: null })).toEqual([])
  })
})

describe('nguồn việc con và chấm từng việc (0.3.1)', () => {
  const REVIEW = 'rà soát kỹ trước khi merge: đã thực hiện đầy đủ yêu cầu và còn sót lỗi nào không'

  test('các bước Haiku tự lập kế hoạch không thành việc con', () => {
    const base = analyzeHeuristic(REVIEW, null, 1)
    const reply = JSON.stringify({
      goal: 'Rà soát trước khi merge',
      steps: [
        'Xác định yêu cầu gốc và danh sách thay đổi cần rà soát',
        'Đối chiếu từng yêu cầu với code đã thay đổi',
        'Rà soát code tìm lỗi logic, lỗi biên và lỗi tích hợp',
        'Chạy hoặc kiểm tra test liên quan',
        'Tổng hợp danh sách thiếu sót và lỗi còn lại',
      ],
      depth: 'substantial',
      volume: 'medium',
      kind: 'investigate',
    })
    const brief = mergeAnalysis(base, null, reply, REVIEW)
    expect(brief.steps.length).toBe(5)
    expect(brief.subtasks).toEqual([])
  })

  test('prompt đoạn văn: việc Haiku trích từ lời người dùng được tách, sàn tín hiệu khó vẫn giữ', () => {
    const text =
      'Hôm nay cần xử lý mấy việc: tìm trong src các chỗ gọi hàm charge, sau đó đổi tên userId thành accountId trong controller, và rà soát lỗ hổng bảo mật trong luồng webhook thanh toán.'
    const base = analyzeHeuristic(text, null, 1)
    expect(base.subtasks).toEqual([])
    const reply = JSON.stringify({
      goal: 'Xử lý ba việc',
      tasks: [
        { text: 'tìm trong src các chỗ gọi hàm charge', depth: 'none', volume: 'small', kind: 'investigate', hardSignals: [] },
        { text: 'đổi tên userId thành accountId trong controller', depth: 'light', volume: 'medium', kind: 'edit', hardSignals: [] },
        { text: 'rà soát lỗ hổng bảo mật trong luồng webhook thanh toán', depth: 'light', volume: 'small', kind: 'investigate', hardSignals: [] },
        { text: 'viết tài liệu kiến trúc mới cho toàn hệ thống', depth: 'light', volume: 'small', kind: 'edit', hardSignals: [] },
      ],
    })
    const brief = mergeAnalysis(base, null, reply, text)
    // Việc thứ tư không có trong lời người dùng nên bị bỏ.
    expect(brief.subtasks.map(s => s.title)).toEqual([
      'tìm trong src các chỗ gọi hàm charge',
      'đổi tên userId thành accountId trong controller',
      'rà soát lỗ hổng bảo mật trong luồng webhook thanh toán',
    ])
    expect(brief.subtasks.map(s => s.depth)).toEqual(['none', 'light', 'hard'])
  })

  test('danh sách người dùng giữ nguyên; Haiku chỉ chấm lại đúng các mục đó', () => {
    const base = analyzeHeuristic(SIX_TASKS, null, 1)
    const reply = JSON.stringify({
      tasks: [{ text: 'Viết unit test cho hàm refund, bao phủ trường hợp hết hạn token', depth: 'substantial', volume: 'medium', kind: 'edit', hardSignals: [] }],
    })
    const brief = mergeAnalysis(base, null, reply, SIX_TASKS)
    expect(brief.subtasks.length).toBe(6)
    expect(brief.subtasks[3]?.depth).toBe('substantial')
    expect(brief.subtasks[1]?.depth).toBe('light')
  })

  test('rà soát, kiểm tra không phải tra cứu: không xuống haiku; tìm và liệt kê vẫn là Explore haiku', () => {
    const plan = (text: string) =>
      planAgent({ prompt: text, description: text, subagentType: undefined, offered: new Set(['Explore']), blocked: new Set<never>(), allowFable: false, parent: null, session: null })
    const review = plan('Rà soát code tìm lỗi logic, lỗi biên và lỗi tích hợp')
    expect(review.family).not.toBe('haiku')
    expect(review.agentType).toBeUndefined()
    const bug = plan('Tìm lỗi trong hàm tính thuế')
    expect(bug.family).not.toBe('haiku')
    const search = plan('Tìm nơi gọi hàm charge và liệt kê đường dẫn')
    expect(search.family).toBe('haiku')
    expect(search.agentType).toBe('Explore')
  })

  test('việc tổng hợp, báo cáo kết quả làm trực tiếp ở luồng chính', () => {
    const subtasks = assessSubtasks(['Tìm nơi gọi hàm charge', 'Đổi tên userId trong 12 file', 'Tổng hợp danh sách lỗi kèm vị trí'])
    const advice = adviseSubtasks({ subtasks, main: { family: 'opus', effort: 'high' }, allowFable: false, blocked: new Set<never>(), offered: new Set(['Explore']), session: null })
    expect(advice[2]?.direct).toBe(true)
    expect(advice[0]?.direct).toBe(false)
  })

  test('Agent khớp việc theo "Việc N", theo cùng ý, hoặc theo prompt chứa tên việc', () => {
    const subtasks = analyzeHeuristic(SIX_TASKS, null, 1).subtasks
    expect(matchSubtask(subtasks, 'Việc 2: đổi tên userId', 'làm đi')?.index).toBe(2)
    expect(matchSubtask(subtasks, 'Task 5', '')?.index).toBe(5)
    expect(matchSubtask(subtasks, 'Đổi tên userId thành accountId', '')?.index).toBe(2)
    expect(matchSubtask(subtasks, 'Rename ids', 'Bối cảnh dự án... Nhiệm vụ: Đổi tên userId thành accountId trong 12 file controller. Báo cáo ngắn.')?.index).toBe(2)
    expect(matchSubtask(subtasks, 'Kiểm tra CI', 'Chạy lại pipeline CI và báo kết quả')).toBeUndefined()
  })
})

describe('rà soát lần hai (0.3.1)', () => {
  test('báo lỗi trang "báo cáo" vẫn là điều tra, không phải hỏi đáp chạy haiku', () => {
    const brief = analyzeHeuristic('Trang báo cáo bị lỗi undefined khi tải', null, 1)
    expect(brief.kind).toBe('investigate')
    expect(brief.depth).not.toBe('none')
  })

  test('chỉ việc mở đầu bằng tổng hợp, báo cáo kết quả mới làm trực tiếp', () => {
    const subtasks = assessSubtasks(['Tìm nơi gọi hàm charge', 'Sửa lỗi trang báo cáo doanh thu', 'Tổng hợp danh sách lỗi kèm vị trí'])
    const advice = adviseSubtasks({ subtasks, main: { family: 'opus', effort: 'high' }, allowFable: false, blocked: new Set<never>(), offered: new Set(['Explore']), session: null })
    expect(advice[1]?.direct).toBe(false)
    expect(advice[2]?.direct).toBe(true)
  })

  test('gạch đầu dòng là ràng buộc không thành việc con', () => {
    const text = `Nâng cấp module thanh toán:
- Tìm nơi gọi hàm charge
- Đổi tên userId thành accountId trong controller
- Cập nhật README phần cài đặt
- Không đổi API công khai
- Chỉ sửa trong src/payment`
    const subtasks = analyzeHeuristic(text, null, 1).subtasks
    expect(subtasks.map(s => s.index)).toEqual([1, 2, 3])
    expect(subtasks.map(s => s.title)).toEqual(['Tìm nơi gọi hàm charge', 'Đổi tên userId thành accountId trong controller', 'Cập nhật README phần cài đặt'])
  })

  test('Explore do Claude chọn: rà soát chạy sonnet, tra cứu thuần chạy haiku', () => {
    const plan = (text: string) =>
      planAgent({ prompt: text, description: text, subagentType: 'Explore', offered: new Set(['Explore']), blocked: new Set<never>(), allowFable: false, parent: null, session: null })
    expect(plan('Rà soát lỗi logic trong module thanh toán').family).toBe('sonnet')
    expect(plan('Tìm file cấu hình retry').family).toBe('haiku')
  })

  test('"Bước N" không khớp việc con, "Việc N" thì khớp', () => {
    const subtasks = analyzeHeuristic(SIX_TASKS, null, 1).subtasks
    expect(matchSubtask(subtasks, 'Bước 2: chạy test', 'Chạy toàn bộ test và báo kết quả')).toBeUndefined()
    expect(matchSubtask(subtasks, 'Việc 2: đổi tên', '')?.index).toBe(2)
  })

  test('lượt Haiku có đủ thời gian cho JSON dài hơn', () => {
    expect(analyzerRequest('Làm ba việc', null).timeoutMs).toBe(12000)
  })
})

describe('vấn đề tồn đọng (0.3.2)', () => {
  test('việc hỗn hợp chạm hai file không có suy luận chạy sonnet; có refactor thì vẫn opus', () => {
    const small = analyzeHeuristic('Đọc a.ts, sửa lỗi trong b.ts', null, 1)
    expect(small.kind).toBe('mixed')
    expect(small.depth).toBe('light')
    expect(chooseMain({ depth: small.depth, volume: small.volume, kind: small.kind, allowFable: false }).family).toBe('sonnet')
    const heavy = analyzeHeuristic('Đọc a.ts rồi refactor b.ts cho gọn', null, 1)
    expect(heavy.depth).toBe('substantial')
  })

  test('prompt đoạn văn nhiều việc được tách bằng luật cục bộ, không cần Haiku', () => {
    const text =
      'Hôm nay cần xử lý mấy việc: tìm trong src các chỗ gọi hàm charge, sau đó đổi tên userId thành accountId trong controller, cuối cùng rà soát lỗ hổng bảo mật trong luồng webhook thanh toán.'
    const subtasks = analyzeHeuristic(text, null, 1).subtasks
    expect(subtasks.map(s => s.title)).toEqual([
      'tìm trong src các chỗ gọi hàm charge',
      'đổi tên userId thành accountId trong controller',
      'rà soát lỗ hổng bảo mật trong luồng webhook thanh toán',
    ])
    expect(subtasks[2]?.depth).toBe('hard')
  })

  test('đoạn văn dùng chấm phẩy kèm từ nối: bỏ từ nối khỏi tên việc, vế tổng hợp vẫn là một việc', () => {
    const text =
      'Anh cần làm mấy việc cho dự án shop: đọc file config.ts và liệt kê biến môi trường; sau đó sửa lỗi nút đăng nhập bị lệch trên mobile; tiếp theo debug vì sao test checkout thỉnh thoảng fail trên CI; cuối cùng tổng hợp kết quả và báo cáo các rủi ro.'
    expect(splitClauses(text)).toEqual([
      'đọc file config.ts và liệt kê biến môi trường',
      'sửa lỗi nút đăng nhập bị lệch trên mobile',
      'debug vì sao test checkout thỉnh thoảng fail trên CI',
      'tổng hợp kết quả và báo cáo các rủi ro',
    ])
  })

  test('một việc viết thành câu, hoặc hai vế, hoặc vế là ràng buộc thì không tách', () => {
    expect(splitClauses('Sửa hàm login để kiểm tra mật khẩu đúng cách, sau đó chạy lại test')).toEqual([])
    expect(splitClauses('Sửa hàm login. Không đổi API công khai. Chỉ sửa trong src/auth.')).toEqual([])
    expect(analyzeHeuristic('Fix race condition khi hai worker cùng ghi file cache', null, 1).subtasks).toEqual([])
  })

  test('cửa sổ model đích nhỏ hơn ngữ cảnh: giữ model, kể cả khi nâng cấp', () => {
    const base = {
      current: { family: 'sonnet' as const, effort: 'medium' as const, tier: 'moderate' as const, goalId: 1, reason: '' },
      wanted: { family: 'opus' as const, effort: 'high' as const },
      volume: 'small' as const,
      tier: 'complex' as const,
      goalId: 2,
      context: 180_000,
      window: 1_000_000,
      turnsLeft: 2,
      isFree: false,
      calib: { haiku: 1, sonnet: 1, opus: 1, fable: 1 },
    }
    expect(decideMain({ ...base, targetWindow: 200_000 }).isHeld).toBe(true)
    expect(decideMain(base).isChanged).toBe(true)
    expect(parseWindows('opus=200000, sonnet=1000000, x=5, haiku=abc')).toEqual({ opus: 200000, sonnet: 1000000 })
  })
})

describe('câu dẫn danh sách (0.3.3)', () => {
  test('chỉ câu có danh từ chỉ việc đi trước "sau" mới là câu dẫn', () => {
    expect(isLeadIn('Làm 3 việc sau:')).toBe(true)
    expect(isLeadIn('Làm các bước dưới đây')).toBe(true)
    expect(isLeadIn('Mấy việc sau đây cần làm: ')).toBe(false)
    expect(isLeadIn('Hoàn thành tính năng này sau')).toBe(false)
    expect(isLeadIn('Làm sau')).toBe(false)
    expect(isLeadIn('Do the following:')).toBe(true)
    expect(isLeadIn('Do this later')).toBe(false)
  })
})

describe('nhiễu từ lần test thật (0.3.3)', () => {
  const PROMPT = `Làm 3 việc sau:
1. Đọc file config.ts và liệt kê biến môi trường.
2. Sửa lỗi nút đăng nhập bị lệch trên mobile.
3. Viết unit test cho hàm refund.`

  test('câu dẫn không là ràng buộc; việc trong danh sách không là tiêu chí chất lượng', () => {
    const brief = analyzeHeuristic(PROMPT, null, 1)
    expect(brief.constraints).toEqual([])
    expect(brief.quality).toEqual([])
    expect(brief.subtasks.length).toBe(3)
    // Câu dẫn có từ ràng buộc ("phải") vẫn không phải ràng buộc; ràng buộc thật thì giữ.
    const withMust = analyzeHeuristic(PROMPT.replace('Làm 3 việc sau:', 'Bạn phải làm các việc sau:') + '\nKhông đổi API công khai.', null, 1)
    expect(withMust.constraints).toEqual(['Không đổi API công khai.'])
  })

  test('câu trả lời Haiku sai ngôn ngữ hoặc lặp câu dẫn, lặp việc: bị lọc, giữ bản đọc cục bộ', () => {
    const base = analyzeHeuristic(PROMPT, null, 1)
    const reply = JSON.stringify({
      goal: 'Complete three tasks: list env vars in config.ts, fix the mobile login button misalignment, and write unit tests for the refund function.',
      steps: ['Read config.ts and list the environment variables', 'Fix the login button on mobile'],
      constraints: ['Làm 3 việc sau', 'Không đổi API công khai'],
      quality: ['Viết unit test cho hàm refund.', 'config.ts env vars listed completely', 'Test refund chạy pass'],
    })
    const brief = mergeAnalysis(base, null, reply, PROMPT)
    expect(brief.goal).toBe(base.goal)
    expect(base.goal).toBe('Làm 3 việc sau: Đọc file config.ts và liệt kê biến môi trường; Sửa lỗi nút đăng nhập bị lệch trên mobile; Viết unit test cho hàm refund')
    expect(brief.steps).toEqual(base.steps)
    expect(brief.constraints).toEqual(['Không đổi API công khai'])
    expect(brief.quality).toEqual(['Test refund chạy pass'])
  })

  test('yêu cầu tiếng Anh vẫn nhận chuỗi tiếng Anh của Haiku', () => {
    const text = 'Do the following:\n1. Read config.ts\n2. Fix the login button\n3. Write tests for refund'
    const brief = mergeAnalysis(analyzeHeuristic(text, null, 1), null, JSON.stringify({ goal: 'Finish three small tasks in the shop app' }), text)
    expect(brief.goal).toBe('Finish three small tasks in the shop app')
    expect(brief.constraints).toEqual([])
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

describe('prompt dài có cấu trúc (0.3.4)', () => {
  const K4_TITLES = Array.from({ length: 11 }, (_, i) => `K4.${i + 1}.`)

  test('prompt K4: mỗi mục có mã là một việc, đủ 11 việc theo thứ tự', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(brief.subtasks.length).toBe(11)
    expect(brief.subtasks.every(s => s.from === 'section')).toBe(true)
    brief.subtasks.forEach((s, i) => expect(s.title.startsWith(K4_TITLES[i] ?? '')).toBe(true))
  })

  test('prompt K4: mục tiêu là câu "Đích là ...", không phải dòng tiêu đề hay điều kiện nghiệm thu', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(brief.goal.startsWith('Đích là engine ra quyết định')).toBe(true)
  })

  test('prompt K4: tiêu chí lấy từ điều kiện "xong khi", không có việc nào lọt vào tiêu chí', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(brief.quality.some(q => q.startsWith('100% bước trong phạm vi'))).toBe(true)
    // Tiêu chí có thể nhắc tới một việc ("Báo cáo đủ các khối ở K4.11"), nhưng không bắt đầu bằng mã mục.
    expect(brief.quality.some(q => /^K4\.\d+\./.test(q))).toBe(false)
  })

  test('prompt K4: ràng buộc không chứa điều kiện nghiệm thu, câu mục tiêu, hay dòng tiêu đề', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(brief.constraints.some(c => c.startsWith('100% bước'))).toBe(false)
    expect(brief.constraints.some(c => c.includes('Đích là'))).toBe(false)
    expect(brief.constraints.some(c => c.startsWith('K4 XONG KHI') || c.startsWith('PROMPT CHO'))).toBe(false)
    expect(brief.constraints.some(c => c.includes('Không làm K5, K6') || c.includes('K5, K6'))).toBe(true)
  })

  test('mục có mã chỉ có ba mục trở xuống không thành việc theo mục', () => {
    const text = ['### K1. Đọc file', '', 'Nội dung.', '', '### K2. Sửa file', '', 'Nội dung.'].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.subtasks.some(s => s.from === 'section')).toBe(false)
  })

  test('tiêu đề "Bước N" trong bảng nội dung có mã cùng cấp: lấy cấp có nhiều mục nhất', () => {
    const text = [
      '# Kế hoạch',
      '## Bước 1 — Chuẩn bị',
      '### 1.1 Đọc mã nguồn cũ',
      'Chi tiết.',
      '### 1.2 Lập danh sách rủi ro',
      'Chi tiết.',
      '### 1.3 Thống nhất phạm vi',
      'Chi tiết.',
      '## Bước 2 — Thực hiện',
      'Chi tiết.',
    ].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.subtasks.map(s => s.title)).toEqual(['1.1 Đọc mã nguồn cũ', '1.2 Lập danh sách rủi ro', '1.3 Thống nhất phạm vi'])
  })

  test('isPureLookup: việc chạy hoặc đối chiếu không phải tra cứu thuần; liệt kê thì là', () => {
    expect(isPureLookup('Chạy lại 15 đầu vào trên engine mới')).toBe(false)
    expect(isPureLookup('Đối chiếu kết quả với bảng cũ')).toBe(false)
    expect(isPureLookup('Liệt kê các hàm export trong utils.ts')).toBe(true)
  })

  test('câu mở "không cần chạy prompt đính kèm" được nhận; câu có chữ "test" không phải prompt thì không', () => {
    expect(splitReference(`${K4_META_LEAD}\n\n${K4_PROMPT}`)).not.toBeNull()
    expect(splitReference('Không cần chạy test, chỉ sửa file bên dưới\nalpha beta gamma\nline two here\nline three here')).toBeNull()
    expect(splitReference('Không chạy migration, chỉ sửa code bên dưới\nalpha beta gamma\nline two here\nline three here')).toBeNull()
    expect(splitReference(`${K4_META_LEAD}\nchỉ một dòng`)).toBeNull()
    expect(splitReference("Don't run the attached prompt, only use it to test routing\na\nb\nc")).not.toBeNull()
  })

  test('prompt đính kèm chỉ để đối chiếu: mục tiêu là việc đối chiếu, không ràng buộc, không tiêu chí, phân việc của phần đính kèm', () => {
    const brief = analyzeHeuristic(`${K4_META_LEAD}\n\n${K4_PROMPT}`, null, 1)
    expect(brief.goal).toContain('Chỉ đối chiếu phân việc')
    expect(brief.steps).toEqual([])
    expect(brief.subtasks).toEqual([])
    expect(brief.constraints).toEqual([])
    expect(brief.quality).toEqual([])
    expect(brief.attached?.subtasks.length).toBe(11)
    expect(brief.depth).toBe('light')
    expect(brief.kind).toBe('answer')
  })

  test('yêu cầu Haiku chấm phần đính kèm, không chấm câu mở; prompt dài có thêm token và thời gian', () => {
    const reference = analyzerRequest(`${K4_META_LEAD}\n\n${K4_PROMPT}`, null)
    expect(reference.prompt).toContain('K4.11')
    expect(reference.prompt).not.toContain('không cần chạy prompt đính kèm')
    expect(reference.maxTokens).toBe(2400)
    expect(reference.timeoutMs).toBe(25000)
    const short = analyzerRequest('Làm 3 việc sau:\n1. Đọc file config.ts.\n2. Sửa lỗi nút đăng nhập.\n3. Viết unit test.', null)
    expect(short.maxTokens).toBe(1400)
    expect(short.timeoutMs).toBe(12000)
  })

  test('mergeAnalysis: Haiku không thay các mục có mã bằng kế hoạch của nó, không hạ việc theo mục xuống none', () => {
    const base = analyzeHeuristic(K4_PROMPT, null, 1)
    const reply = JSON.stringify({
      why: 'Eleven numbered sections',
      goal: 'Rebuild the decision layer',
      steps: ['Plan a', 'Plan b'],
      constraints: [],
      quality: [],
      tasks: [{ text: 'K4.2. Luật của Long theo tầng', depth: 'none', volume: 'small', kind: 'answer', hardSignals: [] }],
      depth: 'light',
      volume: 'small',
      kind: 'answer',
      confidence: 'high',
    })
    const merged = mergeAnalysis(base, null, reply, K4_PROMPT)
    expect(merged.steps.length).toBe(11)
    expect(merged.subtasks.length).toBe(11)
    const k42 = merged.subtasks.find(s => s.title.startsWith('K4.2.'))
    expect(k42?.depth).not.toBe('none')
    expect(k42?.from).toBe('section')
  })

  test('mergeAnalysis với prompt đính kèm: Haiku chấm phần đính kèm, mục tiêu và tiêu chí giữ nguyên', () => {
    const text = `${K4_META_LEAD}\n\n${K4_PROMPT}`
    const base = analyzeHeuristic(text, null, 1)
    const reply = JSON.stringify({
      why: 'Eleven sections',
      goal: 'Rebuild',
      steps: [],
      constraints: [],
      quality: [],
      tasks: [{ text: 'K4.11. Báo cáo và DỪNG', depth: 'substantial', volume: 'large', kind: 'mixed', hardSignals: [] }],
      depth: 'substantial',
      volume: 'large',
      kind: 'mixed',
      confidence: 'high',
    })
    const merged = mergeAnalysis(base, null, reply, text)
    expect(merged.goal).toBe(base.goal)
    expect(merged.quality).toEqual([])
    expect(merged.attached?.subtasks.length).toBe(11)
  })

  test('matchSubtask theo mã: K4.1 không khớp K4.10', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(matchSubtask(brief.subtasks, 'K4.10 kiểm trên số liệu thật', '')?.title.startsWith('K4.10.')).toBe(true)
    expect(matchSubtask(brief.subtasks, 'K4.1 kiểm kê', '')?.title.startsWith('K4.1.')).toBe(true)
  })

  test('chấm phẩy trong ngoặc không tách một ràng buộc thành mảnh vô nghĩa', () => {
    const text = ['Chỉ sửa file trong src/ (kể cả test; không sửa file cấu hình).', 'Không đổi API công khai.'].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.constraints.some(c => c.startsWith('không sửa file cấu hình'))).toBe(false)
    expect(brief.constraints.some(c => c.includes('kể cả test; không sửa file cấu hình'))).toBe(true)
  })

  test('việc theo mục trả lời ngắn không xuống none: subagent không nhận việc trống ngữ cảnh', () => {
    const text = [
      '### K1.1. Cho biết tên hàm chính',
      '',
      'Trả lời một câu.',
      '',
      '### K1.2. Cho biết ngôn ngữ dùng',
      '',
      'Trả lời một câu.',
      '',
      '### K1.3. Cho biết phiên bản',
      '',
      'Trả lời một câu.',
    ].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.subtasks.length).toBe(3)
    expect(brief.subtasks.every(s => s.depth !== 'none')).toBe(true)
  })

  test('điều kiện nghiệm thu không lọt vào ràng buộc, dù có chữ "không được"', () => {
    const text = ['## Tiêu chí chất lượng', '', '1. Không được bỏ qua ca đỏ nào trong bộ kiểm.', '', '## Việc', '', 'Sửa lỗi hàm tính thuế trong src/tax.ts.'].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.constraints.some(c => c.includes('bỏ qua ca đỏ'))).toBe(false)
    expect(brief.quality.some(q => q.includes('bỏ qua ca đỏ'))).toBe(true)
  })

  test('câu mở "không cần chạy tệp bên dưới" không có chữ prompt hay đính kèm thì không phải tham chiếu', () => {
    expect(splitReference('Không cần chạy tệp bên dưới, chỉ dùng để test\na\nb\nc')).toBeNull()
  })

  test('việc vừa tìm vừa chạy lại không phải tra cứu thuần', () => {
    expect(isPureLookup('Tìm và chạy lại bộ kiểm trên engine mới')).toBe(false)
  })

  test('yêu cầu Haiku giữ phần đọc đến cuối prompt dài (mục 11 của K4 nằm sau 12.000 ký tự)', () => {
    expect(analyzerRequest(K4_PROMPT, null).prompt).toContain('K4.11. Báo cáo và DỪNG')
  })

  test('chọn việc theo mã chỉ dựa trên mã đầy đủ, không theo tiền tố: K4.1 không khớp K4.10 dù K4.10 đứng trước', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(matchSubtask([...brief.subtasks].reverse(), 'K4.1 kiểm kê', '')?.title.startsWith('K4.1.')).toBe(true)
  })

  test('mã đứng một mình vẫn chọn được việc theo mục', () => {
    const brief = analyzeHeuristic(K4_PROMPT, null, 1)
    expect(matchSubtask(brief.subtasks, 'K4.9', '')?.title.startsWith('K4.9.')).toBe(true)
  })

  test('việc theo mục trả lời một câu không xuống none (ví dụ "giải thích ngắn")', () => {
    const text = ['### K1.1. Giải thích ngắn khái niệm hook', '', 'Một câu.', '', '### K1.2. Giải thích ngắn khái niệm plugin', '', 'Một câu.', '', '### K1.3. Giải thích ngắn khái niệm mod', '', 'Một câu.'].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.subtasks.length).toBe(3)
    expect(brief.subtasks.every(s => s.depth !== 'none')).toBe(true)
  })

  test('mergeAnalysis: Haiku chỉ nâng việc theo mục, không hạ mức đã chấm từ thân mục', () => {
    const base = analyzeHeuristic(K4_PROMPT, null, 1)
    const reply = JSON.stringify({
      why: 'x',
      goal: 'Dựng lại tầng quyết định',
      steps: [],
      constraints: [],
      quality: [],
      tasks: [{ text: 'K4.3. Xếp loại từng bước', depth: 'light', volume: 'small', kind: 'answer', hardSignals: [] }],
      depth: 'light',
      volume: 'small',
      kind: 'answer',
      confidence: 'high',
    })
    const merged = mergeAnalysis(base, null, reply, K4_PROMPT)
    const k43 = merged.subtasks.find(s => s.title.startsWith('K4.3.'))
    expect(k43?.depth).toBe('substantial')
  })

  test('rà soát 0.3.4: một ngoặc chưa đóng không nuốt các ràng buộc ở dòng sau', () => {
    const text = ['Sửa hàm login trong src/auth.ts (lỗi khi mật khẩu rỗng', 'Không đổi API công khai.', 'Không sửa file cấu hình.', 'Phải có unit test.'].join('\n')
    expect(analyzeHeuristic(text, null, 1).constraints).toEqual(['Không đổi API công khai.', 'Không sửa file cấu hình.', 'Phải có unit test.'])
  })

  test('rà soát 0.3.4: "không cần chạy lại các bước trong prompt" là yêu cầu thường, không phải prompt đính kèm', () => {
    expect(splitReference('Không cần chạy lại các bước trong prompt, chỉ sửa bước 3:\n1. a\n2. b\n3. c')).toBeNull()
  })

  test('rà soát 0.3.4: tiêu đề đánh số "## 1. ..." cũng là việc theo mục; mô tả "3 file" không phải mã việc', () => {
    const brief = analyzeHeuristic(['## 1. Đọc mã nguồn', 'x', '## 2. Đổi tên biến', 'x', '## 3. Viết test', 'x'].join('\n'), null, 1)
    expect(brief.subtasks.map(s => s.title)).toEqual(['Đọc mã nguồn', 'Đổi tên biến', 'Viết test'])
    expect(brief.subtasks.every(s => s.from === 'section')).toBe(true)
    expect(matchSubtask(brief.subtasks, '3 file controller cần đổi tên', 'Đổi tên trong 3 file')).toBeUndefined()
  })

  test('rà soát 0.3.4: tài liệu có nhiều tiêu đề cấp 1 thì "# Bối cảnh" đầu tiên vẫn là khối bối cảnh', () => {
    const text = ['# Bối cảnh', 'Hệ thống cũ không được sửa vì đã khóa.', '# Việc cần làm', '1. Đọc file a.ts', '2. Sửa file b.ts'].join('\n')
    expect(analyzeHeuristic(text, null, 1).constraints).toEqual([])
  })

  test('rà soát 0.3.4: câu "Đích là ..." dài bị cắt vẫn không lặp lại trong ràng buộc', () => {
    const goal = `Đích là ${'engine ra quyết định đúng luật và không phải bộ kiểm '.repeat(5)}.`
    const brief = analyzeHeuristic(`${goal}\nLàm việc A.\nLàm việc B.`, null, 1)
    expect(brief.goal.endsWith('...')).toBe(true)
    expect(brief.constraints.some(c => c.startsWith('Đích là'))).toBe(false)
  })

  test('rà soát 0.3.4: việc tách từ đoạn văn ghi nguồn là vế đoạn văn', () => {
    const brief = analyzeHeuristic('Đọc file config.ts và liệt kê biến môi trường. Sau đó sửa lỗi nút đăng nhập trên mobile. Cuối cùng viết unit test cho hàm refund.', null, 1)
    expect(brief.subtasks.length).toBe(3)
    expect(brief.subtasks.every(s => s.from === 'clause')).toBe(true)
  })

  test('rà soát 0.3.4: đoạn "Xong khi:" trong thân việc là tiêu chí, không phải ràng buộc', () => {
    const text = ['### K1. Đọc', 'Đọc a.', '**Xong khi:** không còn ca đỏ, không đổi kỳ vọng nào.', '### K2. Sửa', 'Sửa b.', '### K3. Kiểm', 'Kiểm c.'].join('\n')
    const brief = analyzeHeuristic(text, null, 1)
    expect(brief.constraints).toEqual([])
    expect(brief.quality).toEqual(['Xong khi: không còn ca đỏ, không đổi kỳ vọng nào.'])
  })

  test('rà soát 0.3.4: lượt chỉ đối chiếu không mang tín hiệu khó của prompt đính kèm', () => {
    const brief = analyzeHeuristic(`${K4_META_LEAD}\n\n${K4_PROMPT}`, null, 1)
    expect(brief.hardSignals).toEqual([])
  })

  test('rà soát 0.3.4: việc mở đầu bằng số đếm ("3 file ...") không khớp mô tả cũng mở đầu bằng số', () => {
    const subtasks = assessSubtasks(['3 file controller: đổi tên userId', 'Viết test cho hàm refund', 'Cập nhật README phần cài đặt'])
    expect(matchSubtask(subtasks, '3 lỗi trong log cần đọc', 'Đọc log lỗi')).toBeUndefined()
  })
})
