// Lợi ích ròng so với chạy thuần: cùng số token đo được, giá của model phiên, phần ghi lại cache do mod đổi model hay effort
// tính theo giá đọc (chặn trên bằng số token ghi thực), router là chi phí thêm. Số liệu tính tay theo giá 13/10/2026
// (Sonnet $2/$10 đọc cache $0.10, Opus $4/$20 đọc cache $0.20, Haiku $0.10/$0.50) và hệ số ghi cache 2.

import { describe, expect, test } from 'claude-code/testing'

import type { Ledger, ModelFamily } from '../types'
import { applyCacheWrite, applyPrices } from '../hooks/lib/cost'
import type { Tokens } from '../hooks/lib/cost'
import { addUsage, emptyLedger, ledgerLines, netLine, nextGoal, planSwitch, resetLedger } from '../hooks/lib/ledger'
import { EMPTY_CORE, normalizeCore } from '../hooks/lib/state'
import { PANE, base, conductor, plan, step, submit } from './support/engine'

const usage = (input: number, output: number, read: number, create: number): Tokens => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: create,
})

type Pair = { family: ModelFamily; effort: string }
const opus: Pair = { family: 'opus', effort: 'high' }
const sonnet: Pair = { family: 'sonnet', effort: 'medium' }

/** Đầu một turn luồng chính: model phiên là `session`, mod phục vụ `served`. */
function begin(ledger: Ledger, turnId: string, session: Pair, served: Pair | null, context: number, over: { isFree?: boolean; sysTokens?: number } = {}): Ledger {
  return planSwitch(ledger, { turnId, session, served, context, isFree: over.isFree ?? false, sysTokens: over.sysTokens ?? 20_000 })
}

/** Cuối turn: cộng usage của lượt đã phục vụ bằng `family`. */
const finish = (ledger: Ledger, family: ModelFamily, tokens: Tokens, group: 'main' | 'agent' | 'analyzer' = 'main'): Ledger => addUsage(ledger, group, family, tokens).ledger

function net(ledger: Ledger): { session: number; goal: number } {
  const b = ledger.baseline
  if (b === undefined) throw new Error('chưa có cơ sở so với chạy thuần')
  return {
    session: b.pure.session - (b.covered.session + ledger.session.analyzer.usd),
    goal: b.pure.goal - (b.covered.goal + ledger.goal.buckets.analyzer.usd),
  }
}

function closeTo(actual: number, expected: number): void {
  expect(Math.abs(actual - expected) < 1e-9).toBe(true)
}

function reset(): void {
  applyPrices({})
  applyCacheWrite(2)
}

