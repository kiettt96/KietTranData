// 0.9.0 A6 (lỗi có từ 0.8.9): usage của turn.complete có thể vắng (khai báo kiểu của 2.1.327 và 2.1.296: absent khi bị ngắt, lỗi API), và
// engine giả hay engine khác có thể gửi usage thiếu trường hay rỗng. Sổ chi phí không thành NaN; mọi chỗ định dạng số trong hooks/ui hiện "–"
// khi giá trị vắng, rỗng hay không phải số hữu hạn; pane, band, status line đều vẽ được.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { formatCost } from '../../hooks/lib/ledger'
import { JS } from '../fixtures/runner-output'
import { PANE, base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' } })

function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-u1' }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
async function texts($: Engine, surface: typeof PANE | typeof BAND) {
  const ui = await $.ui.mount(surface)
  const out = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
  await ui.unmount()
  return out
}
const VARIANTS: ReadonlyArray<readonly [string, Record<string, unknown> | null]> = [
  ['usage chỉ có token', { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 }],
  ['usage rỗng', {}],
  ['usage vắng', null],
]

describe('0.9.0 A6: usage vắng, rỗng hay thiếu trường', () => {
  for (const [name, usage] of VARIANTS) {
    test(`subagent hoàn tất với ${name}: pane, band, status line vẽ được, không có NaN`, { options: { planApproval: 'off' } }, async ($, on) => {
      const seen = setup(on)
      await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
      await submit($, 'Sửa luồng phí')
      await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
      await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
      await step($, seen, { turnId: 't1' })
      await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Rà phí', prompt: 'Rà.' } as never)
      await $.agent.spawn({ prompt: 'Rà.', description: 'Rà phí', tool_use_id: 'u1' } as never)
      await $.turn.complete({ turnId: 'x-u1', agentId: 'a-u1', answer: 'ĐẠT', durationMs: 5, isAborted: false, reason: 'answer', ...(usage !== null ? { usage } : {}) } as never)
      await $.turn.complete({ turnId: 't1', answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer', ...(usage !== null ? { usage } : {}) } as never)
      const pane = await texts($, PANE)
      expect(pane).toContain('Sửa luồng phí')
      expect(pane).not.toMatch(/NaN|undefined|null/)
      const band = await texts($, BAND)
      expect(band.length).toBeGreaterThan(0)
      expect(band).not.toMatch(/NaN|undefined|null/)
      for (const status of seen.statuses) expect(String(status ?? '')).not.toMatch(/NaN|undefined/)
    })
  }
  test('formatCost: giá trị vắng, null, NaN, Infinity hiện "–"', () => {
    for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '1']) expect(formatCost(value as never, 'vi'), String(value)).toBe('–')
    expect(formatCost(1.5, 'vi')).toBe('$1,50')
  })
})
