// 0.8.7 L2: router không còn trần số việc, số yêu cầu; covers nhận mọi số từ 1 tới số yêu cầu thật của lượt; lượt đọc sau không cắt danh
// sách đã có. Lời dặn router không còn "at most 30" yêu cầu và "at most 8 tasks", có câu về thứ tự thực hiện; agentSystem giữ từng byte.
// Danh sách việc cũ gửi kèm request router và request chấm subagent giữ 20 việc như 0.8.6, quá 20 thì thêm một dòng tổng số.

import { describe, expect, test } from 'claude-code/testing'
import { agentRouterRequest, agentSystem, conductorRule, followUpOf, parseRoute, routerRequest, routerSystem, splitRule, uncoveredRequirements } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import type { Brief } from '../types'
import * as S from '../hooks/lib/state'
import { briefContext } from '../hooks/lib/text'
import { makeBrief } from './support/commands'
import { plan, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const COND: Policy = { ...OPEN, conductor: true }
const POLICIES: Array<[string, Policy]> = [['conductor tắt', OPEN], ['conductor fable', COND]]
const reqs = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `Yêu cầu giả số ${from + i}`)
const tasks = (n: number, covers: (i: number) => number[] = i => [i + 1]) => Array.from({ length: n }, (_, i) => task(`Việc giả ${i + 1}`, 'main', 'sonnet', 'medium', { covers: covers(i) }))
const big = (nTasks: number, nReqs: number, covers?: (i: number) => number[]) => JSON.stringify(plan({ goal: 'Mục tiêu giả', depth: 'substantial', volume: 'large', kind: 'edit', requirements: reqs(nReqs), tasks: tasks(nTasks, covers) }))
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/** SHA-256 trường prompt của request router cho tin tiếp nối khi mục tiêu có 12 việc, đo trên 45b5161 (0.8.6) bằng engine 2.1.296. */
const FOLLOW12_PROMPT_SHA = '1254ba2d2eb0d2f73a6b84027e63f8310d01e0b21f8b7d4218f2aa552f037a24'

describe('0.8.7 L2: parseRoute không cắt việc và yêu cầu', () => {
  for (const [name, policy] of POLICIES) {
    test(`${name}: 45 việc, 60 yêu cầu, covers trỏ tới yêu cầu 31 tới 60: giữ đủ, không có droppedTasks`, () => {
      const route = parseRoute(big(45, 60, i => [31 + (i % 30)]), policy)
      expect(route?.tasks.length).toBe(45)
      expect(route?.requirements.length).toBe(60)
      expect(route?.tasks.map(t => t.covers?.[0])).toEqual(Array.from({ length: 45 }, (_, i) => 31 + (i % 30)))
      expect(route?.droppedTasks).toBeUndefined()
    })

    test(`${name}: 130 việc, 130 yêu cầu: giữ đủ 130`, () => {
      const route = parseRoute(big(130, 130), policy)
      expect([route?.tasks.length, route?.requirements.length]).toEqual([130, 130])
      expect(route?.tasks.at(-1)?.covers).toEqual([130])
    })

    test(`${name}: covers có số lớn hơn số yêu cầu, số 0, số âm, số không nguyên: các số đó bị loại`, () => {
      const route = parseRoute(big(1, 60, () => [0, -1, 1.5, 61, 5, 60]), policy)
      expect(route?.tasks[0]?.covers).toEqual([5, 60])
    })
  }
})

describe('0.8.7 L2: lượt đọc sau không cắt danh sách đã có', () => {
  const FOLLOW = JSON.stringify(plan({ goal: '', relation: 'continue', intent: 'amend', depth: 'light', volume: 'small', kind: 'edit', requirements: ['Yêu cầu bổ sung giả'], tasks: [task('Việc bổ sung giả', 'main', 'sonnet', 'medium', { covers: [1] })] }))

  for (const [name, policy] of POLICIES) {
    test(`${name}: mục tiêu 45 việc, 60 yêu cầu, tin bổ sung thêm 1 việc, 1 yêu cầu: 46 việc, 61 yêu cầu; việc mới phủ yêu cầu 61`, () => {
      const first = parseRoute(big(45, 60), policy)
      if (first === null) throw new Error('không đọc được')
      const prev = makeBrief({ goalId: 1, tasks: first.tasks, steps: first.tasks.map(t => t.title), requirements: first.requirements })
      const next = parseRoute(FOLLOW, policy)
      if (next === null) throw new Error('không đọc được')
      const { brief } = followUpOf(prev, next, 2)
      expect([brief.tasks.length, brief.requirements?.length]).toEqual([46, 61])
      expect(brief.tasks.at(-1)?.covers).toEqual([61])
    })
  }
})

