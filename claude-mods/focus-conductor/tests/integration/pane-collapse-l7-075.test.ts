// 0.7.5 L7 (vòng sửa 2): pane tự mở ở 16 dòng với checklist dài (11 bước): các bước đã đóng dồn thành một dòng tóm tắt để dòng
// tiến độ từng việc vẫn hiện trong 16 dòng đầu; checklist ngắn (từ 6 bước trở xuống) giữ nguyên từng bước.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'
import { PANE_ROWS } from '../../hooks/lib/pane'

const PLAN = 'mcp__focus-conductor__plan'
const TITLES = [
  'BƯỚC 0: chuẩn bị', 'BƯỚC 1: chuẩn hóa đơn vị', 'BƯỚC 2: chuyển dữ liệu cũ', 'BƯỚC 3: lọc tin lô 1', 'BƯỚC 4: lọc tin lô 2', 'BƯỚC 5: lọc tin lô 3',
  'BƯỚC 6: đọc và giải thích', 'BƯỚC 7: tóm tắt tin', 'BƯỚC 8: bảng giá tuần', 'BƯỚC 9: bản tổng hợp tuần', 'BƯỚC 10: kết thúc phiên',
]

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))

/** Dòng bắt đầu của Text đầu tiên khớp `want` khi dựng cây như terminal (cùng cách tính với pane-order-075). */
function rowOf(root: unknown, want: RegExp): number {
  let found = -1
  const walk = (n: unknown, top: number): number => {
    if (typeof n === 'string' || n === null || typeof n !== 'object') return 0
    const node = n as Node
    const p = node.props ?? {}
    if (node.type === 'Text') {
      if (found < 0 && want.test(textOf(node))) found = top
      return 1
    }
    const before = num(p.marginTop ?? p.marginY ?? p.margin) + num(p.paddingTop ?? p.paddingY ?? p.padding)
    const after = num(p.marginBottom ?? p.marginY ?? p.margin) + num(p.paddingBottom ?? p.paddingY ?? p.padding)
    const kids = (node.children ?? []).filter(c => c !== null && typeof c === 'object')
    const column = String(p.flexDirection ?? 'row').startsWith('column')
    let height = 0
    if (column) {
      const gap = num(p.rowGap ?? p.gap)
      kids.forEach((c, i) => { height += (i > 0 ? gap : 0) + walk(c, top + before + height + (i > 0 ? gap : 0)) })
    } else {
      for (const c of kids) height = Math.max(height, walk(c, top + before))
    }
    return before + height + after
  }
  walk(root, 0)
  return found
}

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

/** Mục tiêu 11 bước có mã, bước BƯỚC 3 giao subagent (3 lô), checklist 11 bước, `closed` bước đầu đã done và bước kế tiếp đang làm. */
async function longGoal($: Engine, on: On, closed: number, count = TITLES.length) {
  base(on, {
    router: () =>
      plan({
        goal: 'Cập nhật sổ giá theo các bước',
        depth: 'hard',
        volume: 'large',
        tasks: TITLES.map((title, k) => (k === 3 ? task(title, 'agent', 'sonnet', 'medium') : task(title, 'main', 'opus', 'high'))),
      }),
  })
  hooks(on)
  await submit($, 'Cập nhật sổ giá theo các bước')
  for (const n of [1, 2, 3]) await spawnTool($, `u${n}`, `BƯỚC 3: lọc tin lô ${n}`, 'x')
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.slice(0, count).map(title => ({ title })) })
  for (let id = 1; id <= closed; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' })
  if (closed < count) await $.tool.call({ tool: PLAN, action: 'update', step: closed + 1, status: 'doing' })
}

async function drawn($: Engine) {
  const pane = await $.ui.mount(PANE)
  const tree = await pane.drawn()
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return { tree, texts }
}

describe('0.7.5 L7: checklist dài ở pane 16 dòng', () => {
  test('11 bước, 8 bước đầu đã đóng: các bước đã đóng dồn một dòng tóm tắt, dòng đầu của tiến độ từng việc nằm trong 16 dòng đầu', {}, async ($, on) => {
    await longGoal($, on, 8)
    const { tree, texts } = await drawn($)
    expect(PANE_ROWS).toBe(16)
    expect(texts).toContain('8 bước đã đóng')
    expect(texts.some(t => /^BƯỚC 0: chuẩn bị$/.test(t))).toBe(false)
    expect(texts).toContain('BƯỚC 8: bảng giá tuần')
    expect(texts).toContain('BƯỚC 10: kết thúc phiên')
    const section = rowOf(tree, /^Tiến độ từng việc/)
    expect(section).toBeGreaterThanOrEqual(0)
    expect(section + 1).toBeLessThan(PANE_ROWS)
  })

  test('chỉ một bước đóng (tóm tắt không tiết kiệm được dòng nào): giữ nguyên từng bước', {}, async ($, on) => {
    await longGoal($, on, 1)
    const { texts } = await drawn($)
    expect(texts.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(texts).toContain('BƯỚC 0: chuẩn bị')
  })

  test('chưa có bước nào đóng: giữ nguyên từng bước, không có dòng tóm tắt', {}, async ($, on) => {
    await longGoal($, on, 0)
    const { texts } = await drawn($)
    expect(texts.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(texts).toContain('BƯỚC 0: chuẩn bị')
  })

  test('checklist 6 bước (ngắn): giữ nguyên từng bước dù đã đóng', {}, async ($, on) => {
    await longGoal($, on, 4, 6)
    const { texts } = await drawn($)
    expect(texts.some(t => /bước đã đóng$/.test(t))).toBe(false)
    expect(texts).toContain('BƯỚC 0: chuẩn bị')
  })

  test('dồn bước đã đóng không đổi số liệu tiến độ: dòng đếm 8/11 của checklist vẫn hiện', {}, async ($, on) => {
    await longGoal($, on, 8)
    const { texts } = await drawn($)
    expect(texts.some(t => /^8\/11/.test(t))).toBe(true)
  })
})
