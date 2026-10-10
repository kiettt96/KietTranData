// Test tích hợp: chạy hook của mod qua engine của `claude plugin test`.
// Hook của test nằm dưới plugin, đóng vai engine (nhận đầu vào đã bị mod sửa).
// Model router được giả lập qua `model.complete`: test đặt câu trả lời JSON mà router trả.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { K4_META_LEAD, K4_PROMPT } from './fixtures/prompt-k4'
import { calibrate, emptyLedger } from '../hooks/lib/ledger'

const BIG_USAGE = { input_tokens: 100_000, output_tokens: 50_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROUTER_USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const COMPLEX_PROMPT = `### Mục tiêu
Refactor module thanh toán sang kiến trúc hướng sự kiện, đảm bảo bảo mật và hiệu năng.

1. Phân tích luồng hiện tại và các điểm nghẽn hiệu năng.
2. Thiết kế lại kiến trúc, nêu trade-off.
3. Migrate dần từng phần, viết test cho mỗi bước.
4. Kiểm tra bảo mật và đo lại hiệu năng.
- Không được thay đổi API công khai.`

const FOUR = `Mục tiêu: nâng cấp module thanh toán.
1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.
2. Đổi tên userId thành accountId trong 12 file controller.
3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off.
4. Cập nhật README phần cài đặt.`
const SEARCH = 'Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn'
const EDIT = 'Đổi tên userId thành accountId trong 12 file controller'

type Json = Record<string, unknown>

/** Câu trả lời router cho một prompt; mỗi test chỉ đổi phần mình cần. */
function plan(over: Json = {}): Json {
  return {
    why: 'việc vừa',
    relation: 'new',
    reference: false,
    goal: 'Mục tiêu thử',
    constraints: [],
    quality: [],
    scope: [],
    depth: 'light',
    volume: 'small',
    kind: 'edit',
    main: { model: 'sonnet', effort: 'medium', why: '' },
    tasks: [],
    ...over,
  }
}

function task(title: string, run: 'main' | 'agent', model: string, effort: string, over: Json = {}): Json {
  return { title, run, agent: 'general-purpose', model, effort, depth: 'light', volume: 'small', kind: 'edit', why: 'w', ...over }
}

const COMPLEX_PLAN = plan({
  goal: 'Refactor module thanh toán sang kiến trúc hướng sự kiện',
  constraints: ['Không được thay đổi API công khai'],
  quality: ['Hiệu năng không giảm'],
  depth: 'hard',
  volume: 'large',
  kind: 'mixed',
  main: { model: 'opus', effort: 'xhigh', why: 'kiến trúc và bảo mật' },
})

const FOUR_PLAN = plan({
  goal: 'Nâng cấp module thanh toán',
  depth: 'hard',
  volume: 'medium',
  kind: 'mixed',
  main: { model: 'opus', effort: 'xhigh' },
  tasks: [
    task('Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate', depth: 'none' }),
    task('Đổi tên userId thành accountId trong 12 file controller.', 'agent', 'sonnet', 'medium'),
    task('Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off.', 'main', 'opus', 'xhigh', { kind: 'answer', depth: 'hard' }),
    task('Cập nhật README phần cài đặt.', 'agent', 'sonnet', 'medium'),
  ],
})

/** Câu trả lời router mặc định theo nội dung yêu cầu; null là giả lập router lỗi. */
type Responder = (request: string) => Json | string | null
type AgentResponder = (task: string) => Json | string | null

function requestOf(prompt: string): string {
  return prompt.split('<request>\n')[1]?.split('\n</request>')[0] ?? ''
}

const DEFAULT_ROUTER: Responder = request => {
  if (request.includes('Refactor module thanh toán')) return COMPLEX_PLAN
  if (request.startsWith('Mục tiêu: nâng cấp module thanh toán')) return FOUR_PLAN
  if (request.includes('Liệt kê')) return plan({ goal: request, depth: 'none', kind: 'answer', main: { model: 'haiku', effort: 'low' } })
  if (request.includes('race condition')) return plan({ goal: request, depth: 'hard', kind: 'edit', main: { model: 'opus', effort: 'high' } })
  return plan({ goal: request.split('\n')[0] })
}

const DEFAULT_AGENT: AgentResponder = text => {
  if (/race condition|bảo mật/.test(text)) return { why: 'khó', model: 'opus', effort: 'high', agent: 'general-purpose', depth: 'hard', volume: 'medium', kind: 'mixed' }
  if (/Tìm|Liệt kê/.test(text)) return { why: 'tra cứu', model: 'haiku', effort: 'low', agent: 'Explore', depth: 'none', volume: 'small', kind: 'investigate' }
  return { why: 'sửa nhỏ', model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }
}

type Seen = {
  contexts: string[][]
  steps: Array<{ model: string; effort?: TurnStepInput['effort'] }>
  toasts: string[]
  /** Request đọc prompt và request chấm subagent mà router nhận, và model được gọi. */
  routed: string[]
  agentRouted: string[]
  routerModels: string[]
  /** Request kiểm lạc đề (semanticDrift) mà router nhận. */
  drift: string[]
}

/**
 * Hook nền mà mọi test cần (đăng ký trước lần gọi $ đầu tiên): đồng hồ, prompt, step của
 * model, router, toast, status. Ghi lại thứ "engine" và router nhận được.
 */
function base(
  on: On,
  engine: { failFamily?: string; router?: Responder; agent?: AgentResponder; isRejected?: boolean; drift?: (context: string) => Json | null } = {},
): Seen {
  mock.clock(on, { now: 1000 })
  const seen: Seen = { contexts: [], steps: [], toasts: [], routed: [], agentRouted: [], routerModels: [], drift: [] }
  on('prompt.submit', ($, e) => {
    seen.contexts.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  on('model.complete', (_$, e) => {
    if (engine.isRejected) throw new Error('model bị chặn')
    const isAgent = (e.system ?? '').includes('about to start a subagent')
    if ((e.system ?? '').includes('still working toward')) {
      seen.drift.push(e.prompt)
      const verdict = engine.drift ? engine.drift(e.prompt) : { onTrack: true, why: 'ổn' }
      return verdict === null
        ? { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: ZERO_USAGE } }
        : { value: { isAnswered: true as const, text: JSON.stringify(verdict), usage: ROUTER_USAGE } }
    }
    ;(isAgent ? seen.agentRouted : seen.routed).push(e.prompt)
    seen.routerModels.push(e.model)
    const reply = isAgent
      ? (engine.agent ?? DEFAULT_AGENT)(e.prompt.split('<task>\n')[1] ?? '')
      : (engine.router ?? DEFAULT_ROUTER)(requestOf(e.prompt))
    if (reply === null) {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: ZERO_USAGE } }
    }
    return { value: { isAnswered: true as const, text: typeof reply === 'string' ? reply : JSON.stringify(reply), usage: ROUTER_USAGE } }
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

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const conductor = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, ...RUN })

/** Agent của tool Agent: gọi tool.call (mod ghi điều phối), rồi engine khởi động agent đó. */
async function spawnTool($: Engine, toolUseId: string, description: string, prompt: string) {
  await $.tool.call({ tool: 'Agent', tool_use_id: toolUseId, description, prompt })
  return $.agent.spawn({ prompt, description, tool_use_id: toolUseId } as never)
}

