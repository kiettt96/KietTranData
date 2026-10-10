// Test thuần của router: request gửi model router, đọc JSON trả về, kiểm và kẹp lựa chọn
// theo chính sách, và brief dựng từ kế hoạch của router.

import { describe, expect, test } from 'claude-code/testing'

import type { Brief, ModelFamily } from '../types'
import {
  agentRouterRequest,
  bareBrief,
  briefOf,
  fitPick,
  followUpOf,
  parseAgentRoute,
  parseRoute,
  promoteReference,
  routerRequest,
  taskRoute,
} from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { K4_META_LEAD, K4_PROMPT } from './fixtures/prompt-k4'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) ? value.map(b => (b as { text: string }).text).join('') : ''
}

const REPLY = {
  why: 'Ba việc độc lập',
  relation: 'new',
  reference: false,
  goal: 'Làm ba việc trong shop-api',
  constraints: ['Không đổi API công khai'],
  quality: ['Test pass'],
  scope: ['src/payments/', 'module thanh toán', 'README.md'],
  depth: 'substantial',
  volume: 'medium',
  kind: 'mixed',
  main: { model: 'opus', effort: 'high', why: 'việc 2 khó' },
  tasks: [
    { title: 'Tìm chỗ gọi charge', run: 'agent', agent: 'Explore', model: 'haiku', effort: 'low', depth: 'none', volume: 'small', kind: 'investigate', why: 'tra cứu' },
    { title: 'Thiết kế lại thanh toán đa tiền tệ', run: 'main', model: 'opus', effort: 'high', depth: 'hard', volume: 'medium', kind: 'mixed', why: 'khó' },
    { title: 'Viết unit test cho refund', run: 'agent', agent: 'general-purpose', model: 'sonnet', effort: 'medium', depth: 'light', volume: 'small', kind: 'edit', why: 'độc lập' },
  ],
}

function plan(over: Record<string, unknown> = {}, policy: Policy = OPEN): RouterPlan {
  const parsed = parseRoute(JSON.stringify({ ...REPLY, ...over }), policy)
  if (parsed === null) throw new Error('router reply không đọc được')
  return parsed
}

describe('request gửi router', () => {
  test('system prompt đánh dấu cache; context có mục tiêu trước, model đã chạy và họ model được phép', () => {
    const prev = briefOf(plan(), 'p', 1, 1)
    const request = routerRequest({
      text: 'Sửa tiếp phần refund',
      prev,
      ran: 'opus/high',
      policy: { allowFable: false, blocked: new Set<ModelFamily>(['opus']), session: { family: 'opus', policy: 'ceiling' } },
      model: 'sonnet',
    })
    expect(request.model).toBe('sonnet')
    expect(request.effort).toBe('medium')
    const system = request.system as readonly { text: string; cache?: boolean }[]
    expect(system[0]?.cache).toBe(true)
    expect(system[0]?.text).toContain('You are the router')
    const prompt = textOf(request.prompt)
    expect(prompt).toContain('Previous goal: Làm ba việc trong shop-api')
    expect(prompt).toContain('1. Tìm chỗ gọi charge (Explore haiku/low)')
    expect(prompt).toContain('Main thread ran: opus/high')
    expect(prompt).toContain('Allowed models: haiku, sonnet (the user caps every choice at opus).')
    expect(prompt).toContain('<request>\nSửa tiếp phần refund\n</request>')
  })

  test('không có mục tiêu trước; fable chỉ có trong danh sách khi được phép; lệnh goal ép mục tiêu mới', () => {
    const request = routerRequest({ text: 'x', prev: null, ran: null, policy: { ...OPEN, allowFable: true }, model: 'opus', isForcedNew: true })
    const prompt = textOf(request.prompt)
    expect(prompt).toContain('Previous goal: none.')
    expect(prompt).toContain('Allowed models: haiku, sonnet, opus, fable.')
    expect(prompt).toContain('relation must be "new"')
    expect(textOf(routerRequest({ text: 'x', prev: null, ran: null, policy: OPEN, model: 'sonnet' }).prompt)).toContain('Allowed models: haiku, sonnet, opus.')
  })

  test('prompt dài (K4 kèm câu mở) được gửi trọn vẹn, với nhiều token và thời gian hơn', () => {
    const text = `${K4_META_LEAD}\n${K4_PROMPT}`
    const request = routerRequest({ text, prev: null, ran: null, policy: OPEN, model: 'sonnet' })
    const prompt = textOf(request.prompt)
    expect(prompt).toContain(K4_META_LEAD)
    expect(prompt).toContain(K4_PROMPT)
    expect(prompt).not.toContain('ký tự ở giữa')
    expect(request.maxTokens).toBe(16_000)
    expect(request.timeoutMs).toBe(120_000)
    const short = routerRequest({ text: 'Sửa lỗi', prev: null, ran: null, policy: OPEN, model: 'sonnet' })
    expect(short.maxTokens).toBe(8_000)
    expect(short.timeoutMs).toBe(45_000)
  })

  test('yêu cầu quá 80.000 ký tự giữ đầu và cuối, ghi chú phần lược', () => {
    const text = `ĐẦU${'a'.repeat(100_000)}CUỐI`
    const prompt = textOf(routerRequest({ text, prev: null, ran: null, policy: OPEN, model: 'sonnet' }).prompt)
    expect(prompt).toContain('ĐẦU')
    expect(prompt).toContain('CUỐI')
    expect(prompt).toContain('[... lược 20007 ký tự ở giữa ...]')
    expect(prompt.length).toBeLessThan(81_000)
  })

  test('request chấm subagent có gợi ý của Claude, agent cha, việc đã lỗi, và effort thấp', () => {
    const request = agentRouterRequest({
      description: 'Tìm chỗ gọi charge',
      prompt: 'Tìm trong src',
      subagentType: 'Explore',
      requested: { model: 'opus', effort: 'high' },
      goal: 'Nâng cấp thanh toán',
      parent: { description: 'Rà soát', pick: { family: 'opus', effort: 'high' } },
      failed: ['Sửa webhook'],
      isWorkflow: true,
      policy: OPEN,
      model: 'sonnet',
    })
    const prompt = textOf(request.prompt)
    expect(request.effort).toBe('low')
    expect(request.timeoutMs).toBe(20_000)
    expect(prompt).toContain('The main thread asked for: agent type Explore, model opus, effort high.')
    expect(prompt).toContain('Started from inside another subagent: Rà soát (opus/high)')
    expect(prompt).toContain('Started by a workflow script.')
    expect(prompt).toContain('  - Sửa webhook')
    expect(prompt).toContain('Description: Tìm chỗ gọi charge')
  })
})

