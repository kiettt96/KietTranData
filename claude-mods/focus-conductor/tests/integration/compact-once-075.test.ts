// 0.7.5 M7 (vòng sửa 2): sau lần nén qua hook, lần đo context kế tiếp có thể còn là số cũ (trước nén); mod bỏ qua đúng một lần đo
// đó (cờ bỏ qua một lần), nên số cũ không thành mốc và lần đo đúng sau đó không bị coi là một lần nén nữa (nhắc lặp hai lần).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, step, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MARK = '[focus-conductor] Hội thoại vừa được nén.'
const MESSAGES = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]
const reminders = (out: { context?: readonly string[] }) => (out.context ?? []).filter(c => c.startsWith(MARK)).length
const readFile = ($: Engine) => $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never) as Promise<{ context?: string[] }>

function compactor(on: On, tokensAfter?: number) {
  on('session.compact', () => ({ messages: MESSAGES, ...(tokensAfter !== undefined ? { tokensAfter } : {}) }) as never)
}

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

describe('0.7.5 M7: một lần nén qua hook chỉ nhắc một lần', () => {
  for (const tokensAfter of [40_000, undefined]) {
    const label = tokensAfter === undefined ? 'engine không ghi tokensAfter' : 'có tokensAfter'
    test(`${label}: lần đo kế tiếp còn là số cũ (150k), lần sau đúng (38k): đúng một lời nhắc`, {}, async ($, on) => {
      const { seen, box } = await setup($, on, tokensAfter)
      await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
      expect(reminders(await readFile($))).toBe(1)
      box.tokens = 150_000
      await step($, seen, { turnId: 't2' })
      box.tokens = 38_000
      await step($, seen, { turnId: 't3' })
      expect(reminders(await readFile($))).toBe(0)
    })

    test(`${label}: sau lần đo bị bỏ qua, một lần nén thật không qua hook vẫn được nhận ra`, {}, async ($, on) => {
      const { seen, box } = await setup($, on, tokensAfter)
      await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
      expect(reminders(await readFile($))).toBe(1)
      box.tokens = 40_000
      await step($, seen, { turnId: 't2' })
      box.tokens = 140_000
      await step($, seen, { turnId: 't3' })
      box.tokens = 30_000
      await step($, seen, { turnId: 't4' })
      expect(reminders(await readFile($))).toBe(1)
    })
  }
})