describe('0.8.7 L2: lời dặn router', () => {
  const variants: Array<[string, string]> = [['biến thể thường', splitRule(routerSystem(), 0)], ['biến thể điều phối', conductorRule(splitRule(routerSystem(), 0))]]
  for (const [name, rule] of variants) {
    test(`${name}: không còn trần 30 yêu cầu và 8 việc; còn at most 6, at most 5 và câu tasks []; có câu về thứ tự thực hiện`, () => {
      expect(rule).not.toContain('at most 30')
      expect(rule).not.toContain('at most 8 tasks')
      expect(rule).not.toContain('the limit below does not apply')
      expect(rule).toContain('constraints: at most 6')
      expect(rule).toContain('at most 5 acceptance criteria')
      expect(rule).toContain('A request that is one piece of work has tasks [].')
      expect(rule).toContain('Order tasks in the order they are done')
      expect(rule).toContain('There is no fixed limit on the number of tasks')
      expect(rule).toContain('Steps of one piece of work (find the cause, fix it, test it, update its docs) are not tasks')
      expect(rule).toContain('every requirement must be covered by at least one task')
    })
  }

  test('agentSystem trùng 0.8.6 từng byte', async () => {
    expect(await sha(agentSystem())).toBe('7d8176082b9bcdbb9072e89c9dd48418744166d0088d600f97b332970a991eda')
  })
})

describe('0.8.7 L2: yêu cầu chưa được phủ', () => {
  const withTasks = (n: number, uncovered: readonly number[]): Brief => {
    const covered = Array.from({ length: n }, (_, i) => i + 1).filter(i => !uncovered.includes(i))
    return makeBrief({ requirements: reqs(n), tasks: covered.map((c, i) => ({ index: i + 1, title: `Việc ${i + 1}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, covers: [c] }) as never) })
  }

  test('60 yêu cầu, 5 yêu cầu trong nhóm 31 tới 60 không có việc phủ: câu nhắc nêu đủ 5', () => {
    const brief = withTasks(60, [33, 40, 47, 55, 60])
    expect(uncoveredRequirements(brief)).toEqual(['Yêu cầu giả số 33', 'Yêu cầu giả số 40', 'Yêu cầu giả số 47', 'Yêu cầu giả số 55', 'Yêu cầu giả số 60'])
    const text = briefContext(brief, null, true)
    for (const n of [33, 40, 47, 55, 60]) expect(text).toContain(`Yêu cầu giả số ${n}`)
    expect(text).not.toContain('còn ')
  })

  test('30 yêu cầu chưa phủ: câu nhắc nêu 20, kèm còn 10', () => {
    const brief = withTasks(60, Array.from({ length: 30 }, (_, i) => 31 + i))
    const text = briefContext(brief, null, true)
    expect(text).toContain('Yêu cầu giả số 50')
    expect(text).not.toContain('Yêu cầu giả số 51;')
    expect(text).toContain('còn 10')
  })
})

describe('0.8.7 L2: danh sách việc cũ gửi router', () => {
  const brief = (n: number) => makeBrief({ tasks: Array.from({ length: n }, (_, i) => ({ index: i + 1, title: `Việc giả ${i + 1}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' } }) as never) })

  test('mục tiêu 100 việc: request tiếp nối gửi 20 việc và một dòng tổng số 100', () => {
    const prompt = String(routerRequest({ text: 'làm tiếp', prev: brief(100), ran: null, policy: OPEN, model: 'sonnet' }).prompt)
    expect(prompt).toContain('  20. Việc giả 20')
    expect(prompt).not.toContain('  21. Việc giả 21')
    expect(prompt).toContain('100 tasks in total')
  })

  test('mục tiêu 60 yêu cầu: request tiếp nối nêu yêu cầu 31 tới 50 và một dòng số yêu cầu còn lại', () => {
    const prompt = String(routerRequest({ text: 'làm tiếp', prev: makeBrief({ requirements: reqs(60) }), ran: null, policy: OPEN, model: 'sonnet' }).prompt)
    expect(prompt).toContain('Yêu cầu giả số 31')
    expect(prompt).toContain('Yêu cầu giả số 50')
    expect(prompt).not.toContain('Yêu cầu giả số 51')
    expect(prompt).toContain('(10 more requirements)')
  })

  test('mục tiêu 12 việc: trường prompt trùng 0.8.6', async () => {
    const prompt = String(routerRequest({ text: 'làm tiếp', prev: brief(12), ran: null, policy: OPEN, model: 'sonnet' }).prompt)
    expect(await sha(prompt)).toBe(FOLLOW12_PROMPT_SHA)
  })

  test('chấm subagent khi mục tiêu 100 việc: 20 việc và một dòng tổng số', () => {
    const prompt = String(agentRouterRequest({ description: 'Việc 37: làm', prompt: 'x', subagentType: undefined, requested: {}, goal: null, parent: null, failed: [], isWorkflow: false, policy: OPEN, model: 'sonnet', tasks: brief(100).tasks } as never).prompt)
    expect(prompt).toContain('  20. Việc giả 20')
    expect(prompt).not.toContain('  21. Việc giả 21')
    expect(prompt).toContain('100 tasks in total')
  })
})

describe('0.8.7 L2: trạng thái cũ', () => {
  test('nạp trạng thái có trường droppedTasks thừa: đọc được, không lỗi', () => {
    const core = S.normalizeCore({ ...S.EMPTY_CORE, brief: { ...makeBrief(), droppedTasks: 5 } as never } as never)
    expect(core.brief?.goalId).toBe(1)
  })
})
