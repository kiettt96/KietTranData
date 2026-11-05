// 0.7.9 R1: vế ghi đè "Riêng ... dùng <họ>" (hay "except ... with <họ>") có danh sách chung tiền tố hay hậu tố ("tin xuất và nhập khẩu")
// được bung thành từng mục ("tin xuất khẩu", "tin nhập khẩu"); mỗi mục là quy tắc riêng với họ của vế ngoại lệ, đứng trước quy tắc chung,
// và chỉ khớp khi các từ của mục liền nhau trong description. Khớp không trọn vẹn thì null để router chấm.

import { describe, expect, test } from 'claude-code/testing'
import { ruleFamily } from '../hooks/lib/route'
import { base, plan, submit } from './support/engine'

const SPLIT = ['Các việc lọc tin dùng sonnet. Riêng tin xuất và nhập khẩu dùng opus']

describe('0.7.9 R1: vế ghi đè có danh sách chung hậu tố', () => {
  test('"Lọc tin xuất khẩu": opus', () => {
    expect(ruleFamily(SPLIT, 'Lọc tin xuất khẩu', 'sonnet')).toBe('opus')
  })

  test('"Lọc tin nhập khẩu": opus', () => {
    expect(ruleFamily(SPLIT, 'Lọc tin nhập khẩu', 'sonnet')).toBe('opus')
  })

  test('"Lọc tin trong nước": sonnet', () => {
    expect(ruleFamily(SPLIT, 'Lọc tin trong nước', 'sonnet')).toBe('sonnet')
  })

  test('danh sách ba mục chung tiền tố: "Lọc tin dầu" là opus', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet, riêng tin vàng, dầu và thép dùng opus'], 'Lọc tin dầu', null)).toBe('opus')
  })

  test('tiếng Anh: "except import and export news with opus" thì "Filter export news" là opus', () => {
    expect(ruleFamily(['Filter news with sonnet, except import and export news with opus'], 'Filter export news', null)).toBe('opus')
  })

  test('khớp không trọn vẹn: "Lọc tin xuất nhập khẩu" với "Riêng tin xuất khẩu dùng opus" là null', () => {
    expect(ruleFamily(['Lọc tin dùng sonnet. Riêng tin xuất khẩu dùng opus'], 'Lọc tin xuất nhập khẩu', null)).toBeNull()
  })
})

describe('0.7.9 R1: tích hợp qua lời gọi Agent', () => {
  test('Claude ghi opus cho "Lọc tin xuất khẩu": khớp quy định của vế ngoại lệ nên không gọi router chấm subagent', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Lọc tin theo lô', constraints: SPLIT }) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, 'Lọc tin theo lô')
    await $.tool.call({ tool: 'Agent', description: 'Lọc tin xuất khẩu', prompt: 'Lọc tin xuất khẩu lô 1', model: 'opus' } as never)
    expect(seen.agentRouted.length).toBe(0)
  })
})