const PANE = {
  plugin: 'focus-conductor',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'focus-conductor',
  props: { title: 'Focus Conductor', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

describe('router đọc prompt', () => {
  test('khối context lấy đúng từ router: mục tiêu, ràng buộc, tiêu chí, đánh giá, điều phối', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('[focus-conductor] Bản đọc prompt của router')
    expect(context).toContain('Mục tiêu cuối: Refactor module thanh toán sang kiến trúc hướng sự kiện')
    expect(context).toContain('- Không được thay đổi API công khai')
    expect(context).toContain('- Hiệu năng không giảm')
    expect(context).toContain('Đánh giá: độ sâu hard, khối lượng large, bản chất mixed (việc vừa)')
    expect(context).toContain('Điều phối: luồng chính opus/xhigh')
    expect(context).toContain('mcp__focus-conductor__plan')
    // Router nhận nguyên prompt, gọi bằng model mặc định.
    expect(seen.routed.length).toBe(1)
    expect(requestOf(seen.routed[0] ?? '')).toBe(COMPLEX_PROMPT)
    expect(seen.routerModels).toEqual(['sonnet'])
  })

  test('chế độ off: không gọi router, prompt đi qua nguyên vẹn', { options: { routing: 'off' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
    expect(seen.routed.length).toBe(0)
  })

  test('option router chọn model router; chi phí router ghi theo đúng họ model đó', { options: { router: 'opus' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.routerModels).toEqual(['opus'])
    // 1.000 token vào và 500 token ra ở giá opus ($4/$20 mỗi 1M) = $0.014.
    expect(String((await conductor($, 'status')).text)).toContain('router $0.014 trong 1 lượt')
  })

  test('Phân việc: việc giao kèm loại agent, model, effort; việc làm trực tiếp ghi model luồng chính', {}, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (router đã chấm trước khi làm; khi giao, description của Agent mở đầu "Việc N: "')
    expect(context).toContain('1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn. → giao Explore haiku/low')
    expect(context).toContain('2. Đổi tên userId thành accountId trong 12 file controller. → giao general-purpose sonnet/medium')
    expect(context).toContain('3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off. → làm trực tiếp ở luồng chính (opus/xhigh)')
    expect(context).toContain('việc ghi "giao" chạy đúng model đã ghi; subagent ngoài danh sách được router chấm khi giao')
    expect(seen.toasts.some(t => t.includes('3 việc giao subagent'))).toBe(true)
  })

  test('router kẹp theo allowFable: chưa bật thì fable về opus, bật thì chạy fable', { options: { allowFable: true } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ kind: 'mixed', main: { model: 'fable', effort: 'high' } }) })
    await submit($, 'Thiết kế lại toàn bộ engine giao dịch')
    expect((await step($, seen))?.model).toBe('claude-fable-5-1')
  })

  test('chưa bật allowFable: lựa chọn fable của router chạy opus, lý do kẹp hiện trong bản đọc', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ kind: 'mixed', main: { model: 'fable', effort: 'high' } }) })
    await submit($, 'Thiết kế lại toàn bộ engine giao dịch')
    expect((await step($, seen))?.model).toBe('claude-opus-5-5')
    expect(seen.contexts[0]?.join('\n')).toContain('chưa bật allowFable: fable về opus')
  })
})

describe('điều phối luồng chính theo router', () => {
  test('step đầu nhận đúng model và effort router chọn, giữ nguyên cho mọi step của turn', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const first = await step($, seen)
    expect(first).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect((await step($, seen, { index: 1, messageCount: 3 }))?.model).toBe('claude-opus-5-5')
  })

  test('router chọn haiku/low cho hỏi đáp thì luồng chính chạy haiku/low', {}, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    expect(await step($, seen)).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
  })

  test('chế độ subagents không chạm luồng chính', { options: { routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  test('sessionModel ceiling: luồng chính không vượt model của phiên', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await step($, seen, { model: 'claude-sonnet-5-5', effort: 'medium' }))?.model).toBe('claude-sonnet-5-5')
  })

  test('sessionModel fixed: giữ model của phiên, effort theo router', { options: { sessionModel: 'fixed' } }, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    expect(await step($, seen, { model: 'claude-sonnet-5-5', effort: 'high' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' })
  })

  test('không có route đã lưu thì so với model engine đang chạy: nâng cấp ghi đúng "từ haiku/xhigh"', {}, async ($, on) => {
    // Turn đầu chạy opus nhưng model thất bại nên route bị xóa; engine vẫn là haiku/xhigh.
    const seen = base(on, { failFamily: 'opus' })
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1', model: 'claude-haiku-5-5', effort: 'xhigh' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5', effort: 'xhigh' })
    expect(String((await conductor($, 'status')).text)).toContain('sonnet/medium (việc khó hơn, nâng cấp từ haiku/xhigh)')
  })

  test('người dùng tự đổi model rồi sang mục tiêu mới: quyết định so với model đang chạy, có tính chi phí cache', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await step($, seen, { turnId: 't2', model: 'claude-opus-5-5', effort: 'xhigh' })
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    expect((await step($, seen, { turnId: 't3', model: 'claude-opus-5-5', effort: 'xhigh' }))?.model).toBe('claude-sonnet-5-5')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('hạ xuống sonnet/medium')
    expect(status).not.toContain('turn đầu tiên')
  })

  test('model cũ được giữ vì đổi không đáng chi phí cache: bản đọc ghi đúng model sẽ chạy', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    // Router chọn opus/high; hạ effort từ xhigh không bù được chi phí ghi lại cache nên opus/xhigh được giữ.
    await submit($, 'Fix race condition khi hai worker cùng ghi file cache')
    expect(seen.contexts[1]?.join('\n')).toContain('luồng chính opus/xhigh')
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('xhigh')
  })
})

