// 0.7.6 W3: pane hẹp (dưới 48 cột): chip model và số lô của một bước nằm dưới tên bước, trong cột tên; tên bước không bị bẻ từng chữ và mỗi
// bước chiếm không quá 2 dòng. Pane rộng (80 cột) giữ một hàng. Đo trên cây đã vẽ bằng một bộ đo bố cục nhỏ (Text ngắt theo từ, hàng chia chỗ).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'
import { PLAN, TITLES } from '../support/pane-long'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))
const kidsOf = (n: Node) => (n.children ?? []).filter((c): c is Node => c !== null && typeof c === 'object')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/** Ngắt từ tham lam theo `cells` ô; `broken` là có từ dài hơn một dòng nên bị bẻ giữa từ. */
function wrap(text: string, cells: number) {
  let rows = 1
  let used = 0
  let broken = false
  for (const word of text.split(' ').filter(Boolean)) {
    if (word.length > cells) broken = true
    const need = used === 0 ? word.length : used + 1 + word.length
    if (used > 0 && need > cells) {
      rows += 1
      used = word.length
    } else used = need
  }
  return { rows, broken }
}

const widthOf = (n: Node): number => {
  if (n.type === 'Text') return textOf(n).length
  const row = !String(n.props?.flexDirection ?? 'row').startsWith('column')
  const gap = num(n.props?.columnGap ?? n.props?.gap)
  const sizes = kidsOf(n).map(widthOf)
  const inner = row ? sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1) : Math.max(0, ...sizes)
  return inner + num(n.props?.marginRight) + num(n.props?.paddingLeft)
}

/** Số dòng và cờ bẻ giữa từ của một nút khi có `cells` ô bề ngang. */
function measure(n: Node, cells: number): { rows: number; broken: boolean } {
  if (n.type === 'Text') return wrap(textOf(n), cells)
  const p = n.props ?? {}
  const inner = cells - num(p.paddingLeft) - num(p.marginRight)
  const kids = kidsOf(n)
  if (String(p.flexDirection ?? 'row').startsWith('column')) {
    const parts = kids.map(k => measure(k, inner))
    return { rows: parts.reduce((a, b) => a + b.rows, 0), broken: parts.some(x => x.broken) }
  }
  const gap = num(p.columnGap ?? p.gap)
  if (p.flexWrap === 'wrap') {
    let rows = 1
    let used = 0
    for (const k of kids) {
      const w = widthOf(k)
      if (used > 0 && used + gap + w > inner) {
        rows += 1
        used = w
      } else used += (used > 0 ? gap : 0) + w
    }
    return { rows, broken: false }
  }
  // Hàng: các nút flexShrink 0 giữ bề ngang tự nhiên, phần còn lại chia cho nút co giãn (tối thiểu 1 ô).
  const fixed = kids.filter(k => k.props?.flexShrink === 0)
  const flexible = kids.filter(k => k.props?.flexShrink !== 0)
  const left = Math.max(1, inner - fixed.reduce((a, k) => a + widthOf(k), 0) - gap * Math.max(0, kids.length - 1))
  const parts = kids.map(k => measure(k, k.props?.flexShrink === 0 ? widthOf(k) : Math.max(1, Math.floor(left / flexible.length))))
  return { rows: Math.max(1, ...parts.map(x => x.rows)), broken: parts.some(x => x.broken) }
}

/** Đường từ gốc tới Text có chữ đúng `want` (cuối đường là Text). */
function pathTo(n: Node, want: string, path: Node[] = []): Node[] | null {
  if (n.type === 'Text' && textOf(n) === want) return [...path, n]
  for (const k of kidsOf(n)) {
    const found = pathTo(k, want, [...path, n])
    if (found) return found
  }
  return null
}

async function mountSteps($: Engine, on: Parameters<Parameters<typeof test>[1]>[1], columns: number) {
  base(on, { router: () => plan({ goal: 'Cập nhật sổ giá', depth: 'hard', volume: 'large', tasks: TITLES.map(title => task(title, 'agent', 'sonnet', 'medium')) }) })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  await submit($, 'Cập nhật sổ giá')
  for (const [k, title] of TITLES.entries()) await spawnTool($, `u${k}`, `${title} lô 1`, 'x')
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) })
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: 60 } } })
  const tree = (await pane.drawn()) as Node
  await pane.unmount()
  return tree
}

/** Hàng bước chứa tên bước `title`: tổ tiên là con trực tiếp của cột checklist (cột có đủ 11 hàng bước). */
function stepRowOf(tree: Node, title: string) {
  const path = pathTo(tree, title)
  if (!path) throw new Error(`không thấy bước ${title}`)
  const at = path.findLastIndex(n => kidsOf(n).length >= TITLES.length)
  return { row: path[at + 1]!, path }
}

describe('0.7.6 W3: dòng bước ở pane hẹp', () => {
  test('40 cột, 11 bước có lô đang chạy: mỗi bước không quá 2 dòng, tên bước không bị bẻ giữa từ', async ($, on) => {
    const tree = await mountSteps($, on, 40)
    for (const title of TITLES) {
      const { row } = stepRowOf(tree, title)
      const m = measure(row, 40)
      expect(m.broken, title).toBe(false)
      expect(m.rows, title).toBeLessThanOrEqual(2)
    }
  })

  test('40 cột: chip model và chi tiết nằm trong cột tên, dưới tên bước (chung tổ tiên gần nhất là một cột)', async ($, on) => {
    const tree = await mountSteps($, on, 40)
    for (const title of TITLES) {
      const { row, path } = stepRowOf(tree, title)
      const chip = pathTo(row, 'sonnet đang chạy')
      expect(chip, title).not.toBeNull()
      const shared = path.filter(n => chip!.includes(n)).at(-1)!
      expect(String(shared.props?.flexDirection), title).toBe('column')
      expect(kidsOf(row).length, title).toBe(2)
    }
  })

  test('80 cột: chip ở cùng hàng với tên bước, mỗi bước một dòng', async ($, on) => {
    const tree = await mountSteps($, on, 80)
    for (const title of TITLES) {
      const { row, path } = stepRowOf(tree, title)
      const chip = pathTo(row, 'sonnet đang chạy')
      expect(chip, title).not.toBeNull()
      const shared = path.filter(n => chip!.includes(n)).at(-1)!
      expect(shared, title).toBe(row)
      expect(measure(row, 80).rows, title).toBe(1)
    }
  })
})
