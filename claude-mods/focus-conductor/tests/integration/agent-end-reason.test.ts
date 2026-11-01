// 0.6.1: turn.complete của subagent. Chỉ reason 'answer' là xong; 'error', 'aborted', 'refusal' là lỗi, hoặc bị cắt nếu đang tạm
// dừng vì hạn mức (lỗi thắng cắt). Áp cho cả dòng tiến độ của agent (withAgentEnd) lẫn việc đã phân (moveDelegation), và
// 'refusal' (model từ chối, không có model dự phòng) vào danh sách việc lỗi để router chấm lại lần giao lại.

import { describe, expect, test } from 'claude-code/testing'
import type { On, TurnCompleteInput, TurnRefusal } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { FOUR, PANE, SEARCH, base, conductor, spawnTool, submit } from '../support/engine'
import { quotaMeter, session } from '../support/quota'

type Reason = TurnCompleteInput['reason']

/** Sự kiện turn.complete của một subagent đúng dạng engine: 'refusal' luôn kèm trường `refusal`, 'aborted' có isAborted. */
function ended(agentId: string, reason: Reason, refusal: TurnRefusal = { category: null, explanation: null }): TurnCompleteInput {
  const fields = { turnId: `t-${agentId}`, agentId, answer: '', durationMs: 1, isAborted: reason === 'aborted' }
  if (reason === 'refusal') return { ...fields, reason, refusal }
  return { ...fields, reason }
}

/** Mọi agent của tool Agent có agentId `a-<tool_use_id>`; Edit, Grep và Stop do "engine" trả lời. */
function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
}

const status = async ($: Engine) => String((await conductor($, 'status')).text)
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/x.ts', old_string: 'a', new_string: 'b' })

/** Các dòng chữ trong pane. Từ 0.7.6 (U1) việc 1 đi cùng bước dự kiến của nó, trạng thái ở chip "<model> <trạng thái>". */
async function paneTexts($: Engine) {
  const pane = await $.ui.mount(PANE)
  expect(await pane.drawn()).toMatchObject({ type: 'Box' })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return texts
}

const has = (texts: readonly string[], pattern: RegExp) => texts.some(t => pattern.test(t))

/** Mục tiêu bốn việc, việc 1 giao cho subagent a-u1 đang chạy. */
async function runningAgent($: Engine, on: On) {
  const seen = base(on)
  hooks(on)
  const meter = quotaMeter(on, [session(10)])
  await submit($, FOUR)
  await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
  return { seen, meter }
}

/** Vào vùng dừng vì hạn mức khi agent đang chạy: tool call của agent bị từ chối. */
async function pause($: Engine, ctx: Awaited<ReturnType<typeof runningAgent>>) {
  ctx.meter.set([session(98)])
  await ctx.seen.clock.advance(10_000)
  expect((await $.tool.call({ tool: 'Grep', pattern: 'charge', agentId: 'a-u1' } as never)).deny).toContain('hạn mức')
}

const FAILED = `1. ${SEARCH}.: lỗi, chưa giao lại`

describe('0.6.1: turn.complete của subagent, không đang dừng', () => {
  for (const reason of ['aborted', 'refusal', 'error'] as const) {
    test(`reason ${reason}: dòng tiến độ và việc đã phân là lỗi, Stop nhắc giao lại`, {}, async ($, on) => {
      await runningAgent($, on)
      await $.turn.complete(ended('a-u1', reason, { category: 'policy', explanation: 'từ chối' }))
      expect(await status($)).toContain(FAILED)
      const texts = await paneTexts($)
      expect(has(texts, /^sonnet lỗi, chưa giao lại$/)).toBe(true)
      expect(has(texts, /^sonnet xong$/)).toBe(false)
      expect(has(texts, /^sonnet bị cắt vì tạm dừng$/)).toBe(false)
      await edit($)
      expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Việc giao subagent đã lỗi, chưa giao lại: Việc 1')
    })
  }

  test('reason answer: xong cả hai nơi, không nhắc giao lại', {}, async ($, on) => {
    await runningAgent($, on)
    await $.turn.complete(ended('a-u1', 'answer'))
    expect(await status($)).toContain(`1. ${SEARCH}.: xong`)
    const texts = await paneTexts($)
    expect(has(texts, /^sonnet xong$/)).toBe(true)
    expect(has(texts, /^sonnet lỗi, chưa giao lại$/)).toBe(false)
    await edit($)
    expect(String((await $.classic.Stop({ stop_hook_active: false })).block ?? '')).not.toContain('đã lỗi, chưa giao lại')
  })
})

describe('0.6.1: turn.complete của subagent, đang tạm dừng vì hạn mức', () => {
  for (const reason of ['aborted', 'refusal', 'answer'] as const) {
    test(`reason ${reason}: dòng tiến độ là bị cắt, việc đã phân là lỗi (giao lại được)`, {}, async ($, on) => {
      const ctx = await runningAgent($, on)
      await pause($, ctx)
      await $.turn.complete(ended('a-u1', reason, { category: null, explanation: null }))
      expect(await status($)).toContain(FAILED)
      const texts = await paneTexts($)
      expect(has(texts, /^sonnet bị cắt vì tạm dừng$/)).toBe(true)
      expect(has(texts, /^sonnet lỗi, chưa giao lại$/)).toBe(false)
      expect(has(texts, /^sonnet xong$/)).toBe(false)
    })
  }

  test('reason error: lỗi thắng cắt, dòng tiến độ là lỗi chứ không phải bị cắt', {}, async ($, on) => {
    const ctx = await runningAgent($, on)
    await pause($, ctx)
    await $.turn.complete(ended('a-u1', 'error'))
    expect(await status($)).toContain(FAILED)
    const texts = await paneTexts($)
    expect(has(texts, /^sonnet lỗi, chưa giao lại$/)).toBe(true)
    expect(has(texts, /^sonnet bị cắt vì tạm dừng$/)).toBe(false)
  })
})

describe('0.6.1: giao lại việc của subagent bị từ chối hay bị ngắt', () => {
  /** Giao một việc không thuộc phân việc, cho nó kết thúc bằng `reason`, giao lại đúng việc đó: router được hỏi bao nhiêu lần. */
  async function redelegate($: Engine, on: On, reason: Reason) {
    const seen = base(on)
    hooks(on)
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    await $.agent.spawn({ prompt: 'Sửa nút lệch trên trang đăng nhập', description: 'Sửa nút lệch', tool_use_id: 'u1' } as never)
    await $.turn.complete(ended('a-u1', reason, { category: 'policy', explanation: 'từ chối' }))
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    return seen
  }

  test('refusal: router chấm lại, thấy việc đó trong danh sách đã lỗi', {}, async ($, on) => {
    const seen = await redelegate($, on, 'refusal')
    expect(seen.agentRouted.length).toBe(2)
    expect(seen.agentRouted[1]).toContain('Failed pieces in this goal:\n  - Sửa nút lệch')
  })

  test('aborted: người dùng ngắt, không phải lỗi của model; dùng lại kết quả router đã nhớ', {}, async ($, on) => {
    const seen = await redelegate($, on, 'aborted')
    expect(seen.agentRouted.length).toBe(1)
  })
})
