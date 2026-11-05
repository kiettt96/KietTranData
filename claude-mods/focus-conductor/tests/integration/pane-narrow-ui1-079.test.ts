// 0.7.9 UI1: pane dưới 48 cột, tên bước có mã chỉ còn một dòng: cắt bằng hàm cắt của pane, mã đầu tên ("BƯỚC 7", "Việc 3", "K4.1")
// giữ trọn, chip model và số lô vẫn xuống dòng riêng như 0.7.6 (W3). Từ 48 cột trở lên giữ nguyên như 0.7.8. Đo trên cây đã vẽ bằng một
// bộ đo bố cục nhỏ: Text ngắt theo từ trừ khi cắt một dòng (truncate), bề ngang tính theo ô terminal (chữ CJK và emoji rộng hai ô).

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const FILL = 'đối chiếu dữ liệu đầu vào với bảng tham chiếu, ghi chú phần chênh lệch và báo lại cho nhóm phụ trách'
const CODES = ['BƯỚC 1', 'BƯỚC 2', 'Việc 3', 'Việc 4', 'K4.1', 'K4.2', 'BƯỚC 7', 'BƯỚC 8']
/** Tám bước có mã, tên dài đúng 80 ký tự. */
const TITLES = CODES.map(code => `${code}: ${FILL}`.slice(0, 80).trimEnd().padEnd(80, '.'))
// Tên có chữ CJK và emoji (viết bằng mã escape): một emoji đơn, một chuỗi emoji nối ZWJ và một emoji có bộ chọn biến thể.
const WIDE_CODES = ['BƯỚC 1', 'Việc 2', 'K4.1']
const WIDE = [
  'BƯỚC 1: 数据清洗与核对 \u{1F527} 整理输入数据并对照参考表记录差异 \u{1F469}\u{200D}\u{1F4BB} 然后通知负责小组 \u2699\uFE0F 完成',
  'Việc 2: \u{1F4E6}\u{1F4E6}\u{1F4E6} 检查每一批次的结果并汇总到周报中 \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} 再发给团队确认',
  'K4.1 汇总\u{1F4CA}报表\u{1F4CA}并核对\u{1F4CA}每个数字\u{1F4CA}直到全部一致为止\u{1F4CA}然后归档保存\u{1F4CA}留作记录',
]

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))
const kidsOf = (n: Node) => (n.children ?? []).filter((c): c is Node => c !== null && typeof c === 'object')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (text: string) => [...segmenter.segment(text)].map(s => s.segment)
const WIDE_CHAR = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/u
/** Số ô terminal: mỗi cụm ký tự một ô, chữ CJK và emoji hai ô. */
const cells = (text: string) => graphemes(text.normalize('NFC')).reduce((sum, g) => sum + (WIDE_CHAR.test(g) ? 2 : 1), 0)

/** Ngắt từ tham lam theo `width` ô. */
function wrapRows(text: string, width: number): number {
  let rows = 1
  let used = 0
  for (const word of text.split(' ').filter(Boolean)) {
    const w = cells(word)
    rows += used > 0 && used + 1 + w > width ? 1 : 0
    used = used > 0 && used + 1 + w > width ? w : used === 0 ? w : used + 1 + w
    while (used > width) {
      rows += 1
      used -= width
    }
  }
  return rows
}

const isTruncated = (n: Node) => String(n.props?.wrap ?? '').startsWith('truncate')

const widthOf = (n: Node): number => {
  if (n.type === 'Text') return cells(textOf(n))
  const row = !String(n.props?.flexDirection ?? 'row').startsWith('column')
  const gap = num(n.props?.columnGap ?? n.props?.gap)
  const sizes = kidsOf(n).map(widthOf)
  const inner = row ? sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1) : Math.max(0, ...sizes)
  return inner + num(n.props?.marginRight) + num(n.props?.paddingLeft)
}

