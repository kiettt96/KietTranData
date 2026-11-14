// 0.8.8 N4: pane hướng B. Tiêu đề mục là một ô tô đặc (Cần chú ý tô dải warn khi có mục mức đỏ, màu cần chú ý khi chỉ có mục mức vàng;
// Hạn mức tô dải pause khi đang dừng; mục khác theo bảng màu neon), số đếm đẩy sang phải. Đầu mục checklist có dải bước (ký hiệu và số
// thứ tự; chật thì chỉ ký hiệu, rồi cắt kèm +N; một bước thì không có dải). Hạn mức và chi phí có thanh; pane dưới 48 cột thanh còn 6 ô,
// dưới 32 cột bỏ thanh, giữ số. Giờ làm mới ở tiêu đề Hạn mức: đang dừng thì của cửa sổ gây dừng, không thì của cửa sổ đã dùng nhiều nhất.
// Các ca dùng neonMotion off để dải màu đứng yên ở frame 0.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { DARK_GRADIENTS, DARK_SOLIDS, colorAt, paintOf } from '../../hooks/ui/neon'
import { ratioRuns } from '../../hooks/ui/style'
import { resetLabel } from '../../hooks/lib/text'
import { PANE, base, plan, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'
import { longGoal, rowOf } from '../support/pane-long'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const STILL = { planApproval: 'off', neonMotion: 'off' } as const
const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')

function texts(root: unknown): Node[] {
  const out: Node[] = []
  const walk = (n: unknown) => {
    if (n === null || typeof n !== 'object') return
    if ((n as Node).type === 'Text') out.push(n as Node)
    for (const c of (n as Node).children ?? []) walk(c)
  }
  walk(root)
  return out
}
/** Màu nền của từng ô trong một Text (theo các Text con). */
const bgsOf = (n: Node): string[] => texts(n).flatMap(t => (typeof t.props?.backgroundColor === 'string' && kids(t).length === 0 ? [...textOf(t)].map(() => String(t.props?.backgroundColor)) : []))
/** Text đúng bằng tên mục (Text tên mục của tiêu đề). */
const titleNode = (root: unknown, title: string) => texts(root).find(t => textOf(t) === title && bgsOf(t).length > 0)

async function drawPane($: Engine, columns = 80, rows = 40): Promise<Node> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}

async function goal($: Engine, on: On, steps: string[]) {
  const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small', scope: ['src/'] }) })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(title => ({ title })) } as never)
  return seen
}