describe('đọc JSON của router', () => {
  test('đọc đủ kế hoạch: mục tiêu, việc, lựa chọn luồng chính; phạm vi chỉ giữ mục dạng đường dẫn', () => {
    const p = plan()
    expect(p.goal).toBe('Làm ba việc trong shop-api')
    expect(p.main).toEqual({ family: 'opus', effort: 'high' })
    expect(p.tasks.map(t => [t.index, t.run, t.agentType ?? '-', `${t.pick.family}/${t.pick.effort}`])).toEqual([
      [1, 'agent', 'Explore', 'haiku/low'],
      [2, 'main', '-', 'opus/high'],
      [3, 'agent', 'general-purpose', 'sonnet/medium'],
    ])
    expect(p.scope).toEqual(['src/payments/', 'README.md'])
    expect(p.constraints).toEqual(['Không đổi API công khai'])
  })

  test('chịu được code fence và chữ thừa quanh JSON', () => {
    const fenced = parseRoute(`Đây là kế hoạch:\n\`\`\`json\n${JSON.stringify(REPLY)}\n\`\`\`\nXong.`, OPEN)
    expect(fenced?.tasks.length).toBe(3)
  })

  test('không có JSON, JSON hỏng, thiếu main hoặc main sai, mục tiêu mới không có câu mục tiêu: không dùng được', () => {
    expect(parseRoute('không có gì', OPEN)).toBeNull()
    expect(parseRoute('{"main": ', OPEN)).toBeNull()
    expect(parseRoute(JSON.stringify({ ...REPLY, main: undefined }), OPEN)).toBeNull()
    expect(parseRoute(JSON.stringify({ ...REPLY, main: { model: 'gpt', effort: 'low' } }), OPEN)).toBeNull()
    expect(parseRoute(JSON.stringify({ ...REPLY, main: { model: 'opus', effort: 'turbo' } }), OPEN)).toBeNull()
    expect(parseRoute(JSON.stringify({ ...REPLY, goal: '' }), OPEN)).toBeNull()
    // Tiếp nối thì không cần câu mục tiêu.
    expect(parseRoute(JSON.stringify({ ...REPLY, goal: '', relation: 'refine' }), OPEN)?.relation).toBe('refine')
  })

  test('nhãn sai thì dùng mặc định; việc giao mà thiếu model hợp lệ thì làm ở luồng chính; việc không có tên bị bỏ', () => {
    const p = plan({
      depth: 'very hard',
      relation: 'weird',
      tasks: [
        { title: 'Việc thiếu model', run: 'agent', agent: 'Explore', effort: 'low' },
        { title: '', run: 'agent', model: 'haiku', effort: 'low' },
        { title: 'Việc sửa giao Explore', run: 'agent', agent: 'Explore', model: 'sonnet', effort: 'medium', kind: 'edit' },
      ],
    })
    expect(p.depth).toBe('light')
    expect(p.relation).toBe('new')
    expect(p.tasks.length).toBe(2)
    expect(p.tasks[0]?.run).toBe('main')
    expect(p.tasks[0]?.pick).toEqual({ family: 'opus', effort: 'high' })
    // Explore không sửa được file.
    expect(p.tasks[1]?.agentType).toBe('general-purpose')
    expect(p.tasks[1]?.index).toBe(2)
  })

  test('tối đa 20 việc; chuỗi dài bị cắt', () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({ title: `Việc ${i + 1} ${'x'.repeat(200)}`, run: 'main', model: 'sonnet', effort: 'low' }))
    const p = plan({ tasks })
    expect(p.tasks.length).toBe(20)
    expect(p.tasks[0]?.title.length).toBeLessThanOrEqual(140)
  })

  test('prompt đính kèm chỉ để đối chiếu: luồng chính của lượt trả lời, luồng chính của prompt đính kèm riêng', () => {
    const p = plan({ reference: true, main: { model: 'haiku', effort: 'low' }, referenceMain: { model: 'opus', effort: 'xhigh' }, kind: 'mixed' })
    expect(p.isReference).toBe(true)
    // Lượt đối chiếu không sửa file: haiku được giữ dù cả prompt đính kèm là mixed.
    expect(p.main).toEqual({ family: 'haiku', effort: 'low' })
    expect(p.referenceMain).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(plan({ referenceMain: { model: 'opus', effort: 'xhigh' } }).referenceMain).toBeUndefined()
  })

  test('lượt đối chiếu không mang ràng buộc và tiêu chí của prompt đính kèm, dù router trả về', () => {
    const p = plan({ reference: true, main: { model: 'sonnet', effort: 'low' }, constraints: ['Không được chạy prompt đính kèm'], quality: ['Phân việc đủ 11 mục'] })
    expect(p.isReference).toBe(true)
    expect(p.constraints).toEqual([])
    expect(p.quality).toEqual([])
    // Không đối chiếu thì ràng buộc được giữ nguyên.
    expect(plan({ constraints: ['Không đổi API công khai'] }).constraints).toEqual(['Không đổi API công khai'])
  })

  test('chấm subagent: đọc đủ; thiếu model hoặc effort thì không dùng được', () => {
    const route = parseAgentRoute(JSON.stringify({ why: 'tra cứu', model: 'haiku', effort: 'low', agent: 'Explore', depth: 'none', volume: 'small', kind: 'investigate' }), OPEN)
    expect(route).toEqual({ pick: { family: 'haiku', effort: 'low' }, agentType: 'Explore', depth: 'none', volume: 'small', kind: 'investigate', tier: 'trivial', why: 'tra cứu' })
    expect(parseAgentRoute('{"model":"sonnet"}', OPEN)).toBeNull()
    expect(parseAgentRoute('xin lỗi', OPEN)).toBeNull()
  })
})

