// Khung chạy dùng chung cho test tích hợp: đồng hồ, prompt, step của model, router giả lập (model.complete), toast, status.
// Hook của test nằm dưới plugin, đóng vai engine (nhận đầu vào đã bị mod sửa); test đặt câu trả lời JSON mà router trả.

import { mock } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

export const BIG_USAGE = { input_tokens: 100_000, output_tokens: 50_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
export const ROUTER_USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
/** Câu trả lời đặc biệt của responder router: model.complete báo hết giờ chờ. */
export const ROUTER_TIMEOUT = '__router-timeout__'
export const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const COMPLEX_PROMPT = `### Mục tiêu
Refactor module thanh toán sang kiến trúc hướng sự kiện, đảm bảo bảo mật và hiệu năng.

1. Phân tích luồng hiện tại và các điểm nghẽn hiệu năng.
2. Thiết kế lại kiến trúc, nêu trade-off.
3. Migrate dần từng phần, viết test cho mỗi bước.
4. Kiểm tra bảo mật và đo lại hiệu năng.
- Không được thay đổi API công khai.`

export const FOUR = `Mục tiêu: nâng cấp module thanh toán.
1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.
2. Đổi tên userId thành accountId trong 12 file controller.
3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off.
4. Cập nhật README phần cài đặt.`
export const SEARCH = 'Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn'
export const EDIT = 'Đổi tên userId thành accountId trong 12 file controller'

export type Json = Record<string, unknown>

/** Câu trả lời router cho một prompt; mỗi test chỉ đổi phần mình cần. */
export function plan(over: Json = {}): Json {
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

export function task(title: string, run: 'main' | 'agent', model: string, effort: string, over: Json = {}): Json {
  return { title, run, agent: 'general-purpose', model, effort, depth: 'light', volume: 'small', kind: 'edit', why: 'w', ...over }
}

export const COMPLEX_PLAN = plan({
  goal: 'Refactor module thanh toán sang kiến trúc hướng sự kiện',
  constraints: ['Không được thay đổi API công khai'],
  quality: ['Hiệu năng không giảm'],
  depth: 'hard',
  volume: 'large',
  kind: 'mixed',
  main: { model: 'opus', effort: 'xhigh', why: 'kiến trúc và bảo mật' },
})

export const FOUR_PLAN = plan({
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
export type Responder = (request: string) => Json | string | null
export type AgentResponder = (task: string) => Json | string | null

export function requestOf(prompt: string): string {
  return prompt.split('<request>\n')[1]?.split('\n</request>')[0] ?? ''
}

export const DEFAULT_ROUTER: Responder = request => {
  if (request.includes('Refactor module thanh toán')) return COMPLEX_PLAN
  if (request.startsWith('Mục tiêu: nâng cấp module thanh toán')) return FOUR_PLAN
  if (request.includes('Liệt kê')) return plan({ goal: request, depth: 'none', kind: 'answer', main: { model: 'haiku', effort: 'low' } })
  if (request.includes('race condition')) return plan({ goal: request, depth: 'hard', kind: 'edit', main: { model: 'opus', effort: 'high' } })
  return plan({ goal: request.split('\n')[0] })
}

export const DEFAULT_AGENT: AgentResponder = text => {
  if (/race condition|bảo mật/.test(text)) return { why: 'khó', model: 'opus', effort: 'high', agent: 'general-purpose', depth: 'hard', volume: 'medium', kind: 'mixed' }
  if (/Tìm|Liệt kê/.test(text)) return { why: 'tra cứu', model: 'haiku', effort: 'low', agent: 'Explore', depth: 'none', volume: 'small', kind: 'investigate' }
  return { why: 'sửa nhỏ', model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }
}

export type Seen = {
  contexts: string[][]
  steps: Array<{ model: string; effort?: TurnStepInput['effort'] }>
  toasts: string[]
  /** Request đọc prompt và request chấm subagent mà router nhận, và model được gọi. */
  routed: string[]
  agentRouted: string[]
  routerModels: string[]
  /** Request kiểm lạc đề (semanticDrift) mà router nhận. */
  drift: string[]
  /** Dòng trạng thái mod đặt qua $.ui.status (undefined là xóa dòng). */
  statuses: Array<string | undefined>
  /** Các lần mod gọi $.ui.open (id, tiêu đề, số dòng, focus) và các pane đang mở theo "engine" giả (0.7.2). */
  opened: Array<{ id: string; title?: string; rows?: number; focus?: boolean }>
  panes: string[]
  /** Đồng hồ giả: chỉ chạy khi test gọi advance hay set. */
  clock: MockClock
}

/**
 * Hook nền mà mọi test cần (đăng ký trước lần gọi $ đầu tiên): đồng hồ, prompt, step của
 * model, router, toast, status. Ghi lại thứ "engine" và router nhận được.
 */
export function base(
  on: On,
  engine: {
    failFamily?: string
    router?: Responder
    agent?: AgentResponder
    isRejected?: boolean
    drift?: (context: string) => Json | null
    /** Thư mục gốc và thư mục làm việc của phiên; null là engine không trả được; hàm thì gọi lại mỗi lần hỏi. */
    root?: string | null | (() => string)
    /** Lý do $.ui.open trả isPlaced false (pane chờ vì màn hình hẹp, chưa có surface); vắng là pane được đặt. */
    paneUnplaced?: string
    /** $.ui.panes() luôn trả rỗng: mô phỏng pane đã bị đóng trước mỗi prompt (kit không phát được ui.close). */
    panesClosed?: boolean
  } = {},
): Seen {
  const clock = mock.clock(on, { now: 1000 })
  const seen: Seen = { contexts: [], steps: [], toasts: [], routed: [], agentRouted: [], routerModels: [], drift: [], statuses: [], opened: [], panes: [], clock }
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
    // Router hết giờ chờ (engine báo aborted).
    if (reply === ROUTER_TIMEOUT) return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: ZERO_USAGE } }
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
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  // Pane: "engine" giả ghi lại lần mở, nhớ pane đang mở cho $.ui.panes(), và bỏ pane khi ui.close tới được tầng dưới của mod.
  on('ui.open', (_$, e) => {
    seen.opened.push({ id: e.id, ...(e.title !== undefined ? { title: e.title } : {}), ...(e.rows !== undefined ? { rows: e.rows } : {}), ...(e.focus !== undefined ? { focus: e.focus } : {}) })
    if (!seen.panes.includes(e.id)) seen.panes.push(e.id)
    return { value: engine.paneUnplaced !== undefined ? { isPlaced: false as const, reason: engine.paneUnplaced } : { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: (engine.panesClosed ? [] : seen.panes).map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.close', (_$, e) => {
    seen.panes = seen.panes.filter(id => id !== e.id)
    return {} as never
  })
  const root = engine.root === undefined ? '/repo' : engine.root
  const rootNow = () => (typeof root === 'function' ? root() : root)
  on('session.root', () => {
    const value = rootNow()
    if (value === null) throw new Error('không có thư mục gốc')
    return { value }
  })
  on('session.cwd', () => {
    const value = rootNow()
    if (value === null) throw new Error('không có thư mục làm việc')
    return { value }
  })
  return seen
}

export async function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Chạy một step qua chuỗi hook, trả model/effort mà "engine" nhận được. */
export async function step($: Engine, seen: Seen, input: Partial<TurnStepInput> = {}) {
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

export const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
export const conductor = ($: Engine, args: string) => $.command.run({ command: 'conductor', args, ...RUN })

/** Agent của tool Agent: gọi tool.call (mod ghi điều phối), rồi engine khởi động agent đó. */
export async function spawnTool($: Engine, toolUseId: string, description: string, prompt: string) {
  await $.tool.call({ tool: 'Agent', tool_use_id: toolUseId, description, prompt })
  return $.agent.spawn({ prompt, description, tool_use_id: toolUseId } as never)
}

export const PANE = {
  plugin: 'focus-conductor',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'focus-conductor',
  props: { title: 'Focus Conductor', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
