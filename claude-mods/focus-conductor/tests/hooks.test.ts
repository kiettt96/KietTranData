// Test tích hợp: chạy hook của mod qua engine của `claude plugin test`.
// Hook của test nằm dưới plugin, đóng vai engine (nhận đầu vào đã bị mod sửa).

import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HEURISTIC = { options: { analyzer: 'heuristic' } }
const BIG_USAGE = { input_tokens: 100_000, output_tokens: 50_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const COMPLEX_PROMPT = `### Mục tiêu
Refactor module thanh toán sang kiến trúc hướng sự kiện, đảm bảo bảo mật và hiệu năng.

1. Phân tích luồng hiện tại và các điểm nghẽn hiệu năng.
2. Thiết kế lại kiến trúc, nêu trade-off.
3. Migrate dần từng phần, viết test cho mỗi bước.
4. Kiểm tra bảo mật và đo lại hiệu năng.
- Không được thay đổi API công khai.`

type Seen = {
  contexts: string[][]
  steps: Array<{ model: string; effort?: TurnStepInput['effort'] }>
  toasts: string[]
}

/**
 * Hook nền mà mọi test cần (đăng ký trước lần gọi $ đầu tiên): đồng hồ,
 * prompt, step của model, toast, status. Ghi lại thứ "engine" nhận được.
 */
function base(on: On, engine: { failFamily?: string } = {}): Seen {
  mock.clock(on, { now: 1000 })
  const seen: Seen = { contexts: [], steps: [], toasts: [] }
  on('prompt.submit', ($, e) => {
    seen.contexts.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  on('turn.step', async function* (_$, e) {
    seen.steps.push({ model: e.model, effort: e.effort })
    // "Engine" không phản hồi khi nhận một họ model nhất định (không có quyền, quá tải...).
    if (engine.failFamily && e.model.includes(engine.failFamily)) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [] }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  return seen
}

async function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Chạy một step qua chuỗi hook, trả model/effort mà "engine" nhận được. */
async function step($: Engine, seen: Seen, input: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    messageCount: 1,
    ...input,
  })
  for await (const chunk of stream) void chunk
  await stream.result
  return seen.steps[seen.steps.length - 1]
}

describe('đọc prompt', () => {
  test('gắn khối phân tích vào context trước khi model làm việc', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('[focus-conductor]')
    expect(context).toContain('Mục tiêu cuối: Refactor module thanh toán')
    expect(context).toContain('Không được thay đổi API công khai')
    expect(context).toContain('mcp__focus-conductor__plan')
  })

  test('chế độ off để prompt đi qua nguyên vẹn', { options: { analyzer: 'heuristic', routing: 'off' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
  })

  test('analyzer model dùng câu trả lời của Haiku', { options: { analyzer: 'model' } }, async ($, on) => {
    const seen = base(on)
    on('model.complete', () => ({
      value: {
        isAnswered: true as const,
        text: '{"goal":"Chuyển thanh toán sang event-driven","steps":["a","b"],"constraints":[],"quality":[],"tier":"complex","isNewGoal":true}',
        usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }))
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]?.join('\n')).toContain('Mục tiêu cuối: Chuyển thanh toán sang event-driven')
  })
})

describe('điều phối luồng chính', () => {
  test('việc rất phức tạp (deep) chạy opus/xhigh, giữ nguyên cho mọi step của turn', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const first = await step($, seen)
    expect(first?.model).toBe('claude-opus-5-5')
    expect(first?.effort).toBe('xhigh')
    const second = await step($, seen, { index: 1, messageCount: 3 })
    expect(second?.model).toBe('claude-opus-5-5')
  })

  test('việc sửa code nhỏ ở turn đầu chạy sonnet/medium: việc sửa không bao giờ giao cho haiku', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, 'sửa typo trong README')
    const got = await step($, seen)
    expect(got?.model).toBe('claude-sonnet-5-5')
    expect(got?.effort).toBe('medium')
  })

  test('hỏi đáp đơn giản ở turn đầu chạy haiku/low', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    const got = await step($, seen)
    expect(got?.model).toBe('claude-haiku-5-5')
    expect(got?.effort).toBe('low')
  })

  test('chế độ subagents không chạm luồng chính', { options: { analyzer: 'heuristic', routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const got = await step($, seen)
    expect(got?.model).toBe('claude-sonnet-5-5')
    expect(got?.effort).toBe('medium')
  })
})

