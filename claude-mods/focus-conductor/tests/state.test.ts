// Trạng thái mục tiêu (hooks/lib/state, plan): chốt lại mục tiêu qua tool plan, status line, checklist.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { applyPlan } from '../hooks/lib/plan'
import { normalizeCore, retarget } from '../hooks/lib/state'
import { droppedPlanNotice, statusLine } from '../hooks/lib/text'
import type { Brief, Route, Task } from '../types'
import { makeBrief } from './support/commands'

function route(family: Route['family'], effort: Route['effort']): Route {
  return { family, effort, tier: 'complex', goalId: 1, reason: '' }
}

function task(index: number, title: string, over: Partial<Task> = {}): Task {
  return {
    index,
    title,
    run: 'agent',
    agentType: 'general-purpose',
    pick: { family: 'sonnet', effort: 'medium' },
    depth: 'light',
    volume: 'small',
    kind: 'edit',
    why: '',
    ...over,
  }
}

describe('05: plan set với steps rỗng thay toàn bộ checklist', () => {
  const current = [
    { id: 1, title: 'a', status: 'todo' as const },
    { id: 2, title: 'b', status: 'doing' as const },
  ]

  test('steps: [] kèm goal thì xóa checklist; không truyền steps thì giữ', () => {
    expect(applyPlan(current, { action: 'set', goal: 'Mục tiêu mới', steps: [] }).plan).toEqual([])
    expect(applyPlan(current, { action: 'set', steps: [] }).plan).toEqual([])
    expect(applyPlan(current, { action: 'set', goal: 'Mục tiêu mới' }).plan).toEqual(current)
  })

  test('steps khác rỗng mà không có bước hợp lệ thì báo lỗi, không lặng lẽ giữ', () => {
    expect(applyPlan(current, { action: 'set', goal: 'G', steps: [{ title: '' }, 3] }).error).toContain('không có bước hợp lệ')
  })
})

describe('trạng thái và chốt lại mục tiêu', () => {
  test('brief 0.3.x (heuristic, có prompt đính kèm) đọc được: không có lựa chọn của router, không ép', () => {
    const old = {
      goalId: 3,
      goal: 'Đối chiếu',
      steps: ['a'],
      subtasks: [{ index: 1, title: 'x', depth: 'light', volume: 'small', kind: 'edit', hardSignals: [] }],
      constraints: [],
      quality: [],
      depth: 'light',
      volume: 'small',
      kind: 'answer',
      hardSignals: [],
      tier: 'simple',
      score: 10,
      signals: [],
      source: 'heuristic',
      isFollowUp: false,
      keywords: [],
      scopePaths: [],
      prompt: 'p',
      at: 5,
      attached: { depth: 'hard', volume: 'large', kind: 'mixed', subtasks: [] },
    }
    const brief = normalizeCore({ brief: old as unknown as Brief }).brief
    expect(brief?.main).toBeNull()
    expect(brief?.tasks).toEqual([])
    expect(brief?.isReference).toBe(true)
    expect(brief?.source).toBe('none')
    expect(brief?.relation).toBe('new')
    expect(brief?.steps).toEqual(['a'])
    expect('subtasks' in (brief ?? {})).toBe(false)
  })

  test('brief 0.1.x chỉ có tier vẫn suy ra độ sâu và khối lượng', () => {
    const brief = normalizeCore({ brief: { goalId: 1, goal: 'g', tier: 'deep' } as unknown as Brief }).brief
    expect(brief?.depth).toBe('hard')
    expect(brief?.volume).toBe('large')
    expect(brief?.main).toBeNull()
  })

  test('chốt lại mục tiêu qua tool plan chỉ thay mục tiêu và bước; việc đã phân và lựa chọn giữ nguyên', () => {
    const brief = makeBrief({ tasks: [task(1, 'a')] })
    const next = retarget(brief, '  Mục tiêu mới  ', ['b', 'c'])
    expect(next.goal).toBe('Mục tiêu mới')
    expect(next.steps).toEqual(['b', 'c'])
    expect(next.tasks).toEqual(brief.tasks)
    expect(next.main).toEqual(brief.main)
    expect(retarget(brief, undefined, []).goal).toBe(brief.goal)
  })
})

describe('status line và báo checklist bị bỏ', () => {
  test('status line không lặp tiền tố tên plugin mà engine đã thêm', () => {
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
    const brief = makeBrief({ tier: 'complex' })
    expect(statusLine(brief, [], route('opus', 'high'), 'auto')).toBe('complex · opus/high')
    expect(statusLine(brief, [], route('opus', 'high'), 'suggest')).toBe('complex · opus/high · suggest')
  })

  test('báo cho Claude biết checklist cũ còn bao nhiêu bước mở đã bị bỏ', () => {
    const notice = droppedPlanNotice([
      { id: 1, title: 'Viết hooks', status: 'todo' },
      { id: 2, title: 'Viết test', status: 'doing' },
    ])
    expect(notice).toContain('còn 2 bước mở')
    expect(notice).toContain('Viết hooks; Viết test')
    expect(notice).toContain('mcp__focus-conductor__plan')
  })
})

describe('checklist', () => {
  test('verified cần bằng chứng, skipped cần lý do', () => {
    const set = applyPlan([], { action: 'set', goal: 'G', steps: [{ title: 'a' }, { title: 'b' }] })
    expect(set.plan?.length).toBe(2)
    const plan = set.plan ?? []
    expect(applyPlan(plan, { action: 'update', step: 1, status: 'verified' }).error).toBeDefined()
    expect(applyPlan(plan, { action: 'update', step: 2, status: 'skipped' }).error).toBeDefined()
    const ok = applyPlan(plan, { action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 passed' })
    expect(ok.plan?.[0]?.status).toBe('verified')
    expect(applyPlan(plan, { action: 'update', step: 9, status: 'done' }).error).toContain('Không có bước id 9')
  })
})
