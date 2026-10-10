// Test các module thuần: thang đo (scale), chi phí (cost), sổ chi phí (ledger),
// reducer trạng thái và đưa trạng thái cũ về dạng mới (normalizeCore).

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Core, Route } from '../types'
import { applyPrices, fixedContextTokens, parsePrices, priceNote, shouldDowngrade, switchCost, turnCost, usdOf } from '../hooks/lib/cost'
import { addUsage, calibrate, emptyLedger, formatUsd, ledgerLines, nextGoal, resetLedger, sessionUsd } from '../hooks/lib/ledger'
import { legacyOf, tierOf } from '../hooks/lib/scale'
import { EMPTY_CORE, normalizeCore, withAgentUsd, withDecision, withLift, adoptGoal } from '../hooks/lib/state'

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** So sánh số thực với sai số nhỏ (bộ test không có toBeCloseTo). */
function closeTo(actual: number | undefined, expected: number): void {
  expect(Math.abs((actual ?? Number.NaN) - expected) < 1e-6).toBe(true)
}

describe('thang đo của việc', () => {
  test('tier suy ra từ depth và volume', () => {
    expect(tierOf('none', 'small')).toBe('trivial')
    expect(tierOf('light', 'medium')).toBe('moderate')
    expect(tierOf('hard', 'large')).toBe('deep')
  })

  test('dữ liệu tier cũ đổi sang depth và volume tương đương', () => {
    expect(legacyOf('trivial')).toEqual({ depth: 'none', volume: 'small' })
    expect(legacyOf('deep')).toEqual({ depth: 'hard', volume: 'large' })
  })
})

