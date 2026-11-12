// 0.8.7 L1: prompt dài hơn 80.000 ký tự khi router của lượt là Fable (conductor fable, Fable sẵn sàng): request router chứa trọn prompt,
// không có cảnh báo "router chỉ đọc", context không có CLIPPED_CONTEXT. Fable tạm ngừng (router là option router) và conductor mặc định giữ
// như 0.8.6. Lượt đọc trọn hết giờ thì lượt dự phòng đọc request đã cắt theo trần 80.000; khi lượt đó được dùng thì có cảnh báo và CLIPPED_CONTEXT.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, ROUTER_TIMEOUT, base, plan, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const ID = 'claude-fable-5-2'
const MARK = 'DAU_CHO_GIUA_XQ'
const LONG = `Sửa luồng thanh toán. ${'a'.repeat(70_000)}${MARK}${'b'.repeat(30_000 - 22 - MARK.length)}`
const CLIPPED = 'router chưa đọc phần giữa'
const ONLY = 'router chỉ đọc'
const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit' })
const FALLBACK = plan({ goal: 'Mục tiêu theo lượt dự phòng', depth: 'substantial', volume: 'medium', kind: 'edit' })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }

const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')
const status = async ($: Engine) => String(((await $.command.run({ command: 'conductor', args: 'status', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')

function setup(on: On, reply: (model: string, n: number) => Json | string | null): Seen {
  let n = 0
  const seen: Seen = base(on, { router: () => reply(seen.routerModels.at(-1) ?? '', n++) })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

describe('0.8.7 L1: Fable đọc trọn prompt dài', () => {
  test('conductor fable, prompt 100.000 ký tự có dấu ở giữa: request router chứa dấu; không cảnh báo "router chỉ đọc"; không có CLIPPED_CONTEXT', FABLE, async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, LONG)
    expect(seen.routerModels[0]).toBe(ID)
    expect(seen.routed[0] ?? '').toContain(MARK)
    expect(await paneTexts($)).not.toContain(ONLY)
    expect(lastContext(seen)).not.toContain(CLIPPED)
  })

  test('router Fable lỗi hai lần rồi prompt 100.000 ký tự (router là option router): không chứa dấu; cảnh báo 60.000 và 20.000; có CLIPPED_CONTEXT', FABLE, async ($, on) => {
    const seen = setup(on, model => (model === ID ? null : BIG))
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'làm tiếp bước 1')
    await submit($, LONG)
    expect(seen.routerModels.at(-1)).not.toBe(ID)
    expect(seen.routed.at(-1) ?? '').not.toContain(MARK)
    expect(await paneTexts($)).toContain('router chỉ đọc 60.000 ký tự đầu và 20.000 ký tự cuối')
    expect(lastContext(seen)).toContain(CLIPPED)
  })

  test('conductor mặc định, prompt 100.000 ký tự: như 0.8.6', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, LONG)
    expect(seen.routed[0] ?? '').not.toContain(MARK)
    expect(await paneTexts($)).toContain('router chỉ đọc 60.000 ký tự đầu và 20.000 ký tự cuối')
    expect(lastContext(seen)).toContain(CLIPPED)
  })

  test('lượt đọc trọn hết giờ, lượt dự phòng nhận request đã cắt theo trần 80.000 và trả kết quả: mục tiêu theo lượt dự phòng; có cảnh báo và CLIPPED_CONTEXT', FABLE, async ($, on) => {
    const seen = setup(on, (_model, n) => (n === 0 ? ROUTER_TIMEOUT : FALLBACK))
    await submit($, LONG)
    expect(seen.routed[0] ?? '').toContain(MARK)
    expect(seen.routed[1] ?? '').not.toContain(MARK)
    expect(seen.routed[1] ?? '').toContain('lược')
    expect(await status($)).toContain('Mục tiêu theo lượt dự phòng')
    expect(await paneTexts($)).toContain('router chỉ đọc 60.000 ký tự đầu và 20.000 ký tự cuối')
    expect(lastContext(seen)).toContain(CLIPPED)
  })
})
