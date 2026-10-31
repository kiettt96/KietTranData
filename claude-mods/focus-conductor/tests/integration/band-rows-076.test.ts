// 0.7.6, band hai dòng (thiết kế đã chốt; gồm phần band của U6 và U8): dòng 1 là thanh tiến độ, số bước, mã và tên bước hiện tại; bên phải
// là chip model "opus high", thời gian đã chạy của mục tiêu, chi phí (từ 96 cột) và nút Chi tiết. Dòng 2 là một dòng cần chú ý; không có gì
// cần chú ý thì subagent đang chạy; không có nữa thì mục tiêu (mờ). maxRows 1 thì chỉ dòng 1, cảnh báo mức đỏ thế chỗ tên bước. Band không
// còn tên giai đoạn ("đang thực hiện") và không còn các dòng việc riêng (đã ở pane).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Seen } from '../support/engine'
import { base, plan, submit, task } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const TITLES = ['BƯỚC 0: chuẩn bị', 'BƯỚC 1: chuẩn hóa', 'BƯỚC 2: chuyển dữ liệu', 'BƯỚC 3: lọc tin lô 1', 'BƯỚC 4: lọc tin lô 2', 'BƯỚC 5: lọc tin lô 3', 'BƯỚC 6: tổng hợp']
const GOAL = 'Cập nhật sổ giá tuần theo các bước có mã'

const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')

/** Chữ của từng dòng band: cột nội dung là con thứ hai của hộp ngoài. */
async function bandRows($: Engine, columns: number, maxRows: number): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const content = (tree.children ?? []).filter(c => c !== null && typeof c === 'object')[1] as Node
  return (content.children ?? []).filter(c => c !== null && typeof c === 'object').map(textOf)
}

async function midGoal($: Engine, on: Parameters<typeof base>[0]): Promise<Seen> {
  const seen = base(on, { router: () => plan({ goal: GOAL, depth: 'hard', volume: 'large', main: { model: 'opus', effort: 'high', why: '' }, tasks: TITLES.map((title, k) => task(title, k === 3 ? 'agent' : 'main', k === 3 ? 'sonnet' : 'opus', 'high')) }) })
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  await submit($, GOAL)
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
  for (let id = 1; id <= 5; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 6, status: 'doing' } as never)
  await seen.clock.advance(12 * 60_000)
  return seen
}

describe('0.7.6 band hai dòng', () => {
  test('120 cột: dòng 1 có thanh, số bước, mã và tên bước, chip "opus high", thời gian đã chạy, chi phí, Chi tiết; dòng 2 là mục tiêu mờ', async ($, on) => {
    await midGoal($, on)
    const rows = await bandRows($, 120, 2)
    expect(rows.length).toBe(2)
    for (const part of ['5/7', 'BƯỚC 5: lọc tin lô 3', 'opus', 'high', '12 phút', '$', 'Chi tiết']) expect(rows[0], part).toContain(part)
    expect(rows[0]).not.toContain(GOAL)
    expect(rows.join('\n')).not.toContain('đang thực hiện')
    expect(rows[1]).toContain(GOAL)
  })

  test('maxRows 6 vẫn chỉ hai dòng: không còn các dòng việc riêng', async ($, on) => {
    await midGoal($, on)
    expect((await bandRows($, 120, 6)).length).toBe(2)
  })

  test('72 cột: không có chi phí; 96 cột trở lên: có', async ($, on) => {
    await midGoal($, on)
    expect((await bandRows($, 72, 2))[0]).not.toContain('$')
    expect((await bandRows($, 96, 2))[0]).toContain('$')
  })

  test('không có gì cần chú ý mà có subagent đang chạy: dòng 2 là subagent đang chạy', async ($, on) => {
    await midGoal($, on)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'r1', description: 'BƯỚC 3: lọc tin lô 1', prompt: 'lọc', model: 'sonnet' } as never)
    await $.agent.spawn({ prompt: 'lọc', description: 'BƯỚC 3: lọc tin lô 1', tool_use_id: 'r1' } as never)
    const rows = await bandRows($, 120, 2)
    expect(rows[1]).toContain('đang chạy')
    expect(rows[1]).toContain('BƯỚC 3: lọc tin lô 1')
  })

  test('maxRows 1: chỉ dòng 1; cảnh báo mức đỏ (ngoài phạm vi) thế chỗ tên bước', async ($, on) => {
    base(on, { router: () => plan({ goal: GOAL, depth: 'substantial', volume: 'small', scope: ['src/'] }) })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    await submit($, GOAL)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 0: sửa' }, { title: 'BƯỚC 1: kiểm' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
    expect((await bandRows($, 120, 1))[0]).toContain('BƯỚC 0: sửa')
    await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
    const rows = await bandRows($, 120, 1)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('ngoài phạm vi')
    expect(rows[0]).not.toContain('BƯỚC 0: sửa')
  })
})
