// 0.9.0 vòng 2 L4: bắt mẫu 075-R1i (sống cả trên 14a3a85). Core đã lưu từ bản cũ có brief.dropped thì /conductor status nêu số mục bị bỏ.
// Kit không cho ghi sẵn trạng thái của mod, nên ca này chặn state.set của Core và thêm brief.dropped vào giá trị được ghi, như trạng thái
// cũ nạp lại sau hot reload.

import { describe, expect, test } from 'claude-code/testing'
import { base, conductor, plan, submit } from '../support/engine'
import { droppedItemsText } from '../../hooks/lib/text'

describe('0.9.0 vòng 2 L4: /conductor status nêu mục bị bỏ của trạng thái cũ', () => {
  test('Core có brief.dropped là 3: status có dòng droppedItemsText(3)', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit' }) })
    on('state.set', (_$, e, next) => {
      const ev = e as { key?: string; value?: { brief?: Record<string, unknown> | null } }
      if (ev.key !== 'core' || ev.value?.brief == null) return next(e)
      return next({ ...ev, value: { ...ev.value, brief: { ...ev.value.brief, dropped: 3 } } } as never)
    })
    await submit($, 'Sửa luồng thanh toán')
    const text = String((await conductor($, 'status')).text ?? '')
    expect(text).toContain(droppedItemsText(3))
  })
})
