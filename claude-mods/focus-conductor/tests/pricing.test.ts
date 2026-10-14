// Bảng giá, hệ số ghi cache, catalog gửi router và dòng cache ở /conductor status.
// Số liệu theo trang giá Anthropic ngày 13/10/2026: cache hit Sonnet 5.5 là $0.10 (giảm từ $0.20 ngày 07/10/2026), Opus $0.20,
// Fable $0.25, Haiku $0.01 (prompt trên 100K: $0.05); ghi cache bằng 1,25 lần giá vào ở bậc 5 phút và 2 lần ở bậc 1 giờ.

import { describe, expect, test } from 'claude-code/testing'

import * as cost from '../hooks/lib/cost'
import { PRICE_DATE, applyPrices, parsePrices, switchCost, usdOf } from '../hooks/lib/cost'
import { createContext } from '../hooks/context'
import { agentRouterRequest, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import type { ModelFamily } from '../types'
import { base, conductor, submit } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const tokens = (over: Partial<cost.Tokens>): cost.Tokens => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...over })

/** So sánh số thực với sai số nhỏ (bộ test không có toBeCloseTo). */
function closeTo(actual: number | undefined, expected: number): void {
  expect(Math.abs((actual ?? Number.NaN) - expected) < 1e-9).toBe(true)
}

/** Trả module về mặc định: bảng giá kèm mod và hệ số ghi cache 2. */
function reset(): void {
  applyPrices({})
  cost.applyCacheWrite(2)
}

const systemOf = (request: { system?: unknown }): string => ((request.system ?? []) as Array<{ text: string }>).map(block => block.text).join('\n')
const routerSystem = () => systemOf(routerRequest({ text: 'Sửa lỗi đăng nhập', prev: null, ran: null, policy: OPEN, model: 'sonnet' }))
const agentSystem = () =>
  systemOf(
    agentRouterRequest({ description: 'Sửa', prompt: 'Sửa x', subagentType: undefined, requested: {}, goal: null, parent: null, failed: [], isWorkflow: false, policy: OPEN, model: 'sonnet' }),
  )

describe('bảng giá kèm mod ngày 13/10/2026', () => {
  test('ngày bảng giá và đọc cache của từng họ khớp trang giá Anthropic', () => {
    reset()
    expect(PRICE_DATE).toBe('2026-10-13')
    // 50K token đọc cache, prompt dưới 100K: Haiku dùng giá bậc thấp.
    closeTo(usdOf('sonnet', tokens({ cache_read_input_tokens: 50_000 })), 0.005)
    closeTo(usdOf('opus', tokens({ cache_read_input_tokens: 50_000 })), 0.01)
    closeTo(usdOf('fable', tokens({ cache_read_input_tokens: 50_000 })), 0.0125)
    closeTo(usdOf('haiku', tokens({ cache_read_input_tokens: 50_000 })), 0.0005)
    // Haiku với prompt trên 100K token: đọc cache $0.05.
    closeTo(usdOf('haiku', tokens({ cache_read_input_tokens: 200_000 })), 0.01)
  })

  test('chi phí turn ước lượng dùng giá đọc cache mới của Sonnet', () => {
    reset()
    // sonnet/medium, khối lượng nhỏ, ngữ cảnh 100k: 5k vào mới ($2) + 3 step đọc 100k ($0.10) + 2k ra ($10) = $0.06.
    closeTo(cost.turnCost('sonnet', 'medium', 'small', 100_000), 0.06)
    // opus giữ $0.20: 5k vào mới ($4) + 3 × 100k đọc ($0.20) + 4,4k ra ($20) = $0.168.
    closeTo(cost.turnCost('opus', 'xhigh', 'small', 100_000), 0.168)
  })

  test('option prices thiếu giá trị thứ ba: đọc cache theo tỷ lệ của đúng họ đó trong bảng kèm mod', () => {
    // Sonnet và Opus 5% giá vào, Fable 2,5%, Haiku 10%.
    expect(parsePrices('sonnet=3/15, opus=5/25, fable=10/50, haiku=1/5')).toEqual({
      sonnet: { input: 3, output: 15, cacheRead: 0.15 },
      opus: { input: 5, output: 25, cacheRead: 0.25 },
      fable: { input: 10, output: 50, cacheRead: 0.25 },
      haiku: { input: 1, output: 5, cacheRead: 0.1 },
    })
    // Giá trị thứ ba ghi rõ thì giữ nguyên.
    expect(parsePrices('sonnet=3/15/0.4').sonnet?.cacheRead).toBe(0.4)
  })
})

