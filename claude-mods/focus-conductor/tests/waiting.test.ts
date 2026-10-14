// 0.5.6 hạng mục B: trạng thái waiting, isFullyClosed/pendingSteps/restorableSteps, renderPlan, ngữ cảnh tiếp nối, giao diện.
// Là hàm thuần nên không cần engine; phần cổng Stop và thông báo đóng nằm ở tests/integration/waiting.test.ts.

import { describe, expect, test } from 'claude-code/testing'

import type { PlanStep, StepStatus } from '../types'
import { isFullyClosed, isGoalDone, openSteps, pendingSteps, restorableSteps } from '../hooks/lib/drift'
import { applyPlan } from '../hooks/lib/plan'
import { droppedPlanNotice, followUpContext, pendingNotice, renderPlan, skippedContext, stopBlockReason } from '../hooks/lib/text'
import { labels } from '../hooks/ui/labels'
import { STEP_MARK, STEP_ORDER, barRuns, currentStep, isClosed } from '../hooks/ui/style'
import { makeBrief } from './support/commands'

const planOf = (...statuses: StepStatus[]): PlanStep[] => statuses.map((status, i) => ({ id: i + 1, title: `Bước ${i + 1}`, status }))
const brief = makeBrief({ goal: 'Mục tiêu thử' })

describe('0.5.6 B1: status waiting', () => {
  test('waiting cần note; có note thì được nhận và lưu note', () => {
    const plan = planOf('todo', 'todo')
    expect(applyPlan(plan, { action: 'update', step: 1, status: 'waiting' }).error).toContain('cần note')
    const ok = applyPlan(plan, { action: 'update', step: 1, status: 'waiting', note: 'chờ lệnh nền' })
    expect(ok.error).toBeUndefined()
    expect(ok.plan?.[0]).toMatchObject({ status: 'waiting', note: 'chờ lệnh nền' })
  })

  test('thông báo lỗi status liệt kê waiting', () => {
    expect(applyPlan(planOf('todo'), { action: 'update', step: 1, status: 'xyz' }).error).toContain('waiting')
  })

  test('blocked vẫn cần note như cũ', () => {
    expect(applyPlan(planOf('todo'), { action: 'update', step: 1, status: 'blocked' }).error).toContain('cần note')
  })
})

describe('0.5.6 B2: hàm thuần cho checklist', () => {
  test('waiting và blocked không là bước mở (cổng Stop giữ nguyên)', () => {
    expect(openSteps(planOf('done', 'waiting', 'blocked'))).toEqual([])
    expect(isGoalDone(planOf('done', 'waiting', 'blocked'))).toBe(true)
    expect(openSteps(planOf('done', 'todo', 'waiting')).map(s => s.id)).toEqual([2])
  })

  test('isFullyClosed: checklist không rỗng và mọi bước done, verified hay skipped', () => {
    expect(isFullyClosed(planOf('done', 'verified', 'skipped'))).toBe(true)
    expect(isFullyClosed([])).toBe(false)
    for (const bad of ['todo', 'doing', 'blocked', 'waiting'] as const) expect(isFullyClosed(planOf('done', bad))).toBe(false)
  })

  test('pendingSteps: waiting rồi blocked, giữ thứ tự id trong mỗi nhóm', () => {
    const plan = planOf('blocked', 'waiting', 'done', 'waiting', 'blocked')
    expect(pendingSteps(plan).map(s => s.id)).toEqual([2, 4, 1, 5])
  })

  test('restorableSteps: todo, doing và waiting; blocked thì không', () => {
    expect(restorableSteps(planOf('todo', 'doing', 'waiting', 'blocked', 'done')).map(s => s.id)).toEqual([1, 2, 3])
  })
})

describe('0.5.6 B5: renderPlan', () => {
  test('không có bước waiting hay blocked: dòng tổng và toàn bộ văn bản giữ nguyên', () => {
    const out = renderPlan(brief, planOf('done', 'todo'))
    expect(out).toBe('Mục tiêu: Mục tiêu thử\nChecklist (1/2 đã đóng):\n[x] 1. Bước 1\n[ ] 2. Bước 2\nBước tiếp theo: 2. Bước 2')
  })

  test('dòng tổng thêm số bước đang chờ và bị chặn, bỏ vế bằng 0', () => {
    const plan = planOf('done', 'waiting', 'waiting', 'blocked', 'todo')
    expect(renderPlan(brief, plan)).toContain('Checklist (1/5 đã đóng, 2 đang chờ, 1 bị chặn):')
    expect(renderPlan(brief, planOf('done', 'waiting', 'todo'))).toContain('Checklist (1/3 đã đóng, 1 đang chờ):')
    expect(renderPlan(brief, planOf('done', 'blocked', 'todo'))).toContain('Checklist (1/3 đã đóng, 1 bị chặn):')
  })

  test('hàng của bước waiting mang dấu [w]', () => {
    expect(renderPlan(brief, [{ id: 1, title: 'a', status: 'waiting', note: 'chờ' }])).toContain('[w] 1. a (chờ)')
  })

  test('không còn bước mở mà còn waiting: in dòng Đang chờ thay cho Bước tiếp theo (tối đa 3 bước)', () => {
    const out = renderPlan(brief, planOf('done', 'waiting', 'waiting', 'waiting', 'waiting'))
    expect(out).toContain('Đang chờ: 2. Bước 2; 3. Bước 3; 4. Bước 4')
    expect(out).not.toContain('5. Bước 5;')
    expect(out).not.toContain('Bước tiếp theo')
  })

  test('còn bước mở thì vẫn in Bước tiếp theo', () => {
    expect(renderPlan(brief, planOf('waiting', 'todo'))).toContain('Bước tiếp theo: 2. Bước 2')
  })
})