describe('điều phối subagent', () => {
  test('điền model và effort khi Claude để trống, giữ khi Claude chỉ định', HEURISTIC, async ($, on) => {
    base(on)
    const seen: Array<{ model?: string; effort?: string; subagent_type?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await $.tool.call({ tool: 'Agent', description: 'Viết test', prompt: 'Viết unit test cho hàm parseDate trong src/date.ts.' })
    await $.tool.call({
      tool: 'Agent',
      description: 'Viết test',
      prompt: 'Viết unit test cho hàm parseDate trong src/date.ts.',
      model: 'opus',
    })
    expect(seen[0]?.model).toBeDefined()
    expect(seen[0]?.effort).toBeDefined()
    expect(seen[1]?.model).toBe('opus')
  })
})

describe('nhiều subagent trong một phiên', () => {
  test('mỗi subagent nhận model theo việc của nó, không thấp hơn sàn của mục tiêu khó', HEURISTIC, async ($, on) => {
    base(on)
    const seen: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập và liệt kê đường dẫn.' })
    await $.tool.call({ tool: 'Agent', description: 'Sửa login', prompt: 'Sửa hàm login trong src/auth.ts để kiểm tra mật khẩu đúng cách' })
    expect(seen[0]).toBe('haiku')
    expect(seen[1]).toBe('opus')
  })

  test('model Claude chỉ định thấp hơn mức việc khó cần thì được nâng lên sàn', HEURISTIC, async ($, on) => {
    base(on)
    const seen: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({
      tool: 'Agent',
      description: 'Sửa login',
      prompt: 'Sửa hàm login trong src/auth.ts để kiểm tra mật khẩu đúng cách',
      model: 'haiku',
    })
    expect(seen[0]).toBe('opus')
  })

  test('chi phí đo được của subagent cộng vào đúng agent, không vào luồng chính', HEURISTIC, async ($, on) => {
    base(on)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    const spawned = await $.agent.spawn({ prompt: 'Tìm trong codebase các file xử lý đăng nhập', description: 'Tìm file auth', subagentType: 'Explore' } as never)
    await $.turn.complete({
      turnId: 'ag1',
      agentId: spawned.agentId,
      answer: 'ok',
      durationMs: 5,
      isAborted: false,
      reason: 'answer',
      usage: { ...BIG_USAGE, model: 'claude-haiku-5-5' },
    } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('subagent $0.035 trong 1 lượt')
    expect(status).toContain('luồng chính $0.0000 trong 0 lượt')
    expect(status).toContain('Tìm file auth: haiku $0.035')
  })

  test('subagent lỗi rồi được giao lại cùng việc thì lần giao lại nâng một bậc', HEURISTIC, async ($, on) => {
    base(on)
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-9' }))
    on('turn.complete', () => ({ text: '' }))
    const seen: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push(e.model)
      return { result: 'đã giao' }
    })
    const description = 'Sửa nút lệch'
    const prompt = 'Sửa lỗi hiển thị nút bị lệch trên trang đăng nhập'
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description, prompt })
    await $.agent.spawn({ prompt, description, tool_use_id: 'u1' } as never)
    await $.turn.complete({ turnId: 'ag-9', agentId: 'agent-9', answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description, prompt })
    expect(seen[0]).toBe('sonnet')
    expect(seen[1]).toBe('opus')
  })

  test('model Claude chỉ định vượt trần ceiling thì bị giới hạn về model của phiên', { options: { analyzer: 'heuristic', sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Sửa login', prompt: 'Sửa hàm login trong src/auth.ts', model: 'opus' })
    expect(models[0]).toBe('sonnet')
  })

  test('spawn bị từ chối không để lại kế hoạch chờ cho lần spawn sau', HEURISTIC, async ($, on) => {
    base(on)
    let calls = 0
    on('agent.spawn', () => {
      calls += 1
      return calls === 1 ? { deny: 'test: từ chối' } : { model: 'claude-sonnet-5-5', agentId: 'agent-2' }
    })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Sửa nút', prompt: 'Sửa nút lệch' })
    await $.agent.spawn({ prompt: 'Sửa nút lệch', description: 'Sửa nút', tool_use_id: 'u1' } as never)
    await $.agent.spawn({ prompt: 'Việc khác', description: 'Việc khác', tool_use_id: 'u1' } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Việc khác: sonnet (không qua điều phối)')
  })

  test('việc đã phân trước: Agent khớp đúng việc thì dùng model đã chấm sẵn, không chấm lại', HEURISTIC, async ($, on) => {
    base(on)
    const seen: Array<{ model?: string; subagent_type?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push({ model: e.model, subagent_type: e.subagent_type })
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, `Mục tiêu: nâng cấp module thanh toán.
1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.
2. Đổi tên userId thành accountId trong 12 file controller.
3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off.
4. Cập nhật README phần cài đặt.`)
    await $.tool.call({ tool: 'Agent', description: 'Tìm chỗ gọi charge', prompt: 'Tìm trong src/ tất cả chỗ gọi hàm charge' })
    await $.tool.call({ tool: 'Agent', description: 'Đổi tên userId thành accountId', prompt: 'Đổi tên userId thành accountId trong 12 file controller' })
    // Explore chỉ được gọi tên khi engine đã mời agent này; ở đây chưa mời nên giữ general-purpose.
    expect(seen[0]).toEqual({ model: 'haiku', subagent_type: undefined })
    expect(seen[1]?.model).toBe('sonnet')
    // Prompt của agent đầy từ khóa khó nhưng việc đã chấm là nhẹ: vẫn theo việc đã chấm.
    await $.tool.call({
      tool: 'Agent',
      description: 'Đổi tên userId thành accountId',
      prompt: 'Phân tích race condition, bảo mật và kiến trúc liên module của toàn bộ luồng thanh toán trước khi đổi tên userId',
    })
    expect(seen[2]?.model).toBe('sonnet')
    // Description ngắn dạng "Việc N: ..." như tool Agent yêu cầu vẫn khớp đúng việc.
    await $.tool.call({ tool: 'Agent', description: 'Việc 4: sửa README', prompt: 'Cập nhật phần cài đặt' })
    expect(seen[3]?.model).toBe('sonnet')
  })

  test('context liệt kê phân việc: việc nào giao subagent kèm model, việc nào làm trực tiếp', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, `Mục tiêu: nâng cấp module thanh toán.
1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.
2. Đổi tên userId thành accountId trong 12 file controller.
3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off.
4. Cập nhật README phần cài đặt.`)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (đã chấm trước khi làm')
    expect(context).toContain('1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn. → giao general-purpose haiku/low')
    expect(context).toContain('2. Đổi tên userId thành accountId trong 12 file controller. → giao general-purpose sonnet/medium')
    expect(context).toContain('3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off. → làm trực tiếp ở luồng chính (opus/xhigh)')
    expect(context).not.toContain('Bước dự kiến')
  })

  test('giao hơn sáu subagent trong một mục tiêu thì cảnh báo chi phí đúng một lần', HEURISTIC, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 8; i++) {
      await $.tool.call({ tool: 'Agent', description: `Tìm ${i}`, prompt: `Tìm file số ${i} trong codebase` })
    }
    expect(seen.toasts.filter(t => t.includes('đã giao 7 subagent')).length).toBe(1)
  })
})