describe('catalog giá gửi router dựng từ bảng giá đang dùng', () => {
  test('bảng giá kèm mod: số hiển thị khớp bảng, haiku giữ hai chữ số thập phân', () => {
    reset()
    for (const text of [routerSystem(), agentSystem()]) {
      expect(text).toContain('- haiku ($0.10/$0.50):')
      expect(text).toContain('- sonnet ($2/$10):')
      expect(text).toContain('- opus ($4/$20):')
      expect(text).toContain('- fable ($10/$50):')
    }
  })

  test('option prices đổi giá thì request router và request chấm subagent đổi theo', () => {
    applyPrices({ sonnet: { input: 3, output: 15, cacheRead: 0.15 }, haiku: { input: 0.125, output: 0.6, cacheRead: 0.0125 } })
    try {
      for (const text of [routerSystem(), agentSystem()]) {
        expect(text).toContain('- sonnet ($3/$15):')
        expect(text).not.toContain('- sonnet ($2/$10):')
        expect(text).toContain('- haiku ($0.125/$0.60):')
        expect(text).toContain('- opus ($4/$20):')
      }
    } finally {
      reset()
    }
  })

  test('request kèm bảng giá truyền vào dùng đúng bảng đó, không dùng bảng đã bị option prices ghi đè (golden-set băm theo bảng kèm mod)', () => {
    applyPrices({ sonnet: { input: 3, output: 15, cacheRead: 0.15 } })
    try {
      const args = { text: 'Sửa lỗi đăng nhập', prev: null, ran: null, policy: OPEN, model: 'sonnet' }
      const passed = systemOf(routerRequest({ ...args, prices: cost.bundledPrices() }))
      expect(passed).toContain('- sonnet ($2/$10):')
      expect(passed).not.toContain('- sonnet ($3/$15):')
      // Không truyền bảng thì theo bảng đang dùng (đã ghi đè).
      expect(systemOf(routerRequest(args))).toContain('- sonnet ($3/$15):')
    } finally {
      reset()
    }
  })
})

describe('hệ số ghi cache', () => {
  test('mặc định bậc 1 giờ: ghi cache bằng 2 lần giá vào', () => {
    reset()
    expect(cost.CACHE_WRITE_DEFAULT).toBe(2)
    expect(cost.cacheWriteFactor()).toBe(2)
    closeTo(usdOf('sonnet', tokens({ cache_creation_input_tokens: 1_000_000 })), 4)
    closeTo(usdOf('opus', tokens({ cache_creation_input_tokens: 1_000_000 })), 8)
  })

  test('đủ bốn loại token khác 0: số tính tay theo từng bậc (giá vào, ra, đọc cache, ghi cache)', () => {
    // Sonnet: 1000 vào ($2) + 500 ra ($10) + 20000 đọc cache ($0.10) + 3000 ghi cache.
    const usage = tokens({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 3000 })
    reset()
    // Bậc 1 giờ: ghi cache 3000 × $2 × 2 = 12000; tổng (2000 + 5000 + 2000 + 12000) / 1M.
    closeTo(usdOf('sonnet', usage), 0.021)
    cost.applyCacheWrite(1.25)
    try {
      // Bậc 5 phút: ghi cache 3000 × $2 × 1,25 = 7500; tổng (2000 + 5000 + 2000 + 7500) / 1M.
      closeTo(usdOf('sonnet', usage), 0.0165)
    } finally {
      reset()
    }
    // Haiku (prompt 24K, giá bậc thấp): 1000 × 0.1 + 500 × 0.5 + 20000 × 0.01 + 3000 × 0.1 × 2.
    closeTo(usdOf('haiku', usage), (100 + 250 + 200 + 600) / 1_000_000)
  })

  test('đọc option: số hoặc chuỗi số, kẹp trong 1,25 đến 2; thiếu hay sai thì dùng mặc định', () => {
    expect(cost.parseCacheWrite(undefined)).toBe(2)
    expect(cost.parseCacheWrite('')).toBe(2)
    expect(cost.parseCacheWrite('abc')).toBe(2)
    expect(cost.parseCacheWrite(0)).toBe(2)
    expect(cost.parseCacheWrite(-1)).toBe(2)
    expect(cost.parseCacheWrite(Number.NaN)).toBe(2)
    expect(cost.parseCacheWrite(1.25)).toBe(1.25)
    expect(cost.parseCacheWrite('1.25')).toBe(1.25)
    expect(cost.parseCacheWrite(1.5)).toBe(1.5)
    expect(cost.parseCacheWrite(2)).toBe(2)
    // Ngoài khoảng thì kẹp (manifest không khai min, max).
    expect(cost.parseCacheWrite(1)).toBe(1.25)
    expect(cost.parseCacheWrite(3)).toBe(2)
    expect(cost.parseCacheWrite('100')).toBe(2)
  })

  test('chi phí ghi lại cache khi đổi lựa chọn dùng cùng hệ số với usdOf', () => {
    reset()
    // Opus sang Sonnet, ngữ cảnh 100k: 100k × (2 × $2 − $0.20 đọc cache opus) / 1M.
    closeTo(switchCost({ family: 'opus' }, { family: 'sonnet' }, 100_000), 0.38)
    // Cùng Opus đổi effort, 100k trừ 20k system prompt: 80k × (2 × $4 − $0.20) / 1M.
    closeTo(switchCost({ family: 'opus' }, { family: 'opus' }, 100_000), 0.624)
    // Phần cố định đo được 50k: 50k × (2 × $4 − $0.20) / 1M.
    closeTo(switchCost({ family: 'opus' }, { family: 'opus' }, 100_000, 50_000), 0.39)
    cost.applyCacheWrite(1.25)
    try {
      closeTo(switchCost({ family: 'opus' }, { family: 'sonnet' }, 100_000), 0.23)
      closeTo(switchCost({ family: 'opus' }, { family: 'opus' }, 100_000), 0.384)
    } finally {
      reset()
    }
  })

  test('createContext áp option cacheWrite; thiếu thì về mặc định', () => {
    try {
      createContext({ cacheWrite: 1.25 })
      expect(cost.cacheWriteFactor()).toBe(1.25)
      createContext({ cacheWrite: '9' })
      expect(cost.cacheWriteFactor()).toBe(2)
      createContext({ cacheWrite: 1.25 })
      createContext({})
      expect(cost.cacheWriteFactor()).toBe(2)
    } finally {
      reset()
    }
  })
})

