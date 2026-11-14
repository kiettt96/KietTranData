// 0.8.8 N6f: các ca còn thiếu của N1 tới N5, mỗi ca kèm một mẫu đột biến: chữ trên ô tô đặc khác màu nền của chính ô đó; dải pause không dịch
// theo frame; câu mức đỏ ở dòng 2 tô dải warn; pane đổi màu theo frame khi neonMotion on; ô model mờ khi xong hết; không có nút Ẩn khi tạm
// dừng; tắt quotaGuard thì status line không tính tạm dừng.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import * as S from '../../hooks/lib/state'
import { EMPTY_QUOTA, quotaSettings } from '../../hooks/lib/quota'
import { statusTextOf } from '../../hooks/ui/direction'
import { DARK_GRADIENTS, DARK_SOLIDS, colorAt } from '../../hooks/ui/neon'
import { makeBrief } from '../support/commands'
import { PANE, base, plan, step, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')
const all = (n: unknown, type: string): Node[] => (n === null || typeof n !== 'object' ? [] : [...((n as Node).type === type ? [n as Node] : []), ...((n as Node).children ?? []).flatMap(c => all(c, type))])
const leaves = (n: unknown) => all(n, 'Text').filter(t => (t.children ?? []).every(c => typeof c === 'string'))

async function band($: Engine, columns = 120): Promise<Node> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: columns, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}
async function pane($: Engine): Promise<Node> {
  const ui = await $.ui.mount(PANE as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}
const linesOf = (tree: Node): Node[] => (String(tree.props?.flexDirection) === 'column' ? kids(tree) : kids(kids(tree).at(-1) as Node))

async function running($: Engine, on: On, opts: { quota?: boolean } = {}) {
  const seen = base(on, { ...RESUME, router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small', scope: ['src/'], main: { model: 'opus', effort: 'high', why: '' } }) })
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  memoryStore(on)
  const meter = opts.quota ? quotaMeter(on, [session(10)]) : null
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 1: sửa' }, { title: 'BƯỚC 2: kiểm' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  await step($, seen)
  return { seen, meter }
}
async function pauseNow($: Engine, ctx: Awaited<ReturnType<typeof running>>) {
  ctx.meter?.set([session(97)])
  await ctx.seen.clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
}

describe('0.8.8 N6f: các ca còn thiếu', () => {
  test('chữ trên ô tô đặc khác màu nền của chính ô đó', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await running($, on)
    const filled = leaves(await band($)).filter(t => typeof t.props?.backgroundColor === 'string' && t.props?.backgroundColor !== DARK_SOLIDS.cell)
    expect(filled.length).toBeGreaterThan(0)
    for (const t of filled) expect(t.props?.color, textOf(t)).not.toBe(t.props?.backgroundColor)
  })

  test('dải pause không dịch theo frame', { options: { planApproval: 'off' } }, async ($, on) => {
    const ctx = await running($, on, { quota: true })
    await $.turn.start({ text: 'làm', turnId: 't1' })
    await pauseNow($, ctx)
    const bgs = async () => leaves(linesOf(await band($))[0] as Node).map(t => t.props?.backgroundColor).filter(c => typeof c === 'string' && c !== DARK_SOLIDS.cell)
    const a = await bgs()
    await ctx.seen.clock.advance(1_000)
    expect(a.length).toBeGreaterThan(0)
    expect(await bgs()).toEqual(a)
  })

  test('câu mức đỏ ở dòng 2 của band tô dải warn', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await running($, on)
    await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
    const first = leaves(linesOf(await band($))[1] as Node).find(t => textOf(t).trim() !== '')
    expect(first?.props?.color).toBe(colorAt(DARK_GRADIENTS.warn, 0))
  })

  test('pane đổi màu theo frame khi neonMotion on', { options: { planApproval: 'off' } }, async ($, on) => {
    const ctx = await running($, on)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
    const firstBar = async () => leaves(await pane($)).find(t => textOf(t).startsWith('\u2501'))?.props?.color
    const a = await firstBar()
    await ctx.seen.clock.advance(1_000)
    expect(a).toMatch(/^#[0-9a-f]{6}$/)
    expect(await firstBar()).not.toBe(a)
  })

  test('ô model mờ khi xong hết', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    await running($, on)
    for (const id of [1, 2]) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    const family = leaves(linesOf(await band($))[0] as Node).find(t => textOf(t) === 'opus')
    expect(family?.props?.color).toBe(DARK_SOLIDS.onCellDim)
  })

  test('không có nút Ẩn khi tạm dừng', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    const ctx = await running($, on, { quota: true })
    expect(all(await band($), 'Button').map(b => b.props?.label)).toContain('Ẩn')
    await pauseNow($, ctx)
    const labels = all(await band($), 'Button').map(b => b.props?.label)
    expect(labels).toContain('Chi tiết')
    expect(labels).not.toContain('Ẩn')
  })

  test('tắt quotaGuard: status line không tính tạm dừng', () => {
    const view = { core: S.normalizeCore({ ...S.EMPTY_CORE, brief: makeBrief({ at: 1 }), route: { family: 'opus', effort: 'high' }, plan: [{ id: 1, title: 'BƯỚC 1: sửa', status: 'doing' }] } as never), mode: 'auto', isBandHidden: false, lang: 'vi' } as never
    const quota = { ...EMPTY_QUOTA, readings: [{ kind: 'five_hour', percentUsed: 97, resetsAt: '2100-01-01T00:00:00.000Z' }] } as never
    const off = statusTextOf(view, quota, 1000, quotaSettings({ quotaGuard: false }))
    expect(off).toContain('\u2713 đúng hướng')
    expect(off).not.toContain('tạm dừng')
    expect(statusTextOf(view, quota, 1000, quotaSettings({}))).toContain('tạm dừng')
  })
})
