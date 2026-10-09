// Test các module thuần mới của 0.2.0: thang đo (scale), chi phí (cost), sổ chi
// phí (ledger), tách phần dán vào (payload), so khớp có dấu (isRelated) và đưa
// trạng thái cũ về dạng mới (normalizeCore).

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Core, Route } from '../types'
import { analyzeHeuristic, isRelated } from '../hooks/lib/analyze'
import { fixedContextTokens, shouldDowngrade, switchCost, turnCost, usdOf } from '../hooks/lib/cost'
import { addUsage, calibrate, emptyLedger, formatUsd, ledgerLines, nextGoal, resetLedger, sessionUsd } from '../hooks/lib/ledger'
import { splitPayload } from '../hooks/lib/payload'
import { carryDepth, legacyOf, stepDepth, tierOf } from '../hooks/lib/scale'
import { EMPTY_CORE, normalizeCore, withAgentUsd, withLift, adoptGoal } from '../hooks/lib/state'

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** So sánh số thực với sai số nhỏ (bộ test không có toBeCloseTo). */
function closeTo(actual: number | undefined, expected: number): void {
  expect(Math.abs((actual ?? Number.NaN) - expected) < 1e-6).toBe(true)
}

describe('thang đo của việc', () => {
  test('nâng hay hạ độ sâu theo quan hệ với mục tiêu trước', () => {
    expect(carryDepth('light', 'hard', 'continue')).toBe('hard')
    expect(carryDepth('light', 'hard', 'dissatisfied')).toBe('hard')
    expect(carryDepth('light', 'substantial', 'dissatisfied')).toBe('hard')
    expect(carryDepth('light', 'hard', 'refine')).toBe('substantial')
    expect(carryDepth('none', 'hard', 'refine')).toBe('substantial')
    expect(carryDepth('light', 'hard', 'new')).toBe('light')
  })

  test('độ sâu kẹp trong thang; tier suy ra từ depth và volume', () => {
    expect(stepDepth('hard', 1)).toBe('hard')
    expect(stepDepth('none', -1)).toBe('none')
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
    closeTo(usdOf('haiku', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 0.1)
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
    const brief = analyzeHeuristic('Viết hàm parseDate nhận chuỗi ISO và trả về Date', null, 1)
    expect(adoptGoal(brief)(lifted).lift).toEqual({ depth: 0, effort: 0 })
  })
})

describe('quan hệ với mục tiêu trước trong brief', () => {
  test('báo chưa đạt ("vẫn sai") tăng độ sâu một bậc; tinh chỉnh không thấp hơn một bậc', () => {
    const prev = analyzeHeuristic('Viết hàm parseDate nhận chuỗi ISO và trả về Date', null, 1)
    expect(prev.depth).toBe('light')
    const again = analyzeHeuristic('vẫn sai, parseDate vẫn trả về null với chuỗi ISO', prev, 2)
    expect(again.isFollowUp).toBe(true)
    expect(again.depth).toBe('substantial')
    expect(again.goalId).toBe(prev.goalId)
    const refined = analyzeHeuristic('sửa parseDate thêm múi giờ', prev, 3)
    expect(refined.depth).toBe('light')
  })
})

describe('tách phần dán vào', () => {
  test('code fence và dãy log dài bị tách; yêu cầu và danh sách giữ nguyên', () => {
    const fenced = splitPayload('Giải thích lỗi này:\n```\nTypeError: x\n    at a\n```')
    expect(fenced.request).not.toContain('TypeError')
    expect(fenced.payloadLines).toBeGreaterThan(0)

    const logs = Array.from({ length: 12 }, (_, i) => `2026-10-09T10:00:${String(i).padStart(2, '0')} INFO request ${i}`).join('\n')
    const withLog = splitPayload(`Tóm tắt log sau:\n${logs}`)
    expect(withLog.request).toContain('Tóm tắt log sau')
    expect(withLog.request).not.toContain('request 3')
    expect(withLog.payloadLines).toBe(12)
  })

  test('mục liệt kê có dấu hai chấm không bị coi là dữ liệu dán vào', () => {
    // Mỗi mục có nhiều dấu cấu trúc (phẩy, hai chấm, chấm phẩy) nên có thể bị nhầm là dữ liệu nếu không loại trừ mục liệt kê.
    const steps = Array.from({ length: 10 }, (_, i) => `${i + 1}. Bước ${i + 1}: đọc file, kiểm tra: đúng; ghi lại`).join('\n')
    const split = splitPayload(`Yêu cầu:\n${steps}`)
    expect(split.request).toContain('Bước 10')
    expect(split.payloadLines).toBe(0)
  })
})

describe('so khớp có dấu', () => {
  const brief = (overrides: Partial<Brief>): Brief => ({ ...analyzeHeuristic('Tính lượng hàng tồn', null, 1), ...overrides })

  test('"luồng" và "lượng" có dấu là hai từ khác nhau', () => {
    const prev = brief({ keywords: ['lượng'], goal: 'Tính lượng', steps: [], scopePaths: [] })
    expect(isRelated('Luồng dữ liệu bị sai khi gửi', prev)).toBe(false)
  })

  test('gõ không dấu vẫn nhận ra cùng chủ đề với mục tiêu có dấu', () => {
    const prev = brief({ keywords: ['thanh', 'toán'], goal: 'Sửa thanh toán', steps: [], scopePaths: [] })
    expect(isRelated('thanh toan bi loi khi tra gop', prev)).toBe(true)
  })
})

describe('đưa trạng thái cũ về dạng mới', () => {
  test('brief chỉ có tier được suy ra depth, volume; sổ và nâng cấp được điền mặc định', () => {
    // Trạng thái lưu từ bản 0.1.x: không có sổ, nâng cấp hay mốc thời gian.
    const legacy = {
      brief: { ...analyzeHeuristic('Viết hàm parseDate', null, 1), depth: undefined, volume: undefined, kind: undefined, hardSignals: undefined, tier: 'deep' as const },
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
