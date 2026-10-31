// 0.7.6 U10: trạng thái hoàn thành. Band một dòng "11/11 · 11✓ Hoàn thành: <mục tiêu> · <thời gian> · <chi phí>"; pane ẩn dòng việc chưa
// từng giao khi mọi bước đã đóng.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, step, submit, task } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const GOAL = 'Cập nhật sổ giá tuần'
const TITLES = ['BƯỚC 0: chuẩn bị', 'BƯỚC 1: lọc tin', 'BƯỚC 2: tổng hợp']
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')

async function bandRows($: Engine, columns: number, maxRows: number): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const content = (tree.children ?? []).filter(c => c !== null && typeof c === 'object')[1] as Node
  return (content.children ?? []).filter(c => c !== null && typeof c === 'object').map(textOf)
}

async function finished($: Engine, on: On) {
  const seen = base(on, { router: () => plan({ goal: GOAL, depth: 'substantial', volume: 'medium', tasks: TITLES.map((title, k) => task(title, k === 1 ? 'agent' : 'main', k === 1 ? 'sonnet' : 'opus', 'high')) }) })
  await submit($, GOAL)
  await step($, seen)
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
  for (let id = 1; id <= TITLES.length; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
  await seen.clock.advance(25 * 60_000)
}

describe('0.7.6 U10: trạng thái hoàn thành', () => {
  test('band một dòng: số bước, "Hoàn thành: <mục tiêu>", thời gian đã chạy, chi phí', async ($, on) => {
    await finished($, on)
    const rows = await bandRows($, 120, 2)
    expect(rows.length).toBe(1)
    for (const part of ['3/3', `Hoàn thành: ${GOAL}`, '25 phút', '$']) expect(rows[0], part).toContain(part)
    expect(rows[0]).not.toContain('Đã xong mọi bước')
  })

  test('pane ẩn dòng việc chưa từng giao khi mọi bước đã đóng', async ($, on) => {
    await finished($, on)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /chờ giao/ })).toBeUndefined()
    await pane.unmount()
  })
})
