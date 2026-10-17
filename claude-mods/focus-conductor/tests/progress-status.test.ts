// 0.6.1, thanh tiến độ 2.3: status line có thanh chữ 8 ô (cùng ký hiệu với barRuns, không màu) trước số đã đóng/tổng,
// cho các surface không có band (vscode, mobile). Phần còn lại của status line, kể cả nhãn hạn mức, giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { PlanStep, StepStatus } from '../types'
import { STATUS_BAR, statusLine, withQuotaStatus } from '../hooks/lib/text'
import { makeBrief } from './support/commands'

const planOf = (...statuses: StepStatus[]): PlanStep[] => statuses.map((status, i) => ({ id: i + 1, title: `Bước ${i + 1}`, status }))
const route = { family: 'opus', effort: 'high', tier: 'complex', goalId: 1, reason: '' } as const
const brief = makeBrief({ tier: 'complex' })

describe('0.6.1 2.3: thanh chữ trên status line', () => {
  test(`thanh ${STATUS_BAR} ô trước số đã đóng/tổng: 0, 1, nửa và đủ số bước`, () => {
    expect(STATUS_BAR).toBe(8)
    expect(statusLine(brief, planOf('todo', 'todo', 'todo', 'todo'), route, 'auto')).toBe('complex · opus/high · ╌╌╌╌╌╌╌╌ 0/4')
    expect(statusLine(brief, planOf('done', 'doing', 'todo', 'todo'), route, 'auto')).toBe('complex · opus/high · ━━◐╌╌╌╌╌ 1/4')
    expect(statusLine(brief, planOf('done', 'done', 'todo', 'todo'), route, 'auto')).toBe('complex · opus/high · ━━━━╌╌╌╌ 2/4')
    expect(statusLine(brief, planOf('done', 'verified', 'skipped', 'done'), route, 'auto')).toBe('complex · opus/high · ━━━━━━━━ 4/4')
  })

  test('bước bị chặn và đang chờ dùng ■ và ◇ như band; chế độ khác auto vẫn ghi cuối', () => {
    expect(statusLine(brief, planOf('done', 'blocked', 'todo', 'todo'), null, 'suggest')).toBe('complex · ━━■╌╌╌╌╌ 1/4 · suggest')
    expect(statusLine(brief, planOf('done', 'waiting'), null, 'auto')).toBe('complex · ━━━━◇╌╌╌ 1/2')
  })

  test('chưa có checklist: không có thanh, status line như cũ', () => {
    expect(statusLine(brief, [], route, 'auto')).toBe('complex · opus/high')
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
  })

  test('nhãn hạn mức của 0.6.1 vẫn đứng cuối', () => {
    expect(withQuotaStatus(statusLine(brief, planOf('done', 'todo'), route, 'auto'), { paused: true, left: null }, 'vi')).toBe('complex · opus/high · ━━━━╌╌╌╌ 1/2 · tạm dừng: hạn mức')
  })
})