describe('chi phí theo token', () => {
  test('quy đổi usage đo được thành USD theo giá model', () => {
    // Haiku 5.5: prompt tới 100K token ở giá $0.10 mỗi 1M (trên 100K là giá bậc cao, xem test 0.5.0).
    closeTo(usdOf('haiku', { input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 0.01)
    closeTo(usdOf('sonnet', { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 10)
  })

  test('chi phí turn ước lượng khớp các số tính tay trong kế hoạch', () => {
    // opus/xhigh, khối lượng nhỏ, ngữ cảnh 100k: 20k vào mới + 60k đọc cache + 88k ra.
    closeTo(turnCost('opus', 'xhigh', 'small', 100_000), 0.168)
    closeTo(turnCost('sonnet', 'medium', 'small', 100_000), 0.09)
  })

  test('đổi model ghi lại cache theo giá vào của model mới; đổi effort chỉ ghi phần ngoài system prompt', () => {
    closeTo(switchCost({ family: 'opus' }, { family: 'sonnet' }, 100_000), 0.23)
    closeTo(switchCost({ family: 'opus' }, { family: 'opus' }, 100_000), 0.384)
  })

  test('hạ cấp chỉ khi lợi ích trong các turn còn lại vượt chi phí ghi lại cache với hệ số an toàn', () => {
    expect(shouldDowngrade({ saving: 0.078, rewrite: 0.23, turnsLeft: 1 })).toBe(false)
    expect(shouldDowngrade({ saving: 0.078, rewrite: 0.0115, turnsLeft: 2 })).toBe(true)
  })
})

describe('phần cố định của ngữ cảnh đo từ phiên', () => {
  test('cộng mọi hàng đang dùng trừ hội thoại; không có hàng hội thoại thì không đoán', () => {
    const rows = [
      { name: 'System prompt', tokens: 3000, kind: 'used' },
      { name: 'System tools', tokens: 15000, kind: 'used' },
      { name: 'Memory files', tokens: 2000, kind: 'used' },
      { name: 'Messages', tokens: 40000, kind: 'used' },
      { name: 'MCP tools', tokens: 9000, kind: 'deferred' },
      { name: 'Free space', tokens: 100000, kind: 'free' },
    ]
    expect(fixedContextTokens(rows)).toBe(20000)
    expect(fixedContextTokens(rows.filter(r => r.name !== 'Messages'))).toBeNull()
    expect(fixedContextTokens(undefined)).toBeNull()
  })

  test('chi phí đổi effort tính theo phần cố định đo được', () => {
    // Opus, ngữ cảnh 100k, phần cố định 50k: ghi lại 50k × (1,25 × 4 − 0,2) / 1M = 0,24.
    closeTo(switchCost({ family: 'opus' }, { family: 'opus' }, 100_000, 50_000), 0.24)
  })
})

describe('sổ chi phí', () => {
  test('cộng usage vào nhóm, cả phiên lẫn mục tiêu; mục tiêu mới xóa phần mục tiêu, giữ tổng phiên', () => {
    const first = addUsage(emptyLedger(1), 'main', 'sonnet', USAGE).ledger
    const second = addUsage(first, 'agent', 'haiku', USAGE).ledger
    expect(second.session.main.calls).toBe(1)
    expect(second.session.agent.calls).toBe(1)
    closeTo(sessionUsd(second), usdOf('sonnet', USAGE) + usdOf('haiku', USAGE))

    const next = nextGoal(second, 2)
    expect(next.goal.goalId).toBe(2)
    expect(next.goal.buckets.main.calls).toBe(0)
    expect(next.session.main.calls).toBe(1)
  })

  test('hiệu chỉnh kéo hệ số về phía số đo, kẹp trong khoảng 0,5 đến 2, và đếm số lần đo', () => {
    const ledger = emptyLedger(1)
    // Ước lượng sonnet/medium khối lượng nhỏ là 2000 token ra; đo được 2400 thì tỷ lệ 1,2.
    const measured = calibrate(ledger, 'sonnet', 2400, 'small', 'medium')
    closeTo(measured.calib.sonnet, 1.04)
    expect(measured.samples).toBe(1)
    const capped = calibrate(measured, 'sonnet', 1_000_000_000, 'small', 'medium')
    expect(capped.calib.sonnet <= 2).toBe(true)
    expect(calibrate(ledger, 'sonnet', 0, 'small', 'medium')).toBe(ledger)
  })

  test('reset giữ hệ số hiệu chỉnh đã học nhưng xóa mọi chi phí', () => {
    const learned = calibrate(addUsage(emptyLedger(1), 'main', 'opus', USAGE).ledger, 'opus', 50_000, 'medium', 'high')
    const cleared = resetLedger(learned)
    expect(cleared.calib.opus).toBe(learned.calib.opus)
    expect(sessionUsd(cleared)).toBe(0)
  })

  test('định dạng USD và các dòng tóm tắt hiện đủ nhóm', () => {
    expect(formatUsd(0.035)).toBe('$0.035')
    expect(formatUsd(0.0004)).toBe('$0.0004')
    const lines = ledgerLines(addUsage(emptyLedger(1), 'agent', 'haiku', USAGE).ledger)
    expect(lines[0]).toContain('subagent')
    expect(lines[0]).toContain('trong 1 lượt')
  })
})

describe('trạng thái agent và nâng cấp', () => {
  test('chi phí đo được thay ước lượng của agent, các lần đo sau được cộng dồn', () => {
    const core = { ...EMPTY_CORE, log: [{ at: 1, where: 'agent' as const, label: 'a', family: 'haiku' as const, reason: '', isApplied: true, agentId: 'x', usd: 0.5, measured: false }] }
    const once = withAgentUsd('x', 0.1)(core)
    expect(once.log[0]?.usd).toBe(0.1)
    expect(once.log[0]?.measured).toBe(true)
    const twice = withAgentUsd('x', 0.2)(once)
    closeTo(twice.log[0]?.usd, 0.3)
  })

  test('nâng cấp tối đa hai bậc, và mục tiêu mới xóa nâng cấp', () => {
    const lifted = withLift(1, 0)(withLift(1, 1)(withLift(1, 1)(EMPTY_CORE)))
    expect(lifted.lift).toEqual({ depth: 2, effort: 2 })
    const brief = normalizeCore({ brief: { goalId: 2, goal: 'Viết hàm parseDate', tier: 'simple' } as unknown as Brief }).brief
    if (brief === null) throw new Error('brief')
    expect(adoptGoal(brief)(lifted).lift).toEqual({ depth: 0, effort: 0 })
    // Router quyết lại cho prompt tiếp nối: nâng cấp theo bằng chứng về 0 (router đã tự nâng nếu cần).
    expect(withDecision(brief)(lifted).lift).toEqual({ depth: 0, effort: 0 })
    expect(withDecision(brief)(lifted).brief?.goal).toBe('Viết hàm parseDate')
  })
})

describe('đưa trạng thái cũ về dạng mới', () => {
  test('brief chỉ có tier được suy ra depth, volume; sổ và nâng cấp được điền mặc định', () => {
    // Trạng thái lưu từ bản 0.1.x: không có sổ, nâng cấp hay mốc thời gian.
    const legacy = {
      brief: { goalId: 1, goal: 'Viết hàm parseDate', steps: [], constraints: [], quality: [], tier: 'deep' as const },
      plan: [],
      route: null,
      warnings: [],
      log: [],
    } as unknown as Core
    const core = normalizeCore(legacy)
    expect(core.brief?.depth).toBe('hard')
    expect(core.brief?.volume).toBe('large')
    expect(core.brief?.kind).toBe('mixed')
    expect(core.ledger.calib.opus).toBe(1)
    expect(core.lift).toEqual({ depth: 0, effort: 0 })
  })

  test('route còn lại từ bản cũ vẫn đọc được', () => {
    const route: Route = { family: 'opus', effort: 'high', tier: 'complex', goalId: 1, reason: '' }
    expect(normalizeCore({ ...EMPTY_CORE, route }).route).toEqual(route)
  })
})

describe('0.5.0: bảng giá có ngày, ghi đè, giá Haiku prompt dài', () => {
  const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

  test('đọc option prices: vào/ra, kèm đọc cache tùy chọn; mục sai bị bỏ', () => {
    expect(parsePrices('sonnet=3/15, opus=5/25/0.5, gpt=1/2, haiku=x/1')).toEqual({
      sonnet: { input: 3, output: 15, cacheRead: 0.30000000000000004 },
      opus: { input: 5, output: 25, cacheRead: 0.5 },
    })
    expect(parsePrices(undefined)).toEqual({})
  })

  test('ghi đè áp lên mọi phép tính; áp lại thì làm lại từ bảng kèm mod', () => {
    applyPrices({ sonnet: { input: 3, output: 15, cacheRead: 0.3 } })
    expect(usdOf('sonnet', usage(1_000_000, 0))).toBe(3)
    expect(priceNote(Date.parse('2026-10-10T00:00:00Z'))).toBe('Bảng giá kèm mod ngày 2026-10-06, ghi đè cho sonnet')
    applyPrices({})
    expect(usdOf('sonnet', usage(1_000_000, 0))).toBe(2)
  })

  test('bảng giá quá 180 ngày thì có cảnh báo', () => {
    applyPrices({})
    expect(priceNote(Date.parse('2027-01-01T00:00:00Z'))).not.toContain('giá có thể đã đổi')
    expect(priceNote(Date.parse('2027-06-01T00:00:00Z'))).toContain('đã 238 ngày, giá có thể đã đổi')
  })

  test('Haiku với prompt trên 100K token tính theo giá bậc cao', () => {
    applyPrices({})
    closeTo(usdOf('haiku', usage(100_000, 1_000_000)), 0.01 + 0.5)
    closeTo(usdOf('haiku', usage(200_000, 1_000_000)), 0.1 + 2.5)
  })
})
