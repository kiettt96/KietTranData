// 0.8.9 vòng 3 E1: yêu cầu của việc đã bỏ rời kế hoạch (brief.retired), không còn bị nhắc là chưa có việc nào phủ. Chỉ việc bị bỏ (drop)
// mới sinh retired; việc bị gộp chuyển covers sang việc nhận gộp. Yêu cầu được một việc mới phủ lại thì ra khỏi retired. Danh sách yêu cầu
// và số thứ tự giữ nguyên; khi mở đợt mới, số trong retired đổi theo bảng đánh số lại của openPhase.

import { describe, expect, test } from 'claude-code/testing'
import { applyArrange, nextBrief, openPhase, parseRoute, uncoveredRequirements } from '../hooks/lib/router'
import * as S from '../hooks/lib/state'
import { briefContext, compactKeepText, compactReminderText } from '../hooks/lib/text'
import type { Arrange, Brief, Core, PlanStep, Task } from '../types'
import { OPEN } from './golden/cases'
import { makeBrief } from './support/commands'
import { plan, task } from './support/engine'
import type { Json } from './support/engine'

type Retired = Brief & { retired?: number[] }
const retiredOf = (brief: Brief) => (brief as Retired).retired ?? []

const taskOf = (index: number, covers: number[]): Task => ({ index, title: `Việc số ${index}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', covers })
const reqs = (n: number) => Array.from({ length: n }, (_, i) => `Yêu cầu ${i + 1}`)
const goal = (tasks: Task[], requirements: string[], over: Partial<Retired> = {}) => makeBrief({ tasks, requirements, ...over }) as Retired
const four = () => goal([taskOf(1, [1]), taskOf(2, [2]), taskOf(3, [3]), taskOf(4, [4])], reqs(4))
const none: Arrange = { order: [], drop: [], merge: [] }
const drop = (...tasks: number[]): Arrange => ({ ...none, drop: tasks.map(t => ({ task: t, why: 'không cần nữa' })) })
const step = (over: Json) => parseRoute(JSON.stringify(plan({ relation: 'refine', intent: 'amend', goal: '', ...over })), OPEN)!
const GAP = 'chưa có việc nào phủ'

describe('0.8.9 vòng 3 E1: yêu cầu của việc đã bỏ vào retired', () => {
  test('bỏ việc 2 và 3: retired là 2 và 3, không còn yêu cầu nào chưa phủ; danh sách yêu cầu giữ nguyên', () => {
    const out = applyArrange(four(), drop(2, 3), [])
    expect(retiredOf(out.brief)).toEqual([2, 3])
    expect(uncoveredRequirements(out.brief)).toEqual([])
    expect(out.brief.requirements).toEqual(reqs(4))
  })

  test('yêu cầu 2 do cả việc 2 lẫn việc 5 phủ: bỏ việc 2 và 3 thì chỉ 3 vào retired', () => {
    const brief = goal([taskOf(1, [1]), taskOf(2, [2]), taskOf(3, [3]), taskOf(4, [4]), taskOf(5, [2])], reqs(4))
    const out = applyArrange(brief, drop(2, 3), [])
    expect(retiredOf(out.brief)).toEqual([3])
  })

  test('gộp việc 2 vào việc 4 và bỏ việc 3: chỉ 3 vào retired, yêu cầu 2 do việc 4 phủ', () => {
    const out = applyArrange(four(), { ...none, drop: [{ task: 3, why: 'x' }], merge: [{ tasks: [2], into: 4 }] }, [])
    expect(retiredOf(out.brief)).toEqual([3])
    expect(out.brief.tasks.find(t => t.index === 4)?.covers).toEqual([4, 2])
    expect(uncoveredRequirements(out.brief)).toEqual([])
  })

  test('yêu cầu vốn chưa có việc nào phủ từ trước vẫn được nêu sau khi bỏ việc', () => {
    const brief = goal([taskOf(1, [1]), taskOf(2, [2]), taskOf(3, [3]), taskOf(4, [4])], reqs(5))
    const out = applyArrange(brief, drop(2), [])
    expect(uncoveredRequirements(out.brief)).toEqual(['Yêu cầu 5'])
  })

  test('prompt sau thêm việc mới phủ yêu cầu 2: 2 ra khỏi retired, 3 còn lại', () => {
    const prev = applyArrange(four(), drop(2, 3), []).brief
    const next = nextBrief(prev, step({ requirements: ['Yêu cầu 2'], tasks: [task('Làm lại phần hai', 'main', 'sonnet', 'medium', { covers: [1] })] }), 'làm lại phần hai', 3).brief
    expect(next.tasks.at(-1)?.covers).toEqual([2])
    expect(retiredOf(next)).toEqual([3])
    expect(uncoveredRequirements(next)).toEqual([])
  })

  test('briefContext và khối nén của brief có retired không nêu yêu cầu đã rời kế hoạch là chưa phủ', () => {
    const brief = applyArrange(four(), drop(2, 3), []).brief
    const plan: PlanStep[] = [{ id: 1, title: 'Việc 1: Việc số 1', status: 'doing' }]
    for (const text of [briefContext(brief, null), compactKeepText(brief, plan), compactReminderText(brief, plan)]) expect(text).not.toContain(GAP)
  })

  test('retired còn sau vòng JSON của Core (như sau hot reload); Core cũ không có trường này', () => {
    const brief = applyArrange(four(), drop(2, 3), []).brief
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify({ ...S.EMPTY_CORE, brief })) as Partial<Core>)
    expect(retiredOf(reloaded.brief!)).toEqual([2, 3])
    const old = S.normalizeCore(JSON.parse(JSON.stringify({ ...S.EMPTY_CORE, brief: four() })) as Partial<Core>)
    expect((old.brief as Retired).retired).toBeUndefined()
  })

  test('mở đợt mới khi brief có retired: số trong retired đổi theo bảng đánh số lại của openPhase', () => {
    // Việc 1 xong và là việc duy nhất phủ yêu cầu 1: openPhase bỏ yêu cầu 1, các yêu cầu sau lùi một số. Yêu cầu 3 đã rời kế hoạch.
    const brief = goal([taskOf(1, [1]), taskOf(2, [2]), taskOf(4, [4]), taskOf(5, [5])], reqs(5), { retired: [3] })
    const opened = openPhase(brief, new Set([1])).brief
    expect(opened.requirements).toEqual(['Yêu cầu 2', 'Yêu cầu 3', 'Yêu cầu 4', 'Yêu cầu 5'])
    expect(retiredOf(opened)).toEqual([2])
    expect(uncoveredRequirements(opened)).toEqual([])
  })
})