describe('router lỗi: không đoán, turn chạy theo model của phiên', () => {
  test('lỗi API: step đi qua nguyên vẹn, có toast, cảnh báo và báo cho Claude', {}, async ($, on) => {
    const seen = base(on, { router: () => null })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts).toContain('Router (sonnet) không đọc được prompt (lỗi API overloaded 529); turn này chạy theo model của phiên')
    expect(seen.contexts[0]?.join('\n')).toContain('Router không đọc được prompt này (lỗi API overloaded 529)')
    expect(String((await conductor($, 'status')).text)).toContain('Chưa có mục tiêu')
  })

  test('JSON hỏng hoặc thiếu lựa chọn luồng chính: coi như router lỗi', {}, async ($, on) => {
    const seen = base(on, { router: () => '{"goal": "x", "main": {"model": "gpt"' })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts.some(t => t.includes('câu trả lời không đúng định dạng'))).toBe(true)
  })

  test('engine từ chối gọi model router: cũng không đoán', {}, async ($, on) => {
    const seen = base(on, { isRejected: true })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts.some(t => t.includes('engine từ chối'))).toBe(true)
  })

  test('router lỗi sau một mục tiêu đã có: lựa chọn luồng chính không bị áp lên prompt mới; việc đã phân vẫn là của mục tiêu', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    const agents: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      agents.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    expect((await step($, seen, { turnId: 't1' }))?.model).toBe('claude-opus-5-5')
    isDown = true
    await submit($, 'Giờ chuyển sang việc khác hẳn: dọn thư mục build')
    expect(await step($, seen, { turnId: 't2' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('model của phiên (router chưa chọn)')
    // Việc đã phân của mục tiêu vẫn khớp và dùng đúng lựa chọn đã chấm, không hỏi router lần nữa.
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên userId', prompt: EDIT })
    expect(seen.agentRouted.length).toBe(0)
  })

  test('router lỗi ngay sau một turn đã chạy: route cũ không còn hiện trong status, trước cả turn mới', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    expect(String((await conductor($, 'status')).text)).toContain('opus/xhigh')
    isDown = true
    await submit($, 'Giờ dọn thư mục build cho sạch')
    const status = String((await conductor($, 'status')).text)
    expect(status).not.toContain('opus/xhigh')
    expect(status).toContain('model của phiên (router chưa chọn)')
  })

  test('router lỗi hai lần liên tiếp thì tạm bỏ qua router ba prompt, rồi hỏi lại', {}, async ($, on) => {
    const seen = base(on, { router: () => null })
    for (let i = 1; i <= 6; i++) await submit($, `Prompt thử số ${i} có nhiều chữ`)
    expect(seen.routed.length).toBe(3)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router trong 3 prompt tới'))).toBe(true)
    expect(seen.contexts[3]?.join('\n')).toContain('router đang tạm ngừng')
  })
  test('lỗi không liên tiếp (lỗi, đọc được, lỗi) thì không tạm ngừng router', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) % 2 === 1 ? null : DEFAULT_ROUTER(request)) })
    for (let i = 1; i <= 4; i++) await submit($, `Prompt thử số ${i} có nhiều chữ`)
    expect(seen.routed.length).toBe(4)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router'))).toBe(false)
  })
})

describe('prompt tiếp nối', () => {
  test('prompt một từ cũng hỏi router: router nói tiếp nối thì giữ mục tiêu', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.includes('tiếp') ? plan({ relation: 'continue', goal: '' }) : DEFAULT_ROUTER(request)) })
    await submit($, FOUR)
    await submit($, 'tiếp')
    expect(seen.routed.length).toBe(2)
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
  })

  test('tiếp nối thêm việc: việc mới đánh số tiếp theo, vào phần chờ giao; lựa chọn luồng chính theo router', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Thêm')
          ? plan({ relation: 'refine', goal: '', main: { model: 'sonnet', effort: 'high' }, tasks: [task('Viết test webhook', 'agent', 'sonnet', 'medium')] })
          : DEFAULT_ROUTER(request),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await submit($, 'Thêm test cho webhook thanh toán nữa')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    expect(context).toContain('Router: refine; luồng chính sonnet/high')
    expect(context).toContain('5. Viết test webhook → giao general-purpose sonnet/medium')
    // Router thấy mục tiêu và các việc trước.
    expect(seen.routed[1]).toContain('Previous goal: Nâng cấp module thanh toán')
    expect(seen.routed[1]).toContain('  2. Đổi tên userId thành accountId trong 12 file controller. (general-purpose sonnet/medium)')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium), 5 (sonnet/medium)')
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('nâng theo bằng chứng về 0 khi router quyết lại, kẻo nâng hai lần', {}, async ($, on) => {
    const seen = base(on, {
      router: request => (request.startsWith('vẫn') ? plan({ relation: 'dissatisfied', goal: '', main: { model: 'sonnet', effort: 'high' } }) : plan({ goal: 'Sửa typo' })),
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    // Turn sau cùng prompt: nâng effort một bậc theo bằng chứng.
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('high')
    // Người dùng báo chưa đạt: router đã thấy model đã chạy và tự nâng; mod không nâng thêm.
    await submit($, 'vẫn sai, README vẫn còn lỗi chính tả')
    expect(seen.routed[1]).toContain('Main thread ran: sonnet/high')
    expect(await step($, seen, { turnId: 't3' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('ba tool call lỗi trong một turn thì turn sau nâng effort một bậc', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    expect(await step($, seen, { turnId: 't2', index: 1, messageCount: 3 })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })
})

describe('subagent theo router', () => {
  test('"Việc N" dùng đúng lựa chọn đã phân, không gọi router lần hai, kể cả khi Claude ghi model khác', {}, async ($, on) => {
    const seen = base(on)
    const calls: Array<{ model?: string; effort?: string; subagent_type?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên userId', prompt: EDIT, model: 'opus' })
    // Explore chỉ được gọi tên khi engine đã mời agent này; ở đây chưa mời nên giữ general-purpose.
    expect(calls[0]).toEqual({ model: 'haiku', effort: 'low', subagent_type: undefined })
    expect(calls[1]).toEqual({ model: 'sonnet', effort: 'medium', subagent_type: undefined })
    expect(seen.agentRouted.length).toBe(0)
  })

  test('subagent tự phát: router chấm theo việc của nó; cùng description và prompt thì dùng lại kết quả', {}, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập.', model: 'opus' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition trong luồng ghi số dư' })
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập.' })
    expect(models).toEqual(['haiku', 'opus', 'haiku'])
    expect(seen.agentRouted.length).toBe(2)
    // Router thấy mục tiêu và gợi ý của Claude.
    expect(seen.agentRouted[0]).toContain('Goal of the session: Refactor module thanh toán')
    expect(seen.agentRouted[0]).toContain('The main thread asked for: model opus.')
  })

  test('router lỗi khi chấm subagent: giữ nguyên lựa chọn của Claude, ghi lý do', {}, async ($, on) => {
    base(on, { agent: () => null })
    const calls: Array<{ model?: string; effort?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push({ model: e.model, effort: e.effort })
      return { result: 'đã giao' }
    })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-free' }))
    await submit($, COMPLEX_PROMPT)
    await spawnTool($, 'u1', 'Tìm file auth', 'Tìm file auth')
    await $.tool.call({ tool: 'Agent', description: 'Sửa', prompt: 'Sửa x', model: 'sonnet' })
    expect(calls).toEqual([{ model: undefined, effort: undefined }, { model: 'sonnet', effort: undefined }])
    expect(String((await conductor($, 'status')).text)).toContain('router không chấm được (lỗi API overloaded 529); giữ lựa chọn của Claude')
  })

  test('subagent lỗi rồi được giao lại: router được hỏi lại kèm danh sách việc đã lỗi', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-9' }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    await $.agent.spawn({ prompt: 'Sửa nút lệch trên trang đăng nhập', description: 'Sửa nút lệch', tool_use_id: 'u1' } as never)
    await $.turn.complete({ turnId: 'ag-9', agentId: 'agent-9', answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    expect(seen.agentRouted.length).toBe(2)
    expect(seen.agentRouted[1]).toContain('Failed pieces in this goal:\n  - Sửa nút lệch')
  })

  test('model Claude ghi không thuộc họ Claude thì cho qua nguyên vẹn, không hỏi router', {}, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Việc riêng', prompt: 'làm', model: 'my-local-model' } as never)
    expect(models).toEqual(['my-local-model'])
    expect(seen.agentRouted.length).toBe(0)
  })

  test('sessionModel ceiling giới hạn cả lựa chọn router cho subagent', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition' })
    expect(models).toEqual(['sonnet'])
  })

  test('chi phí đo được của subagent cộng vào đúng agent, không vào luồng chính', {}, async ($, on) => {
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
  })

  test('spawn bị từ chối không để lại kế hoạch chờ cho lần spawn sau', {}, async ($, on) => {
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
    expect(String((await conductor($, 'status')).text)).toContain('Việc khác: sonnet (không qua điều phối)')
  })

  test('luồng chính tự sửa file khi còn việc ghi giao subagent: nhắc đúng một lần', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((first.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
    const second = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    expect((second.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('mọi việc ghi giao đã có Agent nhận thì không nhắc', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, FOUR)
    for (const n of [1, 2, 4]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'làm việc được giao' })
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/c.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('ghi file kế hoạch của plan mode không nhắc giao subagent; sửa file mã nguồn thì vẫn nhắc', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const planned = await $.tool.call({ tool: 'Write', file_path: '/root/.claude/plans/ke-hoach.md', content: '# Kế hoạch' })
    expect((planned.context ?? []).join('\n')).not.toContain('chưa giao')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('chưa giao')
  })

  test('giao hơn sáu subagent trong một mục tiêu thì cảnh báo chi phí đúng một lần', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Agent', description: `Tìm ${i}`, prompt: `Tìm file số ${i} trong codebase` })
    expect(seen.toasts.filter(t => t.includes('đã giao 7 subagent')).length).toBe(1)
  })
  test('engine đã mời Explore thì việc router ghi Explore được đổi sang Explore; Claude chọn loại khác thì giữ', {}, async ($, on) => {
    base(on)
    on('agent.offer', () => ({ isOffered: true }))
    const types: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      types.push(e.subagent_type)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await $.agent.offer({ agent: 'Explore', description: 'tra cứu', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH, subagent_type: 'Plan' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên', prompt: EDIT })
    expect(types).toEqual(['Explore', 'Plan', undefined])
  })

  test('việc đã phân được kiểm lại theo chính sách lúc giao (model của phiên chỉ biết từ step đầu)', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ tasks: [task('Thiết kế lại engine', 'agent', 'opus', 'high'), task('Viết test', 'agent', 'sonnet', 'medium')] }) })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, 'Làm hai việc: thiết kế lại engine và viết test')
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: thiết kế', prompt: 'làm' })
    expect(models).toEqual(['sonnet'])
  })

  test('chế độ suggest: Claude để trống model thì không có cảnh báo lệch model (mod không gửi model nào)', { options: { routing: 'suggest' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-sg' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    expect(String((await conductor($, 'status')).text)).not.toContain('thay vì')
  })
})

