// Test các hàm thuần: chấm độ phức tạp, đọc prompt, điều phối có tính cache,
// chọn model subagent, reducer checklist và phát hiện lạc đề.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Route } from '../types'
import { analyzeHeuristic, assessSubtasks, isMeta, isRelated, isSameIdea, mergeAnalysis, retarget } from '../hooks/lib/analyze'
import { newTracker, observe } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { adviseSubtasks, decideMain, matchSubtask, planAgent, raisePick, resolveModelId } from '../hooks/lib/route'
import { droppedPlanNotice, statusLine } from '../hooks/lib/text'

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
