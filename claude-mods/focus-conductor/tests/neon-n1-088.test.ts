// 0.8.8 N1: bảng màu neon và ba option. hooks/ui/neon.ts chứa mọi mã màu: dải màu lặp theo chu kỳ 24 ô, phản chiếu, nội suy tuyến tính,
// dịch một ô mỗi nhịp; bảng nền sáng giảm L của HSL tới khi đạt tương phản 4,5 trên 1 với nền trắng. neon off thì band và pane dùng theme
// key như 0.8.7, cây vẽ không có mã màu thô.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import {
  DARK_BACKGROUND,
  DARK_GRADIENTS,
  DARK_SOLIDS,
  LIGHT_GRADIENTS,
  LIGHT_SOLIDS,
  contrast,
  gradientRuns,
  neonMotionOf,
  neonPaletteOf,
  neonThemeOf,
} from '../hooks/ui/neon'
import { PANE, base, plan, submit } from './support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const HEX = /^#[0-9a-f]{6}$/
const RAW = /#|rgb\(|ansi256\(/

/** Màu của từng ô theo thứ tự: một phần tử mỗi cụm ký tự (đủ cho chuỗi một ô mỗi ký tự). */
const cellColors = (runs: { text: string; color: unknown }[]) => runs.flatMap(r => [...r.text].map(() => String(r.color)))
const cellCount = (runs: { text: string }[]) => runs.reduce((sum, r) => sum + [...r.text].length, 0)

/** Mọi giá trị color và backgroundColor của các Text trong cây. */
function paints(root: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (n === null || typeof n !== 'object') return
    const node = n as Node
    if (node.type === 'Text') for (const key of ['color', 'backgroundColor']) if (typeof node.props?.[key] === 'string') out.push(node.props[key] as string)
    for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return out
}

async function drawBand($: Engine): Promise<unknown> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: 120, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