describe('0.8.8 N4: tiêu đề mục là ô tô đặc', () => {
  for (const columns of [80, 44, 30]) {
    test(`${columns} cột: mỗi tiêu đề mục có tên là một Text tô nền`, { options: STILL }, async ($, on) => {
      await goal($, on, ['Sửa', 'Kiểm'])
      const tree = await drawPane($, columns)
      for (const title of ['Danh sách bước', 'Chi phí', 'Ràng buộc', 'Tiêu chí chất lượng', 'Điều phối']) expect(titleNode(tree, title), title).toBeDefined()
    })
  }

  test('Cần chú ý có mục mức đỏ: tên mục tô dải warn', { options: STILL }, async ($, on) => {
    await goal($, on, ['Sửa', 'Kiểm'])
    await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
    const bgs = bgsOf(titleNode(await drawPane($), 'Cần chú ý') as Node)
    expect(bgs[0]).toBe(colorAt(DARK_GRADIENTS.warn, 1))
    for (const bg of bgs) expect(bg).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('Cần chú ý chỉ có mục mức vàng: tên mục tô màu cần chú ý', { options: STILL }, async ($, on) => {
    await goal($, on, ['Sửa', 'Kiểm'])
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    const bgs = bgsOf(titleNode(await drawPane($), 'Cần chú ý') as Node)
    expect(new Set(bgs)).toEqual(new Set([DARK_SOLIDS.attention]))
  })
})

describe('0.8.8 N4: dải bước', () => {
  test('7 bước: đúng 7 ký hiệu theo trạng thái, kèm số thứ tự; bước đang làm in đậm', { options: STILL }, async ($, on) => {
    await goal($, on, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'])
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    for (const id of [1, 2]) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'done' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 4, status: 'doing' } as never)
    const tree = await drawPane($)
    const strip = texts(tree).find(t => textOf(t) === '\u27131 \u27132 \u25CF3 \u25D04 \u25CB5 \u25CB6 \u25CB7')
    expect(strip).toBeDefined()
    const doing = kids(strip as Node).find(t => textOf(t).includes('\u25D04'))
    expect(doing?.props?.bold).toBe(true)
  })

  test('60 bước ở 44 cột: chỉ ký hiệu, cắt và ghi +N, không dài hơn bề rộng', { options: STILL }, async ($, on) => {
    await goal($, on, Array.from({ length: 60 }, (_, i) => `Bước ${i + 1}`))
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
    const tree = await drawPane($, 44)
    const strip = texts(tree).find(t => /^\u25D0\u25CB+ \+\d+$/.test(textOf(t)))
    expect(strip).toBeDefined()
    const text = textOf(strip as Node)
    expect([...text].length).toBeLessThanOrEqual(44)
    const shown = [...text.split(' ')[0] as string].length
    expect(Number(text.split('+')[1])).toBe(60 - shown)
  })

  test('một bước: không có dải bước', { options: STILL }, async ($, on) => {
    await goal($, on, ['Chỉ một bước'])
    const tree = await drawPane($)
    expect(texts(tree).some(t => /^[\u2713\u25CF\u25D0\u25A0\u25C7\u25CB–]1$/.test(textOf(t)))).toBe(false)
  })
})

describe('0.8.8 N4: thanh hạn mức', () => {
  const SESSION_RESET = '2100-01-01T05:00:00.000Z'
  const WEEK_RESET = '2100-01-08T09:00:00.000Z'
  const quotaGoal = async ($: Engine, on: On, limits: ReturnType<typeof session>[]) => {
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10, SESSION_RESET), week(10, WEEK_RESET)])
    await submit($, 'Sửa module thanh toán')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
    meter.set(limits)
    await seen.clock.advance(120_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  }
  const barLine = (tree: Node, label: string) => texts(tree).find(t => textOf(t).startsWith(label) && textOf(t).includes('%') && /[\u2501\u254C]/.test(textOf(t)))
  const filledOf = (line: Node | undefined) => [...textOf(line as Node)].filter(c => c === '\u2501').length

  test('68% và 31%: số ô tô của hai thanh đúng tỷ lệ (lệch không quá một ô); tiêu đề ghi giờ làm mới của cửa sổ dùng nhiều nhất', { options: STILL }, async ($, on) => {
    await quotaGoal($, on, [session(68, SESSION_RESET), week(31, WEEK_RESET)])
    const tree = await drawPane($)
    expect(Math.abs(filledOf(barLine(tree, 'phiên')) - Math.round(0.68 * 12))).toBeLessThanOrEqual(1)
    expect(Math.abs(filledOf(barLine(tree, 'tuần')) - Math.round(0.31 * 12))).toBeLessThanOrEqual(1)
    expect(texts(tree).some(t => /Hạn mức/.test(textOf(t)) && textOf(t).includes(`làm mới ${resetLabel(SESSION_RESET)}`))).toBe(true)
  })

  test('không dừng, tuần dùng nhiều hơn: tiêu đề ghi giờ làm mới của tuần', { options: STILL }, async ($, on) => {
    await quotaGoal($, on, [session(31, SESSION_RESET), week(70, WEEK_RESET)])
    const tree = await drawPane($)
    expect(texts(tree).some(t => /Hạn mức/.test(textOf(t)) && textOf(t).includes(`làm mới ${resetLabel(WEEK_RESET)}`))).toBe(true)
  })

  test('đang dừng vì phiên, tuần dùng nhiều hơn: tiêu đề tô dải pause, ghi giờ làm mới của phiên; thanh tô dải pause', { options: STILL }, async ($, on) => {
    await quotaGoal($, on, [session(96, SESSION_RESET), week(97, WEEK_RESET)])
    const tree = await drawPane($)
    const title = titleNode(tree, 'Hạn mức') as Node
    expect(bgsOf(title)[0]).toBe(colorAt(DARK_GRADIENTS.pause, 1))
    expect(texts(tree).some(t => /Hạn mức/.test(textOf(t)) && textOf(t).includes(`làm mới ${resetLabel(SESSION_RESET)}`))).toBe(true)
    const line = barLine(tree, 'phiên') as Node
    const first = texts(line).find(t => textOf(t).startsWith('\u2501') && kids(t).length === 0)
    expect(first?.props?.color).toBe(DARK_GRADIENTS.pause[0])
  })

  test('30 cột: không có thanh hạn mức, số phần trăm vẫn còn', { options: STILL }, async ($, on) => {
    await quotaGoal($, on, [session(68, SESSION_RESET), week(31, WEEK_RESET)])
    const tree = await drawPane($, 30)
    expect(barLine(tree, 'phiên')).toBeUndefined()
    expect(texts(tree).some(t => textOf(t).startsWith('phiên') && textOf(t).includes('68%'))).toBe(true)
  })
})

describe('0.8.8 N4: thanh chi phí', () => {
  const paint = paintOf({ palette: 'cyber', motion: 'off', theme: 'dark' })
  const filled = (usd: number) => ratioRuns(usd / 1.2, 8, paint, 'cyber').reduce((sum, r) => sum + [...r.text].filter(c => c === '\u2501').length, 0)

  test('ba nhóm 1,20, 0,52, 0,12: nhóm lớn nhất đầy; hai nhóm còn lại đúng tỷ lệ; nhóm bằng 0 không có thanh', () => {
    expect(filled(1.2)).toBe(8)
    expect(filled(0.52)).toBe(Math.round((0.52 / 1.2) * 8))
    expect(filled(0.12)).toBe(1)
    expect(filled(0)).toBe(0)
    expect(ratioRuns(0.5, 8, paint, 'cyber').reduce((sum, r) => sum + [...r.text].length, 0)).toBe(8)
  })

  for (const [columns, cells] of [[80, 8], [44, 6]] as const) {
    test(`${columns} cột: dòng chi phí có thanh ${cells} ô; 30 cột không có thanh`, { options: STILL }, async ($, on) => {
      await goal($, on, ['Sửa', 'Kiểm'])
      const row = (tree: Node) => texts(tree).find(t => /^luồng chính/.test(textOf(t)))
      const bar = (tree: Node) => [...textOf(row(tree) as Node)].filter(c => c === '\u2501' || c === '\u254C').length
      expect(bar(await drawPane($, columns))).toBe(cells)
      expect(bar(await drawPane($, 30))).toBe(0)
    })
  }
})

describe('0.8.8 N4: pane tự mở 16 dòng', () => {
  test('mục Cần chú ý và bước đang làm nằm trong 16 dòng đầu', { options: STILL }, async ($, on) => {
    await longGoal($, on, 4)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 1 pass' } as never)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } } } as never)
    const tree = await ui.drawn()
    await ui.unmount()
    for (const want of [/^\s*Cần chú ý/, /BƯỚC 4: lọc tin lô 2/]) {
      const row = rowOf(tree, want)
      expect(row, String(want)).toBeGreaterThanOrEqual(0)
      expect(row, String(want)).toBeLessThan(16)
    }
  })
})
