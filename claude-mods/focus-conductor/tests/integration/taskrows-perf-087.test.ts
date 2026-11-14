// 0.8.7: taskRows (hooks/lib/progress.ts) tính việc của từng bước và việc của bước doing một lần cho mọi việc, thay vì tính lại cho từng
// việc (chậm theo bậc ba của số việc). Kết quả dựng band và pane của mục tiêu không quá 20 việc phải trùng 45b5161 (0.8.6): ca này ghim
// sha256 chữ của band (56, 72, 120 cột) và pane (16, 24, 40 dòng) đo trên 45b5161 bằng engine 2.1.296.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, step, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = 'Mục tiêu giả mười hai việc'
const TASKS = Array.from({ length: 12 }, (_, i) => task(`Việc giả ${i + 1}`, i % 4 === 3 ? 'agent' : 'main', i % 4 === 3 ? 'haiku' : 'sonnet', i % 4 === 3 ? 'low' : 'medium', { kind: i % 4 === 3 ? 'investigate' : 'edit' }))
const STEPS = ['Việc 1: bước đầu', 'Việc 1: bước sau', 'Việc 2: sửa', 'Việc 3: sửa', 'Việc 5: sửa', 'Kiểm chung', 'Việc 6: sửa', 'Việc 9: sửa']

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')
async function bandText($: Engine, columns: number): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: columns, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return textOf(tree)
}
async function paneText($: Engine, rows: number): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never)
  const text = (await ui.findAll({ type: 'Text' })).map(e => String(e.text)).join('\n')
  await ui.unmount()
  return text
}
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/** sha256 của chữ band và pane, đo trên 45b5161. */
const BASE_SHA = 'f10de6b917dd73cbef9f2ca6cd6efb62e90ca0b4fe2b19572ec363245504511b'

describe('0.8.7: taskRows tính một lần cho mọi việc', () => {
  test('mục tiêu 12 việc, checklist có bước "Việc N", bước doing và bước đã xong: chữ band và pane trùng 0.8.6', { options: { planApproval: 'off', neon: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: GOAL, depth: 'substantial', volume: 'large', kind: 'edit', tasks: TASKS }) })
    await submit($, GOAL)
    await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS.map(title => ({ title })) } as never)
    for (const id of [1, 2, 3]) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 4, status: 'doing' } as never)
    await step($, seen)
    const parts: string[] = []
    for (const columns of [56, 72, 120]) parts.push(await bandText($, columns))
    for (const rows of [16, 24, 40]) parts.push(await paneText($, rows))
    const all = parts.join('\n---\n')
    expect(await sha(all)).toBe(BASE_SHA)
  })
})