describe('chi phí luồng chính và nâng cấp theo bằng chứng', () => {
  test('turn luồng chính kết thúc: chi phí đo được cộng vào nhóm luồng chính', HEURISTIC, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await $.turn.complete({
      turnId: 't1',
      answer: 'ok',
      durationMs: 5,
      isAborted: false,
      reason: 'answer',
      usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' },
    } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('luồng chính $0.700 trong 1 lượt')
    expect(status).toContain('subagent $0.0000 trong 0 lượt')
  })

  test('turn chưa có mục tiêu vẫn được cộng vào sổ', HEURISTIC, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await $.turn.complete({ turnId: 't0', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('luồng chính $0.700 trong 1 lượt')
  })

  test('chế độ suggest không áp route nên không hiệu chỉnh ước lượng', { options: { analyzer: 'heuristic', routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).not.toContain('Hiệu chỉnh ước lượng')
  })

  test('chế độ auto áp route thì có hiệu chỉnh ước lượng', HEURISTIC, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('Hiệu chỉnh ước lượng theo 1 lần đo')
  })

  test('người dùng tự đổi model rồi sang mục tiêu mới: quyết định so với model đang chạy, có tính chi phí cache', HEURISTIC, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    // Người dùng tự chuyển sang opus/xhigh: mod tạm dừng tới mục tiêu mới.
    await step($, seen, { turnId: 't2', model: 'claude-opus-5-5', effort: 'xhigh' })
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    const got = await step($, seen, { turnId: 't3', model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(got?.model).toBe('claude-sonnet-5-5')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('hạ xuống sonnet/medium')
    expect(status).not.toContain('turn đầu tiên')
  })

  test('ba tool call lỗi trong một turn thì turn sau nâng effort một bậc', HEURISTIC, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    const second = await step($, seen, { turnId: 't2', index: 1, messageCount: 3 })
    expect(second?.model).toBe('claude-sonnet-5-5')
    expect(second?.effort).toBe('high')
  })
})

