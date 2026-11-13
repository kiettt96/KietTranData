// 0.8.7 L3 (thay phần trần cố định của L1): mọi model router đọc trọn prompt dài tới sức chứa của lượt đó. Prompt dài hơn 80.000 ký tự vừa
// sức chứa: request router chứa trọn prompt, không cảnh báo "router chỉ đọc", context không có CLIPPED_CONTEXT, status line ghi đang đọc trọn
// prompt dài. Vượt sức chứa (routerMaxWait nhỏ): cắt, cảnh báo nêu giới hạn và tên option. Lượt đọc trọn hết giờ: lượt dự phòng đọc request
// đã cắt theo trần 80.000; khi lượt đó được dùng thì có cảnh báo và CLIPPED_CONTEXT. /conductor reroute đọc trọn prompt đã lập mục tiêu.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, ROUTER_TIMEOUT, base, plan, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const ID = 'claude-fable-5-2'
const MARK = 'DAU_CHO_GIUA_XQ'
const HUGE = `Sửa luồng thanh toán. ${'a'.repeat(120_000)}${MARK}${'b'.repeat(238_489 - 120_000 - 22 - MARK.length)}`
const LONG = `Sửa luồng thanh toán. ${'a'.repeat(70_000)}${MARK}${'b'.repeat(30_000 - 22 - MARK.length)}`
const CLIPPED = 'router chưa đọc phần giữa'
const ONLY = 'router chỉ đọc'
const WAIT_TEXT = 'router đang đọc trọn prompt dài, có thể mất vài phút...'
const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit' })
const FALLBACK = plan({ goal: 'Mục tiêu theo lượt dự phòng', depth: 'substantial', volume: 'medium', kind: 'edit' })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PLAIN = { options: { planApproval: 'off' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }

const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')

function setup(on: On, reply: (model: string, n: number) => Json | string | null): Seen {
  let n = 0
  const seen: Seen = base(on, { router: () => reply(seen.routerModels.at(-1) ?? '', n++) })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

describe('0.8.7 L3: mọi router đọc trọn prompt dài', () => {
  for (const [name, options, model] of [['conductor tắt, router mặc định', PLAIN, 'sonnet'], ['conductor fable', FABLE, ID]] as const) {
    test(`${name}, prompt 238.489 ký tự có dấu ở giữa: request chứa dấu; không cảnh báo "router chỉ đọc"; không có CLIPPED_CONTEXT; chữ chờ đọc trọn`, options, async ($, on) => {
      const seen = setup(on, () => BIG)
      await submit($, HUGE)
      expect(seen.routerModels[0]).toBe(model)
      expect((seen.routed[0] ?? '').includes(MARK)).toBe(true)
      expect(await paneTexts($)).not.toContain(ONLY)
      expect(lastContext(seen)).not.toContain(CLIPPED)
      expect(seen.statuses).toContain(WAIT_TEXT)
    })
  }

  test('router Fable lỗi hai lần rồi prompt 100.000 ký tự (router là option router): request chứa dấu; không cảnh báo', FABLE, async ($, on) => {
    const seen = setup(on, model => (model === ID ? null : BIG))
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'làm tiếp bước 1')
    await submit($, LONG)
    expect(seen.routerModels.at(-1)).not.toBe(ID)
    expect((seen.routed.at(-1) ?? '').includes(MARK)).toBe(true)
    expect(await paneTexts($)).not.toContain(ONLY)
    expect(lastContext(seen)).not.toContain(CLIPPED)
  })

  test('conductor fable, routerMaxWait 120 giây, prompt 238.489 ký tự: bị cắt; cảnh báo nêu thời gian chờ tối đa và option routerMaxWait; có CLIPPED_CONTEXT', { options: { planApproval: 'off', conductor: 'fable', routerMaxWait: 120 } }, async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, HUGE)
    expect((seen.routed[0] ?? '').includes(MARK)).toBe(false)
    const pane = await paneTexts($)
    expect(pane).toContain(ONLY)
    expect(pane).toContain('routerMaxWait')
    expect(lastContext(seen)).toContain(CLIPPED)
  })

  test('prompt ngắn: giữ chữ chờ cũ, ở cả router thường và Fable', FABLE, async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.statuses).toContain('router đang đọc prompt...')
    expect(seen.statuses.some(s => (s ?? '').includes('vài phút'))).toBe(false)
  })

  for (const [name, options] of [['router thường', PLAIN], ['Fable', FABLE]] as const) {
    test(`${name}, lượt đọc trọn hết giờ: lượt dự phòng nhận request đã cắt theo trần 80.000 và trả kết quả; mục tiêu theo lượt dự phòng; có cảnh báo và CLIPPED_CONTEXT`, options, async ($, on) => {
      const seen = setup(on, (_model, n) => (n === 0 ? ROUTER_TIMEOUT : FALLBACK))
      await submit($, LONG)
      expect((seen.routed[0] ?? '').includes(MARK)).toBe(true)
      expect((seen.routed[1] ?? '').includes(MARK)).toBe(false)
      expect((seen.routed[1] ?? '').includes('lược')).toBe(true)
      expect(seen.routerCalls[1]?.timeoutMs).toBe(120_000)
      expect(await run($, 'status')).toContain('Mục tiêu theo lượt dự phòng')
      expect(await paneTexts($)).toContain('router chỉ đọc 60.000 ký tự đầu và 20.000 ký tự cuối')
      expect(lastContext(seen)).toContain(CLIPPED)
    })
  }

  test('/conductor reroute với prompt 100.000 ký tự đã lập mục tiêu: request chứa trọn prompt', PLAIN, async ($, on) => {
    const seen = setup(on, () => BIG)
    await submit($, LONG)
    await run($, 'reroute')
    expect(seen.routed.length).toBeGreaterThanOrEqual(2)
    expect((seen.routed.at(-1) ?? '').includes(MARK)).toBe(true)
  })
})
