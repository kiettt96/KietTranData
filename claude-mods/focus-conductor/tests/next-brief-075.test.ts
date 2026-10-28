// 0.7.5 B12: checklist còn bước mở mà router xếp prompt là mục tiêu mới với tin cậy dưới 0,8: coi là tiếp nối và ghi nhật ký
// quyết định. Nhận mục tiêu mới thì mang theo quy định model của brief trước khi prompt mới không nêu quy định model nào.

import { describe, expect, test } from 'claude-code/testing'
import * as R from '../hooks/lib/router'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { makeBrief } from './support/commands'
import { COMPLEX_PROMPT, base, plan, submit } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const prev = makeBrief({ goalId: 4, goal: 'Cập nhật dữ liệu theo 11 bước', constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'] })

describe('0.7.5 B12: tin cậy thấp khi checklist còn mở', () => {
  test('ngưỡng là 0,8', () => {
    expect((R as Record<string, unknown>)['NEW_GOAL_CONFIDENCE']).toBe(0.8)
  })

  test('new với tin cậy 0,6, checklist còn bước mở: coi là tiếp nối, giữ mục tiêu', () => {
    const out = (nextBrief as (...a: unknown[]) => ReturnType<typeof nextBrief> & { held?: boolean })(prev, routed({ relation: 'new', confidence: 0.6, goal: 'Một việc khác' }), 'làm BƯỚC 8', 2, { openSteps: ['Phân tích', 'Làm BƯỚC 8'] })
    expect(out.isNewGoal).toBe(false)
    expect(out.brief.goalId).toBe(4)
    expect(out.brief.goal).toBe('Cập nhật dữ liệu theo 11 bước')
    expect(out.held).toBe(true)
  })

  test('tin cậy từ 0,8 trở lên, hay checklist không còn bước mở: nhận mục tiêu mới', () => {
    const call = nextBrief as (...a: unknown[]) => ReturnType<typeof nextBrief>
    expect(call(prev, routed({ relation: 'new', confidence: 0.85, goal: 'Một việc khác' }), 'p', 2, { openSteps: ['Phân tích', 'Làm BƯỚC 8'] }).isNewGoal).toBe(true)
    expect(call(prev, routed({ relation: 'new', confidence: 0.6, goal: 'Một việc khác' }), 'p', 2, { openSteps: [] }).isNewGoal).toBe(true)
  })
})

describe('0.7.5 B12: mang theo quy định model', () => {
  test('mục tiêu mới không nêu quy định model: mang quy định model của brief trước, đứng đầu', () => {
    const out = nextBrief(prev, routed({ relation: 'new', goal: 'Một việc khác', constraints: ['Giữ định dạng cũ'] }), 'p', 2)
    expect(out.brief.constraints).toEqual(['Việc lọc tin chạy sonnet', 'Giữ định dạng cũ'])
  })

  test('mục tiêu mới nêu quy định model khác: không mang quy định cũ', () => {
    const out = nextBrief(prev, routed({ relation: 'new', goal: 'Một việc khác', constraints: ['Việc tổng hợp chạy opus'] }), 'p', 2)
    expect(out.brief.constraints).toEqual(['Việc tổng hợp chạy opus'])
  })
})

describe('0.7.5 B12: nhật ký quyết định', () => {
  test('lần giữ mục tiêu được ghi vào nhật ký', { options: { decisionLog: '/tmp/fc-075-b12.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    base(on, { router: request => (request.startsWith('làm') ? plan({ relation: 'new', confidence: 0.5, goal: 'Khác' }) : plan({ goal: 'Refactor thanh toán', depth: 'hard', volume: 'large' })) })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    await submit($, 'làm tiếp phần thiết kế')
    const lines = (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.some(line => line['kind'] === 'new-held' && line['confidence'] === 0.5)).toBe(true)
  })
})
