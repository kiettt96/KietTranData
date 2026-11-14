// 0.8.8 N6b: dòng 1 không xuống dòng. Mọi Text của ô bước có wrap="truncate-end". Ở maxRows 1 và ở band dưới 56 cột, phần không co của mỗi
// dòng không vượt bề rộng: sau các bước bỏ của N2, bỏ thêm lần lượt nút Ẩn, phần bên phải, rồi cắt nhãn ô hướng còn ký hiệu; từ 16 cột trở
// xuống bỏ cả nút Chi tiết (bước bỏ cuối cùng; mở pane bằng /conductor) [Nguồn: chủ mod, 14/11/2026].

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { base, plan, step, submit } from '../support/engine'
import { quotaMeter, session } from '../support/quota'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const GLYPHS = /[\u2713\u25CF\u25B2\u25B3\u23F8]/
const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')
const cellsOf = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s.normalize('NFC'))].length

/** Phần không co của một dòng (như test 0.6.1 mục 3.3): hộp co được không tính; Button ít nhất 10 ô. */
function fixedOf(n: unknown): number {
  if (typeof n === 'string') return cellsOf(n)
  if (n === null || typeof n !== 'object') return 0
  const node = n as Node
  if (node.type === 'Text') return cellsOf(textOf(node))
  if (node.type === 'Button') return Math.max(10, cellsOf(String(node.props?.label ?? '')) + 2)
  if (node.props?.flexShrink === 1) return 0
  const c = kids(node)
  return c.reduce((sum, k) => sum + fixedOf(k), 0) + Number(node.props?.gap ?? 0) * Math.max(0, c.length - 1)
}
const all = (n: unknown, type: string): Node[] => (n === null || typeof n !== 'object' ? [] : [...((n as Node).type === type ? [n as Node] : []), ...((n as Node).children ?? []).flatMap(c => all(c, type))])

async function band($: Engine, columns: number, maxRows: number): Promise<Node> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}
/** Các dòng của band (cột chứa các dòng; 0.8.7 có thêm cột gờ đứng trước). */
const linesOf = (tree: Node): Node[] => {
  const c = kids(tree)
  return String(tree.props?.flexDirection) === 'column' ? c : kids(c.at(-1) as Node)
}

async function running($: Engine, on: On, red: boolean) {
  const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán theo các bước có mã', depth: 'substantial', volume: 'small', scope: ['src/'], main: { model: 'opus', effort: 'high', why: '' } }) })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 1: sửa module thanh toán' }, { title: 'BƯỚC 2: kiểm' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  await step($, seen)
  await seen.clock.advance(5 * 60_000)
  if (red) await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
}

describe('0.8.8 N6b: band hẹp', () => {
  for (const red of [false, true])
    for (const columns of [8, 16, 24, 32, 40, 48])
      for (const maxRows of [1, 2])
        test(`${red ? 'mục mức đỏ' : 'đang chạy'}, ${columns} cột, maxRows ${maxRows}: phần không co không vượt bề rộng; ô hướng còn ký hiệu`, { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
          await running($, on, red)
          const tree = await band($, columns, maxRows)
          const lines = linesOf(tree)
          expect(lines.length).toBe(maxRows)
          for (const line of lines) expect(fixedOf(line), textOf(line)).toBeLessThanOrEqual(columns)
          expect(GLYPHS.test(textOf(lines[0]))).toBe(true)
          if (columns <= 16) expect(all(tree, 'Button')).toEqual([])
        })

  test('nhãn hạn mức (phần bên phải) bị bỏ ở band hẹp maxRows 1, còn ở 120 cột', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    const meter = quotaMeter(on, [session(10)])
    const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small' }) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa module thanh toán')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
    meter.set([session(92)])
    await seen.clock.advance(120_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    expect(textOf(linesOf(await band($, 120, 1))[0])).toMatch(/hạn mức|còn/)
    const narrow = linesOf(await band($, 24, 1))[0] as Node
    expect(fixedOf(narrow), textOf(narrow)).toBeLessThanOrEqual(24)
    expect(textOf(narrow)).not.toMatch(/hạn mức/)
  })

  test('mọi Text của ô bước có wrap="truncate-end"', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await running($, on, false)
    const step0 = kids(linesOf(await band($, 40, 2))[0] as Node)[0] as Node
    const texts = all(step0, 'Text')
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) expect(t.props?.wrap, textOf(t)).toBe('truncate-end')
  })

  test('48 cột: còn nút Chi tiết; 120 cột: nhãn ô hướng đầy đủ', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await running($, on, false)
    expect(all(await band($, 48, 2), 'Button').length).toBeGreaterThan(0)
    expect(textOf(linesOf(await band($, 120, 2))[0])).toContain('\u2713 Đúng hướng')
  })
})