/** Vị trí của từng nút khi bề ngang là `width` ô: dòng bắt đầu, số dòng và số ô được cấp. */
type Place = { top: number; rows: number; width: number }
function place(n: Node, width: number, top: number, out: Map<Node, Place>): number {
  const p = n.props ?? {}
  let rows: number
  if (n.type === 'Text') rows = isTruncated(n) ? 1 : wrapRows(textOf(n), width)
  else {
    const inner = width - num(p.paddingLeft) - num(p.marginRight)
    const kids = kidsOf(n)
    const before = num(p.marginTop)
    if (String(p.flexDirection ?? 'row').startsWith('column')) {
      const gap = num(p.rowGap ?? p.gap)
      let used = 0
      kids.forEach((k, i) => {
        used += i > 0 ? gap : 0
        used += place(k, inner, top + before + used, out)
      })
      rows = before + used
    } else if (p.flexWrap === 'wrap') {
      const gap = num(p.columnGap ?? p.gap)
      let lines = 1
      let used = 0
      for (const k of kids) {
        const w = widthOf(k)
        if (used > 0 && used + gap + w > inner) {
          lines += 1
          used = w
        } else used += (used > 0 ? gap : 0) + w
        place(k, w, top + before + lines - 1, out)
      }
      rows = before + lines
    } else {
      // Hàng: nút flexShrink 0 (và Text đứng thẳng trong hàng) giữ bề ngang tự nhiên, phần còn lại chia cho nút co giãn.
      const gap = num(p.columnGap ?? p.gap)
      const isFixed = (k: Node) => k.props?.flexShrink === 0 || k.type === 'Text'
      const fixed = kids.filter(isFixed)
      const flexible = kids.filter(k => !isFixed(k))
      const left = Math.max(1, inner - fixed.reduce((a, k) => a + widthOf(k), 0) - gap * Math.max(0, kids.length - 1))
      rows = before + Math.max(1, ...kids.map(k => place(k, isFixed(k) ? widthOf(k) : Math.max(1, Math.floor(left / flexible.length)), top + before, out)))
    }
  }
  out.set(n, { top, rows, width })
  return rows
}

/** Đường từ gốc tới Text đầu tiên thỏa `want` (cuối đường là Text). */
function pathTo(n: Node, want: (text: string) => boolean, path: Node[] = []): Node[] | null {
  if (n.type === 'Text' && want(textOf(n))) return [...path, n]
  for (const k of kidsOf(n)) {
    const found = pathTo(k, want, [...path, n])
    if (found) return found
  }
  return null
}

async function setup($: Engine, on: On, titles: readonly string[]) {
  base(on, { router: () => plan({ goal: 'Đối chiếu sổ giá', depth: 'hard', volume: 'large', tasks: titles.map(title => task(title, 'agent', 'sonnet', 'medium')) }) })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  await submit($, 'Đối chiếu sổ giá')
  for (const [k, title] of titles.entries()) await spawnTool($, `u${k}`, `${title} lô 1`, 'x')
  await $.tool.call({ tool: PLAN, action: 'set', steps: titles.map(title => ({ title })) })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
}

async function drawAt($: Engine, columns: number, rows: number) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } })
  const tree = (await pane.drawn()) as Node
  await pane.unmount()
  const out = new Map<Node, Place>()
  place(tree, Math.max(36, Math.min(columns, 100)), 0, out)
  return { tree, out }
}

/** Dòng bước có mã `code`: Text tên bước, hàng bước (Text nằm trong cột tên của hàng) và đường từ gốc; null khi bước không được vẽ. */
function findStep(tree: Node, code: string) {
  const path = pathTo(tree, text => text.startsWith(`${code}:`) || text.startsWith(`${code} `))
  return path ? { title: path.at(-1)!, row: path.at(-3)!, path } : null
}

function stepOf(tree: Node, code: string) {
  const found = findStep(tree, code)
  if (!found) throw new Error(`không thấy bước ${code}`)
  expect(found.row.props?.flexDirection, code).toBe('row')
  return found
}

/** Chip của bước: Text "sonnet đang chạy" trong hàng bước. */
const chipOf = (row: Node) => pathTo(row, text => text === 'sonnet đang chạy')

