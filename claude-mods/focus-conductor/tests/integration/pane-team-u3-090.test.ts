// 0.9.0 vòng 2, U3: mục Bước đóng của pane nằm trên một dòng kiểu chú giải (ký hiệu và màu theo STEP_MARK), xuống dòng theo mục khi hẹp,
// và số dòng của mục tính vào phép thử vừa pane. Ký hiệu viết bằng mã \u.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE } from '../support/engine'
import { TITLES, drawn, longGoal, rowOf } from '../support/pane-long'
import { SAMPLE_OPTS, editSample, openSample, paneText, runCheck, sampleGoal, sampleSetup } from '../support/closing-sample'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Hàng chứa các bước đóng: Box có ít nhất hai con là Text mở bằng một ký hiệu trạng thái rồi tên bước. */
function teamRow(root: unknown): Node | null {
  let found: Node | null = null
  const walk = (n: unknown) => {
    if (found !== null || n === null || typeof n !== 'object') return
    const node = n as Node
    const kids = (node.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
    if (node.type === 'Box' && kids.filter(k => k.type === 'Text' && /^[✓■○–] (?:Kiểm|Duyệt|Sẵn sàng|Check|Review|Readiness): /.test(textOf(k))).length >= 2) found = node
    else kids.forEach(walk)
  }
  walk(root)
  return found
}
const cells = (text: string) => [...text].length

describe('0.9.0 vòng 2 U3: mục Bước đóng của pane', () => {
  for (const lang of ['vi', 'en'] as const) {
    for (const closed of [0, 6, 10]) {
      test(`longGoal ${closed} bước đóng, ${lang}: dòng bước đóng và dòng bước đang làm nằm trong thân pane 16 và 24 dòng`, { options: { planApproval: 'off', uiLanguage: lang } }, async ($, on) => {
        await longGoal($, on, closed)
        for (const rows of [16, 24]) {
          const { tree } = await drawn($, rows)
          const team = rowOf(tree, lang === 'vi' ? /Sẵn sàng: / : /Readiness: /)
          const doing = rowOf(tree, new RegExp(escape(TITLES[closed]!)))
          expect(team, `${rows} dòng`).toBeGreaterThanOrEqual(0)
          expect(team, `${rows} dòng`).toBeLessThan(rows)
          expect(doing, `${rows} dòng`).toBeGreaterThanOrEqual(0)
          expect(doing, `${rows} dòng`).toBeLessThan(rows)
        }
      })
    }
  }
  test('mục tiêu mẫu, Edit rồi lệnh của bước lỗi: "\\u25a0 Kiểm: chưa đạt" và "\\u25cb Duyệt: chờ", không còn dấu chéo hay dấu chấm giữa đầu dòng', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    sample.outputs['bash tests/kiem.sh'] = { text: 'TỔNG: FAIL 1/5', isError: true }
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    const text = await paneText($)
    expect(text).toContain('■ Kiểm: chưa đạt')
    expect(text).toContain('○ Duyệt: chờ')
    expect(text).not.toContain('✗')
    expect(text.split('\n').some(line => line.startsWith('· '))).toBe(false)
  })
  test('hard, en, pane 44 cột: ba bước đóng là ba mục của một hàng xuống dòng theo mục, không mục nào quá 44 ô', SAMPLE_OPTS({ uiLanguage: 'en' }), async ($: Engine, on) => {
    const sample = sampleSetup(on, sampleGoal({ depth: 'hard' }))
    await openSample($, sample)
    await editSample($)
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 44, scroll: { offset: 0, bodyRows: 40 } } } as never)
    const row = teamRow(await pane.drawn())
    await pane.unmount()
    expect(row).not.toBeNull()
    expect(row!.props?.flexWrap).toBe('wrap')
    const items = (row!.children ?? []).filter(c => c !== null && typeof c === 'object').map(textOf)
    expect(items.length).toBe(3)
    for (const item of items) expect(cells(item)).toBeLessThanOrEqual(44)
    expect(items.reduce((sum, item) => sum + cells(item) + 2, -2)).toBeGreaterThan(44)
  })
})
