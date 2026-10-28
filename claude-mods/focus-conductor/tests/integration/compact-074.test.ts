// 0.7.4 điểm 4 (tích hợp): session.compact của luồng chính nối khối giữ mục tiêu vào instructions (cả precompute), luôn
// chuyển tiếp; lần nén thật (không precompute, không skip) đặt lời nhắc gắn một lần vào kết quả tool kế tiếp của luồng chính,
// dựng từ trạng thái lúc nhắc. Đường dự phòng: context luồng chính giảm mạnh giữa hai lần đo; hai đường không nhắc trùng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, conductor, plan, step, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MARK = '[focus-conductor] Hội thoại vừa được nén.'
const KEEP = '[focus-conductor] Bản tóm tắt phải giữ nguyên các mục sau'
const READ = { tool: 'Read', file_path: 'src/a.ts' } as const
/** Một lần nén luôn để lại ít nhất một tin nhắn (engine của kit kiểm điều này). */
const MESSAGES = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]

const router = () =>
  plan({
    goal: 'Cập nhật dữ liệu theo các bước có mã',
    constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'],
    requirements: ['Ghi lô 1', 'Ghi lô 2', 'Báo cáo cuối'],
    tasks: [task('BƯỚC 1: ghi lô 1', 'main', 'sonnet', 'medium', { covers: [1, 2] })],
  })

/** "Engine" ở đáy chuỗi session.compact: ghi instructions nhận được; `skip` trả một lần bỏ qua. */
function compactor(on: On, options: { skip?: boolean } = {}) {
  const got: Array<string | undefined> = []
  on('session.compact', (_$, e) => {
    got.push(e.instructions)
    return options.skip === true ? { skip: 'không nén' } : { messages: MESSAGES }
  })
  return got
}

const compact = ($: Engine, trigger: 'manual' | 'auto' | 'plugin' | 'precompute', over: Record<string, unknown> = {}) =>
  $.session.compact({ trigger, messages: MESSAGES, ...over } as never)

const readFile = ($: Engine, over: Record<string, unknown> = {}) => $.tool.call({ ...READ, ...over } as never) as Promise<{ context?: string[] }>
const reminders = (out: { context?: readonly string[] }) => (out.context ?? []).filter(c => c.startsWith(MARK))

async function setup($: Engine, on: On) {
  const seen = base(on, { router })
  const got = compactor(on)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  await submit($, 'Cập nhật dữ liệu theo các bước có mã')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 0: chuẩn bị' }, { title: 'BƯỚC 1: ghi lô 1' }, { title: 'BƯỚC 2: ghi lô 2' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  return { seen, got }
}

