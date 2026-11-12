// 0.8.5 K12: bảng giá kèm mod giữ giá Fable 5.1 (bảng giá nằm trong lời dặn router, nên cập nhật để sang bản riêng). Người dùng Fable 5.2 đặt
// option prices là fable=8/40/0.2: priceNote ghi phần ghi đè và chi phí một lượt Fable tính theo giá đó.

import { describe, expect, test } from 'claude-code/testing'
import * as cost from '../hooks/lib/cost'
import { createContext } from '../hooks/context'

const tokens = (over: Partial<cost.Tokens>): cost.Tokens => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...over })
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected) < 1e-9).toBe(true)

describe('0.8.5 K12: option prices cho Fable 5.2', () => {
  test('prices fable=8/40/0.2: priceNote ghi "ghi đè cho fable"; một lượt Fable tính theo 8 / 40, đọc cache 0,2', () => {
    try {
      createContext({ prices: 'fable=8/40/0.2' })
      expect(cost.priceNote(Date.parse(`${cost.PRICE_DATE}T00:00:00Z`))).toContain('ghi đè cho fable')
      near(cost.usdOf('fable', tokens({ input_tokens: 1_000_000 })), 8)
      near(cost.usdOf('fable', tokens({ output_tokens: 1_000_000 })), 40)
      near(cost.usdOf('fable', tokens({ cache_read_input_tokens: 1_000_000 })), 0.2)
    } finally {
      cost.applyPrices({})
    }
  })

  test('không đặt option prices: bảng kèm mod giữ giá Fable 5.1, 10 / 50', () => {
    createContext({})
    near(cost.usdOf('fable', tokens({ input_tokens: 1_000_000 })), 10)
    near(cost.usdOf('fable', tokens({ output_tokens: 1_000_000 })), 50)
    expect(cost.priceNote(Date.parse(`${cost.PRICE_DATE}T00:00:00Z`))).not.toContain('ghi đè')
  })
})