describe('chính sách model của phiên', () => {
  test('sessionModel ceiling: luồng chính không vượt model của phiên', { options: { analyzer: 'heuristic', sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const got = await step($, seen, { model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(got?.model).toBe('claude-sonnet-5-5')
    expect(got?.effort).toBe('medium')
  })

  test('sessionModel fixed: giữ model của phiên, chỉ effort được chọn lại', { options: { analyzer: 'heuristic', sessionModel: 'fixed' } }, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    const got = await step($, seen, { model: 'claude-sonnet-5-5', effort: 'high' })
    expect(got?.model).toBe('claude-sonnet-5-5')
    expect(got?.effort).toBe('low')
  })
})

describe('checklist và chặn kết thúc', () => {
  test('checklist còn mở thì chặn dừng, đóng hết thì cho dừng', HEURISTIC, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    const set = await $.tool.call({
      tool: 'mcp__focus-conductor__plan',
      action: 'set',
      goal: 'Refactor thanh toán',
      steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }],
    })
    expect(String(set.result)).toContain('Checklist (0/2 đã đóng)')

    const blocked = await $.classic.Stop({ stop_hook_active: false })
    expect(blocked.block).toContain('Checklist còn 2 bước mở')

    // Turn sau chỉ hỏi đáp, không thay đổi gì: không bị chặn dù checklist còn mở.
    await $.turn.start({ text: 'giải thích bước 1', turnId: 't2' })
    const question = await $.classic.Stop({ stop_hook_active: false })
    expect(question.block).toBeUndefined()

    const refused = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified' })
    expect(refused.deny).toContain('evidence')

    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified', evidence: 'đã đọc 3 file' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 2, status: 'skipped', note: 'người dùng hoãn' })
    const allowed = await $.classic.Stop({ stop_hook_active: false })
    expect(allowed.block).toBeUndefined()
  })
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const conductor = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, ...RUN })

describe('model được chọn không phản hồi', () => {
  test('lỗi một lần chỉ quay về model của engine; lỗi hai turn liên tiếp mới bị chặn, hết chặn sau 5 turn', HEURISTIC, async ($, on) => {
    const seen = base(on, { failFamily: 'opus' })
    await submit($, COMPLEX_PROMPT)
    const attempts = async (turnId: string) => {
      const from = seen.steps.length
      await step($, seen, { turnId, messageCount: 3 })
      return seen.steps.slice(from).map(s => s.model)
    }
    const retried = ['claude-opus-5-5', 'claude-sonnet-5-5']
    expect(await attempts('t1')).toEqual(retried)
    expect(await attempts('t2')).toEqual(retried)
    for (const id of ['t3', 't4', 't5', 't6']) expect(await attempts(id)).toEqual(['claude-sonnet-5-5'])
    expect(await attempts('t7')).toEqual(retried)
  })

  test('lỗi một lần chưa chặn: /conductor status không báo model tạm ngừng', HEURISTIC, async ($, on) => {
    const seen = base(on, { failFamily: 'opus' })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1', messageCount: 3 })
    const status = await conductor($, 'status')
    expect(status.text).not.toContain('tạm ngừng')
  })
})

