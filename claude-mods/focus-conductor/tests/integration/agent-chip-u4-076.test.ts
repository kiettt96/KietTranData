// 0.7.6 U4: chip lô subagent trên band chỉ hiện khi có lô đang chạy hay lỗi, dạng "N đang chạy · M lỗi"; không hiện "0/3 xong" trước khi
// giao và không hiện sau khi xong mục tiêu; tên việc được ưu tiên hơn chip khi phải cắt.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { base, plan, submit, task } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const TITLES = ['BƯỚC 0: chuẩn bị', 'BƯỚC 1: lọc tin lô 1', 'BƯỚC 2: lọc tin lô 2', 'BƯỚC 3: lọc tin lô 3', 'BƯỚC 4: tổng hợp']
const LONG = { timeoutMs: 120_000 }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')

async function firstRow($: Engine, columns: number): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 2, bodyColumns: columns, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const content = (tree.children ?? []).filter(c => c !== null && typeof c === 'object')[1] as Node
  return textOf((content.children ?? []).filter(c => c !== null && typeof c === 'object')[0])
}

async function goal($: Engine, on: On) {
  base(on, { router: () => plan({ goal: 'Lọc tin ba lô và tổng hợp', depth: 'hard', volume: 'large', tasks: TITLES.map((title, k) => task(title, k >= 1 && k <= 3 ? 'agent' : 'main', k >= 1 && k <= 3 ? 'sonnet' : 'opus', 'high')) }) })
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  await submit($, 'Lọc tin ba lô và tổng hợp')
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
}

async function batch($: Engine, step: number, n: number, outcome: 'done' | 'failed' | 'running') {
  const id = `s${step}-${n}`
  const description = `BƯỚC ${step}: lọc tin lô ${n}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'lọc', model: 'sonnet' } as never)
  await $.agent.spawn({ prompt: 'lọc', description, tool_use_id: id } as never)
  if (outcome === 'running') return
  await $.turn.start({ text: 'lọc', turnId: `a-${id}`, agentId: `ag-${id}` } as never)
  await $.turn.complete({ turnId: `a-${id}`, agentId: `ag-${id}`, answer: '', durationMs: 5, isAborted: false, reason: outcome === 'failed' ? 'error' : 'answer' } as never)
}

describe('0.7.6 U4: chip lô subagent', () => {
  test('trước khi giao: không có chip lô', async ($, on) => {
    await goal($, on)
    const row = await firstRow($, 120)
    expect(row).not.toMatch(/xong|đang chạy|lỗi/)
  })

  test('3 việc x 100 lô, 3 lô lỗi: 120 cột chip "3 lỗi"; còn lô chạy thì "2 đang chạy · 3 lỗi"', LONG, async ($, on) => {
    await goal($, on)
    for (const step of [1, 2, 3]) for (let n = 1; n <= 100; n++) await batch($, step, n, n === 50 ? 'failed' : 'done')
    expect(await firstRow($, 120)).toContain('3 lỗi')
    expect(await firstRow($, 120)).not.toMatch(/\d+\/\d+ xong/)
    await batch($, 2, 101, 'running')
    await batch($, 2, 102, 'running')
    expect(await firstRow($, 120)).toContain('2 đang chạy · 3 lỗi')
  })

  test('60 cột: tên việc được ưu tiên, chip bị bỏ trước', LONG, async ($, on) => {
    await goal($, on)
    for (const step of [1, 2, 3]) for (let n = 1; n <= 100; n++) await batch($, step, n, n === 50 ? 'failed' : 'done')
    const row = await firstRow($, 60)
    expect(row).toContain('BƯỚC 1: lọc tin lô 1')
    expect(row).not.toContain('3 lỗi')
  })

  test('xong mục tiêu: không có chip lô', LONG, async ($, on) => {
    await goal($, on)
    for (let n = 1; n <= 3; n++) await batch($, 1, n, n === 2 ? 'failed' : 'done')
    for (let id = 2; id <= TITLES.length; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    expect(await firstRow($, 120)).not.toMatch(/xong \d|\d+\/\d+ xong|đang chạy|\d lỗi/)
  })
})
