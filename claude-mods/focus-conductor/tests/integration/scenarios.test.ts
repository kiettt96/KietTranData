// Test tích hợp: kịch bản đầu cuối và các ca rà soát nhiều thành phần.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, DEFAULT_ROUTER, EDIT, FOUR, FOUR_PLAN, PANE, SEARCH, base, conductor, plan, spawnTool, step, submit, task } from '../support/engine'

describe('rà soát trước merge (0.4.0)', () => {
  test('router lỗi giữ việc, phạm vi và số thứ tự của mục tiêu: việc mới đánh số tiếp theo, phạm vi vẫn áp', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, {
      router: request => {
        if (isDown) return null
        if (request.startsWith('Mục tiêu: nâng cấp')) return { ...FOUR_PLAN, scope: ['src/pay/'] }
        if (request.startsWith('Thêm')) return plan({ relation: 'continue', goal: '', tasks: [task('Viết test webhook', 'agent', 'sonnet', 'medium')] })
        return DEFAULT_ROUTER(request)
      },
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    isDown = true
    await submit($, 'Giờ dọn thư mục build cho sạch')
    isDown = false
    await submit($, 'Thêm test cho webhook thanh toán nữa')
    expect(seen.contexts[2]?.join('\n')).toContain('5. Viết test webhook')
    const edit = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/other.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.stringify(edit.context ?? [])).toContain('ngoài phạm vi')
  })

  test('/conductor goal khi router lỗi: route cũ bị xóa, không hiện trong status', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    expect(String((await conductor($, 'status')).text)).toContain('opus/xhigh')
    isDown = true
    const goal = await conductor($, 'goal Viết hàm parseDate')
    expect(goal.text).toContain('Router không đọc được')
    expect(String((await conductor($, 'status')).text)).not.toContain('opus/xhigh')
  })

  test('chế độ suggest không lưu route: prompt sau ghi đúng model engine đang chạy, luồng chính ghi là chỉ đề xuất', { options: { routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]?.join('\n')).toContain('luồng chính opus/xhigh (chỉ đề xuất)')
    await step($, seen, { turnId: 't1' })
    expect(String((await conductor($, 'status')).text)).not.toContain('opus/xhigh (')
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    expect(seen.routed[1]).toContain('Main thread ran: claude-sonnet-5-5/medium')
  })

  test('subagents + ceiling: subagent không vượt model của phiên khi chưa có bước nào ở chế độ auto', { options: { routing: 'subagents', sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition trong luồng ghi số dư' })
    expect(models).toEqual(['sonnet'])
  })

  test('chạy thật prompt đã đối chiếu khi router trả relation new kèm runReference: việc đối chiếu thành việc thật', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('ok')
          ? plan({ relation: 'new', goal: '', runReference: true, main: { model: 'opus', effort: 'high' } })
          : plan({ ...FOUR_PLAN, reference: true, goal: 'Đối chiếu K4', kind: 'answer', main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    await submit($, FOUR)
    await submit($, 'ok giờ chạy thật prompt đó đi')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (router đã chấm trước khi làm')
    expect(context).not.toContain('chỉ để đối chiếu')
    expect(context).toContain('1. Tìm trong src/')
  })

  test('lượt chạy thật giữ ràng buộc của prompt đính kèm từ lượt đối chiếu', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('ok')
          ? plan({ relation: 'new', goal: '', runReference: true, constraints: [], main: { model: 'opus', effort: 'high' } })
          : plan({ ...FOUR_PLAN, reference: true, goal: 'Đối chiếu K4', kind: 'answer', constraints: ['Giữ API công khai'], main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    await submit($, FOUR)
    expect(seen.contexts[0]?.join('\n')).not.toContain('Giữ API công khai')
    await submit($, 'ok giờ chạy thật prompt đó đi')
    expect(seen.contexts[1]?.join('\n')).toContain('- Giữ API công khai')
  })

  test('agent workflow lỗi thì lần giao lại được router chấm lại, không dùng kết quả nhớ', {}, async ($, on) => {
    const seen = base(on)
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w-${(n += 1)}` }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    const first = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_r', agentIndex: 1 } } as never)
    await $.turn.complete({ turnId: 'wf-e', agentId: first.agentId, answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_r', agentIndex: 2 } } as never)
    expect(seen.agentRouted.length).toBe(2)
  })

  test('kết quả router đã nhớ được kiểm lại theo model của phiên hiện tại trước khi dùng', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w-c${(n += 1)}` }))
    await submit($, FOUR)
    await $.agent.spawn({ prompt: 'Phân tích race condition trong luồng ghi số dư', description: 'Rà race condition', workflow: { runId: 'wf_c', agentIndex: 1 } } as never)
    await step($, seen, { turnId: 't1', model: 'claude-sonnet-5-5' })
    await $.agent.spawn({ prompt: 'Phân tích race condition trong luồng ghi số dư', description: 'Rà race condition', workflow: { runId: 'wf_c', agentIndex: 2 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: 'w-c2', model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]?.model).toBe('claude-sonnet-5-5')
  })

  test('lời gọi Agent dùng lại kết quả router đã nhớ vẫn kiểm theo model của phiên hiện tại', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition trong luồng ghi số dư' })
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition trong luồng ghi số dư' })
    expect(models).toEqual(['opus', 'sonnet'])
    expect(seen.agentRouted.length).toBe(1)
  })

  test('chi phí router của prompt tạo mục tiêu mới được tính vào mục tiêu đó', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    // 1.000 token vào và 500 token ra ở giá sonnet ($2 và $10 mỗi 1M) = $0.007.
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu này, đo được: $0.0070')
  })
})

