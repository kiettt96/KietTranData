// 0.7.6 W2: mọi chỗ hiển thị chi phí (dòng ước tính, ledgerLines, /conductor status, bảng chi phí, band) dùng cùng một hàm định dạng
// formatCost: hai chữ số thập phân, dấu phẩy khi 'vi', dấu chấm khi 'en', dương dưới 0,01 thì "<$0,01"; không còn "$1.800".

import { describe, expect, test } from 'claude-code/testing'
import * as ledgerMod from '../hooks/lib/ledger'
import { addUsage, emptyLedger, estimateLine, ledgerLines } from '../hooks/lib/ledger'
import type { RouteEvent } from '../types'
import type { Brief } from '../types'
import { createContext } from '../hooks/context'
import { EMPTY_CORE, normalizeCore } from '../hooks/lib/state'
import { BIG_USAGE, EDIT, FOUR, PANE, base, conductor, plan, spawnTool, submit, task } from './support/engine'

// Hàm mới gọi qua import * để tệp nạp được cả trên mã trước khi sửa (đỏ ở khẳng định, không đỏ vì thiếu export).
const formatCost = (value: number, lang: 'vi' | 'en'): string => ((ledgerMod as Record<string, unknown>).formatCost as ((v: number, l: string) => string) | undefined)?.(value, lang) ?? ''
const call = (fn: unknown, ...args: unknown[]): string => (typeof fn === 'function' ? (fn as (...a: unknown[]) => string)(...args) : '')

const agentLog = (count: number): RouteEvent[] =>
  Array.from({ length: count }, (_, k) => ({ at: k, where: 'agent' as const, label: `a${k}`, family: 'haiku' as const, reason: '', isApplied: true, agentId: `x${k}`, usd: 0.03, measured: false }))

const USAGE = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('0.7.6 W2: một hàm định dạng chi phí', () => {
  test('formatCost: hai chữ số, dấu theo ngôn ngữ, dưới 0,01 là "<$0,01"', () => {
    expect(formatCost(1.8, 'vi')).toBe('$1,80')
    expect(formatCost(1.8, 'en')).toBe('$1.80')
    expect(formatCost(0.004, 'vi')).toBe('<$0,01')
    expect(formatCost(0.004, 'en')).toBe('<$0.01')
    expect(formatCost(0, 'vi')).toBe('$0,00')
  })

  test('estimateLine: 60 subagent chưa đo ra "$1,80" và "60 subagent" khi vi', () => {
    const line = call((ledgerMod as Record<string, unknown>).estimateLine, agentLog(60), 'vi')
    expect(line).toContain('$1,80')
    expect(line).toContain('60 subagent')
    expect(line).not.toMatch(/\$\d+\.\d{3}/)
  })

  test('estimateLine: 60 subagent chưa đo ra "$1.80" và "60 subagents" khi en', () => {
    const line = call((ledgerMod as Record<string, unknown>).estimateLine, agentLog(60), 'en')
    expect(line).toContain('$1.80')
    expect(line).toContain('60 subagents')
    expect(line).toContain('Estimated at delegation')
  })

  test('estimateLine: mặc định vi, không có mục chưa đo thì null', () => {
    expect(estimateLine(agentLog(60))).toContain('$1,80')
    expect(estimateLine([])).toBeNull()
  })

  test('ledgerLines: không còn dạng ba hay bốn chữ số thập phân, en dùng dấu chấm', () => {
    const ledger = addUsage(emptyLedger(1), 'agent', 'haiku', USAGE).ledger
    const en = (ledgerMod.ledgerLines as (l: unknown, lang?: string) => string[])(ledger, 'en').join('\n')
    expect(ledgerLines(ledger).join('\n')).not.toMatch(/\$\d+[.,]\d{3}/)
    expect(en).not.toMatch(/\$\d+[.,]\d{3}/)
    expect(en).toMatch(/\$\d+\.\d{2}\b/)
  })

  test('pane: không có chuỗi chi phí ba chữ số thập phân', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa lớn', tasks: [task('Một', 'main', 'sonnet', 'medium')] }) })
    await submit($, 'Sửa lỗi đăng nhập trong module xác thực và thêm test')
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '')
    await pane.unmount()
    expect(texts.some(t => /\$\d+\.\d{3}/.test(t))).toBe(false)
  })
})

describe('0.7.6 W2: các chỗ hiển thị còn lại', () => {
  const brief = normalizeCore({ brief: { goalId: 1, goal: 'Sửa typo', tier: 'trivial' } as unknown as Brief }).brief as Brief
  const decide = (turnsLeft: number) =>
    createContext({}).mainDecision({
      core: { ...EMPTY_CORE, lastTurnAt: 1_000, lastContext: 100_000 },
      brief,
      wanted: { family: 'sonnet', effort: 'medium' },
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      at: 1_000 + 10 * 60_000,
      context: 100_000,
      window: 1_000_000,
      turnsLeft,
    })

  test('lý do giữ model của router: tiền ghi lại cache theo dạng vi hai chữ số', () => {
    const held = decide(2)
    expect(held.isHeld).toBe(true)
    expect(held.reason).toMatch(/ghi lại cache khoảng (\$\d+,\d{2}|<\$0,01)$/)
  })

  test('lý do hạ model của router: tiền tiết kiệm theo dạng vi hai chữ số', () => {
    const lowered = decide(500)
    expect(lowered.isHeld).toBe(false)
    expect(lowered.reason).toMatch(/tiết kiệm khoảng (\$\d+,\d{2}|<\$0,01),/)
  })

  const spawnOne = async ($: Parameters<typeof conductor>[0], on: Parameters<typeof base>[0]) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'est-1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    return spawnTool($, 'u-e', 'Việc 2: đổi tên userId', EDIT)
  }

  test('/conductor status vi: dòng ước tính và dòng cuối agent dùng "$x,xx"', async ($, on) => {
    await spawnOne($, on)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Ước tính lúc giao, chưa có số đo')
    expect(status).not.toMatch(/\$\d+\.\d{3}/)
    expect(status).toMatch(/\$\d+,\d{2} ước tính/)
  })

  test('/conductor status en: dòng ước tính và sổ chi phí bằng tiếng Anh, dấu chấm', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const spawned = await spawnOne($, on)
    const before = String((await conductor($, 'status')).text)
    expect(before).toContain('Estimated at delegation, not measured yet')
    expect(before).toMatch(/\$\d+\.\d{2} for 1 subagent \(/)
    expect(before).toMatch(/\$\d+\.\d{2} estimated/)
    await $.turn.complete({ turnId: 'ag1', agentId: spawned.agentId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Session, measured:')
    expect(status).toMatch(/subagents \$\d+\.\d{2} in 1 turns/)
    expect(status).not.toMatch(/\$\d+[.,]\d{3}/)
  })

  test('pane en: dòng ước tính bằng tiếng Anh, tiền dạng "$x.xx"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    await spawnOne($, on)
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '')
    await pane.unmount()
    expect(texts.some(t => /Estimated at delegation.*\$\d+\.\d{2} for 1 subagent/.test(t))).toBe(true)
    expect(texts.some(t => /\$\d+\.\d{3}/.test(t))).toBe(false)
  })
})
