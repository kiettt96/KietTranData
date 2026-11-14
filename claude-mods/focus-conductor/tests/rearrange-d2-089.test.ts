// 0.8.9 D2: mod áp kế hoạch router đã điều phối lại (arrange) lên brief sau khi followUpOf nối việc mới, không đoán. Luật kiểm ở một chỗ
// (applyArrange): (1) chỉ việc chưa bắt đầu, hay đã lỗi mà chưa giao lại, mới bị bỏ hay bị gộp; việc xong, đang chạy, hay có bước doing,
// done, verified thì giữ và mục nhắm vào nó bị bỏ qua; (2) không đánh số lại; (3) gộp nhập covers vào việc nhận gộp; (4) order áp cho việc
// còn mở, số lạ, trùng, đã bỏ thì bỏ qua, việc còn mở không có trong order xếp sau theo số; (5) brief giữ tối đa 50 việc đã gỡ; (6) thứ tự
// và việc đã gỡ sống qua vòng JSON của Core; (7) không có arrange, hay arrange rỗng sau khi lọc, thì brief trùng bản trước.

import { describe, expect, test } from 'claude-code/testing'
import * as router from '../hooks/lib/router'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import * as S from '../hooks/lib/state'
import type { Arrange, Brief, Core, PlanStep, Task, TaskStatus } from '../types'
import { OPEN } from './golden/cases'
import { makeBrief } from './support/commands'
import { plan, task } from './support/engine'
import type { Json } from './support/engine'

type Removed = { index: number; title: string; why: string; into?: number }
type Arranged = { order: number[]; dropped: number[]; merged: Array<{ tasks: number[]; into: number }>; skipped: Array<{ task: number | string; why: string }> }
type Applied = { brief: Brief & { order?: number[]; removed?: Removed[] }; arranged: Arranged | null }
type Guard = { states?: Record<number, TaskStatus>; checklist?: readonly PlanStep[] }
// Hàm mới của D2 lấy qua namespace, để test đỏ đếm từng ca khi mã chưa có hàm.
const applyArrange = (brief: Brief, arrange: Arrange, added: readonly Task[], guard: Guard = {}): Applied =>
  ((router as unknown as Record<string, unknown>)['applyArrange'] as (b: Brief, a: Arrange, t: readonly Task[], g: Guard) => Applied)(brief, arrange, added, guard)

