// 0.8.8 N6e: thanh hạn mức khi tạm dừng. Chỉ cửa sổ gây ra việc dừng dùng dải pause; cửa sổ còn lại theo mức far hay near của nó. Người dùng
// tự dừng (/conductor pause): tiêu đề mục Hạn mức tô dải pause, các thanh theo far hay near [Nguồn: chủ mod, 14/11/2026].

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { DARK_GRADIENTS, colorAt } from '../../hooks/ui/neon'
import { PANE, base, conductor, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')
const texts = (n: unknown): Node[] => (n === null || typeof n !== 'object' ? [] : [...((n as Node).type === 'Text' ? [n as Node] : []), ...((n as Node).children ?? []).flatMap(texts)])

async function drawPane($: Engine): Promise<Node> {
  const ui = await $.ui.mount(PANE as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}
/** Màu ô đầu của thanh của một cửa sổ (dòng bắt đầu bằng tên cửa sổ, có phần trăm và thanh). */
function barColor(tree: Node, label: string): unknown {
  const line = texts(tree).find(t => textOf(t).startsWith(label) && textOf(t).includes('%') && /[\u2501\u254C]/.test(textOf(t)))
  return line === undefined ? undefined : texts(line).find(t => textOf(t).startsWith('\u2501') && kids(t).length === 0)?.props?.color
}
const titleBg = (tree: Node) => texts(tree).find(t => textOf(t) === 'Hạn mức' && texts(t).some(c => typeof c.props?.backgroundColor === 'string'))

async function setup($: Engine, on: On, limits: ReturnType<typeof session>[]) {
  const seen = base(on, RESUME)
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  memoryStore(on)
  const meter = quotaMeter(on, [session(10), week(10)])
  await submit($, 'Sửa module thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
  meter.set(limits)
  await seen.clock.advance(120_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
}

describe('0.8.8 N6e: thanh hạn mức khi tạm dừng', () => {
  test('dừng vì phiên, tuần ở vùng báo mềm: phiên dải pause, tuần dải almost', { options: { planApproval: 'off', neonMotion: 'off', noticeWeekRemainingPct: 20 } }, async ($, on) => {
    await setup($, on, [session(96), week(85)])
    const tree = await drawPane($)
    expect(barColor(tree, 'phiên')).toBe(DARK_GRADIENTS.pause[0])
    expect(barColor(tree, 'tuần')).toBe(DARK_GRADIENTS.almost[0])
  })

  test('dừng vì phiên, tuần còn xa: tuần theo bảng màu đang chạy', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await setup($, on, [session(96), week(30)])
    const tree = await drawPane($)
    expect(barColor(tree, 'phiên')).toBe(DARK_GRADIENTS.pause[0])
    expect(barColor(tree, 'tuần')).toBe(DARK_GRADIENTS.cyber[0])
  })

  test('người dùng tự dừng: tiêu đề mục tô dải pause, các thanh theo far hay near', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await setup($, on, [session(40), week(30)])
    await conductor($, 'pause')
    const tree = await drawPane($)
    const title = titleBg(tree) as Node
    expect(texts(title).find(t => typeof t.props?.backgroundColor === 'string')?.props?.backgroundColor).toBe(colorAt(DARK_GRADIENTS.pause, 1))
    expect(barColor(tree, 'phiên')).toBe(DARK_GRADIENTS.cyber[0])
    expect(barColor(tree, 'tuần')).toBe(DARK_GRADIENTS.cyber[0])
  })
})
