// 0.8.9 C1 (tích hợp): một mục tiêu nhận các prompt tiếp nối cho tới khi có 30 ràng buộc. Không có cảnh báo "đã đầy", không có cảnh báo
// mục bị bỏ, mục cần chú ý không có mục bị bỏ, /conductor status không nêu mục bị bỏ, và request tiếp nối kế tiếp còn ràng buộc mới nhất.
// Trạng thái cũ đã lưu brief.dropped: kit test không cho ghi sẵn trạng thái của mod, nên ca này kiểm ở mức hàm rằng brief.dropped còn
// sau vòng JSON của Core (như sau hot reload); /conductor status đọc đúng trường đó bằng droppedItemsText (hooks/parts/command.ts).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as S from '../../hooks/lib/state'
import { droppedItemsText } from '../../hooks/lib/text'
import type { Core } from '../../types'
import { makeBrief } from '../support/commands'
import { PANE, base, conductor, plan, submit } from '../support/engine'

const items = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`)
const FIRST = plan({ goal: 'Cập nhật sổ giá theo nhiều bước', depth: 'hard', volume: 'large', constraints: items('Ràng buộc gốc', 6) })
const FULL = 'đã đầy'
const DROPPED = 'không giữ được'

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return texts
}

describe('0.8.9 C1: mục tiêu nhận prompt tiếp nối tới 30 ràng buộc', () => {
  test('không cảnh báo "đã đầy" hay mục bị bỏ ở toast, pane và status; request kế tiếp còn ràng buộc mới nhất', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, {
      router: request => {
        const n = /thêm ràng buộc đợt (\d+)/.exec(request)?.[1]
        if (request.includes('làm tiếp phần còn lại')) return plan({ relation: 'continue', intent: 'resume', goal: '' })
        return n === undefined ? FIRST : plan({ relation: 'refine', intent: 'amend', goal: '', constraints: items(`Ràng buộc đợt ${n}`, 6) })
      },
    })
    await submit($, 'Cập nhật sổ giá theo nhiều bước')
    for (let n = 1; n <= 4; n++) await submit($, `thêm ràng buộc đợt ${n}`)
    expect(seen.toasts.some(t => t.includes(FULL) || t.includes(DROPPED))).toBe(false)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes(FULL) || t.includes(DROPPED) || t.includes('mục bị bỏ'))).toBe(false)
    expect(String((await conductor($, 'status')).text)).not.toContain(DROPPED)
    await submit($, 'làm tiếp phần còn lại')
    const request = seen.routed.at(-1) ?? ''
    expect(request).toContain('Ràng buộc gốc 1')
    expect(request).toContain('Ràng buộc đợt 4 6')
  })

  test('trạng thái cũ có brief.dropped là 5: trường còn sau vòng JSON của Core, và status dùng droppedItemsText(5)', () => {
    const core = { ...S.EMPTY_CORE, brief: makeBrief({ dropped: 5 }) } as Core
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(reloaded.brief?.dropped).toBe(5)
    expect(droppedItemsText(5)).toContain('5 mục')
  })
})
