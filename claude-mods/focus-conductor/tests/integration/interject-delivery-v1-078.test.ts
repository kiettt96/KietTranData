// Vòng sửa 2 của 0.7.8, V1: engine báo tin chen ngang đã chèn vào turn đang chạy bằng hàng attachment queued_command với door
// `delivery` (không phải `attachment`) và origin của người gõ tin. Mod nhận cả hai door; chỉ hàng của luồng chính, đúng tên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, conductor, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = { options: { decisionLog: '/tmp/fc-delivery-v1-078.jsonl' } }
const FIRST = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'light',
  volume: 'medium',
  main: { model: 'sonnet', effort: 'medium' },
  tasks: [task('Đọc mã thanh toán', 'main', 'sonnet', 'medium'), task('Sửa hàm tính phí', 'main', 'sonnet', 'medium'), task('Viết test phí', 'agent', 'sonnet', 'medium')],
})
const RACE = plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Sửa race condition ghi cache', 'main', 'opus', 'high', { depth: 'hard' })] })
const routerWith = (later: Json) => (request: string) => (request.startsWith('Sửa luồng thanh toán') ? FIRST : later)

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
}

async function running($: Engine, seen: Seen) {
  await submit($, 'Sửa luồng thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: đọc mã' }, { title: 'Việc 2: sửa phí' }, { title: 'Việc 3: test phí' }] })
  await $.turn.start({ text: 'Sửa luồng thanh toán', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const interject = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, turnId: 't1' })
const row = ($: Engine, name: string, door: string, agentId?: string) =>
  $.session.append({ message: { type: 'attachment', name, content: [{ type: 'text', text: 'x' }] }, door, origin: { kind: 'composer' }, uuid: `v1-${name}-${door}`, ...(agentId !== undefined ? { agentId } : {}) } as never)
const noteOf = async ($: Engine, path = 'src/a.ts') => (((await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'x', new_string: 'y' } as never)) as { context?: string[] }).context ?? []).join('\n')

function logLines(on: On): () => Array<Record<string, unknown>> {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('V1: hàng queued_command door delivery', () => {
  test('door delivery, name queued_command, luồng chính: việc opus/high chuyển sang general-purpose; nhật ký interject-deliver toAgent 1', LOG, async ($, on) => {
    const lines = logLines(on)
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'queued_command', 'delivery')
    const note = await noteOf($)
    expect(note).toContain('general-purpose')
    expect(note).toContain('opus/high')
    expect(lines().find(l => l['kind'] === 'interject-deliver')).toMatchObject({ kind: 'interject-deliver', toAgent: 1 })
  })

  test('door delivery nhưng name khác (poll_events): không chuyển việc', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'poll_events', 'delivery')
    expect(await noteOf($)).not.toContain('general-purpose')
  })

  test('door delivery, name queued_command, có agentId: không chuyển việc', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Việc 3: viết test phí', prompt: 'Viết test' } as never)
    await $.agent.spawn({ prompt: 'Viết test', description: 'Việc 3: viết test phí', tool_use_id: 'u1' } as never)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'queued_command', 'delivery', 'a-u1')
    expect(await noteOf($)).not.toContain('general-purpose')
  })

  test('door attachment, name queued_command: vẫn chuyển việc', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'queued_command', 'attachment')
    expect(await noteOf($)).toContain('general-purpose')
  })
})

describe('V2: câu báo chuyển việc không rơi sang turn sau', () => {
  test('tin chèn vào turn t1, t1 kết thúc không còn lời gọi tool, t2 bắt đầu: Edit đầu của t2 không có câu báo chuyển việc', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'queued_command', 'delivery')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await $.turn.start({ text: 'tiếp', turnId: 't2' })
    const note = await noteOf($)
    expect(note).not.toContain('general-purpose')
    expect(note).not.toContain('Yêu cầu chen ngang đã vào turn đang chạy')
  })

  test('cùng turn: câu báo có ở lời gọi tool kế tiếp', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await row($, 'queued_command', 'delivery')
    expect(await noteOf($)).toContain('Yêu cầu chen ngang đã vào turn đang chạy')
  })
})

describe('V4a: việc chờ chuyển của mục tiêu cũ không áp sang mục tiêu mới', () => {
  test('tin chen ngang cho mục tiêu 1 đang chờ, người dùng đặt mục tiêu 2 bằng /conductor goal, rồi queued_command tới: không đổi run việc nào, không có interject-deliver', LOG, async ($, on) => {
    const lines = logLines(on)
    const many = plan({ goal: 'Làm việc khác', depth: 'light', volume: 'medium', main: { model: 'sonnet', effort: 'medium' }, tasks: Array.from({ length: 5 }, (_, i) => task(`Phần khác ${i + 1}`, 'main', 'sonnet', 'medium')) })
    const seen = base(on, { router: request => (request.includes('Làm việc khác') ? many : routerWith(RACE)(request)) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await conductor($, 'goal Làm việc khác')
    await row($, 'queued_command', 'delivery')
    expect(await noteOf($)).not.toContain('general-purpose')
    const shown = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(shown).not.toContain('Việc 4')
    expect(lines().some(l => l['kind'] === 'interject-deliver')).toBe(false)
  })
})

describe('V4b: tin có turnId khi chưa có mục tiêu không phải tin chen ngang', () => {
  test('prompt.submit của người có turnId khi chưa có mục tiêu: request router không có dòng "while the main model was still working", context không có khối chen ngang, không toast', {}, async ($, on) => {
    const seen = base(on, { router: () => FIRST })
    hooks(on)
    await interject($, 'Sửa luồng thanh toán')
    expect(seen.routed.length).toBe(1)
    expect(seen.routed[0]).not.toContain('while the main model was still working')
    expect((seen.contexts.at(-1) ?? []).join('\n')).not.toContain('Yêu cầu chen ngang khi đang làm')
    expect(seen.toasts.some(t => t.includes('Đã nhận yêu cầu chen ngang'))).toBe(false)
  })
})