async function drawPane($: Engine): Promise<unknown> {
  const ui = await $.ui.mount(PANE as never)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

describe('0.8.8 N1: dải màu', () => {
  test('13 ô dải cyber: ô 0 là mốc đầu, ô 12 là mốc cuối; mọi màu là hex sáu chữ số thường', () => {
    const runs = gradientRuns('\u2501'.repeat(13), DARK_GRADIENTS.cyber, 0)
    expect(cellCount(runs)).toBe(13)
    const colors = cellColors(runs)
    expect(colors[0]).toBe('#00e5ff')
    expect(colors[12]).toBe('#ff2bd6')
    for (const color of colors) expect(color).toMatch(HEX)
    // Có nội suy: ô giữa khác hai mốc đầu và cuối.
    expect(colors[3]).not.toBe('#00e5ff')
    expect(colors[9]).not.toBe('#ff2bd6')
  })

  test('frame 1 dịch đúng một ô so với frame 0; frame 24 như frame 0', () => {
    const at = (frame: number) => cellColors(gradientRuns('\u2501'.repeat(40), DARK_GRADIENTS.aurora, frame))
    const zero = at(0)
    const one = at(1)
    for (let i = 0; i < 39; i++) expect(one[i]).toBe(zero[i + 1])
    expect(at(24)).toEqual(zero)
  })

  test('chu kỳ phản chiếu: ô 24 về lại mốc đầu, nửa sau đi ngược nửa đầu', () => {
    const colors = cellColors(gradientRuns('\u2501'.repeat(25), DARK_GRADIENTS.plasma, 0))
    expect(colors[24]).toBe(colors[0])
    for (let i = 1; i < 12; i++) expect(colors[12 + i]).toBe(colors[12 - i])
  })

  test('chuỗi rỗng là mảng rỗng; chuỗi một ô là một Run; chữ tiếng Việt có dấu không bị tách đôi', () => {
    expect(gradientRuns('', DARK_GRADIENTS.cyber, 0)).toEqual([])
    const one = gradientRuns('x', DARK_GRADIENTS.cyber, 0)
    expect(one).toEqual([{ text: 'x', color: '#00e5ff' }])
    const word = 'Viê\u0323t Nam'
    const runs = gradientRuns(word, DARK_GRADIENTS.cyber, 0)
    expect(runs.map(r => r.text).join('')).toBe(word.normalize('NFC'))
    // Mỗi Run kết thúc ở ranh giới cụm ký tự: không Run nào bắt đầu bằng dấu kết hợp.
    for (const run of runs) expect(/^\p{M}/u.test(run.text)).toBe(false)
    expect(cellCount(runs)).toBe([...word.normalize('NFC')].length)
  })

  test('các ô liền nhau cùng màu gộp thành một Run', () => {
    const runs = gradientRuns('\u2501'.repeat(6), ['#00e5ff'], 0)
    expect(runs).toEqual([{ text: '\u2501'.repeat(6), color: '#00e5ff' }])
  })
})

describe('0.8.8 N1: tương phản', () => {
  test('bảng nền tối: mọi mốc và màu đơn (trừ nền ô và chữ trên ô) tương phản với #0a0b13 từ 4,5', () => {
    for (const stops of Object.values(DARK_GRADIENTS)) for (const c of stops) expect(contrast(c, DARK_BACKGROUND), c).toBeGreaterThanOrEqual(4.5)
    for (const [name, c] of Object.entries(DARK_SOLIDS)) if (name !== 'cell' && name !== 'onFill') expect(contrast(c, DARK_BACKGROUND), name).toBeGreaterThanOrEqual(4.5)
  })

  test('bảng nền sáng: mọi mốc và màu đơn tương phản với #ffffff từ 4,5; cùng tên với bảng nền tối', () => {
    expect(Object.keys(LIGHT_GRADIENTS).sort()).toEqual(Object.keys(DARK_GRADIENTS).sort())
    for (const stops of Object.values(LIGHT_GRADIENTS)) for (const c of stops) expect(contrast(c, '#ffffff'), c).toBeGreaterThanOrEqual(4.5)
    for (const [name, c] of Object.entries(LIGHT_SOLIDS)) if (name !== 'cell' && name !== 'onFill') expect(contrast(c, '#ffffff'), name).toBeGreaterThanOrEqual(4.5)
    expect(LIGHT_SOLIDS.cell).toBe('#e6e8f0')
    // Bảng nền sáng là bảng riêng: mốc đầu của cyber đã đậm hơn.
    expect(LIGHT_GRADIENTS.cyber[0]).not.toBe(DARK_GRADIENTS.cyber[0])
  })

  test('chữ trên ô tô đặc tương phản với mọi mốc của mọi dải từ 4,5, ở cả hai bảng', () => {
    for (const stops of Object.values(DARK_GRADIENTS)) for (const c of stops) expect(contrast(DARK_SOLIDS.onFill, c), c).toBeGreaterThanOrEqual(4.5)
    for (const stops of Object.values(LIGHT_GRADIENTS)) for (const c of stops) expect(contrast(LIGHT_SOLIDS.onFill, c), c).toBeGreaterThanOrEqual(4.5)
    expect(DARK_SOLIDS.onFill).toBe('#07080d')
  })
})

describe('0.8.8 N1: ba option', () => {
  test('neon nhận cyber, aurora, plasma, off; giá trị lạ, rỗng, sai kiểu là cyber', () => {
    for (const value of ['cyber', 'aurora', 'plasma', 'off']) expect(neonPaletteOf(value)).toBe(value)
    for (const value of ['', 'neon', 'Off', 'CYBER', 1, null, undefined, true]) expect(neonPaletteOf(value)).toBe('cyber')
  })

  test('neonMotion nhận on, off (mặc định on); neonTheme nhận dark, light, auto là dark (mặc định auto)', () => {
    expect(neonMotionOf('off')).toBe('off')
    for (const value of ['on', '', 'x', 0, undefined]) expect(neonMotionOf(value)).toBe('on')
    expect(neonThemeOf('light')).toBe('light')
    for (const value of ['dark', 'auto', '', 'Light', 2, undefined]) expect(neonThemeOf(value)).toBe('dark')
  })
})

describe('0.8.8 N1: neon off', () => {
  const goal = 'Sửa module thanh toán theo ba bước'
  const setup = async ($: Engine, on: Parameters<typeof base>[0]) => {
    base(on, { router: () => plan({ goal, depth: 'substantial', volume: 'small', scope: ['src/'] }) })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    await submit($, goal)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 1: sửa' }, { title: 'BƯỚC 2: kiểm' }, { title: 'BƯỚC 3: ghi' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  }
  const noRaw = (tree: unknown) => {
    const colors = paints(tree)
    expect(colors.length).toBeGreaterThan(0)
    for (const color of colors) expect(RAW.test(color), color).toBe(false)
  }

  test('đang chạy, vi phạm, xong: band và pane không có mã màu thô', { options: { planApproval: 'off', neon: 'off' } }, async ($, on) => {
    await setup($, on)
    noRaw(await drawBand($))
    noRaw(await drawPane($))
    await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
    noRaw(await drawBand($))
    noRaw(await drawPane($))
    for (let id = 1; id <= 3; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    noRaw(await drawBand($))
    noRaw(await drawPane($))
  })

  test('mặc định (cyber): band đang chạy có mã màu hex', { options: { planApproval: 'off' } }, async ($, on) => {
    await setup($, on)
    expect(paints(await drawBand($)).some(color => HEX.test(color))).toBe(true)
  })

  test('neonTheme light: mã màu của band thuộc bảng nền sáng, không thuộc bảng nền tối', { options: { planApproval: 'off', neonTheme: 'light' } }, async ($, on) => {
    await setup($, on)
    const hex = paints(await drawBand($)).filter(color => HEX.test(color))
    expect(hex.length).toBeGreaterThan(0)
    const dark = new Set([...Object.values(DARK_GRADIENTS).flat(), ...Object.values(DARK_SOLIDS)])
    for (const color of hex) expect(dark.has(color), color).toBe(false)
  })
})