describe('0.5.0: phần còn lại của đánh giá', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('semanticDrift tắt (mặc định): không hỏi router ở checkpoint', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of ['a', 'b', 'c', 'd', 'e']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    expect(seen.drift.length).toBe(0)
  })

  test('semanticDrift: ở checkpoint router đọc mục tiêu, bước mở và các thay đổi; lạc đề thì nhắc và cảnh báo', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on, { drift: () => ({ onTrack: false, confidence: 0.8, why: 'đang sửa CSS không liên quan' }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích luồng' }] })
    let last: Awaited<ReturnType<typeof $.tool.call>> | undefined
    for (const f of ['a', 'b', 'c', 'd', 'e']) last = await $.tool.call({ tool: 'Edit', file_path: `styles/${f}.css`, old_string: 'x', new_string: 'y' })
    expect(seen.drift.length).toBe(1)
    expect(seen.drift[0]).toContain('Goal: Refactor module thanh toán')
    expect(seen.drift[0]).toContain('  - Phân tích luồng')
    expect(seen.drift[0]).toContain('styles/e.css')
    expect((last?.context ?? []).join('\n')).toContain('có thể đang lệch mục tiêu: đang sửa CSS không liên quan')
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /Router: có thể lạc đề/ })).toBeDefined()
    await ui.unmount()
  })

  test('semanticDrift: router thấy vẫn đúng hướng thì không nhắc thêm', { options: { semanticDrift: true } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    let last: Awaited<ReturnType<typeof $.tool.call>> | undefined
    for (const f of ['a', 'b', 'c', 'd', 'e']) last = await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    expect((last?.context ?? []).join('\n')).not.toContain('lệch mục tiêu')
  })

  test('agent engine báo khởi động mà không qua agent.spawn của mod: status ghi là agent ngoài điều phối', {}, async ($, on) => {
    base(on)
    on('classic.SubagentStart', () => ({}))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'known-1' }))
    await submit($, COMPLEX_PROMPT)
    await $.agent.spawn({ prompt: 'Tìm file', description: 'Tìm file auth', subagentType: 'Explore' } as never)
    await $.classic.SubagentStart({ agent_id: 'known-1', agent_type: 'Explore' } as never)
    await $.classic.SubagentStart({ agent_id: 'ghost-1', agent_type: 'statusline-setup' } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Agent ngoài điều phối (untracked agent, mod không chấm, không ép, không đo): 1 (statusline-setup)')
  })

  test('routerFallback reuse: router lỗi thì dùng lại lựa chọn luồng chính của prompt trước', { options: { routerFallback: 'reuse' } }, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    isDown = true
    await submit($, 'Giờ chuyển sang phần còn lại của việc refactor')
    expect(seen.toasts.some(t => t.includes('dùng lại lựa chọn của prompt trước'))).toBe(true)
    expect((await step($, seen, { turnId: 't2' }))?.model).toBe('claude-opus-5-5')
  })

  test('uiLanguage en: band và pane dùng nhãn tiếng Anh; nội dung của router giữ nguyên', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const band = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await band.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
    expect((await band.find({ key: 'details' }))?.text).toBe('Details')
    await band.unmount()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /^Constraints$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Không được thay đổi API công khai/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('0.5.0: kịch bản đầu cuối', () => {
  test('mục tiêu nhiều việc → giao hai subagent → engine tự đổi model → mục tiêu mới giữa chừng → khôi phục → kiểm tra → kết thúc', { options: { strictDelegation: 'remind' } }, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    const seen = base(on)
    let n = 0
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '42 pass' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `e2e-${(n += 1)}` }))
    on('classic.PostModelSwitch', () => ({}))
    on('classic.Stop', () => ({}))
    on('turn.complete', () => ({ text: '' }))

    // 1. Router đọc prompt bốn việc: luồng chính opus/xhigh, ba việc giao subagent.
    await submit($, FOUR)
    expect((await step($, seen, { turnId: 't1' }))?.model).toBe('claude-opus-5-5')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Giao việc' }, { title: 'Thiết kế đa tiền tệ' }] })

    // 2. Giao hai việc: mỗi subagent chạy đúng model đã phân dù engine gửi khác.
    await spawnTool($, 'e-1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await spawnTool($, 'e-2', 'Việc 2: đổi tên userId', EDIT)
    expect((await step($, seen, { agentId: 'e2e-1', model: 'claude-opus-5-5', effort: 'xhigh' }))?.model).toBe('claude-haiku-5-5')
    expect((await step($, seen, { agentId: 'e2e-2', model: 'claude-opus-5-5', effort: 'xhigh' }))?.effort).toBe('medium')
    // Việc 4 vẫn chờ giao: luồng chính tự sửa file thì được nhắc ở mỗi lần.
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/pay.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 4 (sonnet/medium)')

    // 3. Engine tự hạ model phiên vì quá tải: mod vẫn ép luồng chính về opus.
    await $.classic.PostModelSwitch({ from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-5-5', requested_model: null, source: 'auto', context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0 } as never)
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-opus-5-5')

    // 4. Prompt bị xếp là mục tiêu mới: checklist cũ được cất, Claude khôi phục.
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' })
    expect(String(restored.result)).toContain('Đã khôi phục mục tiêu: Nâng cấp module thanh toán')

    // 5. Kiểm tra bằng lệnh thật rồi ghi verified kèm evidence khớp: không cảnh báo, cho kết thúc.
    await $.turn.start({ text: 'làm tiếp', turnId: 't3' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    for (const id of [1, 2]) {
      const done = await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'verified', evidence: 'npm test: 42 pass' })
      expect(String(done.result)).not.toContain('chưa tính là đã kiểm tra')
    }
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Mục tiêu: Nâng cấp module thanh toán')
    expect(status).toContain('[v] 2. Thiết kế đa tiền tệ')
  })
})

