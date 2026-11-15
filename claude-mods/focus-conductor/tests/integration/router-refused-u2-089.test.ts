// 0.8.9 U2 (tích hợp): engine từ chối request gửi router thì router có đường lùi. Fable bị từ chối: họ dự phòng (opus) đọc prompt, chi phí
// tính theo giá opus, bộ đếm lỗi của fable tăng một. Engine chỉ từ chối request đọc trọn (maxTokens trên 16.000): request cắt theo trần cũ
// đọc prompt, có cảnh báo prompt bị lược. Bộ đếm của fable đang ở 1 mà fallback cứu được lượt bị từ chối: không tạm ngừng, bộ đếm về 0.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { addUsage, emptyLedger, formatCost } from '../../hooks/lib/ledger'
import { PANE, ROUTER_USAGE, allowlistRefusal, base, plan, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const GOAL = 'Mục tiêu router đọc được'
const LONG = `Sửa luồng thanh toán. ${'a'.repeat(100_000 - 22)}`
const FAIL = 'không đọc được prompt'
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }

const prompts = (seen: Seen) => seen.requests.filter(r => r.kind === 'prompt')
const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')
const isFable = (model: string) => model.includes('fable')

describe('0.8.9 U2: engine từ chối request gửi router', () => {
  test('conductor fable, engine từ chối mọi request gửi họ fable: opus đọc prompt; context có bản đọc; chi phí theo giá opus; bộ đếm lỗi của fable tăng một', FABLE, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => (isFable(call.model) ? allowlistRefusal(call.model) : null) })
    await submit($, 'Sửa luồng thanh toán')
    expect(prompts(seen).map(r => r.model)).toEqual(['fable', 'opus'])
    expect(lastContext(seen)).toContain(GOAL)
    expect(seen.toasts.some(t => t.includes(FAIL))).toBe(false)
    const usd = addUsage(emptyLedger(0), 'analyzer', 'opus', ROUTER_USAGE).ledger.session.analyzer.usd
    expect(Math.abs(usd - 0.014)).toBeLessThan(1e-9)
    expect(await run($, 'status')).toContain(`router ${formatCost(usd, 'vi')} trong 1 lượt`)
    // Bộ đếm lỗi của fable đang ở 1: một lần lỗi nữa thì router fable tạm ngừng, prompt kế không gửi fable.
    await submit($, 'làm tiếp bước 1')
    const before = prompts(seen).length
    await submit($, 'làm tiếp bước 2')
    expect(prompts(seen).slice(before).some(r => isFable(r.model))).toBe(false)
  })

  test('engine chỉ từ chối request có maxTokens trên 16.000, prompt 100.000 ký tự: request cắt theo trần cũ đọc prompt; có cảnh báo prompt bị lược; mục tiêu không tối thiểu', FABLE, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: GOAL }), refuse: call => ((call.maxTokens ?? 0) > 16_000 ? `maxTokens ${call.maxTokens} is past what claude-fable-5-2 can produce in one reply (16000)` : null) })
    await submit($, LONG)
    const sent = prompts(seen)
    expect(sent.length).toBe(2)
    expect(sent[0]?.maxTokens).toBe(64_000)
    expect(sent[1]?.maxTokens ?? Infinity).toBeLessThanOrEqual(16_000)
    expect(sent[1]?.timeoutMs).toBe(120_000)
    expect(await paneTexts($)).toContain('router chỉ đọc')
    expect(lastContext(seen)).toContain(GOAL)
    expect(seen.toasts.some(t => t.includes(FAIL))).toBe(false)
  })

  test('bộ đếm lỗi của fable đang ở 1, engine từ chối lượt đọc trọn, fallback cứu được: không tạm ngừng; bộ đếm về 0', { options: { planApproval: 'off', conductor: 'fable', conductorFallback: 'off' } }, async ($, on) => {
    let isDown = true
    const seen = base(on, {
      router: () => (isDown && isFable(seen.routerModels.at(-1) ?? '') ? null : plan({ goal: GOAL })),
      refuse: call => ((call.maxTokens ?? 0) > 16_000 ? `maxTokens ${call.maxTokens} is past what claude-fable-5-2 can produce in one reply (16000)` : null),
    })
    // Prompt 1: fable lỗi API một lần, bộ đếm lên 1.
    await submit($, 'Sửa luồng thanh toán')
    isDown = false
    // Prompt 2: lượt đọc trọn bị engine từ chối, fallback (cùng họ fable) đọc được.
    await submit($, LONG)
    expect(prompts(seen).slice(-2).map(r => r.model)).toEqual(['fable', 'fable'])
    expect(lastContext(seen)).toContain(GOAL)
    // Prompt 3 vẫn gửi fable (không tạm ngừng) và lỗi một lần; prompt 4 vẫn gửi fable (bộ đếm đã về 0 nên một lỗi chưa đủ tạm ngừng).
    isDown = true
    await submit($, 'làm tiếp bước 1')
    expect(prompts(seen).at(-1)?.model).toBe('fable')
    await submit($, 'làm tiếp bước 2')
    expect(prompts(seen).at(-1)?.model).toBe('fable')
  })
})