describe('0.7.9 UI1: tên bước một dòng ở pane hẹp', () => {
  test('40 cột, 24 dòng, 8 bước có mã tên 80 ký tự: mỗi bước không quá 2 dòng (tên và chip), thấy ít nhất 6 bước mở', async ($, on) => {
    expect(TITLES.every(title => title.length === 80)).toBe(true)
    await setup($, on, TITLES)
    const { tree, out } = await drawAt($, 40, 24)
    let visible = 0
    for (const [k, code] of CODES.entries()) {
      // Dạng gọn chỉ vẽ một phần các bước mở: bước không được vẽ là bước không thấy.
      if (findStep(tree, code) === null) continue
      const { title, row } = stepOf(tree, code)
      const box = out.get(row)!
      expect(box.rows, code).toBeLessThanOrEqual(2)
      expect(out.get(title)!.rows, code).toBe(1)
      expect(chipOf(row), code).not.toBeNull()
      // Mã đầu tên giữ trọn; tên bị cắt kết bằng dấu ba chấm của hàm cắt.
      expect(textOf(title).startsWith(`${CODES[k]}:`), code).toBe(true)
      expect(textOf(title).endsWith('…'), code).toBe(true)
      if (box.top + box.rows <= 24) visible += 1
    }
    expect(visible).toBeGreaterThanOrEqual(6)
  })

  test('47 cột (ca biên dưới 48): tên một dòng không quá bề ngang cột tên, chip nằm dòng riêng dưới tên', async ($, on) => {
    await setup($, on, TITLES)
    const { tree, out } = await drawAt($, 47, 60)
    for (const code of CODES) {
      const { title, row, path } = stepOf(tree, code)
      expect(out.get(title)!.rows, code).toBe(1)
      expect(cells(textOf(title)), code).toBeLessThanOrEqual(out.get(title)!.width)
      expect(textOf(title).startsWith(`${code}:`), code).toBe(true)
      const chip = chipOf(row)
      expect(chip, code).not.toBeNull()
      const shared = path.filter(n => chip!.includes(n)).at(-1)!
      expect(String(shared.props?.flexDirection), code).toBe('column')
      expect(out.get(row)!.rows, code).toBeLessThanOrEqual(2)
    }
  })

  test('48 cột (ca biên từ 48): như 0.7.8, tên đầy đủ ngắt dòng, chip cùng hàng với tên', async ($, on) => {
    await setup($, on, TITLES)
    const { tree } = await drawAt($, 48, 60)
    for (const [k, code] of CODES.entries()) {
      const { title, row, path } = stepOf(tree, code)
      expect(textOf(title), code).toBe(TITLES[k]!)
      expect(title.props?.wrap, code).toBe('wrap')
      const chip = chipOf(row)
      expect(chip, code).not.toBeNull()
      expect(path.filter(n => chip!.includes(n)).at(-1), code).toBe(row)
    }
  })

  test('120 cột: giữ nguyên như 0.7.8, tên đầy đủ, chip cùng hàng với tên', async ($, on) => {
    await setup($, on, TITLES)
    const { tree } = await drawAt($, 120, 60)
    for (const [k, code] of CODES.entries()) {
      const { title, row, path } = stepOf(tree, code)
      expect(textOf(title), code).toBe(TITLES[k]!)
      expect(title.props?.wrap, code).toBe('wrap')
      const chip = chipOf(row)
      expect(chip, code).not.toBeNull()
      expect(path.filter(n => chip!.includes(n)).at(-1), code).toBe(row)
    }
  })

  test('40 cột, tên chứa chữ CJK và emoji: tên một dòng không vượt bề ngang cột tên, không cắt giữa một cụm ký tự, mã giữ trọn', async ($, on) => {
    await setup($, on, WIDE)
    const { tree, out } = await drawAt($, 40, 60)
    for (const [k, full] of WIDE.entries()) {
      const code = WIDE_CODES[k]!
      const { title, row } = stepOf(tree, code)
      const shown = textOf(title)
      expect(out.get(title)!.rows, code).toBe(1)
      expect(cells(shown), code).toBeLessThanOrEqual(out.get(title)!.width)
      expect(out.get(row)!.rows, code).toBeLessThanOrEqual(2)
      expect(shown.startsWith(code), code).toBe(true)
      expect(shown.endsWith('…'), code).toBe(true)
      // Phần trước dấu ba chấm là một dãy cụm ký tự đầu của tên (không có cụm nào bị cắt đôi).
      const kept = graphemes(shown.slice(0, -1))
      expect(graphemes(full.normalize('NFC')).slice(0, kept.length).join('').trimEnd(), `${k}`).toBe(kept.join('').trimEnd())
    }
  })
})
