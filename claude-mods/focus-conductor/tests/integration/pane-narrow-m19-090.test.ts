// 0.9.0 vòng 2 M19: pane 30 và 36 cột, vi và en, mục tiêu mẫu và mục tiêu 11 bước: dòng đầu pane (tiêu đề mục) và dòng của mục Danh sách bước
// (tiêu đề, dải bước) không dài quá bề rộng tính theo ô. Đo trên cây vẽ, chỉ các dòng mod dựng theo bề rộng mà không tự xuống dòng: tiêu đề
// mục (mở bằng một ô trống, có đường kẻ) và dải bước (mở bằng ký hiệu bước). Các dòng cắt có chủ đích khác (bảng chi phí, dòng chi tiết)
// ngoài phạm vi của M19.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { cellsOf } from '../../hooks/ui/style'
import { PANE } from '../support/engine'
import { SAMPLE_OPTS, closeAll, editSample, openSample, runCheck, sampleSetup } from '../support/closing-sample'
import { longGoal } from '../support/pane-long'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))
function textLines(root: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (n === null || typeof n !== 'object') return
    const node = n as Node
    if (node.type === 'Text') {
      if (String(node.props?.['wrap'] ?? '').startsWith('truncate')) for (const line of textOf(node).split('\n')) if (/^ \S.*(?:─|\d)\s*$/.test(line) || /^[●◐○■✓✗·◇]/.test(line)) out.push(line)
      return
    }
    for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return out
}
async function overflow($: Engine, columns: number): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: 40 } } } as never)
  const lines = textLines(await pane.drawn())
  await pane.unmount()
  return lines.filter(line => cellsOf(line) > columns)
}

describe('0.9.0 vòng 2 M19: pane hẹp', () => {
  for (const lang of ['vi', 'en'] as const) {
    for (const columns of [30, 36]) {
      test(`mục tiêu mẫu, ${lang}, ${columns} cột: không dòng nào vượt bề rộng`, SAMPLE_OPTS({ uiLanguage: lang }), async ($, on) => {
        const sample = sampleSetup(on)
        await openSample($, sample)
        await editSample($)
        await runCheck($)
        await closeAll($)
        expect(await overflow($, columns)).toEqual([])
      })
      test(`mục tiêu 11 bước, ${lang}, ${columns} cột: không dòng nào vượt bề rộng`, { options: { planApproval: 'off', uiLanguage: lang } }, async ($, on) => {
        await longGoal($, on, 4)
        expect(await overflow($, columns)).toEqual([])
      })
    }
  }
})
