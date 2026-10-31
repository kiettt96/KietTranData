// 0.7.6 U5: status line bỏ từ tier (simple, deep); dạng "<thanh> 4/11 · BƯỚC 4 · opus": số bước, mã (hay tên ngắn) của bước hiện tại,
// họ model; giữ thanh chữ cho surface không có band. Chế độ khác auto vẫn ghi cuối.

import { describe, expect, test } from 'claude-code/testing'
import type { PlanStep, StepStatus } from '../types'
import { statusLine } from '../hooks/lib/text'
import { makeBrief } from './support/commands'

const route = { family: 'opus', effort: 'high', tier: 'deep', goalId: 1, reason: '' } as const
const brief = makeBrief({ tier: 'deep' })
const coded = (...statuses: StepStatus[]): PlanStep[] => statuses.map((status, i) => ({ id: i + 1, title: `BƯỚC ${i}: việc ${i}`, status }))

describe('0.7.6 U5: status line không có tier', () => {
  test('giữa chừng: "<thanh> 4/11 · BƯỚC 4 · opus"', () => {
    const plan = coded('done', 'done', 'done', 'done', 'doing', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo')
    expect(statusLine(brief, plan, route, 'auto')).toBe('━━━◐╌╌╌╌ 4/11 · BƯỚC 4 · opus')
  })

  test('không có từ tier ở mọi tier', () => {
    for (const tier of ['trivial', 'simple', 'moderate', 'complex', 'deep'] as const) {
      const line = statusLine(makeBrief({ tier }), coded('doing', 'todo'), route, 'auto')
      expect(line.includes(tier), tier).toBe(false)
    }
  })

  test('bước không có mã: tên ngắn của bước, cắt ở 24 ký tự', () => {
    const plan: PlanStep[] = [{ id: 1, title: 'Đổi tên userId thành accountId trong mọi controller', status: 'doing' }]
    expect(statusLine(brief, plan, route, 'auto')).toBe('◐╌╌╌╌╌╌╌ 0/1 · Đổi tên userId thành acc… · opus')
  })

  test('chưa có checklist: chỉ model; không có model thì tên chế độ; chế độ khác auto ghi cuối', () => {
    expect(statusLine(brief, [], route, 'auto')).toBe('opus')
    expect(statusLine(brief, [], null, 'auto')).toBe('auto')
    expect(statusLine(brief, coded('doing'), null, 'suggest')).toBe('◐╌╌╌╌╌╌╌ 0/1 · BƯỚC 0 · suggest')
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
  })
})