describe('kiểm và kẹp theo chính sách', () => {
  test('max về xhigh; fable về opus khi chưa bật; được bật thì giữ', () => {
    expect(fitPick({ family: 'opus', effort: 'max' }, 'answer', OPEN).pick).toEqual({ family: 'opus', effort: 'xhigh' })
    const fable = fitPick({ family: 'fable', effort: 'high' }, 'edit', OPEN)
    expect(fable.pick).toEqual({ family: 'opus', effort: 'high' })
    expect(fable.notes.join()).toContain('allowFable')
    expect(fitPick({ family: 'fable', effort: 'high' }, 'edit', { ...OPEN, allowFable: true }).pick.family).toBe('fable')
  })

  test('việc sửa file không chạy haiku; tra cứu thì được', () => {
    expect(fitPick({ family: 'haiku', effort: 'low' }, 'edit', OPEN).pick.family).toBe('sonnet')
    expect(fitPick({ family: 'haiku', effort: 'low' }, 'mixed', OPEN).pick.family).toBe('sonnet')
    expect(fitPick({ family: 'haiku', effort: 'low' }, 'investigate', OPEN).pick.family).toBe('haiku')
  })

  test('model của phiên: ceiling giới hạn, fixed giữ nguyên họ của phiên', () => {
    const ceiling = fitPick({ family: 'opus', effort: 'high' }, 'edit', { ...OPEN, session: { family: 'sonnet', policy: 'ceiling' } })
    expect(ceiling.pick.family).toBe('sonnet')
    expect(ceiling.notes.join()).toContain('theo model của phiên')
    expect(fitPick({ family: 'haiku', effort: 'low' }, 'answer', { ...OPEN, session: { family: 'opus', policy: 'fixed' } }).pick.family).toBe('opus')
  })

  test('họ đang bị chặn: xuống họ thấp hơn và tăng effort một bậc', () => {
    const fitted = fitPick({ family: 'opus', effort: 'high' }, 'edit', { ...OPEN, blocked: new Set<ModelFamily>(['opus']) })
    expect(fitted.pick).toEqual({ family: 'sonnet', effort: 'xhigh' })
    expect(fitted.notes.join()).toContain('đang bị chặn')
  })

  test('kẹp áp lúc đọc JSON, cho cả luồng chính và từng việc', () => {
    const p = plan(
      {
        main: { model: 'fable', effort: 'max' },
        tasks: [{ title: 'Sửa nút', run: 'agent', agent: 'general-purpose', model: 'haiku', effort: 'low', kind: 'edit' }],
      },
      OPEN,
    )
    expect(p.main).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(p.notes.length).toBe(2)
    expect(p.tasks[0]?.pick.family).toBe('sonnet')
    expect(p.tasks[0]?.why).toContain('không chạy haiku')
  })

  test('việc đã phân được kiểm lại theo chính sách lúc giao', () => {
    const task = plan().tasks[2]
    if (task === undefined) throw new Error('task')
    expect(taskRoute(task, OPEN).pick).toEqual({ family: 'sonnet', effort: 'medium' })
    expect(taskRoute(task, { ...OPEN, blocked: new Set<ModelFamily>(['sonnet']) }).pick.family).toBe('opus')
  })
})

