// 0.8.7 M1 (tích hợp): router nhận alias ở mọi engine; luồng chính nhận alias khi engine từ 2.1.323 ($.session.version), engine cũ hơn
// hay không đọc được phiên bản thì nhận ID ghim như 0.8.6; lời gọi Agent giữ alias như 0.8.6. Engine phục vụ ID khác ID ghim của họ:
// một cảnh báo model cho mỗi họ trong phiên, dòng "Model đang dùng" ở /conductor status, chi phí vẫn theo giá của họ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BIG_USAGE, COMPLEX_PROMPT, PANE, base, conductor, plan, step, submit } from '../support/engine'
import { addUsage, emptyLedger, formatCost } from '../../hooks/lib/ledger'

const OPUS_MAIN = plan({ goal: 'Sửa luồng thanh toán', depth: 'moderate', volume: 'medium', kind: 'edit', main: { model: 'opus', effort: 'high', why: 'khó' } })
const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit' })
const version = (on: On, value: string) => on('session.version', () => ({ value: { version: value } }) as never)
const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text)

describe('0.8.7 M1: alias ở router, luồng chính và Agent', () => {
  test('router mặc định nhận model là alias sonnet', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => OPUS_MAIN })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.routerModels[0]).toBe('sonnet')
  })

  test('conductor fable: router nhận alias fable', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const seen = base(on, { router: () => BIG })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.routerModels[0]).toBe('fable')
  })

  for (const [engine, expected] of [['2.1.323', 'opus'], ['2.1.1000', 'opus'], ['2.1.296', 'claude-opus-5-5'], ['2.1.322', 'claude-opus-5-5']] as const) {
    test(`engine ${engine}: luồng chính router chọn opus nhận ${expected}`, { options: { planApproval: 'off' } }, async ($, on) => {
      const seen = base(on, { router: () => OPUS_MAIN })
      version(on, engine)
      await submit($, 'Sửa luồng thanh toán')
      expect((await step($, seen, { model: 'claude-sonnet-5-5' }))?.model).toBe(expected)
    })
  }

  test('engine không trả phiên bản: luồng chính nhận ID ghim như 0.8.6', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => OPUS_MAIN })
    await submit($, 'Sửa luồng thanh toán')
    expect((await step($, seen, { model: 'claude-sonnet-5-5' }))?.model).toBe('claude-opus-5-5')
  })

  test('conductor fable, engine 2.1.323, mục tiêu lớn: luồng chính nhận alias fable', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const seen = base(on, { router: () => BIG })
    version(on, '2.1.323')
    await submit($, 'Sửa luồng thanh toán')
    expect((await step($, seen, { model: 'claude-sonnet-5-5' }))?.model).toBe('fable')
  })

  test('lời gọi Agent giữ alias như 0.8.6', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on)
    version(on, '2.1.323')
    const calls: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập.', model: 'sonnet' } as never)
    expect(calls[0]).toBe('sonnet')
  })
})

describe('0.8.7 M1: ID engine phục vụ khác ID ghim', () => {
  test('claude-opus-9-9 cho họ opus: đúng một cảnh báo dù nhiều turn; status có dòng Model đang dùng; chi phí theo giá opus', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => OPUS_MAIN })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa luồng thanh toán')
    for (const turnId of ['t1', 't2', 't3']) await $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-opus-9-9' } } as never)
    const pane = await paneTexts($)
    expect(pane.filter(t => t.includes('claude-opus-9-9') && t.includes('prices')).length).toBe(1)
    const status = String((await conductor($, 'status')).text)
    const line = status.split('\n').find(l => l.startsWith('Model đang dùng')) ?? ''
    expect(line).toContain('opus claude-opus-9-9')
    let ledger = emptyLedger(0)
    for (let i = 0; i < 3; i++) ledger = addUsage(ledger, 'main', 'opus', BIG_USAGE).ledger
    expect(status).toContain(`luồng chính ${formatCost(ledger.session.main.usd, 'vi')} trong 3 lượt`)
  })

  test('ID trùng ID ghim: không cảnh báo; họ chưa được gọi không có trong dòng Model đang dùng', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => OPUS_MAIN })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    const pane = await paneTexts($)
    expect(pane.some(t => t.includes('prices') && t.includes('claude-sonnet-5-5'))).toBe(false)
    const status = String((await conductor($, 'status')).text)
    const line = status.split('\n').find(l => l.startsWith('Model đang dùng')) ?? ''
    expect(line).toContain('sonnet claude-sonnet-5-5')
    expect(line.includes('opus')).toBe(false)
  })
})
