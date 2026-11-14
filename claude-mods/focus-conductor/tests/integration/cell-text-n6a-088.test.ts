// 0.8.8 N6a: chữ trên nền thô dùng màu thô. Neon khác off thì mọi chữ nằm trên nền ô thường (paint.solid('cell')) hay nền ô tô đặc có màu
// là mã màu thô, không theo theme key hay dimColor: chữ thường đạt tương phản từ 4,5 trên 1 với nền thật của chính ô đó, chữ mờ (onCellDim)
// từ 3 trên 1. Áp cho cả nhãn ô hướng không tô đặc (màu ok và attention), ở cả hai bảng. neon off: cây không có mã màu thô.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { DARK_SOLIDS, LIGHT_SOLIDS, contrast } from '../../hooks/ui/neon'
import { base, conductor, plan, step, submit } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const HEX = /^#[0-9a-f]{6}$/
type Leaf = { text: string; bg: string; color: unknown; dim: boolean }

/** Mọi đoạn chữ (không chỉ khoảng trắng) nằm trên nền mã màu thô, với nền, màu chữ và cờ mờ thừa hưởng từ các Text bao ngoài. */
function leavesOnRaw(root: unknown): Leaf[] {
  const out: Leaf[] = []
  const walk = (n: unknown, bg: unknown, color: unknown, dim: boolean) => {
    if (typeof n === 'string') {
      if (n.trim() !== '' && typeof bg === 'string' && HEX.test(bg)) out.push({ text: n, bg, color, dim })
      return
    }
    if (n === null || typeof n !== 'object') return
    const node = n as Node
    const p = node.props ?? {}
    const isText = node.type === 'Text'
    const nb = isText && p.backgroundColor !== undefined ? p.backgroundColor : bg
    const nc = isText && p.color !== undefined ? p.color : color
    const nd = isText && p.dimColor === true ? true : dim
    for (const c of node.children ?? []) walk(c, nb, nc, nd)
  }
  walk(root, undefined, undefined, false)
  return out
}

async function band($: Engine, columns = 120): Promise<Node> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: columns, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}

async function running($: Engine, on: On) {
  const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small', scope: ['src/'], main: { model: 'opus', effort: 'high', why: '' } }) })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'BƯỚC 1: sửa' }, { title: 'BƯỚC 2: kiểm' }, { title: 'BƯỚC 3: ghi' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
  await step($, seen)
  return seen
}

const check = (leaves: Leaf[], solids: typeof DARK_SOLIDS) => {
  expect(leaves.length).toBeGreaterThan(0)
  for (const leaf of leaves) {
    expect(leaf.dim, leaf.text).toBe(false)
    expect(String(leaf.color), leaf.text).toMatch(HEX)
    const min = leaf.color === solids.onCellDim ? 3 : 4.5
    expect(contrast(String(leaf.color), leaf.bg), `${leaf.text} ${String(leaf.color)} trên ${leaf.bg}`).toBeGreaterThanOrEqual(min)
  }
}

describe('0.8.8 N6a: màu onCell, onCellDim', () => {
  test('mỗi bảng có onCell (từ 4,5 với nền ô) và onCellDim (từ 3 với nền ô)', () => {
    for (const solids of [DARK_SOLIDS, LIGHT_SOLIDS]) {
      expect(solids.onCell).toMatch(HEX)
      expect(solids.onCellDim).toMatch(HEX)
      expect(contrast(solids.onCell, solids.cell)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(solids.onCellDim, solids.cell)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('0.8.8 N6a: chữ trên nền thô của band', () => {
  for (const [theme, solids] of [['dark', DARK_SOLIDS], ['light', LIGHT_SOLIDS]] as const) {
    test(`${theme}: đang chạy (ô bước tô đặc, ô model và ô hướng thường)`, { options: { planApproval: 'off', neonMotion: 'off', neonTheme: theme } }, async ($, on) => {
      await running($, on)
      check(leavesOnRaw(await band($)), solids)
    })

    test(`${theme}: mục mức đỏ (ô hướng tô đặc, ô bước và ô model thường)`, { options: { planApproval: 'off', neonMotion: 'off', neonTheme: theme } }, async ($, on) => {
      await running($, on)
      await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
      check(leavesOnRaw(await band($)), solids)
    })

    test(`${theme}: xong mà còn bước done (nhãn ô hướng màu cần chú ý trên nền ô, ô model mờ)`, { options: { planApproval: 'off', neonMotion: 'off', neonTheme: theme } }, async ($, on) => {
      await running($, on)
      await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
      await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
      await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'npm test: 12 pass' } as never)
      await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' } as never)
      await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'done' } as never)
      check(leavesOnRaw(await band($)), solids)
    })

    test(`${theme}: chế độ suggest (nhãn gợi ý trên nền ô)`, { options: { planApproval: 'off', neonMotion: 'off', neonTheme: theme } }, async ($, on) => {
      on('command.register', () => ({ value: { command: 'conductor' } }))
      await running($, on)
      await conductor($, 'mode suggest')
      const tree = await band($)
      expect(JSON.stringify(tree)).toContain('đề xuất')
      check(leavesOnRaw(tree), solids)
    })
  }

  test('neon off: không có chữ nào trên nền mã màu thô', { options: { planApproval: 'off', neon: 'off' } }, async ($, on) => {
    await running($, on)
    expect(leavesOnRaw(await band($))).toEqual([])
  })
})