describe('0.7.4 4: instructions khi nén', () => {
  test('nối khối giữ mục tiêu sau phần instructions cũ, giữ nguyên phần cũ', {}, async ($, on) => {
    const { got } = await setup($, on)
    await compact($, 'manual', { instructions: 'giữ bảng số liệu' })
    const text = got[0] ?? ''
    expect(text.startsWith('giữ bảng số liệu\n\n' + KEEP)).toBe(true)
    expect(text).toContain('Mục tiêu: Cập nhật dữ liệu theo các bước có mã')
    expect(text).toContain('Bước còn mở: 1. BƯỚC 0: chuẩn bị; 2. BƯỚC 1: ghi lô 1; 3. BƯỚC 2: ghi lô 2')
    expect(text).toContain('Ràng buộc: Việc lọc tin chạy sonnet; Không tạo bộ kiểm mới')
    expect(text).toContain('Yêu cầu chưa có việc nào phủ: Báo cáo cuối')
  })

  test('không có instructions cũ: instructions là khối giữ mục tiêu; precompute cũng được nối', {}, async ($, on) => {
    const { got } = await setup($, on)
    await compact($, 'precompute')
    expect((got[0] ?? '').startsWith(KEEP)).toBe(true)
  })

  test('subagent nén: instructions không đổi, không đặt nhắc', {}, async ($, on) => {
    const { got } = await setup($, on)
    await compact($, 'auto', { agentId: 'agent-1', instructions: 'riêng' })
    expect(got).toEqual(['riêng'])
    expect(reminders(await readFile($))).toEqual([])
  })

  test('chưa có mục tiêu: không làm gì', {}, async ($, on) => {
    base(on)
    const got = compactor(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await compact($, 'manual')
    expect(got).toEqual([undefined])
    expect(reminders(await readFile($))).toEqual([])
  })

  test('mode off: không làm gì', { options: { routing: 'off' } }, async ($, on) => {
    base(on)
    const got = compactor(on)
    await compact($, 'manual', { instructions: 'a' })
    expect(got).toEqual(['a'])
  })
})

describe('0.7.4 4: lời nhắc sau nén', () => {
  test('nhắc đúng một lần ở tool call kế tiếp của luồng chính sau lần nén thật', {}, async ($, on) => {
    await setup($, on)
    await compact($, 'auto')
    expect(reminders(await readFile($, { agentId: 'agent-1' }))).toEqual([])
    const first = reminders(await readFile($))
    expect(first.length).toBe(1)
    expect(first[0]).toContain('Đang làm: 1. BƯỚC 0: chuẩn bị')
    expect(first[0]).toContain('Ràng buộc: Việc lọc tin chạy sonnet; Không tạo bộ kiểm mới')
    expect(reminders(await readFile($))).toEqual([])
    await compact($, 'manual')
    expect(reminders(await readFile($)).length).toBe(1)
  })

  test('precompute và skip không đặt nhắc', {}, async ($, on) => {
    const seen = base(on, { router })
    compactor(on, { skip: true })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await compact($, 'precompute')
    await compact($, 'auto')
    expect(reminders(await readFile($))).toEqual([])
    void seen
  })

  test('bước đổi giữa precompute và lần nén thật: lời nhắc theo trạng thái mới', {}, async ($, on) => {
    await setup($, on)
    await compact($, 'precompute')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
    await compact($, 'auto')
    const text = reminders(await readFile($))[0] ?? ''
    expect(text).toContain('Đang làm: 2. BƯỚC 1: ghi lô 1')
    expect(text).toContain('Bước còn mở: 2. BƯỚC 1: ghi lô 1; 3. BƯỚC 2: ghi lô 2')
    expect(text).not.toContain('BƯỚC 0')
  })
})

describe('0.7.4 4: đường dự phòng theo context giảm mạnh', () => {
  function usage(on: On) {
    const meter = { tokens: 100_000 }
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: meter.tokens, window: 200_000 }, rateLimits: [] } }) as never)
    return meter
  }

  test('context luồng chính giảm dưới ngưỡng giữa hai turn mà không có session.compact: nhắc một lần', {}, async ($, on) => {
    const seen = base(on, { router })
    const meter = usage(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await step($, seen, { turnId: 't1' })
    meter.tokens = 30_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($)).length).toBe(1)
    expect(reminders(await readFile($))).toEqual([])
  })

  test('đã nhắc theo session.compact thì lần đo context giảm sau đó không nhắc lại', {}, async ($, on) => {
    const seen = base(on, { router })
    compactor(on)
    const meter = usage(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await step($, seen, { turnId: 't1' })
    await compact($, 'auto')
    expect(reminders(await readFile($)).length).toBe(1)
    meter.tokens = 30_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($))).toEqual([])
  })

  test('context giảm ít (trên ngưỡng): không nhắc', {}, async ($, on) => {
    const seen = base(on, { router })
    const meter = usage(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await step($, seen, { turnId: 't1' })
    meter.tokens = 80_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($))).toEqual([])
  })
})

describe('0.7.4 4: biên (bắt mẫu đột biến)', () => {
  test('mục tiêu đã có rồi chuyển mode off: instructions không đổi, không nhắc', {}, async ($, on) => {
    const { got } = await setup($, on)
    await conductor($, 'mode off')
    await compact($, 'manual', { instructions: 'a' })
    expect(got).toEqual(['a'])
    await conductor($, 'mode auto')
    expect(reminders(await readFile($))).toEqual([])
  })

  test('sau một lần nén qua hook, lần context giảm mạnh kế tiếp (không có hook) vẫn nhắc', {}, async ($, on) => {
    const seen = base(on, { router })
    compactor(on)
    const meter = { tokens: 100_000 }
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: meter.tokens, window: 200_000 }, rateLimits: [] } }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await step($, seen, { turnId: 't1' })
    await compact($, 'auto')
    expect(reminders(await readFile($)).length).toBe(1)
    meter.tokens = 40_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($))).toEqual([])
    meter.tokens = 10_000
    await step($, seen, { turnId: 't3' })
    expect(reminders(await readFile($)).length).toBe(1)
  })
})

