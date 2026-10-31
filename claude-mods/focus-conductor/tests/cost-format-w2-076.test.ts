// 0.7.6 W2: mọi chỗ hiển thị chi phí (dòng ước tính, ledgerLines, /conductor status, bảng chi phí, band) dùng cùng một hàm định dạng
// formatCost: hai chữ số thập phân, dấu phẩy khi 'vi', dấu chấm khi 'en', dương dưới 0,01 thì "<$0,01"; không còn "$1.800".

import { describe, expect, test } from 'claude-code/testing'
import * as ledgerMod from '../hooks/lib/ledger'
import { addUsage, emptyLedger, estimateLine, ledgerLines } from '../hooks/lib/ledger'
import type { RouteEvent } from '../types'
import { PANE, base, plan, submit, task } from './support/engine'

// Hàm mới gọi qua import * để tệp nạp được cả trên mã trước khi sửa (đỏ ở khẳng định, không đỏ vì thiếu export).
const formatCost = (value: number, lang: 'vi' | 'en'): string => ((ledgerMod as Record<string, unknown>).formatCost as ((v: number, l: string) => string) | undefined)?.(value, lang) ?? ''
const call = (fn: unknown, ...args: unknown[]): string => (typeof fn === 'function' ? (fn as (...a: unknown[]) => string)(...args) : '')

const agentLog = (count: number): RouteEvent[] =>
  Array.from({ length: count }, (_, k) => ({ at: k, where: 'agent' as const, label: `a${k}`, family: 'haiku' as const, reason: '', isApplied: true, agentId: `x${k}`, usd: 0.03, measured: false }))

const USAGE = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }

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