describe('subagent chạy đúng điều phối', () => {
  test('hai subagent song song nhận đúng model và effort của việc mình, dù engine gửi khác', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
    await submit($, FOUR)
    // Khởi động ngược thứ tự: sửa trước, tra cứu sau.
    const edit = await spawnTool($, 'u2', 'Việc 2: đổi tên userId', EDIT)
    const search = await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    const before = seen.steps.length
    await step($, seen, { agentId: search.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: edit.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: search.agentId, model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    const got = seen.steps.slice(before)
    expect(got.map(g => g.effort)).toEqual(['low', 'medium', 'low'])
    expect(got.map(g => g.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  test('engine chạy model khác model đã điều phối thì ghi nhật ký và cảnh báo', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-lech' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    expect(String((await conductor($, 'status')).text)).toContain('engine chạy opus thay vì haiku')
  })

  test('agent workflow không do script chọn model: router chấm trước khi agent chạy, mod ép ở từng bước', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `w-${e.description.slice(0, 6)}` }))
    await submit($, FOUR)
    const lookup = await $.agent.spawn({ prompt: 'Tìm trong codebase các file xử lý đăng nhập', description: 'Tìm file auth', workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
    const edit = await $.agent.spawn({ prompt: EDIT, description: 'Đổi tên userId', workflow: { runId: 'wf_1', agentIndex: 2 } } as never)
    expect(seen.agentRouted.length).toBe(2)
    expect(seen.agentRouted[0]).toContain('Started by a workflow script.')
    const before = seen.steps.length
    await step($, seen, { agentId: lookup.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: edit.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)).toEqual([
      { model: 'claude-haiku-5-5', effort: 'low' },
      { model: 'claude-sonnet-5-5', effort: 'medium' },
    ])
  })

  test('agent workflow lặp lại cùng description và prompt chỉ hỏi router một lần', {}, async ($, on) => {
    const seen = base(on)
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w-${(n += 1)}` }))
    await submit($, FOUR)
    for (let i = 1; i <= 3; i++) await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_9', agentIndex: i } } as never)
    expect(seen.agentRouted.length).toBe(1)
    const before = seen.steps.length
    await step($, seen, { agentId: 'w-3', model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
  })

  test('agent workflow có model do script chọn thì giữ nguyên model và effort của engine', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'w-script' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', model: 'sonnet', workflow: { runId: 'wf_2', agentIndex: 1 } } as never)
    expect(seen.agentRouted.length).toBe(0)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-sonnet-5-5', effort: 'high' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('agent đã chạy step trước khi mod kịp ghi điều phối thì không bị ép về sau (đổi giữa chừng phá cache)', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-early' }))
    await submit($, FOUR)
    await step($, seen, { agentId: 'w-early', model: 'claude-opus-5-5', effort: 'xhigh' })
    await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_5', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: 'w-early', model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(String((await conductor($, 'status')).text)).toContain('bước đầu đã chạy trước khi mod kịp ghi, không ép')
  })

  test('chế độ suggest không ép model hay effort của subagent; nhật ký ghi là không áp dụng', { options: { routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-suggest' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_3', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /không áp dụng/ })).toBeTruthy()
    await ui.unmount()
  })

  test('agent workflow không phản hồi với model đã chọn thì quay về model của engine và ngừng ép', {}, async ($, on) => {
    const seen = base(on, { failFamily: 'haiku' })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-fail' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_4', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    const got = seen.steps.slice(before)
    expect(got.map(g => g.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-opus-5-5'])
    expect(got[2]?.effort).toBe('xhigh')
    expect(seen.toasts.some(t => t.includes('không phản hồi'))).toBe(true)
  })

  test('lời gọi Agent từ trong một subagent không lấy việc của luồng chính; router thấy agent cha', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'p1' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    // Agent p1 gọi thêm một agent cho việc 2 của luồng chính: không được coi là đã giao việc 2.
    await $.tool.call({ tool: 'Agent', agentId: 'p1', tool_use_id: 'n1', description: 'Việc 2: đổi tên userId', prompt: EDIT } as never)
    expect(seen.agentRouted[0]).toContain('Started from inside another subagent: Việc 1: tìm chỗ gọi charge (haiku/low)')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 2 (sonnet/medium)')
  })

  test('chế độ subagents vẫn ép subagent, chỉ luồng chính là không bị đổi', { options: { routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-haiku-5-5', agentId: 'a-sub' }))
    await submit($, FOUR)
    const spawned = await spawnTool($, 'us', 'Việc 2: đổi tên userId', EDIT)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-sonnet-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]?.effort).toBe('medium')
  })
})

describe('hiệu chỉnh chi phí subagent theo effort thật', () => {
  // 2.400 token ra: hệ số hiệu chỉnh không bị chặn ở 2, nên low và xhigh cho ra giá trị khác nhau.
  const USAGE = { input_tokens: 100_000, output_tokens: 2_400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

  // Chế độ gợi ý: engine chạy subagent theo effort của nó (không ép). Hiệu chỉnh phải dùng effort đó.
  async function calibrationAfter($: Engine, on: On, engineEffort: string): Promise<string> {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-cal' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'uc', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Việc 1: tìm chỗ gọi charge', tool_use_id: 'uc' } as never)
    await step($, seen, { agentId: spawned.agentId, model: 'claude-haiku-5-5', effort: engineEffort as 'low' })
    await $.turn.complete({ turnId: 'ag-cal', agentId: spawned.agentId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'claude-haiku-5-5' } } as never)
    return String((await conductor($, 'status')).text)
  }

  test('chế độ gợi ý: hiệu chỉnh haiku dùng effort xhigh mà engine đã gửi', { options: { routing: 'suggest' } }, async ($, on) => {
    const status = await calibrationAfter($, on, 'xhigh')
    expect(status).toContain(`haiku ×${calibrate(emptyLedger(0), 'haiku', USAGE.output_tokens, 'small', 'xhigh').calib.haiku.toFixed(2)}`)
  })

  test('chế độ gợi ý: hiệu chỉnh haiku dùng effort low mà engine đã gửi', { options: { routing: 'suggest' } }, async ($, on) => {
    const status = await calibrationAfter($, on, 'low')
    expect(status).toContain(`haiku ×${calibrate(emptyLedger(0), 'haiku', USAGE.output_tokens, 'small', 'low').calib.haiku.toFixed(2)}`)
  })
})

describe('prompt dài và prompt đính kèm', () => {
  // Câu trả lời router mẫu cho K4: 11 mục có mã, 4 việc giao (sonnet/medium), 7 việc ở luồng chính (opus).
  const K4_TASKS = Array.from({ length: 11 }, (_, i) => {
    const code = `K4.${i + 1}`
    const isAgent = [2, 3, 6, 9].includes(i + 1)
    return isAgent ? task(`${code}. Việc giao`, 'agent', 'sonnet', 'medium') : task(`${code}. Việc luồng chính`, 'main', 'opus', 'high', { depth: 'hard' })
  })
  const K4_PLAN = plan({ goal: 'Engine ra quyết định đúng luật', depth: 'hard', volume: 'large', kind: 'mixed', main: { model: 'opus', effort: 'high' }, tasks: K4_TASKS })

  test('prompt K4: router nhận trọn prompt; phân việc đủ 11 mục, 4 việc giao, 7 việc ở luồng chính; "K4.N" khớp đúng việc', {}, async ($, on) => {
    const seen = base(on, { router: () => K4_PLAN })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, K4_PROMPT)
    expect(requestOf(seen.routed[0] ?? '')).toBe(K4_PROMPT.trim())
    const context = seen.contexts[0]?.join('\n') ?? ''
    const block = context.split('Phân việc (router đã chấm')[1]?.split('Điều phối')[0] ?? ''
    expect(block.match(/^\d+\. K4\./gm)?.length).toBe(11)
    expect(block.match(/→ giao general-purpose sonnet\/medium/g)?.length).toBe(4)
    expect(block.match(/→ làm trực tiếp ở luồng chính \(opus\/high\)/g)?.length).toBe(7)
    await $.tool.call({ tool: 'Agent', description: 'K4.9 Báo cáo', prompt: 'làm' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 6: phần 6', prompt: 'làm' })
    expect(models).toEqual(['sonnet', 'sonnet'])
    expect(seen.agentRouted.length).toBe(0)
  })

  test('prompt đính kèm chỉ để đối chiếu: phân việc của phần đính kèm, không thực thi, không theo dõi giao việc', {}, async ($, on) => {
    const seen = base(on, {
      router: () => plan({ ...K4_PLAN, reference: true, goal: 'Đối chiếu phân việc của prompt K4', kind: 'answer', main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, `${K4_META_LEAD}\n\n${K4_PROMPT}`)
    // Router nhận cả câu mở lẫn phần đính kèm: chính router nhận ra đây là đối chiếu.
    expect(requestOf(seen.routed[0] ?? '')).toContain(K4_META_LEAD)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('Mục tiêu cuối: Đối chiếu phân việc của prompt K4')
    expect(context).toContain('Phân việc của prompt đính kèm (chỉ để đối chiếu: không thực thi, không giao subagent; luồng chính của prompt đó: opus/high)')
    expect(context).toContain('Không thực thi prompt đính kèm.')
    expect(context).toContain('luồng chính của lượt này sonnet/low')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).not.toContain('chưa giao')
    // Việc của prompt đối chiếu không khớp lời gọi Agent.
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: phần 2', prompt: 'làm' })
    expect(seen.agentRouted.length).toBe(1)
  })

  test('sau lượt đối chiếu, người dùng yêu cầu chạy thật: việc đối chiếu thành việc thật và được theo dõi giao', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('ok')
          ? plan({ relation: 'continue', runReference: true, goal: '', kind: 'mixed', main: { model: 'opus', effort: 'high' } })
          : plan({ ...K4_PLAN, reference: true, goal: 'Đối chiếu K4', kind: 'answer', main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, `${K4_META_LEAD}\n\n${K4_PROMPT}`)
    await submit($, 'ok giờ chạy thật prompt đó đi')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (router đã chấm trước khi làm')
    expect(context).not.toContain('chỉ để đối chiếu')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 2 (sonnet/medium), 3 (sonnet/medium), 6 (sonnet/medium), 9 (sonnet/medium)')
    expect(await step($, seen)).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })
})

describe('chi phí luồng chính', () => {
  test('turn luồng chính kết thúc: chi phí đo được cộng vào nhóm luồng chính', {}, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('luồng chính $0.700 trong 1 lượt')
    expect(status).toContain('subagent $0.0000 trong 0 lượt')
  })

  test('turn chưa có mục tiêu vẫn được cộng vào sổ', {}, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await $.turn.complete({ turnId: 't0', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('luồng chính $0.700 trong 1 lượt')
  })

  test('chế độ suggest không áp route nên không hiệu chỉnh ước lượng', { options: { routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).not.toContain('Hiệu chỉnh ước lượng')
  })

  test('chế độ auto áp route thì có hiệu chỉnh ước lượng', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('Hiệu chỉnh ước lượng theo 1 lần đo')
  })
})

describe('model được chọn không phản hồi', () => {
  test('lỗi một lần chỉ quay về model của engine; lỗi hai turn liên tiếp mới bị chặn, hết chặn sau 5 turn', {}, async ($, on) => {
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

  test('lỗi một lần chưa chặn: /conductor status không báo model tạm ngừng', {}, async ($, on) => {
    const seen = base(on, { failFamily: 'opus' })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1', messageCount: 3 })
    expect((await conductor($, 'status')).text).not.toContain('tạm ngừng')
  })
})

describe('checklist và chặn kết thúc', () => {
  test('checklist còn mở thì chặn dừng, đóng hết thì cho dừng', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    const set = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', goal: 'Refactor thanh toán', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    expect(String(set.result)).toContain('Checklist (0/2 đã đóng)')
    expect(String(set.result)).toContain('Bước tiếp theo: 1. Phân tích')
    expect(String(set.result)).not.toContain('gợi ý')
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
    // Turn sau chỉ hỏi đáp, không thay đổi gì: không bị chặn dù checklist còn mở.
    await $.turn.start({ text: 'giải thích bước 1', turnId: 't2' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    const refused = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified' })
    expect(refused.deny).toContain('evidence')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified', evidence: 'đã đọc 3 file' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 2, status: 'skipped', note: 'người dùng hoãn' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('mục tiêu mới khi checklist cũ còn bước mở thì báo cho Claude', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng thanh toán' }, { title: 'Thiết kế lại kiến trúc' }] })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.')
    const second = seen.contexts[1]?.join('\n') ?? ''
    expect(second).toContain('Bản đọc prompt của router')
    expect(second).toContain('Checklist cũ còn 2 bước mở đã được lưu')
  })

  test('plan "set" đổi mục tiêu: router thấy mục tiêu mới; tiếp nối giữ mục tiêu đó', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Bổ sung') ? plan({ relation: 'refine', goal: '' }) : plan({ goal: 'Tạo plugin' })) })
    await submit($, 'Tạo plugin focus-conductor cho Claude Code')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', goal: 'Viết hàm slugify(text) bằng TypeScript', steps: [{ title: 'slugify.ts' }, { title: 'Unit test' }] })
    await submit($, 'Bổ sung cho slugify: bỏ dấu tiếng Việt và cập nhật unit test.')
    expect(seen.routed[1]).toContain('Previous goal: Viết hàm slugify(text) bằng TypeScript')
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Viết hàm slugify')
  })
})

describe('lệnh /conductor', () => {
  test('mode off tắt điều phối, mode không hợp lệ trả trợ giúp', {}, async ($, on) => {
    const seen = base(on)
    expect((await conductor($, 'mode lung-tung')).text).toContain('auto, subagents, suggest hoặc off')
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
    await conductor($, 'mode auto')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[1]?.join('\n')).toContain('[focus-conductor]')
  })

  test('goal qua router (ép mục tiêu mới), status hiện mục tiêu và lý do của router, reset xóa', {}, async ($, on) => {
    const seen = base(on)
    const goal = await conductor($, 'goal Viết hàm parseDate cho ngày ISO, có unit test')
    expect(seen.routed[0]).toContain('relation must be "new"')
    expect(goal.text).toContain('Đã đặt mục tiêu: Viết hàm parseDate cho ngày ISO, có unit test (light, khối lượng small, luồng chính sonnet/medium)')
    expect(goal.context?.join('\n')).toContain('[focus-conductor]')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Mục tiêu: Viết hàm parseDate')
    expect(status).toContain('Đánh giá của router: độ sâu light, khối lượng small, bản chất edit (việc vừa)')
    await conductor($, 'reset')
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })

  test('goal khi router lỗi: đặt mục tiêu không có lựa chọn model, có báo checklist cũ đã được lưu', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích' }] })
    isDown = true
    const goal = await conductor($, 'goal Viết hàm parseDate')
    expect(goal.text).toContain('Router không đọc được')
    expect(goal.context?.join('\n')).toContain('Checklist cũ còn 1 bước mở đã được lưu')
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  test('/clear (session.end clear) xóa mục tiêu của phiên', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await conductor($, 'status')).text).toContain('Mục tiêu:')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect((await conductor($, 'status')).text).toContain('Chưa có mục tiêu')
  })
})

describe('system prompt', () => {
  const FACTS = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

  test('thêm mục kỷ luật làm việc (nói rõ khối do router đọc), tắt khi mode off', {}, async ($, on) => {
    base(on)
    const result = await $.prompt.compose(FACTS)
    const section = result.sections.find(s => s.id === 'focus-conductor:discipline')
    expect(section?.text).toContain('do model router của plugin đọc sẵn')
    expect(section?.text).toContain('description của Agent mở đầu "Việc N: "')
    await conductor($, 'mode off')
    expect((await $.prompt.compose(FACTS)).sections).toEqual([])
  })
})

describe('giao diện', () => {
  test('band hiện mục tiêu trên terminal và desktop', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'focus-conductor',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
      })
      expect(await ui.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
      expect(await ui.find({ key: 'details' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pane hiện lý do của router, checklist, và đổi chế độ bằng nút', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng' }] })
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /hard · khối lượng large · mixed \(việc vừa\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeDefined()
    await ui.press({ key: 'mode-suggest' })
    expect(await ui.find({ type: 'Text', text: /Checklist 0\/1/ })).toBeDefined()
    await ui.unmount()
  })
})

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
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu này: $0.0070')
  })
})


describe('0.5.0: không mất tiến độ khi đổi mục tiêu', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('mục tiêu mới cất checklist cũ còn bước mở; restore khôi phục đúng mục tiêu và trạng thái từng bước', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(seen.contexts[1]?.join('\n')).toContain('action "restore"')
    expect(seen.toasts.some(t => t.includes('đã được lưu'))).toBe(true)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết slugify' }] })
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' })
    expect(String(restored.result)).toContain('Đã khôi phục mục tiêu: Refactor module thanh toán')
    expect(String(restored.result)).toContain('[x] 1. Phân tích')
    expect(String(restored.result)).toContain('[ ] 2. Thiết kế')
    // Mục tiêu slugify còn bước mở nên đến lượt nó được cất; khôi phục lại được.
    const back = await $.tool.call({ tool: PLAN, action: 'restore', index: 1 })
    expect(String(back.result)).toContain('Viết slugify')
  })

  test('restore khi không có gì đã lưu, hoặc index ngoài phạm vi, thì bị từ chối kèm lý do', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore', index: 2 })).deny).toContain('index từ 1')
  })

  test('checklist cũ đã đóng hết thì không cần lưu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
  })

  test('router không ghi relation (hoặc ghi sai) thì giữ mục tiêu, không cất checklist', {}, async ($, on) => {
    const seen = base(on, {
      router: request => (request.startsWith('Làm tiếp') ? { ...plan({ goal: '' }), relation: undefined } : DEFAULT_ROUTER(request)),
    })
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Tìm chỗ gọi' }] })
    await submit($, 'Làm tiếp phần đổi tên nhé')
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    expect(seen.contexts[1]?.join('\n')).toContain('Bước còn mở: 1. Tìm chỗ gọi')
  })

  test('plan set nhận scope: sửa ngoài phạm vi bị cảnh báo; scope rỗng bỏ giới hạn; mục không phải đường dẫn bị từ chối', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const bad = await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: ['module thanh toán'] })
    expect(bad.deny).toContain('scope chỉ nhận đường dẫn')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: ['src/pay/'] })
    const outside = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/other.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.stringify(outside.context ?? [])).toContain('ngoài phạm vi')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: [] })
    const free = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/other2.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.stringify(free.context ?? [])).not.toContain('ngoài phạm vi')
  })
})

describe('0.5.0: prompt tiếp nối ngắn và đọc lại prompt', () => {
  test('mặc định (routerSkip trống) prompt "ok" vẫn qua router', {}, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    await submit($, 'ok')
    expect(seen.routed.length).toBe(2)
  })

  test('routerSkip: câu trong danh sách không hỏi router, giữ mục tiêu và điều phối; câu khác vẫn hỏi', { options: { routerSkip: 'ok, tiếp tục' } }, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    await step($, seen, { turnId: 't1' })
    await submit($, 'OK.')
    await submit($, 'Tiếp tục')
    expect(seen.routed.length).toBe(1)
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    expect(context).toContain('router không đọc lại')
    // Điều phối luồng chính giữ nguyên lựa chọn của router cho mục tiêu.
    expect((await step($, seen, { turnId: 't2' }))?.model).toBe('claude-opus-5-5')
    await submit($, 'ok sửa luôn phần README')
    expect(seen.routed.length).toBe(2)
  })

  test('routerSkip khi chưa có mục tiêu: vẫn hỏi router', { options: { routerSkip: 'ok' } }, async ($, on) => {
    const seen = base(on)
    await submit($, 'ok')
    expect(seen.routed.length).toBe(1)
  })

  test('/conductor reroute: router đọc lại prompt gần nhất kể cả khi đang tạm ngừng, giữ checklist', {}, async ($, on) => {
    let isDown = true
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Prompt thử số 1 có nhiều chữ')
    await submit($, FOUR)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router'))).toBe(true)
    isDown = false
    const result = await conductor($, 'reroute')
    expect(result.text).toContain('Router đã đọc lại prompt gần nhất: Nâng cấp module thanh toán')
    expect(result.context?.join('\n')).toContain('2. Đổi tên userId thành accountId')
    // Router hết tạm ngừng: prompt sau được đọc ngay.
    await submit($, 'Thêm test cho webhook')
    expect(seen.routed.length).toBe(4)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Đổi tên' }] })
    const again = await conductor($, 'reroute')
    expect(again.text).toContain('Router đã đọc lại')
    expect(String((await conductor($, 'status')).text)).toContain('1. Đổi tên')
  })

  test('/conductor reroute khi router vẫn lỗi: giữ điều phối hiện tại; khi chưa có prompt: báo rõ', {}, async ($, on) => {
    let isDown = false
    base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    expect((await conductor($, 'reroute')).text).toContain('Không có prompt nào')
    await submit($, FOUR)
    isDown = true
    expect((await conductor($, 'reroute')).text).toContain('Router không đọc được')
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu: Nâng cấp module thanh toán')
  })

  test('/conductor reroute sau khi router lỗi ở prompt tiếp nối: áp phần đọc mới lên mục tiêu, không lập mục tiêu mới', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, {
      router: request =>
        isDown ? null : request.startsWith('Thêm') ? plan({ relation: 'continue', goal: '', tasks: [task('Viết test webhook', 'agent', 'sonnet', 'medium')] }) : DEFAULT_ROUTER(request),
    })
    await submit($, FOUR)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Tìm chỗ gọi' }] })
    isDown = true
    await submit($, 'Thêm test cho webhook thanh toán nữa')
    isDown = false
    const result = await conductor($, 'reroute')
    expect(result.context?.join('\n')).toContain('5. Viết test webhook')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Mục tiêu: Nâng cấp module thanh toán')
    expect(status).toContain('1. Tìm chỗ gọi')
    void seen
  })

  test('/conductor goal hỏi router cả khi router đang tạm ngừng', {}, async ($, on) => {
    let isDown = true
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Prompt thử số 1 có nhiều chữ')
    await submit($, 'Prompt thử số 2 có nhiều chữ')
    isDown = false
    const goal = await conductor($, 'goal Viết hàm parseDate cho ngày ISO')
    expect(goal.text).toContain('luồng chính sonnet/medium')
    expect(seen.routed.length).toBe(3)
  })
})

describe('0.5.0: giao việc đã phân', () => {
  test('router nhận ra lời gọi Agent là một việc đã phân dù không ghi "Việc N": dùng lựa chọn đã phân, hết chờ giao', {}, async ($, on) => {
    const seen = base(on, {
      agent: text => (text.startsWith('Description: Đổi tên') ? { why: 'đúng việc 2', task: 2, model: 'opus', effort: 'high', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' } : DEFAULT_AGENT(text)),
    })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(`${e.model}/${e.effort}`)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Đổi tên userId sang accountId', prompt: EDIT })
    expect(seen.agentRouted[0]).toContain('Tasks of the goal:')
    expect(seen.agentRouted[0]).toContain('  2. Đổi tên userId thành accountId trong 12 file controller.')
    // Lựa chọn đã phân cho việc 2 (sonnet/medium), không phải lựa chọn router vừa chấm.
    expect(models).toEqual(['sonnet/medium'])
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 4 (sonnet/medium)')
  })

  test('lời gọi gần khớp mà không khớp được ghi vào log quyết định', { options: { decisionLog: '/tmp/fc-decisions.jsonl' } }, async ($, on) => {
    base(on)
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Bước 2: đổi tên', prompt: EDIT })
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map(l => l['kind'])).toEqual(['route', 'agent'])
    expect(lines[1]?.['miss']).toContain('"Bước 2" là số bước của checklist')
  })

  test('strictDelegation off (mặc định): chỉ nhắc ở lần sửa file đầu tiên', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    const second = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    expect((first.context ?? []).join('\n')).toContain('chưa giao')
    expect((second.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('strictDelegation remind: nhắc ở mọi lần thay đổi, kể cả lệnh ghi file; lệnh chỉ đọc thì không', { options: { strictDelegation: 'remind' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    const again = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    const bash = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/c.ts" })
    const read = await $.tool.call({ tool: 'Bash', command: 'cat src/c.ts' })
    expect((again.context ?? []).join('\n')).toContain('chưa giao')
    expect((bash.context ?? []).join('\n')).toContain('chưa giao')
    expect((read.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('strictDelegation block: chặn sửa file tối đa hai lần mỗi mục tiêu; giao hết thì không chặn; file kế hoạch không chặn', { options: { strictDelegation: 'block' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    const plan = await $.tool.call({ tool: 'Write', file_path: '/root/.claude/plans/p.md', content: 'x' })
    expect(plan.deny).toBeUndefined()
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect(first.deny).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toContain('lần chặn cuối')
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
    // Mục tiêu mới, giao hết việc: không chặn.
    await submit($, `${FOUR}\n5. Thêm log.`)
    for (const n of [1, 2, 4]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'x' })
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
  })

  test('strictDelegation block không chặn subagent và không chặn ở chế độ suggest', { options: { strictDelegation: 'block', routing: 'suggest' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
  })
})

describe('0.5.0: engine tự đổi model khác người dùng đổi model', () => {
  const SWITCH = { from_model: 'claude-sonnet-5-5', requested_model: null, context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0 } as const

  test('engine tự đổi (source auto): mod vẫn điều phối luồng chính, nhật ký ghi là engine', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    expect((await step($, seen, { turnId: 't1' }))?.model).toBe('claude-opus-5-5')
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'auto' } as never)
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-opus-5-5')
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /engine tự đổi model phiên sang claude-haiku-5-5 \(auto\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('người dùng gõ /model (source command): tạm dừng tự điều phối tới mục tiêu mới', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'command' } as never)
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-haiku-5-5')
  })

  test('engine không báo nguồn (không có hook): đổi model giữa các turn vẫn coi là người dùng đổi', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-haiku-5-5')
  })

  test('lần đổi do engine chỉ áp cho đúng lần đổi đó: người dùng đổi tiếp sau đó thì tạm dừng', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'auto' } as never)
    await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' })
    expect((await step($, seen, { turnId: 't3', model: 'claude-sonnet-5-5' }))?.model).toBe('claude-sonnet-5-5')
  })
})

describe('0.5.0: hỏi lại router và bộ đếm lỗi riêng', () => {
  test('router trả JSON hỏng rồi trả đúng: prompt được đọc, chi phí cộng cả hai lượt, nhật ký ghi đã hỏi lại', { options: { decisionLog: '/tmp/fc.jsonl' } }, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) === 1 ? '{"goal": "x", "main": {' : DEFAULT_ROUTER(request)) })
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, COMPLEX_PROMPT)
    expect(seen.routed.length).toBe(2)
    expect(seen.contexts[0]?.join('\n')).toContain('Mục tiêu cuối: Refactor module thanh toán')
    // Hai lượt router, mỗi lượt $0.007 ở giá sonnet.
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu này: $0.014,')
    expect(JSON.parse(writes[writes.length - 1]?.trim() ?? '{}')).toMatchObject({ kind: 'route', retried: true })
  })

  test('router chấm subagent lỗi liên tiếp không làm tạm ngừng router đọc prompt', {}, async ($, on) => {
    const seen = base(on, { agent: () => null })
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    for (const n of [1, 2, 3]) await $.tool.call({ tool: 'Agent', description: `Rà soát phần ${n}`, prompt: `Rà soát phần ${n} của module` })
    expect(seen.toasts.some(t => t.includes('Router chấm subagent (sonnet) lỗi 2 lần liên tiếp'))).toBe(true)
    // Lần thứ ba trong thời gian tạm ngừng của router chấm subagent: không hỏi.
    expect(seen.agentRouted.length).toBe(2)
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    expect(seen.routed.length).toBe(2)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router trong'))).toBe(false)
  })
})

describe('0.5.0: verified phải có evidence thật', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('evidence nhắc lệnh đã chạy: tính là đã kiểm tra, không cảnh báo', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    for (const f of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(done.result)).not.toContain('chưa tính là đã kiểm tra')
    // Đếm thay đổi chưa kiểm tra bắt đầu lại: lần sửa tiếp theo không nhắc checkpoint.
    const next = await $.tool.call({ tool: 'Edit', file_path: 'src/e.ts', old_string: 'x', new_string: 'y' })
    expect(JSON.stringify(next.context ?? [])).not.toContain('Checkpoint')
  })

  test('evidence không nhắc lệnh hay file nào đã chạy: vẫn ghi nhận, nhưng cảnh báo và chưa tính là đã kiểm tra', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    for (const f of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã kiểm tra kỹ, chạy ổn' })
    expect(String(done.result)).toContain('[v] 1. Sửa')
    expect(String(done.result)).toContain('chưa tính là đã kiểm tra')
    const next = await $.tool.call({ tool: 'Edit', file_path: 'src/e.ts', old_string: 'x', new_string: 'y' })
    expect(JSON.stringify(next.context ?? [])).toContain('Checkpoint')
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /evidence không nhắc lệnh hay file/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('0.5.0: bảng giá trong /conductor status', () => {
  test('status ghi ngày bảng giá và phần ghi đè theo option prices', { options: { prices: 'opus=5/25' } }, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'status')).text)).toContain('Bảng giá kèm mod ngày 2026-10-06, ghi đè cho opus')
  })
})

describe('0.5.0: log quyết định và hiệu chỉnh', () => {
  test('log quyết định nối tiếp file cũ khi phiên bắt đầu', { options: { decisionLog: '/tmp/fc-old.jsonl' } }, async ($, on) => {
    base(on)
    const writes: string[] = []
    on('fs.read', () => ({ value: '{"at":"2026-10-01T00:00:00.000Z","kind":"route"}\nkhông phải json\n' }))
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await submit($, COMPLEX_PROMPT)
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('{"at":"2026-10-01T00:00:00.000Z","kind":"route"}')
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ kind: 'route' })
  })

  test('agent không có kết quả chấm của router không được dùng để hiệu chỉnh ước lượng', {}, async ($, on) => {
    const seen = base(on, { agent: () => null })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a-raw' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-raw', 'Rà soát phần lạ', 'Rà soát phần lạ của module')
    await $.turn.complete({ turnId: 'x', agentId: 'a-raw', answer: '', durationMs: 1, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).not.toContain('Hiệu chỉnh ước lượng')
    void seen
  })
})

describe('0.5.0: danh mục agent và nhắc subagent', () => {
  test('router thấy loại agent engine mời (kèm mô tả) và loại khai trong agentTypes; chọn loại đó thì được giữ', { options: { agentTypes: 'security-reviewer' } }, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Rà soát')
          ? plan({ goal: 'Rà soát bảo mật', kind: 'mixed', tasks: [task('Rà soát webhook', 'agent', 'opus', 'high', { agent: 'security-reviewer', kind: 'investigate' })] })
          : DEFAULT_ROUTER(request),
    })
    on('agent.offer', () => ({ isOffered: true }))
    await $.agent.offer({ agent: 'test-runner', description: 'Chạy test và báo lỗi', source: 'plugin', provider: { plugin: 'x', tier: 'user' } } as never)
    await submit($, 'Rà soát bảo mật luồng webhook')
    expect(seen.routed[0]).toContain('Agent types: Explore (')
    expect(seen.routed[0]).toContain('test-runner (Chạy test và báo lỗi)')
    expect(seen.routed[0]).toContain('security-reviewer')
    expect(seen.contexts[0]?.join('\n')).toContain('1. Rà soát webhook → giao security-reviewer opus/high')
  })

  test('remindSubagents: subagent sửa file ngoài phạm vi được nhắc kèm việc được giao', { options: { remindSubagents: true } }, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Mục tiêu: nâng cấp') ? { ...FOUR_PLAN, scope: ['src/pay/'] } : DEFAULT_ROUTER(request)) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-1' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-sub', 'Việc 2: đổi tên userId', EDIT)
    const edit = await $.tool.call({ tool: 'Edit', agentId: 'sub-1', file_path: '/repo/src/other.ts', old_string: 'a', new_string: 'b' } as never)
    const text = (edit.context ?? []).join('\n')
    expect(text).toContain('Việc được giao cho subagent này: Việc 2: đổi tên userId')
    expect(text).toContain('ngoài phạm vi')
    void seen
  })

  test('mặc định không nhắc subagent (chỉ ghi cảnh báo lên pane)', {}, async ($, on) => {
    base(on, { router: request => (request.startsWith('Mục tiêu: nâng cấp') ? { ...FOUR_PLAN, scope: ['src/pay/'] } : DEFAULT_ROUTER(request)) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-2' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-sub2', 'Việc 2: đổi tên userId', EDIT)
    let last: Awaited<ReturnType<typeof $.tool.call>> | undefined
    for (let i = 0; i < 3; i++) last = await $.tool.call({ tool: 'Bash', agentId: 'sub-2', command: 'npm run build' } as never)
    expect(last?.context ?? []).toEqual([])
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
    expect(await band.find({ type: 'Text', text: /^Goal$/ })).toBeDefined()
    expect(await band.find({ key: 'details' })).toBeDefined()
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
