// Ranh giới số học của các ngưỡng quyết định: mỗi test dùng số cụ thể ở hai phía ngưỡng, không đọc lại hằng của mod, để đổi
// ngưỡng (hoặc đổi `>` thành `>=`) là test đỏ. Gồm: hỏi lại router khi tin cậy thấp, số mục tiêu cất tối đa, cache nguội theo
// TTL, ngữ cảnh co lại sau khi nén, và stop_hook_active ở hook Stop.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, Choice, Core, PlanStep, Route } from '../types'
import { createContext } from '../hooks/context'
import { askRouter, parseRoute, routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { EMPTY_CORE, adoptGoal, normalizeCore } from '../hooks/lib/state'
import { COMPLEX_PROMPT, base, submit } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('hỏi lại router khi tin cậy thấp', () => {
  const reply = (confidence: number) =>
    JSON.stringify({
      why: 'w',
      confidence,
      relation: 'new',
      reference: false,
      goal: 'Sửa lỗi đăng nhập',
      constraints: [],
      quality: [],
      scope: [],
      depth: 'light',
      volume: 'small',
      kind: 'edit',
      main: { model: 'sonnet', effort: 'medium', why: '' },
      tasks: [],
    })
  const request = routerRequest({ text: 'Sửa lỗi đăng nhập', prev: null, ran: null, policy: OPEN, model: 'sonnet' })

  async function asks(confidence: number): Promise<number> {
    let count = 0
    const ask = async () => {
      count += 1
      return { isAnswered: true as const, text: reply(confidence), usage: USAGE }
    }
    await askRouter(ask, request, text => parseRoute(text, OPEN))
    return count
  }

  test('dưới 0,4 thì hỏi lại đúng một lần (0,35 và 0,39)', async () => {
    expect(await asks(0.35)).toBe(2)
    expect(await asks(0.39)).toBe(2)
  })

  test('từ 0,4 trở lên thì không hỏi lại (0,4 và 0,45)', async () => {
    expect(await asks(0.4)).toBe(1)
    expect(await asks(0.45)).toBe(1)
    expect(await asks(0.9)).toBe(1)
  })
})

describe('mục tiêu đã cất', () => {
  const goal = (id: number): Brief => normalizeCore({ brief: { goalId: id, goal: `Mục tiêu ${id}`, tier: 'simple' } as unknown as Brief }).brief as Brief
  const open: PlanStep[] = [{ id: 1, title: 'Bước còn mở', status: 'todo' }]

  test('cất tối đa 3 mục tiêu còn bước mở, mới nhất trước', () => {
    let core: Core = { ...EMPTY_CORE }
    for (let id = 1; id <= 5; id++) core = { ...adoptGoal(goal(id))(core), plan: open }
    // Mục tiêu 5 đang chạy; 1 đã bị đẩy khỏi danh sách cất.
    expect(core.archived.map(a => a.brief.goalId)).toEqual([4, 3, 2])
  })

  test('mục tiêu không còn bước mở thì không được cất', () => {
    const done: PlanStep[] = [{ id: 1, title: 'Xong', status: 'verified', note: 'ok' }]
    let core: Core = { ...EMPTY_CORE }
    for (let id = 1; id <= 3; id++) core = { ...adoptGoal(goal(id))(core), plan: done }
    expect(core.archived).toEqual([])
  })
})

describe('cache nguội và ngữ cảnh co lại: đổi model không mất chi phí ghi lại', () => {
  const brief = normalizeCore({ brief: { goalId: 1, goal: 'Sửa typo', tier: 'trivial' } as unknown as Brief }).brief as Brief
  const wanted: Choice = { family: 'sonnet', effort: 'medium' }
  const LAST = 1_000

  /** Đang chạy opus/xhigh, router muốn hạ xuống sonnet/medium: ghi lại cache đắt hơn lợi ích nên giữ, trừ khi cache nguội hoặc vừa nén. */
  function decide(options: Record<string, string | number | boolean>, over: { at: number; context: number; lastContext?: number; lastTurnAt?: number }) {
    const ctx = createContext(options)
    return ctx.mainDecision({
      core: { ...EMPTY_CORE, lastTurnAt: over.lastTurnAt ?? LAST, lastContext: over.lastContext ?? 100_000 },
      brief,
      wanted,
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      at: over.at,
      context: over.context,
      window: 1_000_000,
      turnsLeft: 2,
    })
  }

  test('TTL 5 phút: đúng 5 phút kể từ turn trước thì cache còn nóng, thêm 1 ms thì nguội', () => {
    const five = { cacheTtlMinutes: '5' }
    expect(decide(five, { at: LAST + 299_999, context: 100_000 }).isHeld).toBe(true)
    expect(decide(five, { at: LAST + 300_000, context: 100_000 }).isHeld).toBe(true)
    const cold = decide(five, { at: LAST + 300_001, context: 100_000 })
    expect(cold.isHeld).toBe(false)
    expect(cold.route.family).toBe('sonnet')
    expect(cold.reason).toContain('cache đã nguội')
  })

  test('TTL mặc định 60 phút: đúng 60 phút thì còn nóng, thêm 1 ms thì nguội', () => {
    expect(decide({}, { at: LAST + 3_600_000, context: 100_000 }).isHeld).toBe(true)
    expect(decide({}, { at: LAST + 3_600_001, context: 100_000 }).isHeld).toBe(false)
    // Quá 5 phút nhưng chưa tới 60 phút: với bậc 1 giờ cache vẫn còn nóng.
    expect(decide({}, { at: LAST + 10 * 60_000, context: 100_000 }).isHeld).toBe(true)
  })

  test('turn đầu của phiên (chưa có mốc thời gian) thì đổi không mất gì', () => {
    expect(decide({}, { at: LAST + 1, context: 100_000, lastTurnAt: 0, lastContext: 0 }).isHeld).toBe(false)
  })

  test('đã có route nhưng chưa có mốc thời gian của turn (lastTurnAt 0) thì coi cache là nguội: đổi không mất gì, dù thời điểm hiện tại còn trong TTL', () => {
    const route: Route = { family: 'opus', effort: 'xhigh', tier: 'trivial', goalId: 1, reason: 'đã chạy' }
    const call = (lastTurnAt: number) =>
      createContext({}).mainDecision({
        core: { ...EMPTY_CORE, route, lastTurnAt, lastContext: 100_000 },
        brief,
        wanted,
        model: 'claude-opus-5-5',
        effort: 'xhigh',
        at: LAST + 1,
        context: 100_000,
        window: 1_000_000,
        turnsLeft: 2,
      })
    expect(call(0).isHeld).toBe(false)
    // Đối chứng: cùng trạng thái, có mốc turn trước 1 ms thì cache còn nóng nên giữ.
    expect(call(LAST).isHeld).toBe(true)
  })

  test('ngữ cảnh co dưới 60% ngữ cảnh turn trước là đã nén: 55% và 59,999% là nén, đúng 60% và 65% thì không', () => {
    const at = LAST + 1000
    expect(decide({}, { at, context: 55_000 }).isHeld).toBe(false)
    expect(decide({}, { at, context: 59_999 }).isHeld).toBe(false)
    expect(decide({}, { at, context: 60_000 }).isHeld).toBe(true)
    expect(decide({}, { at, context: 65_000 }).isHeld).toBe(true)
    expect(decide({}, { at, context: 100_000 }).isHeld).toBe(true)
  })

  test('chưa biết ngữ cảnh turn trước (0) thì không suy ra là đã nén', () => {
    expect(decide({}, { at: LAST + 1000, context: 100_000, lastContext: 0 }).isHeld).toBe(true)
  })
})

describe('hook Stop và stop_hook_active', () => {
  test('stop_hook_active: true thì không chặn nữa (tránh vòng lặp); false thì chặn khi checklist còn mở', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', goal: 'Refactor thanh toán', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    expect((await $.classic.Stop({ stop_hook_active: true })).block).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
  })
})
