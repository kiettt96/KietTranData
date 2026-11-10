// 0.8.1 B3: hai vế ngoại lệ "Riêng ... dùng <họ>" có họ khác nhau cùng phủ một mục thì mod không tự chốt theo thứ tự câu: ruleFamily trả
// null để router chấm, và nhật ký có dòng rule-conflict ghi các họ và mục khớp; không chèn gì vào context. Một họ, hay nhiều vế cùng họ,
// thì giữ như cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ruleFamily } from '../../hooks/lib/route'
import { base, plan, submit } from '../support/engine'

const FIRST = 'Việc lọc tin chạy sonnet. Riêng tin pháp lý và tin thuế dùng opus. Riêng tin thuế và tin xuất khẩu dùng haiku.'
const SWAPPED = 'Việc lọc tin chạy sonnet. Riêng tin thuế và tin xuất khẩu dùng haiku. Riêng tin pháp lý và tin thuế dùng opus.'
const LOG = '/tmp/fc-rule-conflict-b3-081.jsonl'

describe('0.8.1 B3: ruleFamily khi hai vế ngoại lệ khác họ cùng phủ một mục', () => {
  for (const [name, rule] of [['thứ tự câu gốc', FIRST], ['đảo hai vế', SWAPPED]] as const) {
    test(`${name}: "Lọc tin thuế quý 3" là null`, () => expect(ruleFamily([rule], 'Lọc tin thuế quý 3', null)).toBe(null))
    test(`${name}: pháp lý opus, xuất khẩu haiku, tin chung sonnet`, () => {
      expect(ruleFamily([rule], 'Lọc tin pháp lý', null)).toBe('opus')
      expect(ruleFamily([rule], 'Lọc tin xuất khẩu', null)).toBe('haiku')
      expect(ruleFamily([rule], 'Lọc tin chung', null)).toBe('sonnet')
    })
  }
  test('hai vế cùng họ opus phủ cùng mục: opus', () => {
    const rule = 'Việc lọc tin chạy sonnet. Riêng tin pháp lý và tin thuế dùng opus. Riêng tin thuế và tin xuất khẩu dùng opus.'
    expect(ruleFamily([rule], 'Lọc tin thuế quý 3', null)).toBe('opus')
  })
})

const EDIT = { why: 'lọc', model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }
const agent = ($: Engine, description: string, model: string) =>
  $.tool.call({ tool: 'Agent', description, prompt: description, model } as never) as Promise<{ context?: string[] }>

describe('0.8.1 B3: đầu cuối', () => {
  test('Claude ghi opus cho "Lọc tin thuế quý 3": router được gọi, nhật ký có rule-conflict với hai họ, context không nhắc xung đột', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const writes: string[] = []
    const seen = base(on, { router: () => plan({ goal: 'Lọc tin theo các lô', constraints: [FIRST], depth: 'hard', volume: 'large' }), agent: () => EDIT })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, 'Lọc tin theo các lô')
    const done = await agent($, 'Lọc tin thuế quý 3', 'opus')
    expect(seen.agentRouted.length).toBe(1)
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    const conflict = lines.find(l => l['kind'] === 'rule-conflict')
    expect(conflict).toBeDefined()
    expect([...((conflict?.['families'] as string[] | undefined) ?? [])].sort()).toEqual(['haiku', 'opus'])
    expect((done.context ?? []).some(c => c.includes('rule-conflict') || c.includes('xung đột'))).toBe(false)
  })
})