describe('thời gian sống của cache và cặp bậc cache', () => {
  test('cacheTtlMinutes mặc định 60 (bậc 1 giờ); khai thì theo giá trị; sai thì về mặc định', () => {
    expect(createContext({}).cacheTtlMs).toBe(60 * 60_000)
    expect(createContext({ cacheTtlMinutes: '5' }).cacheTtlMs).toBe(5 * 60_000)
    expect(createContext({ cacheTtlMinutes: '60' }).cacheTtlMs).toBe(60 * 60_000)
    expect(createContext({ cacheTtlMinutes: 'abc' }).cacheTtlMs).toBe(60 * 60_000)
    expect(createContext({ cacheTtlMinutes: '0' }).cacheTtlMs).toBe(60 * 60_000)
  })

  test('cacheNote: nêu hệ số và thời gian nguội; chỉ cảnh báo khi hai option không cùng một bậc', () => {
    reset()
    expect(cost.cacheNote(60)).toBe('Ghi cache 2× giá vào, cache nguội sau 60 phút')
    cost.applyCacheWrite(1.25)
    try {
      expect(cost.cacheNote(5)).toBe('Ghi cache 1.25× giá vào, cache nguội sau 5 phút')
      // Bậc 5 phút (1.25) với TTL 60 và bậc 1 giờ (2) với TTL 5 đều lệch.
      expect(cost.cacheNote(60)).toContain('không cùng một bậc cache')
    } finally {
      reset()
    }
    expect(cost.cacheNote(5)).toContain('không cùng một bậc cache')
    expect(cost.cacheNote(5)).toContain('bậc 5 phút là 1.25 và 5, bậc 1 giờ là 2 và 60')
  })

  test('/conductor status in cặp bậc cache đang dùng', {}, async ($, on) => {
    base(on)
    await submit($, 'sửa typo trong README')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Ghi cache 2× giá vào, cache nguội sau 60 phút')
    expect(status).not.toContain('không cùng một bậc cache')
  })

  test('/conductor status cảnh báo khi người dùng cũ còn TTL 5 phút đã lưu nhưng hệ số là 2', { options: { cacheTtlMinutes: '5' } }, async ($, on) => {
    base(on)
    await submit($, 'sửa typo trong README')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Ghi cache 2× giá vào, cache nguội sau 5 phút')
    expect(status).toContain('không cùng một bậc cache')
  })
})