describe('lợi ích ròng so với chạy thuần: sổ', () => {
  test('chưa có cơ sở: addUsage không đổi, không có dòng so sánh', () => {
    reset()
    const added = addUsage(emptyLedger(1), 'main', 'sonnet', usage(1000, 500, 0, 0)).ledger
    expect(added.baseline).toBeUndefined()
    expect(netLine(added)).toBeNull()
    // Có cơ sở nhưng chưa có lượt nào được tính: cũng chưa có dòng.
    expect(netLine(begin(emptyLedger(1), 't1', opus, sonnet, 50_000))).toBeNull()
    // Model của phiên chưa biết (không phải họ Claude): không tính.
    const unknown = finish(begin(emptyLedger(1), 't1', { family: null as unknown as ModelFamily, effort: '' }, sonnet, 50_000), 'sonnet', usage(1000, 500, 0, 0))
    expect(netLine(unknown)).toBeNull()
  })

  test('model phiên Opus, mod phục vụ Sonnet suốt hai turn, có chi phí router: tiết kiệm', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, sonnet, 50_000, { isFree: true })
    // Turn 1: 1000 vào, 2000 ra, 50000 ghi cache. Thật (Sonnet): 2000 + 20000 + 200000 = 222000. Chạy thuần (Opus): 4000 + 40000 + 400000 = 444000.
    ledger = finish(ledger, 'sonnet', usage(1000, 2000, 0, 50_000))
    ledger = begin(ledger, 't2', opus, sonnet, 52_000)
    // Turn 2 (không đổi model nên không bù): thật 1000 + 10000 + 5000 + 8000 = 24000; thuần 2000 + 20000 + 10000 + 16000 = 48000.
    ledger = finish(ledger, 'sonnet', usage(500, 1000, 50_000, 2000))
    // Router: 1000 vào, 500 ra ở giá Sonnet = 7000.
    ledger = finish(ledger, 'sonnet', usage(1000, 500, 0, 0), 'analyzer')
    closeTo(net(ledger).session, (444_000 + 48_000 - 222_000 - 24_000 - 7000) / 1_000_000)
    expect(netLine(ledger)).toBe('So với chạy thuần opus: phiên tiết kiệm ~$0.239, mục tiêu này tiết kiệm ~$0.239 (ước tính theo cùng số token, đã tính chi phí router)')
  })

  test('Opus sang Sonnet giữa phiên với 100K ngữ cảnh: phần ghi lại cache chạy thuần đã đọc được, kết quả là tốn thêm', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, opus, 100_000, { isFree: true })
    // Turn 1 chạy đúng model phiên: thật bằng thuần = 4000 + 20000 + 800000 = 824000.
    ledger = finish(ledger, 'opus', usage(1000, 1000, 0, 100_000))
    ledger = begin(ledger, 't2', opus, sonnet, 100_000)
    expect(ledger.baseline?.rewrite).toBe(100_000)
    // Turn 2: thật (Sonnet) 2000 + 10000 + 400000 = 412000; thuần (Opus) coi 100000 ghi là đọc: 4000 + 20000 + 20000 = 44000.
    ledger = finish(ledger, 'sonnet', usage(1000, 1000, 0, 100_000))
    expect(ledger.baseline?.rewrite).toBe(0)
    closeTo(net(ledger).session, (44_000 - 412_000) / 1_000_000)
    expect(netLine(ledger)).toContain('phiên tốn thêm ~$0.368, mục tiêu này tốn thêm ~$0.368')
  })

  test('chỉ đổi effort cùng họ: phần ghi lại là ngữ cảnh trừ phần cố định đo được', () => {
    reset()
    const high: Pair = { family: 'sonnet', effort: 'high' }
    const low: Pair = { family: 'sonnet', effort: 'low' }
    let ledger = begin(emptyLedger(1), 't1', high, high, 100_000, { isFree: true, sysTokens: 20_000 })
    ledger = begin(ledger, 't2', high, low, 100_000, { sysTokens: 20_000 })
    expect(ledger.baseline?.rewrite).toBe(80_000)
    // Chưa đo phần cố định (0): dùng giả định 20000.
    expect(begin(begin(emptyLedger(1), 't1', high, high, 100_000, { isFree: true, sysTokens: 0 }), 't2', high, low, 100_000, { sysTokens: 0 }).baseline?.rewrite).toBe(80_000)
    // Thật (Sonnet) 2000 + 5000 + 2000 + 400000 = 409000; thuần coi 80000 ghi là đọc: 2000 + 5000 + 10000 + 80000 = 97000.
    ledger = finish(ledger, 'sonnet', usage(1000, 500, 20_000, 100_000))
    closeTo(net(ledger).session, (97_000 - 409_000) / 1_000_000)
  })

  test('cache nguội hoặc vừa nén: chạy thuần cũng phải ghi, không bù', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, opus, 100_000, { isFree: true })
    ledger = finish(ledger, 'opus', usage(1000, 1000, 0, 100_000))
    ledger = begin(ledger, 't2', opus, sonnet, 100_000, { isFree: true })
    expect(ledger.baseline?.rewrite).toBe(0)
    ledger = finish(ledger, 'sonnet', usage(1000, 1000, 0, 100_000))
    // Thuần 824000 + 824000, thật 824000 + 412000.
    closeTo(net(ledger).session, (824_000 - 412_000) / 1_000_000)
    expect(netLine(ledger)).toContain('phiên tiết kiệm ~$0.412')
  })

  test('đổi qua lại trong TTL (Opus, Sonnet, Opus): bù chặn trên bằng số token ghi thực của lượt', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, opus, 100_000, { isFree: true })
    ledger = finish(ledger, 'opus', usage(1000, 1000, 0, 100_000))
    ledger = begin(ledger, 't2', opus, sonnet, 100_000)
    ledger = finish(ledger, 'sonnet', usage(1000, 1000, 0, 100_000))
    ledger = begin(ledger, 't3', opus, opus, 110_000)
    expect(ledger.baseline?.rewrite).toBe(110_000)
    // Cache Opus còn sống nên thật chỉ ghi 3000: thật 2000 + 16000 + 20000 + 24000 = 62000; thuần coi 3000 ghi là đọc:
    // 2000 + 16000 + 20600 = 38600 (không bù quá số token thật sự đã ghi).
    ledger = finish(ledger, 'opus', usage(500, 800, 100_000, 3000))
    const pure = 824_000 + 44_000 + 38_600
    const covered = 824_000 + 412_000 + 62_000
    closeTo(net(ledger).session, (pure - covered) / 1_000_000)
    expect(netLine(ledger)).toContain('phiên tốn thêm ~$0.391')
  })

  test('chính người dùng đổi model phiên: chạy thuần cũng mất cache, không bù', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, opus, 100_000, { isFree: true })
    ledger = finish(ledger, 'opus', usage(1000, 1000, 0, 100_000))
    // Người dùng chuyển phiên sang Sonnet; mod phục vụ đúng Sonnet.
    ledger = begin(ledger, 't2', sonnet, sonnet, 100_000)
    expect(ledger.baseline?.rewrite).toBe(0)
    ledger = finish(ledger, 'sonnet', usage(1000, 1000, 0, 100_000))
    expect(ledger.baseline?.family).toBe('sonnet')
    closeTo(net(ledger).session, 0)
  })

  test('tính phần chuyển đổi một lần mỗi turn, kể cả khi mod nạp lại giữa turn', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, opus, 100_000, { isFree: true })
    ledger = begin(ledger, 't2', opus, sonnet, 100_000)
    const again = begin(ledger, 't2', opus, sonnet, 100_000)
    expect(again).toBe(ledger)
    expect(again.baseline?.rewrite).toBe(100_000)
  })

  test('subagent tính theo model phiên, không bù ghi cache; router không vào cơ sở mà là chi phí thêm', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', sonnet, sonnet, 30_000, { isFree: true })
    // Thật (Haiku) 200 + 500 = 700; thuần (Sonnet) 4000 + 10000 = 14000.
    ledger = finish(ledger, 'haiku', usage(2000, 1000, 0, 0), 'agent')
    closeTo(net(ledger).session, (14_000 - 700) / 1_000_000)
    expect(netLine(ledger)).toContain('So với chạy thuần sonnet: phiên tiết kiệm ~$0.013')
    ledger = finish(ledger, 'sonnet', usage(1000, 500, 0, 0), 'analyzer')
    expect(netLine(ledger)).toContain('phiên tiết kiệm ~$0.006')
    expect(ledger.baseline?.pure.session).toBe(0.014)
  })

  test('mục tiêu mới zero phần mục tiêu, giữ phần phiên; reset bỏ cả cơ sở', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, sonnet, 50_000, { isFree: true })
    ledger = finish(ledger, 'sonnet', usage(1000, 2000, 0, 50_000))
    const next = nextGoal(ledger, 2)
    expect(next.baseline?.pure.goal).toBe(0)
    expect(next.baseline?.covered.goal).toBe(0)
    expect(next.baseline?.pure.session).toBe(ledger.baseline?.pure.session)
    expect(next.baseline?.covered.session).toBe(ledger.baseline?.covered.session)
    expect(netLine(next)).toContain('mục tiêu này tiết kiệm ~$0.0000')
    expect(resetLedger(ledger).baseline).toBeUndefined()
    expect(netLine(resetLedger(ledger))).toBeNull()
  })

  test('dòng so sánh nằm sau hai dòng đầu của ledgerLines (pane và status)', () => {
    reset()
    let ledger = begin(emptyLedger(1), 't1', opus, sonnet, 50_000, { isFree: true })
    ledger = finish(ledger, 'sonnet', usage(1000, 2000, 0, 50_000))
    const lines = ledgerLines(ledger)
    expect(lines[0]).toContain('Phiên, đo được')
    expect(lines[1]).toContain('Mục tiêu này, đo được')
    expect(lines[2]).toContain('So với chạy thuần opus')
  })

  test('trạng thái lưu từ bản cũ (không có cơ sở) vẫn đọc được', () => {
    expect(normalizeCore({ ...EMPTY_CORE, ledger: emptyLedger(1) }).ledger.baseline).toBeUndefined()
  })
})