describe('brief từ kế hoạch của router', () => {
  test('mục tiêu mới: bước dự kiến là tên các việc, tier suy ra từ đánh giá', () => {
    const brief = briefOf(plan(), 'prompt gốc', 4, 9)
    expect(brief.goalId).toBe(4)
    expect(brief.steps).toEqual(['Tìm chỗ gọi charge', 'Thiết kế lại thanh toán đa tiền tệ', 'Viết unit test cho refund'])
    expect(brief.tier).toBe('complex')
    expect(brief.source).toBe('router')
    expect(brief.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('tiếp nối: giữ mục tiêu và việc cũ, việc mới được đánh số tiếp theo, ràng buộc gộp không trùng', () => {
    const prev = briefOf(plan(), 'p', 1, 1)
    const next = plan({
      relation: 'refine',
      goal: '',
      constraints: ['Không đổi API công khai', 'Giữ log cũ'],
      main: { model: 'sonnet', effort: 'medium' },
      tasks: [{ title: 'Thêm test webhook', run: 'agent', model: 'sonnet', effort: 'medium', kind: 'edit' }],
    })
    const { brief, added } = followUpOf(prev, next, 5)
    expect(brief.goalId).toBe(1)
    expect(brief.goal).toBe(prev.goal)
    expect(added.map(t => t.index)).toEqual([4])
    expect(brief.tasks.map(t => t.index)).toEqual([1, 2, 3, 4])
    expect(brief.constraints).toEqual(['Không đổi API công khai', 'Giữ log cũ'])
    expect(brief.main).toEqual({ family: 'sonnet', effort: 'medium' })
    expect(brief.isFollowUp).toBe(true)
    expect(brief.relation).toBe('refine')
  })

  test('chạy thật prompt đã đối chiếu: việc đối chiếu thành việc thật của mục tiêu mới', () => {
    const reference: Brief = briefOf(plan({ reference: true, referenceMain: { model: 'opus', effort: 'high' } }), 'p', 2, 1)
    const run = plan({ relation: 'continue', runReference: true, goal: '', main: { model: 'opus', effort: 'high' }, tasks: [] })
    const brief = promoteReference(reference, run, 'ok chạy đi', 7)
    expect(brief.goalId).toBe(3)
    expect(brief.isReference).toBe(false)
    expect(brief.tasks).toEqual(reference.tasks)
    expect(brief.goal).toBe(reference.goal)
  })

  test('mục tiêu đặt bằng lệnh khi router lỗi: không có việc, không có lựa chọn model', () => {
    const brief = bareBrief('  Viết hàm parseDate  ', 2, 3)
    expect(brief.goal).toBe('Viết hàm parseDate')
    expect(brief.main).toBeNull()
    expect(brief.tasks).toEqual([])
    expect(brief.source).toBe('none')
  })
})
