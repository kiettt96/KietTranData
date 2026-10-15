// 0.6.0 hạng mục A: đọc số đo hạn mức và quyết định vùng dừng (hooks/lib/quota.ts, hàm thuần).

import { describe, expect, test } from 'claude-code/testing'

import { REMAINING_MAX, REMAINING_MIN, clampRemaining, evaluateQuota, isPastLimit, isStale, quotaSettings } from '../hooks/lib/quota'

const NOW = Date.parse('2026-10-15T08:00:00Z')
const LATER = '2026-10-15T10:00:00Z'
const PAST = '2026-10-15T07:00:00Z'
const DEFAULT = { session: 5, week: 2 }

describe('0.6.0 A: ngưỡng phần còn lại', () => {
  test('phiên: 94,9 chưa dừng, 95 dừng; tuần: 97,9 chưa dừng, 98 dừng', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 94.9, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('ok')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 95, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('pause')
    expect(evaluateQuota([{ kind: 'seven_day', percentUsed: 97.9, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('ok')
    expect(evaluateQuota([{ kind: 'seven_day', percentUsed: 98, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('pause')
  })

  test('isPastLimit: đúng bằng ngưỡng thì dừng', () => {
    expect(isPastLimit(95, 5)).toBe(true)
    expect(isPastLimit(94.9, 5)).toBe(false)
    expect(isPastLimit(10, 90)).toBe(true)
    expect(isPastLimit(9.9, 90)).toBe(false)
  })

  test('hit ghi cửa sổ, phần trăm đã dùng, phần còn lại, giờ làm mới và ngưỡng', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 96.5, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.hits).toEqual([{ kind: 'five_hour', percentUsed: 96.5, remaining: 3.5, resetsAt: LATER, threshold: 5 }])
  })

  test('ngưỡng tùy chỉnh và kẹp biên 0,5 đến 99', () => {
    expect([REMAINING_MIN, REMAINING_MAX]).toEqual([0.5, 99])
    expect(clampRemaining(90, 5)).toBe(90)
    expect(clampRemaining(0, 5)).toBe(0.5)
    expect(clampRemaining(150, 5)).toBe(99)
    expect(clampRemaining('abc', 5)).toBe(5)
    expect(clampRemaining(Number.NaN, 2)).toBe(2)
    expect(clampRemaining('12', 5)).toBe(12)
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 10, resetsAt: LATER }], NOW, { session: 90, week: 2 }).zone).toBe('pause')
  })

  test('quotaSettings đọc option: mặc định bật, 5 và 2; quotaGuard false thì tắt', () => {
    expect(quotaSettings({})).toEqual({ enabled: true, session: 5, week: 2 })
    expect(quotaSettings({ quotaGuard: false, pauseSessionRemainingPct: 90, pauseWeekRemainingPct: 0 })).toEqual({ enabled: false, session: 90, week: 0.5 })
  })

  test('kind lạ, spend_limit, NaN, Infinity và mảng rỗng không gây dừng và không ném lỗi', () => {
    expect(evaluateQuota([], NOW, DEFAULT)).toEqual({ zone: 'unknown', hits: [], nearest: null })
    expect(evaluateQuota([{ kind: 'spend_limit', percentUsed: 120 }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'mystery', percentUsed: 99 }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: Number.NaN }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: Number.POSITIVE_INFINITY }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota(null as never, NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([null, { kind: 5 }] as never, NOW, DEFAULT).zone).toBe('unknown')
  })

  test('một cửa sổ hợp lệ dưới ngưỡng thì vùng ok, dù cửa sổ kia không đọc được', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 40, resetsAt: LATER }, { kind: 'seven_day', percentUsed: Number.NaN }], NOW, DEFAULT).zone).toBe('ok')
  })

  test('cả hai cửa sổ đều qua ngưỡng: hai hit', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: LATER }, { kind: 'seven_day', percentUsed: 99, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.hits.map(h => h.kind)).toEqual(['five_hour', 'seven_day'])
  })
})

describe('0.6.0 A: resetsAt đã qua là số đo cũ', () => {
  test('isStale: mốc đã qua là cũ, chưa tới hoặc vắng hoặc hỏng thì không', () => {
    expect(isStale(PAST, NOW)).toBe(true)
    expect(isStale(new Date(NOW).toISOString(), NOW)).toBe(true)
    expect(isStale(LATER, NOW)).toBe(false)
    expect(isStale(undefined, NOW)).toBe(false)
    expect(isStale('không phải ngày', NOW)).toBe(false)
  })

  test('số đo cũ không gây dừng; cửa sổ đã làm mới thì vùng tự mở', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: PAST }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: LATER }], Date.parse(LATER) + 1, DEFAULT).zone).toBe('unknown')
  })
})

describe('0.6.0 A: nearest cho band (trong vùng gấp đôi biên)', () => {
  test('còn 8% ở phiên (biên 5, gấp đôi là 10): nearest là phiên; còn 30% thì không có', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 92, resetsAt: LATER }], NOW, DEFAULT).nearest).toEqual({ kind: 'five_hour', remaining: 8 })
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 70, resetsAt: LATER }], NOW, DEFAULT).nearest).toBeNull()
  })

  test('hai cửa sổ cùng gần ngưỡng: chọn cửa sổ có phần còn lại gần ngưỡng nhất (tỷ lệ còn lại trên ngưỡng nhỏ nhất)', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 92, resetsAt: LATER }, { kind: 'seven_day', percentUsed: 97, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.nearest).toEqual({ kind: 'seven_day', remaining: 3 })
  })
})
