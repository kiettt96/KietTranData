// 0.8.4 C7: lập kế hoạch thuộc vai của Fable: khi Fable sẵn sàng, lời gọi Agent loại Plan chạy fable/medium (sau các bước kẹp, không kẹp
// theo allowFable); sessionModel ceiling hay fixed vẫn thắng. Loại agent khác giữ lựa chọn hiện có. Option mặc định: như 0.8.3.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, step, submit } from '../support/engine'

const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit' })
const AGENT_PICK = { why: 'việc vừa', model: 'opus', effort: 'high', agent: 'Plan', depth: 'substantial', volume: 'small', kind: 'investigate' }

function capture(on: On) {
  const calls: Array<{ model?: unknown; effort?: unknown }> = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    calls.push({ model: e.model, effort: e.effort })
    return { deny: 'test: đã ghi nhận đầu vào' }
  })
  return calls
}
const agent = ($: Engine, type: string) => $.tool.call({ tool: 'Agent', description: 'Thiết kế phương án tách module', prompt: 'Thiết kế phương án tách module báo cáo', subagent_type: type } as never)

describe('0.8.4 C7: Agent Plan khi Fable điều phối', () => {
  test('conductor fable, allowFable tắt, Agent Plan: chạy fable, effort medium', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    base(on, { router: () => BIG, agent: () => AGENT_PICK })
    const calls = capture(on)
    await submit($, 'Sửa luồng thanh toán')
    await agent($, 'Plan')
    expect(calls).toEqual([{ model: 'fable', effort: 'medium' }])
  })

  for (const type of ['Explore', 'general-purpose']) {
    test(`Agent ${type}: theo lựa chọn hiện có, không thành fable`, { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
      base(on, { router: () => BIG, agent: () => ({ ...AGENT_PICK, agent: type, model: 'sonnet', effort: 'medium' }) })
      const calls = capture(on)
      await submit($, 'Sửa luồng thanh toán')
      await agent($, type)
      expect(calls[0]?.model).not.toBe('fable')
    })
  }

  test('sessionModel ceiling, phiên opus: Agent Plan không vượt opus', { options: { planApproval: 'off', conductor: 'fable', sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on, { router: () => BIG, agent: () => AGENT_PICK })
    const calls = capture(on)
    await submit($, 'Sửa luồng thanh toán')
    await step($, seen, { model: 'claude-opus-5-5' })
    await agent($, 'Plan')
    expect(calls[0]?.model).toBe('opus')
  })

  test('conductor mặc định: Agent Plan theo router như 0.8.3', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => BIG, agent: () => AGENT_PICK })
    const calls = capture(on)
    await submit($, 'Sửa luồng thanh toán')
    await agent($, 'Plan')
    expect(calls).toEqual([{ model: 'opus', effort: 'high' }])
  })
})