describe('0.5.6 B3: pendingNotice và stopBlockReason', () => {
  test('pendingNotice nêu số bước chờ hoặc bị chặn, tối đa 3 bước, nói chưa tính là xong', () => {
    const text = pendingNotice(planOf('done', 'waiting', 'blocked', 'waiting', 'blocked'))
    expect(text).toContain('Không còn bước mở')
    expect(text).toContain('4 bước')
    expect(text).toContain('chưa tính là xong')
    expect(text).toContain('2. Bước 2')
    expect(text).not.toContain('5. Bước 5')
  })

  test('stopBlockReason giữ chuỗi cũ và chỉ dẫn waiting cho việc chờ', () => {
    const text = stopBlockReason(planOf('todo', 'doing'))
    expect(text).toContain('Checklist còn 2 bước mở')
    expect(text).toContain('waiting')
    expect(text).not.toContain('Nếu đang chờ người dùng, đánh dấu blocked')
  })
})

describe('0.5.6 B6: ngữ cảnh tiếp nối', () => {
  test('có bước waiting hoặc blocked: thêm dòng bước đang chờ kèm hướng dẫn đặt lại', () => {
    const plan = planOf('done', 'waiting', 'blocked', 'todo')
    for (const text of [followUpContext(brief, plan, []), skippedContext(brief, plan)]) {
      expect(text).toContain('Bước đang chờ hoặc bị chặn: 2. Bước 2; 3. Bước 3')
      expect(text).toContain('todo hoặc doing')
    }
  })

  test('plan không có bước waiting hay blocked: văn bản giữ nguyên từng ký tự', () => {
    const plan = planOf('done', 'todo')
    expect(followUpContext(brief, plan, [])).toBe(
      '[focus-conductor] Tiếp nối mục tiêu hiện tại: Mục tiêu thử\nBước còn mở: 2. Bước 2\nGiữ nhất quán với phần đã làm; nếu yêu cầu này đổi mục tiêu, cập nhật lại checklist.',
    )
    expect(skippedContext(brief, plan)).toBe(
      '[focus-conductor] Tiếp nối mục tiêu hiện tại: Mục tiêu thử\nPrompt nằm trong danh sách routerSkip nên router không đọc lại; giữ nguyên phân việc và điều phối đang có.\nBước còn mở: 2. Bước 2',
    )
  })
})

describe('0.5.6 B7: droppedPlanNotice', () => {
  test('chỉ có bước mở: văn bản giữ nguyên', () => {
    expect(droppedPlanNotice(planOf('todo', 'doing'))).toContain('Checklist cũ còn 2 bước mở đã được lưu')
  })

  test('có bước waiting: thêm vế đang chờ', () => {
    const text = droppedPlanNotice(planOf('todo', 'waiting', 'waiting'))
    expect(text).toContain('còn 1 bước mở và 2 bước đang chờ đã được lưu')
  })
})

describe('0.5.6 B8: giao diện', () => {
  const ALL: StepStatus[] = ['todo', 'doing', 'done', 'verified', 'skipped', 'blocked', 'waiting']

  test('STEP_MARK, STEP_ORDER và hai bảng nhãn phủ đủ mọi StepStatus', () => {
    expect(Object.keys(STEP_MARK).sort()).toEqual([...ALL].sort())
    expect([...STEP_ORDER].sort()).toEqual([...ALL].sort())
    expect(Object.keys(labels('vi').legend).sort()).toEqual([...ALL].sort())
    expect(Object.keys(labels('en').legend).sort()).toEqual([...ALL].sort())
  })

  test('waiting có ký hiệu riêng, không trùng sáu ký hiệu còn lại', () => {
    const glyphs = ALL.map(s => STEP_MARK[s].glyph)
    expect(new Set(glyphs).size).toBe(ALL.length)
  })

  test('waiting đứng ngay sau doing trong chú giải', () => {
    expect(STEP_ORDER.indexOf('waiting')).toBe(STEP_ORDER.indexOf('doing') + 1)
  })

  test('isClosed của waiting là false; currentStep theo thứ tự doing, blocked, todo, waiting', () => {
    expect(isClosed({ id: 1, title: 'a', status: 'waiting' })).toBe(false)
    expect(currentStep(planOf('waiting', 'todo'))?.status).toBe('todo')
    expect(currentStep(planOf('waiting', 'blocked'))?.status).toBe('blocked')
    expect(currentStep(planOf('done', 'waiting'))?.status).toBe('waiting')
    expect(currentStep(planOf('waiting', 'doing'))?.status).toBe('doing')
  })

  test('đầu thanh của bước waiting dùng ký hiệu waiting', () => {
    const runs = barRuns(planOf('done', 'waiting', 'waiting'), 12)
    expect(runs.some(r => r.text === STEP_MARK.waiting.glyph)).toBe(true)
  })
})