describe('lệnh /conductor', () => {
  test('mode off tắt phân tích, mode không hợp lệ trả trợ giúp', HEURISTIC, async ($, on) => {
    const seen = base(on)
    expect((await conductor($, 'mode lung-tung')).text).toContain('auto, subagents, suggest hoặc off')
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
    await conductor($, 'mode auto')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[1]?.join('\n')).toContain('[focus-conductor]')
  })

  test('goal đặt mục tiêu, status hiện mục tiêu, reset xóa', HEURISTIC, async ($, on) => {
    base(on)
    const goal = await conductor($, 'goal Viết hàm parseDate cho ngày ISO, có unit test')
    expect(goal.text).toContain('Đã đặt mục tiêu')
    expect(goal.context?.join('\n')).toContain('[focus-conductor]')
    expect((await conductor($, 'status')).text).toContain('Mục tiêu: Viết hàm parseDate')
    await conductor($, 'reset')
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })

  test('/clear (session.end clear) xóa mục tiêu của phiên', HEURISTIC, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await conductor($, 'status')).text).toContain('Mục tiêu:')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })
})

describe('system prompt', () => {
  const FACTS = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

  test('thêm mục kỷ luật làm việc, tắt khi mode off', HEURISTIC, async ($, on) => {
    base(on)
    const result = await $.prompt.compose(FACTS)
    expect(result.sections.map(section => section.id)).toContain('focus-conductor:discipline')
    await conductor($, 'mode off')
    expect((await $.prompt.compose(FACTS)).sections).toEqual([])
  })
})

describe('đổi mục tiêu qua tool plan', () => {
  test('mục tiêu mới khi checklist cũ còn bước mở thì báo cho Claude', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({
      tool: 'mcp__focus-conductor__plan',
      action: 'set',
      steps: [{ title: 'Phân tích luồng thanh toán' }, { title: 'Thiết kế lại kiến trúc' }],
    })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.')
    const second = seen.contexts[1]?.join('\n') ?? ''
    expect(second).toContain('Bản đọc prompt')
    expect(second).toContain('Checklist cũ còn 2 bước mở đã bị bỏ')
  })

  test('plan "set" sang mục tiêu mới thì prompt khác chủ đề sau đó là mục tiêu mới', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit(
      $,
      `Tạo plugin focus-conductor cho Claude Code:
1. Viết hooks phân tích prompt và điều phối model
2. Viết README hướng dẫn cài đặt plugin
3. Viết unit test cho hooks`,
    )
    await $.tool.call({
      tool: 'mcp__focus-conductor__plan',
      action: 'set',
      goal: 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.',
      steps: [{ title: 'slugify.ts: hàm slugify(text: string): string' }, { title: 'Unit test các trường hợp chính và biên' }],
    })
    await submit($, 'Bổ sung cho slugify: bỏ dấu tiếng Việt và cập nhật unit test.')
    await submit($, 'Sửa file README cho rõ cách cài đặt plugin.')

    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Viết hàm slugify')
    const readme = seen.contexts[2]?.join('\n') ?? ''
    expect(readme).toContain('Bản đọc prompt')
    expect(readme).toContain('Mục tiêu cuối: Sửa file README cho rõ cách cài đặt plugin.')
  })
})

describe('giao diện', () => {
  test('band hiện mục tiêu và tier trên terminal và desktop', HEURISTIC, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'focus-conductor',
        surface,
        component: 'AbovePrompt',
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 6,
          bodyColumns: 120,
          scroll: { offset: 0, bodyRows: 6 },
          view: {},
        },
      })
      expect(await ui.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
      expect(await ui.find({ key: 'details' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pane hiện checklist và đổi chế độ bằng nút', HEURISTIC, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng' }] })
    const ui = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'focus-conductor',
      props: { title: 'Focus Conductor', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeDefined()
    await ui.press({ key: 'mode-suggest' })
    expect(await ui.find({ type: 'Text', text: /Checklist 0\/1/ })).toBeDefined()
    await ui.unmount()
  })
})
