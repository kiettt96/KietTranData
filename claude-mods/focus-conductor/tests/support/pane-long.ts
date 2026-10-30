// Dựng mục tiêu 11 bước và đo bố cục pane như terminal, dùng chung cho test pane 16 dòng (L7, R10).

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from './engine'

export const PLAN = 'mcp__focus-conductor__plan'
export const TITLES = [
  'BƯỚC 0: chuẩn bị', 'BƯỚC 1: chuẩn hóa đơn vị', 'BƯỚC 2: chuyển dữ liệu cũ', 'BƯỚC 3: lọc tin lô 1', 'BƯỚC 4: lọc tin lô 2', 'BƯỚC 5: lọc tin lô 3',
  'BƯỚC 6: đọc và giải thích', 'BƯỚC 7: tóm tắt tin', 'BƯỚC 8: bảng giá tuần', 'BƯỚC 9: bản tổng hợp tuần', 'BƯỚC 10: kết thúc phiên',
]

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))

/** Dòng bắt đầu của Text đầu tiên khớp `want` khi dựng cây như terminal (cùng cách tính với pane-order-075); -1 nếu không có. */
export function rowOf(root: unknown, want: RegExp): number {
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

/** Mục tiêu 11 bước có mã, bước BƯỚC 3 giao subagent (3 lô), checklist `count` bước, `closed` bước đầu đã done và bước kế tiếp đang làm. */
export async function longGoal($: Engine, on: On, closed: number, count = TITLES.length, goal = 'Cập nhật sổ giá theo các bước') {
  base(on, {
    router: () =>
      plan({
        goal,
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

/** Dựng pane như pane tự mở (mặc định 16 dòng thân, như pane tự mở phía trên prompt) và trả cây vẽ cùng các dòng chữ. */
export async function drawn($: Engine, rows = 16) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } })
  const tree = await pane.drawn()
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return { tree, texts }
}

/** Tiêu đề mục checklist và mục tiến độ từng việc theo ngôn ngữ. */
export const HEADINGS = { vi: { checklist: /^Danh sách bước/, tasks: /^Tiến độ từng việc/ }, en: { checklist: /^Checklist/, tasks: /^Progress by task/ } } as const

/** Các dòng chữ của riêng mục Checklist (từ tiêu đề Checklist tới tiêu đề Tiến độ từng việc); mục sau cũng ghi tiêu đề các việc. */
export function checklistOf(texts: string[], lang: 'vi' | 'en' = 'vi'): string[] {
  const from = texts.findIndex(t => HEADINGS[lang].checklist.test(t))
  const to = texts.findIndex(t => HEADINGS[lang].tasks.test(t))
  return texts.slice(from + 1, to < 0 ? undefined : to)
}
