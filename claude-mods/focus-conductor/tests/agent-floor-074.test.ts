// 0.7.4 điểm 1: model người dùng chỉ định. Model Claude ghi ở lời gọi Agent là mức sàn (router và việc đã phân chỉ
// được nâng), effort chỉ làm sàn khi Claude ghi rõ; bỏ lượt router khi cả họ lẫn effort đã chốt ở mức trần; ràng buộc
// của brief (kể cả quy định model theo loại việc) đi kèm request chấm subagent; router đọc prompt biết model của phiên.

import { describe, expect, test } from 'claude-code/testing'

import type { Policy } from '../hooks/lib/router'
import { agentRouterRequest, agentSystem, floorPick, floorRoute, isSettled, routerRequest, routerSystem } from '../hooks/lib/router'
import type { AgentRoute } from '../hooks/lib/router'
import { DISCIPLINE } from '../hooks/lib/text'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }

function route(over: Partial<AgentRoute> = {}): AgentRoute {
  return { pick: { family: 'haiku', effort: 'low' }, agentType: 'general-purpose', depth: 'none', volume: 'small', kind: 'investigate', tier: 'trivial', why: 'tra cứu', ...over }
}

describe('0.7.4 1: floorPick nâng lên model và effort Claude ghi, không hạ', () => {
  test('router chấm haiku, Claude ghi sonnet: lên sonnet, giữ effort của router, có ghi chú', () => {
    const out = floorPick({ family: 'haiku', effort: 'low' }, 'sonnet', null)
    expect(out.pick).toEqual({ family: 'sonnet', effort: 'low' })
    expect(out.notes).toEqual(['Claude ghi sonnet: không chọn thấp hơn'])
  })

  test('effort chỉ làm sàn khi Claude ghi rõ effort', () => {
    expect(floorPick({ family: 'sonnet', effort: 'medium' }, 'sonnet', 'high').pick).toEqual({ family: 'sonnet', effort: 'high' })
    expect(floorPick({ family: 'sonnet', effort: 'medium' }, 'sonnet', 'high').notes).toEqual(['Claude ghi effort high: không chọn thấp hơn'])
    expect(floorPick({ family: 'sonnet', effort: 'medium' }, 'sonnet', null).pick).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('lựa chọn đã cao hơn sàn thì giữ nguyên, không ghi chú', () => {
    expect(floorPick({ family: 'opus', effort: 'high' }, 'sonnet', 'low')).toEqual({ pick: { family: 'opus', effort: 'high' }, notes: [] })
    expect(floorPick({ family: 'sonnet', effort: 'medium' }, null, null)).toEqual({ pick: { family: 'sonnet', effort: 'medium' }, notes: [] })
  })
})

describe('0.7.4 1: floorRoute áp sàn rồi mới kẹp theo chính sách', () => {
  test('sàn nâng route, lý do có ghi chú sàn', () => {
    const out = floorRoute(route(), 'sonnet', null, OPEN)
    expect(out.route.pick).toEqual({ family: 'sonnet', effort: 'low' })
    expect(out.route.why).toBe('tra cứu; Claude ghi sonnet: không chọn thấp hơn')
    expect(out.notes).toEqual(['Claude ghi sonnet: không chọn thấp hơn'])
  })

  test('không có sàn: route giữ nguyên, không ghi chú', () => {
    const r = route()
    expect(floorRoute(r, null, null, OPEN)).toEqual({ route: r, notes: [] })
  })

  test('fable không có allowFable vẫn về opus sau sàn', () => {
    expect(floorRoute(route(), 'fable', null, OPEN).route.pick.family).toBe('opus')
  })

  test('sessionModel ceiling vẫn kẹp sau sàn', () => {
    const policy: Policy = { ...OPEN, session: { family: 'sonnet', policy: 'ceiling' } }
    expect(floorRoute(route(), 'opus', null, policy).route.pick.family).toBe('sonnet')
  })

  test('sessionModel fixed vẫn giữ model của phiên sau sàn', () => {
    const policy: Policy = { ...OPEN, session: { family: 'sonnet', policy: 'fixed' } }
    // Route đã kẹp theo fixed (sonnet); Claude ghi opus: sàn nâng lên opus rồi fixed kẹp lại về sonnet.
    expect(floorRoute(route({ pick: { family: 'sonnet', effort: 'low' } }), 'opus', null, policy).route.pick.family).toBe('sonnet')
  })

  test('họ bị chặn (avoidBlocked) vẫn hạ sau sàn và có dòng ghi chú', () => {
    const policy: Policy = { ...OPEN, blocked: new Set(['opus'] as const) }
    const out = floorRoute(route({ kind: 'mixed' }), 'opus', null, policy)
    expect(out.route.pick).toEqual({ family: 'sonnet', effort: 'medium' })
    expect(out.route.why).toContain('opus đang bị chặn: dùng sonnet/medium')
  })

  test('haiku vẫn bị chặn khi việc có sửa file, dù Claude ghi haiku', () => {
    // Việc sửa file đã được kẹp lên sonnet; Claude ghi haiku và effort high: sàn chỉ nâng effort, họ vẫn là sonnet.
    const out = floorRoute(route({ kind: 'edit', pick: { family: 'sonnet', effort: 'low' } }), 'haiku', 'high', OPEN)
    expect(out.route.pick).toEqual({ family: 'sonnet', effort: 'high' })
  })
})

describe('0.7.4 1: isSettled: chỉ bỏ lượt router khi cả họ lẫn effort đã chốt ở mức trần', () => {
  test('auto, chưa bật allowFable: opus cùng effort là đã chốt; thiếu effort hay họ thấp hơn thì chưa', () => {
    expect(isSettled('opus', 'high', OPEN)).toBe(true)
    expect(isSettled('opus', null, OPEN)).toBe(false)
    expect(isSettled('sonnet', 'high', OPEN)).toBe(false)
    expect(isSettled(null, 'high', OPEN)).toBe(false)
  })

  test('bật allowFable: opus chưa ở trần, fable mới ở trần', () => {
    const policy: Policy = { ...OPEN, allowFable: true }
    expect(isSettled('opus', 'high', policy)).toBe(false)
    expect(isSettled('fable', 'high', policy)).toBe(true)
  })

  test('ceiling và fixed: trần là model của phiên', () => {
    expect(isSettled('sonnet', 'medium', { ...OPEN, session: { family: 'sonnet', policy: 'ceiling' } })).toBe(true)
    expect(isSettled('sonnet', 'medium', { ...OPEN, session: { family: 'sonnet', policy: 'fixed' } })).toBe(true)
    expect(isSettled('sonnet', null, { ...OPEN, session: { family: 'sonnet', policy: 'fixed' } })).toBe(false)
  })

  test('lựa chọn mà chính sách sẽ đổi (max, họ bị chặn) thì chưa chốt', () => {
    expect(isSettled('opus', 'max', OPEN)).toBe(false)
    expect(isSettled('opus', 'high', { ...OPEN, blocked: new Set(['opus'] as const) })).toBe(false)
  })
})

describe('0.7.4 1: request của router', () => {
  const base = {
    description: 'Lọc tin',
    prompt: 'Lọc tin theo tiêu chí',
    subagentType: undefined,
    requested: {},
    goal: 'Cập nhật dữ liệu',
    parent: null,
    failed: [],
    isWorkflow: false,
    policy: OPEN,
    model: 'sonnet',
  }

  test('request chấm subagent kèm ràng buộc của brief và quy tắc theo đúng model quy định', () => {
    const request = agentRouterRequest({ ...base, constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'] })
    expect(request.prompt).toContain('User rules of this goal (a rule that names a model for this kind of work must be followed, never a lower model):')
    expect(request.prompt).toContain('  - Việc lọc tin chạy sonnet\n  - Không tạo bộ kiểm mới')
  })

  test('ràng buộc cắt gọn tối đa khoảng 600 ký tự, mục đầu (quy định model) luôn còn', () => {
    const long = ['Việc lọc tin chạy sonnet', ...Array.from({ length: 12 }, (_, i) => `Ràng buộc dài số ${i} ${'x'.repeat(90)}`)]
    const request = agentRouterRequest({ ...base, constraints: long })
    const block = String(request.prompt).split('User rules of this goal')[1]?.split('\nAllowed models')[0] ?? ''
    expect(block.length).toBeLessThanOrEqual(700)
    expect(block).toContain('Việc lọc tin chạy sonnet')
  })

  test('không có ràng buộc: không có dòng User rules', () => {
    expect(agentRouterRequest(base).prompt).not.toContain('User rules')
    expect(agentRouterRequest({ ...base, constraints: [] }).prompt).not.toContain('User rules')
  })

  test('cả hai request ghi model của phiên khi biết', () => {
    expect(agentRouterRequest({ ...base, sessionFamily: 'opus' }).prompt).toContain('Session model (the model the user runs this session on): opus.')
    expect(agentRouterRequest(base).prompt).not.toContain('Session model')
    const read = routerRequest({ text: 'x', prev: null, ran: null, policy: OPEN, model: 'sonnet', sessionFamily: 'opus' })
    expect(read.prompt).toContain('Session model (the model the user runs this session on): opus.')
    expect(routerRequest({ text: 'x', prev: null, ran: null, policy: OPEN, model: 'sonnet' }).prompt).not.toContain('Session model')
  })

  test('lời dặn router đọc prompt: quy định model theo loại việc đứng đầu constraints, main không thấp hơn, việc theo đúng model', () => {
    const system = routerSystem()
    expect(system).toContain('A rule that sets a model for a kind of work (including "the session\'s model") is always the first constraint, kept with its model, and never dropped.')
    expect(system).toContain('"main" is never below the model the request sets for the main thread.')
    expect(system).toContain('A task whose kind of work the request sets a model for uses exactly that model; "the session\'s model" is the Session model in <context>.')
  })

  test('lời dặn router chấm subagent: model Claude ghi là mức sàn, ràng buộc model phải theo', () => {
    const system = agentSystem()
    expect(system).toContain('The model the main thread asked for is the lowest allowed: choose it or higher, never lower.')
    expect(system).toContain('If <context> lists a user rule that names a model for this kind of work, use that model ("the session\'s model" is the Session model in <context>).')
  })
})

describe('0.7.4 1: DISCIPLINE', () => {
  test('câu 5 dặn ghi rõ model người dùng quy định ở lời gọi Agent', () => {
    expect(DISCIPLINE).toContain('Prompt quy định model cho việc giao (kể cả "model của phiên") thì ghi rõ model đó ở lời gọi Agent (model của phiên ghi bằng tên họ model đang chạy); model ghi ở lời gọi là mức sàn, mod không chọn thấp hơn.')
  })
})