describe('lợi ích ròng so với chạy thuần: hook', () => {
  const small = plan({ goal: 'Sửa typo', depth: 'none', kind: 'edit', main: { model: 'haiku', effort: 'low' } })
  const complete = ($: Parameters<typeof conductor>[0], tokens: Tokens, model: string) =>
    $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...tokens, model } } as never)

  test('luồng chính chạy haiku trong phiên opus: /conductor status và pane nêu tiết kiệm', {}, async ($, on) => {
    const seen = base(on, { router: () => small })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1', model: 'claude-opus-5-5', effort: 'high' })
    // Thật (Haiku) 300 + 500 = 800; thuần (Opus) 12000 + 20000 = 32000; router 7000: tiết kiệm 24200.
    await complete($, usage(3000, 1000, 0, 0), 'claude-haiku-5-5')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('So với chạy thuần opus: phiên tiết kiệm ~$0.024, mục tiêu này tiết kiệm ~$0.024')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /So với chạy thuần opus: phiên tiết kiệm/ })).toBeDefined()
    await pane.unmount()
  })

  test('chế độ subagents: luồng chính không đổi nhưng subagent vẫn được so với model phiên', { options: { routing: 'subagents' } }, async ($, on) => {
    const seen = base(on, { router: () => small })
    on('turn.complete', () => ({ text: '' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1', model: 'claude-sonnet-5-5', effort: 'medium' })
    const spawned = await $.agent.spawn({ prompt: 'Tìm file auth', description: 'Tìm file auth', subagentType: 'Explore' } as never)
    await $.turn.complete({ turnId: 'ag1', agentId: spawned.agentId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...usage(2000, 1000, 0, 0), model: 'claude-haiku-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('So với chạy thuần sonnet: phiên tiết kiệm ~$0.006')
  })

  test('/conductor reset xóa cơ sở: không còn dòng so sánh', {}, async ($, on) => {
    const seen = base(on, { router: () => small })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1', model: 'claude-opus-5-5', effort: 'high' })
    await complete($, usage(3000, 1000, 0, 0), 'claude-haiku-5-5')
    expect(String((await conductor($, 'status')).text)).toContain('So với chạy thuần')
    await conductor($, 'reset')
    expect(String((await conductor($, 'status')).text)).not.toContain('So với chạy thuần')
  })
})
