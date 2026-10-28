// 0.7.5 C1 (gia cố, không tái hiện được lỗi như mô tả): lần nén qua hook ghi context sau nén (tokensAfter, vắng thì 0) làm mốc
// cho đường dự phòng, thay cho cờ "đã nén qua hook"; hai đường (hook, context giảm mạnh) vẫn không nhắc trùng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { createContext } from '../../hooks/context'
import { base, plan, step, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MARK = '[focus-conductor] Hội thoại vừa được nén.'
const MESSAGES = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]
const reminders = (out: { context?: readonly string[] }) => (out.context ?? []).filter(c => c.startsWith(MARK)).length
const readFile = ($: Engine) => $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never) as Promise<{ context?: string[] }>

/** "Engine" ở đáy session.compact trả số token sau nén cho trước (vắng thì không có). */
function compactor(on: On, tokensAfter?: number) {
  on('session.compact', () => ({ messages: MESSAGES, ...(tokensAfter !== undefined ? { tokensAfter } : {}) }) as never)
}

/** Số đo context luồng chính cho lần step kế tiếp. */
function meter(on: On) {
  const box = { tokens: 150_000 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: box.tokens, window: 200_000 }, rateLimits: [] } }) as never)
  return box
}

async function setup($: Engine, on: On, tokensAfter?: number) {
  const seen = base(on, { router: () => plan({ goal: 'Cập nhật dữ liệu theo các bước', depth: 'hard', volume: 'large' }) })
  compactor(on, tokensAfter)
  const box = meter(on)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  await submit($, 'Cập nhật dữ liệu theo các bước')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 0' }, { title: 'BƯỚC 1' }] } as never)
  await step($, seen, { turnId: 't1' })
  return { seen, box }
}

describe('0.7.5 C1: mốc context sau nén qua hook', () => {
  test('lần nén qua hook ghi tokensAfter làm mốc đo; vắng tokensAfter thì 0', () => {
    const ctx = createContext({})
    ctx.local.compaction.lastContext = 150_000
    ctx.noteCompacted(40_000)
    expect(ctx.local.compaction.lastContext).toBe(40_000)
    expect(ctx.local.compaction.pending).toBe(true)
    ctx.noteCompacted(undefined)
    expect(ctx.local.compaction.lastContext).toBe(0)
  })

  test('nén qua hook có tokensAfter, lần đo sau gần bằng: một lời nhắc, không nhắc trùng', {}, async ($, on) => {
    const { seen, box } = await setup($, on, 40_000)
    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    box.tokens = 38_000
    await step($, seen, { turnId: 't2' })
    expect(reminders(await readFile($))).toBe(1)
    expect(reminders(await readFile($))).toBe(0)
  })

  test('nén qua hook rồi context giảm mạnh lần nữa không qua hook: nhắc lần nữa (đường dự phòng)', {}, async ($, on) => {
    const { seen, box } = await setup($, on, 40_000)
    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    expect(reminders(await readFile($))).toBe(1)
    box.tokens = 120_000
    await step($, seen, { turnId: 't2' })
    box.tokens = 30_000
    await step($, seen, { turnId: 't3' })
    expect(reminders(await readFile($))).toBe(1)
  })
})