const taskOf = (index: number, covers?: number[]): Task => ({ index, title: `Việc số ${index}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', ...(covers ? { covers } : {}) })
const goal = (count: number, over: Partial<Brief> = {}) => makeBrief({ tasks: Array.from({ length: count }, (_, i) => taskOf(i + 1, [i + 1])), requirements: Array.from({ length: count }, (_, i) => `Yêu cầu ${i + 1}`), ...over })
const none: Arrange = { order: [], drop: [], merge: [] }
const indexes = (b: Brief) => b.tasks.map(t => t.index)

describe('0.8.9 D2 luật 1: chỉ việc chưa bắt đầu hay đã lỗi mới bị bỏ hay gộp', () => {
  test('bỏ việc chưa bắt đầu và việc đã lỗi: cả hai rời brief', () => {
    const out = applyArrange(goal(5), { ...none, drop: [{ task: 2, why: 'không còn cần' }, { task: 4, why: 'đổi hướng' }] }, [], { states: { 4: 'failed' } })
    expect(indexes(out.brief)).toEqual([1, 3, 5])
    expect(out.arranged?.dropped).toEqual([2, 4])
  })

  test('bỏ việc đang chạy, việc đã xong và việc có bước doing: cả ba còn nguyên, ba mục bị bỏ qua kèm lý do', () => {
    const checklist: PlanStep[] = [{ id: 1, title: 'Việc 3: Việc số 3', status: 'doing' }]
    const out = applyArrange(goal(5), { ...none, drop: [{ task: 1, why: 'a' }, { task: 2, why: 'b' }, { task: 3, why: 'c' }] }, [], { states: { 1: 'running', 2: 'done' }, checklist })
    expect(indexes(out.brief)).toEqual([1, 2, 3, 4, 5])
    expect(out.arranged?.skipped.map(s => s.task)).toEqual([1, 2, 3])
    for (const s of out.arranged?.skipped ?? []) expect(s.why.length).toBeGreaterThan(0)
  })

  test('gộp nhắm vào việc đang chạy: bỏ qua, việc còn nguyên', () => {
    const out = applyArrange(goal(5), { ...none, merge: [{ tasks: [2], into: 5 }] }, [], { states: { 2: 'running' } })
    expect(indexes(out.brief)).toEqual([1, 2, 3, 4, 5])
    expect(out.arranged === null || out.arranged.merged.length === 0).toBe(true)
  })
})

describe('0.8.9 D2 luật 2 và 3: không đánh số lại; gộp nhập covers', () => {
  test('bỏ việc 2: các việc còn lại giữ số', () => {
    const out = applyArrange(goal(5), { ...none, drop: [{ task: 2, why: 'x' }] }, [])
    expect(indexes(out.brief)).toEqual([1, 3, 4, 5])
    expect(out.brief.tasks.map(t => t.title)).toEqual(['Việc số 1', 'Việc số 3', 'Việc số 4', 'Việc số 5'])
  })

  test('gộp việc 2 và 3 vào new1 (việc 6 vừa thêm): hai việc rời brief, việc 6 mang hợp covers', () => {
    const added = [taskOf(6, [6])]
    const brief = { ...goal(5), tasks: [...goal(5).tasks, ...added] }
    const out = applyArrange(brief, { ...none, merge: [{ tasks: [2, 3], into: 'new1' }] }, added)
    expect(indexes(out.brief)).toEqual([1, 4, 5, 6])
    expect([...(out.brief.tasks.find(t => t.index === 6)?.covers ?? [])].sort((a, b) => a - b)).toEqual([2, 3, 6])
    expect(out.arranged?.merged).toEqual([{ tasks: [2, 3], into: 6 }])
  })

  test('into không tồn tại, hay cũng đang bị bỏ: bỏ qua mục gộp đó', () => {
    const missing = applyArrange(goal(5), { ...none, merge: [{ tasks: [2], into: 9 }] }, [])
    expect(indexes(missing.brief)).toEqual([1, 2, 3, 4, 5])
    const dropped = applyArrange(goal(5), { ...none, drop: [{ task: 4, why: 'x' }], merge: [{ tasks: [2], into: 4 }] }, [])
    expect(indexes(dropped.brief)).toEqual([1, 2, 3, 5])
  })
})

describe('0.8.9 D2 luật 4: order', () => {
  test('số lạ, số trùng, việc đã bỏ trong order bị bỏ qua; mỗi việc còn mở xuất hiện một lần', () => {
    const out = applyArrange(goal(5), { order: [5, 9, 5, 2, 'new3', 1], drop: [{ task: 2, why: 'x' }], merge: [] }, [])
    expect(out.brief.order).toEqual([5, 1, 3, 4])
  })

  test('order thiếu ba việc còn mở: ba việc đó xếp cuối theo số', () => {
    const out = applyArrange(goal(6), { ...none, order: [6, 2, 1] }, [])
    expect(out.brief.order).toEqual([6, 2, 1, 3, 4, 5])
  })

  test('việc đã xong không vào order', () => {
    const out = applyArrange(goal(4), { ...none, order: [4, 1, 2, 3] }, [], { states: { 1: 'done' } })
    expect(out.brief.order).toEqual([4, 2, 3])
  })

  test('không có order: brief không có thứ tự làm', () => {
    const out = applyArrange(goal(4), { ...none, drop: [{ task: 4, why: 'x' }] }, [])
    expect(out.brief.order).toBeUndefined()
  })
})

describe('0.8.9 D2 luật 5 tới 7: việc đã gỡ, vòng JSON, không arrange', () => {
  test('việc đã gỡ: số, tiêu đề, lý do, việc nhận gộp; giữ tối đa 50 việc gần nhất', () => {
    const out = applyArrange(goal(5), { ...none, drop: [{ task: 1, why: 'không cần' }], merge: [{ tasks: [2], into: 5 }] }, [])
    expect(out.brief.removed).toEqual([
      { index: 1, title: 'Việc số 1', why: 'không cần' },
      { index: 2, title: 'Việc số 2', why: '', into: 5 },
    ])
    const many = goal(60)
    const big = applyArrange(many, { ...none, drop: Array.from({ length: 55 }, (_, i) => ({ task: i + 1, why: 'x' })) }, [])
    expect(big.brief.removed).toHaveLength(50)
    expect(big.brief.removed?.[0]?.index).toBe(6)
    expect(big.brief.removed?.at(-1)?.index).toBe(55)
  })

  test('thứ tự làm và việc đã gỡ còn sau vòng JSON của Core (như sau hot reload); Core cũ không có hai trường này', () => {
    const out = applyArrange(goal(5), { order: [5, 1], drop: [{ task: 2, why: 'x' }], merge: [] }, [])
    const core = { ...S.EMPTY_CORE, brief: out.brief } as Core
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect((reloaded.brief as Applied['brief']).order).toEqual([5, 1, 3, 4])
    expect((reloaded.brief as Applied['brief']).removed).toEqual([{ index: 2, title: 'Việc số 2', why: 'x' }])
    const old = S.normalizeCore(JSON.parse(JSON.stringify({ ...S.EMPTY_CORE, brief: goal(3) })) as Partial<Core>)
    expect((old.brief as Applied['brief']).order).toBeUndefined()
    expect((old.brief as Applied['brief']).removed).toBeUndefined()
  })

  test('arrange rỗng sau khi lọc (mọi mục nhắm vào việc đang chạy): brief trùng bản trước, không có kết quả điều phối', () => {
    const brief = goal(4)
    const out = applyArrange(brief, { order: [], drop: [{ task: 1, why: 'x' }], merge: [] }, [], { states: { 1: 'running' } })
    expect(out.brief).toEqual(brief)
  })

  test('nextBrief không có arrange: brief trùng như khi không có D2', () => {
    const prev = goal(4)
    const routed = parseRoute(JSON.stringify(plan({ relation: 'refine', intent: 'amend', goal: '', tasks: [task('Việc thêm', 'main', 'sonnet', 'medium')] })), OPEN)!
    const out = nextBrief(prev, routed, 'thêm', 2) as ReturnType<typeof nextBrief> & { arranged?: unknown }
    expect(indexes(out.brief)).toEqual([1, 2, 3, 4, 5])
    expect((out.brief as Applied['brief']).order).toBeUndefined()
    expect(out.arranged).toBeUndefined()
  })
})

const step = (over: Json) => parseRoute(JSON.stringify(plan({ relation: 'refine', intent: 'amend', goal: '', ...over })), OPEN)!

describe('0.8.9 D2: ba prompt điều chỉnh liên tiếp trên mục tiêu 12 việc', () => {
  test('thêm 2, bỏ 3, gộp 2, đảo thứ tự: sau mỗi prompt, việc còn mở, thứ tự và việc đã gỡ đúng; số của việc cũ không đổi', () => {
    let brief: Applied['brief'] = goal(12)
    // Prompt 1: thêm hai việc (13, 14), bỏ việc 3, 7, 11.
    brief = nextBrief(brief, step({ tasks: [task('Việc thêm A', 'main', 'sonnet', 'medium'), task('Việc thêm B', 'main', 'sonnet', 'medium')], arrange: { order: [], drop: [{ task: 3, why: 'bỏ' }, { task: 7, why: 'bỏ' }, { task: 11, why: 'bỏ' }], merge: [] } }), 'p1', 2).brief
    expect(indexes(brief)).toEqual([1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14])
    expect(brief.removed?.map(r => r.index)).toEqual([3, 7, 11])
    expect(brief.order).toBeUndefined()
    // Prompt 2: gộp việc 5 và 6 vào việc 13.
    brief = nextBrief(brief, step({ arrange: { order: [], drop: [], merge: [{ tasks: [5, 6], into: 13 }] } }), 'p2', 3).brief
    expect(indexes(brief)).toEqual([1, 2, 4, 8, 9, 10, 12, 13, 14])
    expect(brief.removed?.map(r => [r.index, r.into ?? null])).toEqual([[3, null], [7, null], [11, null], [5, 13], [6, 13]])
    // Prompt 3: làm việc 14 trước, rồi 12.
    brief = nextBrief(brief, step({ arrange: { order: [14, 12], drop: [], merge: [] } }), 'p3', 4).brief
    expect(brief.order).toEqual([14, 12, 1, 2, 4, 8, 9, 10, 13])
    expect(brief.tasks.find(t => t.index === 9)?.title).toBe('Việc số 9')
  })

  test('mở đợt mới cùng prompt có arrange: việc đã cất không bị ảnh hưởng, arrange áp trên phần còn lại', () => {
    const prev = goal(8)
    const routed = step({ relation: 'continue', tasks: [task('BƯỚC A', 'main', 'sonnet', 'medium'), task('BƯỚC B', 'main', 'sonnet', 'medium'), task('BƯỚC C', 'main', 'sonnet', 'medium')], arrange: { order: [], drop: [{ task: 1, why: 'đã cất' }, { task: 6, why: 'bỏ' }], merge: [] } })
    const out = nextBrief(prev, routed, '1. BƯỚC A\n2. BƯỚC B\n3. BƯỚC C', 2, { doneTasks: new Set([1, 2]) })
    expect(out.phase).toBeDefined()
    expect(indexes(out.brief)).toEqual([3, 4, 5, 7, 8, 9, 10, 11])
    expect((out.brief as Applied['brief']).removed?.map(r => r.index)).toEqual([6])
  })
})
