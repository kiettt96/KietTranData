// 0.8.4 C2: khi Fable sẵn sàng (option conductor fable), mọi lượt router gửi ID Fable thay option router: đọc prompt, chấm subagent,
// kiểm lạc đề, rà kế hoạch; effort giữ như cũ, riêng lượt đọc lại vì tin cậy thấp hạ từ high về medium; thời gian chờ theo hằng
// FABLE_*_TIMEOUT_MS. Sổ chi phí cộng lượt router vào nhóm router theo họ model thật đã gọi. Option mặc định: như 0.8.3.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as C from '../../hooks/lib/conductor'
import { COMPLEX_PROMPT, PANE, base, conductor, plan, submit } from '../support/engine'
import type { Json } from '../support/engine'

const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PLAIN = { options: { planApproval: 'off' } }
const ID = 'claude-fable-5-2'
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', requirements: ['Sửa hàm tính phí', 'Thêm test cho phí'], ...over })
const edit = ($: Engine, name: string) => $.tool.call({ tool: 'Edit', file_path: `src/${name}.ts`, old_string: 'x', new_string: 'y' } as never)
const agent = ($: Engine, description: string) => $.tool.call({ tool: 'Agent', description, prompt: `${description}. Báo lại ngắn.`, subagent_type: 'general-purpose' } as never)

describe('0.8.4 C2: hằng thời gian chờ của router Fable', () => {
  test('giá trị đo được ngày 10/11 trên engine 2.1.322: 45, 120, 20, 20, 30 giây', () => {
    expect([C.FABLE_PROMPT_TIMEOUT_MS, C.FABLE_LONG_TIMEOUT_MS, C.FABLE_AGENT_TIMEOUT_MS, C.FABLE_DRIFT_TIMEOUT_MS, C.FABLE_REVIEW_TIMEOUT_MS]).toEqual([45_000, 120_000, 20_000, 20_000, 30_000])
  })
})

describe('0.8.4 C2: lượt đọc prompt', () => {
  test('conductor fable, prompt mới: model là ID Fable, effort medium, thời gian chờ theo hằng mới', FABLE, async ($, on) => {
    const seen = base(on, { router: () => BIG() })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.routerCalls[0]).toEqual({ kind: 'prompt', model: ID, effort: 'medium', timeoutMs: C.FABLE_PROMPT_TIMEOUT_MS })
  })

  test('router trả tin cậy 0,3: lượt đọc lại của Fable có effort medium', FABLE, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => BIG({ confidence: n++ === 0 ? 0.3 : 1 }) })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.routerCalls.filter(c => c.kind === 'prompt').map(c => `${c.model}/${c.effort}`)).toEqual([`${ID}/medium`, `${ID}/medium`])
  })

  test('conductor mặc định, tin cậy 0,3: lượt đọc lại vẫn high, model option router', PLAIN, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => BIG({ confidence: n++ === 0 ? 0.3 : 1 }) })
    await submit($, 'Sửa luồng thanh toán')
    expect(seen.routerCalls.filter(c => c.kind === 'prompt').map(c => `${c.model}/${c.effort}`)).toEqual(['sonnet/medium', 'sonnet/high'])
  })
})

describe('0.8.4 C2: chấm subagent, kiểm lạc đề, rà kế hoạch', () => {
  test('lời gọi Agent không khớp việc đã phân: request chấm có model là ID Fable, effort low', FABLE, async ($, on) => {
    const seen = base(on, { router: () => BIG() })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Sửa luồng thanh toán')
    await agent($, 'Tra cứu cấu hình CI')
    expect(seen.routerCalls.filter(c => c.kind === 'agent')).toEqual([{ kind: 'agent', model: ID, effort: 'low', timeoutMs: C.FABLE_AGENT_TIMEOUT_MS }])
  })

  test('lượt kiểm lạc đề: model là ID Fable', FABLE, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    // 0.8.6 R1: luồng chính đang điều phối không tự sửa file; solo để các lần Edit dựng tình huống được chạy.
    await conductor($, 'solo')
    for (const f of ['a', 'b', 'c', 'd', 'e']) await edit($, f)
    const drift = seen.routerCalls.filter(c => c.kind === 'drift')
    expect(drift.length).toBe(1)
    expect(drift[0]).toEqual({ kind: 'drift', model: ID, effort: 'low', timeoutMs: C.FABLE_DRIFT_TIMEOUT_MS })
  })

  test('lượt rà kế hoạch: model là ID Fable', { options: { conductor: 'fable', enforceChecklist: true } }, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG()) })
    on('classic.Stop', () => ({}))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa hàm tính phí', check: 'bun test' }, { title: 'Thêm test cho phí', check: 'bun test' }] } as never)
    await $.classic.Stop({ stop_hook_active: false } as never)
    expect(seen.routerCalls.filter(c => c.kind === 'review')).toEqual([{ kind: 'review', model: ID, effort: 'medium', timeoutMs: C.FABLE_REVIEW_TIMEOUT_MS }])
  })
})

describe('0.8.4 C2: sổ chi phí theo họ model thật đã gọi', () => {
  const routerRow = async ($: Engine) => {
    const pane = await $.ui.mount(PANE)
    return (await pane.findAll({ type: 'Text' })).map(e => e.text).find(t => t.startsWith('router')) ?? ''
  }
  test('lượt router Fable cộng theo giá fable: không còn là mức dưới 1 cent của sonnet', FABLE, async ($, on) => {
    base(on, { router: () => BIG() })
    await submit($, 'Sửa luồng thanh toán')
    expect(await routerRow($)).not.toContain('<$0,01')
  })
  test('conductor mặc định: lượt router theo giá sonnet (dưới 1 cent)', PLAIN, async ($, on) => {
    base(on, { router: () => BIG() })
    await submit($, 'Sửa luồng thanh toán')
    expect(await routerRow($)).toContain('<$0,01')
  })
})

describe('0.8.4 C2: conductor mặc định giữ request như 0.8.3', () => {
  test('đọc prompt sonnet, medium, 45 giây; chấm subagent sonnet, low, 20 giây; kiểm lạc đề sonnet, low, 20 giây', PLAIN, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Tra cứu cấu hình CI')
    for (const f of ['a', 'b', 'c', 'd', 'e']) await edit($, f)
    expect(seen.routerCalls.find(c => c.kind === 'prompt')).toEqual({ kind: 'prompt', model: 'sonnet', effort: 'medium', timeoutMs: 45_000 })
    expect(seen.routerCalls.find(c => c.kind === 'agent')).toEqual({ kind: 'agent', model: 'sonnet', effort: 'low', timeoutMs: 20_000 })
    expect(seen.routerCalls.find(c => c.kind === 'drift')).toEqual({ kind: 'drift', model: 'sonnet', effort: 'low', timeoutMs: 20_000 })
  })
  test('rà kế hoạch sonnet, medium, 30 giây', { options: { enforceChecklist: true } }, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG()) })
    on('classic.Stop', () => ({}))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa hàm tính phí', check: 'bun test' }, { title: 'Thêm test cho phí', check: 'bun test' }] } as never)
    await $.classic.Stop({ stop_hook_active: false } as never)
    expect(seen.routerCalls.filter(c => c.kind === 'review')).toEqual([{ kind: 'review', model: 'sonnet', effort: 'medium', timeoutMs: 30_000 }])
  })
})