describe('0.5.0: các ca biên do kiểm đột biến chỉ ra', () => {
  test('báo đổi model của engine chỉ dùng cho turn ngay sau đó: lần đổi sau của người dùng (không có hook) vẫn tạm dừng', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.classic.PostModelSwitch({ from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-5-5', requested_model: null, source: 'auto', context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0 } as never)
    await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' })
    await step($, seen, { turnId: 't3', model: 'claude-sonnet-5-5' })
    await submit($, 'Fix race condition khi hai worker cùng ghi file cache')
    // Người dùng đổi về haiku, không có hook báo nguồn: là lựa chọn của người dùng, không ép opus.
    expect((await step($, seen, { turnId: 't4', model: 'claude-haiku-5-5' }))?.model).toBe('claude-haiku-5-5')
  })

  test('khôi phục rồi lập mục tiêu mới nhiều lần: các mục tiêu đã lưu không đè nhau', {}, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    base(on)
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Bước của mục tiêu A' }] })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Bước của mục tiêu B' }] })
    await $.tool.call({ tool: PLAN, action: 'restore' })
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Bước của mục tiêu C' }] })
    await submit($, 'Fix race condition khi hai worker cùng ghi file cache')
    // Ba mục tiêu còn bước mở đều còn trong danh sách đã lưu.
    const third = await $.tool.call({ tool: PLAN, action: 'restore', index: 3 })
    expect(String(third.result)).toContain('Bước của mục tiêu B')
  })
})

describe('0.5.0: siết theo đánh giá PR', () => {
  test('strictDelegation block chặn cả Bash ghi file của luồng chính; lệnh đọc, subagent và file kế hoạch thì không', { options: { strictDelegation: 'block' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    expect((await $.tool.call({ tool: 'Bash', command: 'cat src/a.ts' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', agentId: 'sub-x', command: "sed -i 's/a/b/' src/a.ts" } as never)).deny).toBeUndefined()
    const blocked = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/a.ts" })
    expect(blocked.deny).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
    expect((await $.tool.call({ tool: 'Bash', command: 'rm src/old.ts' })).deny).toContain('lần chặn cuối')
    // Hết trần hai lần: chỉ nhắc.
    expect((await $.tool.call({ tool: 'Bash', command: 'echo x > src/a.ts' })).deny).toBeUndefined()
  })

  test('router không ghi relation: checklist cũ nằm nguyên trong mục tiêu hiện tại, không có gì để khôi phục', {}, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    base(on, { router: request => (request.startsWith('Làm tiếp') ? { ...plan({ goal: '' }), relation: undefined } : DEFAULT_ROUTER(request)) })
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Tìm chỗ gọi' }] })
    await submit($, 'Làm tiếp phần đổi tên nhé')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
    expect(String((await conductor($, 'status')).text)).toContain('1. Tìm chỗ gọi')
  })

  test('router hỏi lại vì JSON hỏng thì có toast báo', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) === 1 ? '{"goal": "x"' : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    expect(seen.toasts.some(t => t.includes('Router đã đọc lại một lần'))).toBe(true)
  })
})