describe('0.7.4 4: danh sách phản chiếu (TodoWrite, TaskCreate) cũng được giữ qua lần nén', () => {
  type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
  const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

  function taskTools(on: On) {
    let next = 0
    on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: Todo[] }).todos } }) as never)
    on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
      next += 1
      return { result: { task: { id: String(next), subject: (e as unknown as { subject: string }).subject } } } as never
    })
  }

  async function mirrorOnly($: Engine, on: On) {
    const seen = base(on, { router })
    const got = compactor(on)
    taskTools(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    return { seen, got }
  }

  test('chỉ có TodoWrite: khối nối vào instructions và khối nhắc sau nén liệt kê bước còn mở kèm số', {}, async ($, on) => {
    const { got } = await mirrorOnly($, on)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Đọc mã', 'completed'), todo('Sửa lô 1', 'in_progress'), todo('Kiểm lô 1', 'pending')] } as never)
    await compact($, 'auto')
    expect(got[0]).toContain('Bước còn mở: 2. Sửa lô 1; 3. Kiểm lô 1')
    const text = reminders(await readFile($))[0] ?? ''
    expect(text).toContain('Đang làm: 2. Sửa lô 1')
    expect(text).toContain('Bước còn mở: 2. Sửa lô 1; 3. Kiểm lô 1')
    expect(text).not.toContain('Đọc mã')
  })

  test('chỉ có TaskCreate: cả hai khối liệt kê các việc đã tạo', {}, async ($, on) => {
    const { got } = await mirrorOnly($, on)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Lọc tin lô 1', description: 'd', activeForm: 'Lọc' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Lọc tin lô 2', description: 'd', activeForm: 'Lọc' } as never)
    await compact($, 'manual')
    expect(got[0]).toContain('Bước còn mở: 1. Lọc tin lô 1; 2. Lọc tin lô 2')
    expect(reminders(await readFile($))[0]).toContain('Bước còn mở: 1. Lọc tin lô 1; 2. Lọc tin lô 2')
  })

  test('có cả checklist plan và danh sách phản chiếu: dùng checklist plan', {}, async ($, on) => {
    const { got } = await mirrorOnly($, on)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Việc phản chiếu', 'pending')] } as never)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Bước của plan' }] } as never)
    await compact($, 'auto')
    expect(got[0]).toContain('Bước còn mở: 1. Bước của plan')
    expect(got[0]).not.toContain('Việc phản chiếu')
    expect(reminders(await readFile($))[0]).not.toContain('Việc phản chiếu')
  })

  test('danh sách phản chiếu của mục tiêu cũ không được dùng cho mục tiêu mới', {}, async ($, on) => {
    const { got } = await mirrorOnly($, on)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Việc của mục tiêu cũ', 'pending')] } as never)
    await conductor($, 'goal Làm một việc khác hẳn')
    await compact($, 'auto')
    expect(got[0]).not.toContain('Việc của mục tiêu cũ')
    expect(got[0]).not.toContain('Bước còn mở')
  })
})

describe('0.7.4 4: precompute không đặt nhắc dù không skip (bắt mẫu 074-F6)', () => {
  test('precompute trả kết quả bình thường: không nhắc; lần nén thật sau đó nhắc đúng một lần', {}, async ($, on) => {
    await setup($, on)
    await compact($, 'precompute')
    expect(reminders(await readFile($))).toEqual([])
    await compact($, 'auto')
    expect(reminders(await readFile($)).length).toBe(1)
    expect(reminders(await readFile($))).toEqual([])
  })

  test('precompute không đánh dấu đã nén qua hook: context giảm mạnh sau đó vẫn nhắc bằng đường dự phòng', {}, async ($, on) => {
    const seen = base(on, { router })
    compactor(on)
    const meter = { tokens: 100_000 }
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: meter.tokens, window: 200_000 }, rateLimits: [] } }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isReadOnly: true }))
    await submit($, 'Cập nhật dữ liệu theo các bước có mã')
    await step($, seen, { turnId: 't1' })
    await compact($, 'precompute')
    meter.tokens = 20_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($)).length).toBe(1)
  })
})
