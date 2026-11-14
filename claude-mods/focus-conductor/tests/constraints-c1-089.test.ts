// 0.8.9 C1: ràng buộc của mục tiêu không còn trần, như yêu cầu từ 0.8.7. Không ràng buộc nào của prompt tiếp nối bị bỏ hay bị mục
// mới thay vì đầy; mục cùng khóa vẫn thay mục cũ tại chỗ và không tính là mục bị thay. Thứ tự giữ nguyên: quy định model, mục của prompt
// lập mục tiêu, rồi mục của các prompt tiếp nối theo thời gian.

import { describe, expect, test } from 'claude-code/testing'
import { followUpOf, nextBrief, parseRoute, promoteReference } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import type { Brief } from '../types'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const items = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`)
/** Mục tiêu 22 ràng buộc: 10 mục của prompt lập mục tiêu, 12 mục của các prompt tiếp nối. */
const TWENTY_TWO = [...items('Ràng buộc gốc', 10), ...items('Ràng buộc tiếp nối', 12)]
const FIVE = items('Ràng buộc mới', 5)

function forty(isPhase: boolean): { brief: Brief; dropped: number; replaced: number } {
  let brief = makeBrief({ constraints: items('Ràng buộc gốc', 10), constraintsBase: 10, tasks: [] })
  let dropped = 0
  let replaced = 0
  for (let n = 1; n <= 40; n++) {
    const out = followUpOf(brief, routed({ relation: 'continue', goal: '', constraints: items(`Ràng buộc lượt ${n}`, 3) }), n + 1, false, isPhase)
    dropped += out.dropped
    replaced += out.replaced.length
    brief = out.brief
  }
  return { brief, dropped, replaced }
}

describe('0.8.9 C1: prompt tiếp nối thường', () => {
  test('mục tiêu 22 ràng buộc, prompt tiếp nối thêm 5 mục: 27 mục, 5 mục mới đứng cuối đúng thứ tự, không bỏ, không thay', () => {
    const out = followUpOf(makeBrief({ constraints: TWENTY_TWO, constraintsBase: 10 }), routed({ relation: 'continue', goal: '', constraints: FIVE }), 2)
    expect(out.brief.constraints).toEqual([...TWENTY_TWO, ...FIVE])
    expect(out.dropped).toBe(0)
    expect(out.replaced).toEqual([])
  })

  test('40 prompt tiếp nối, mỗi prompt 3 ràng buộc, từ mục tiêu 10 ràng buộc: đủ 130 mục, không mục nào bị bỏ', () => {
    const { brief, dropped, replaced } = forty(false)
    expect(brief.constraints).toHaveLength(130)
    expect(brief.constraints.slice(0, 10)).toEqual(items('Ràng buộc gốc', 10))
    expect(brief.constraints.at(-1)).toBe('Ràng buộc lượt 40 3')
    expect(dropped).toBe(0)
    expect(replaced).toBe(0)
    expect(brief.dropped).toBeUndefined()
  })
})

describe('0.8.9 C1: mở đợt mới', () => {
  test('mục tiêu 22 ràng buộc, đợt mới thêm 5 mục: 27 mục, không mục nào bị thay hay bị bỏ', () => {
    const out = followUpOf(makeBrief({ constraints: TWENTY_TWO, constraintsBase: 10 }), routed({ relation: 'continue', goal: '', constraints: FIVE }), 2, false, true)
    expect(out.brief.constraints).toEqual([...TWENTY_TWO, ...FIVE])
    expect(out.dropped).toBe(0)
    expect(out.replaced).toEqual([])
  })

  test('40 đợt mới liên tiếp, mỗi đợt 3 ràng buộc: đủ 130 mục, không thay, không bỏ', () => {
    const { brief, dropped, replaced } = forty(true)
    expect(brief.constraints).toHaveLength(130)
    expect(dropped).toBe(0)
    expect(replaced).toBe(0)
  })
})

describe('0.8.9 C1: mục cùng khóa', () => {
  test('ràng buộc cùng khóa (khác hoa thường, thừa dấu chấm cuối) thay tại chỗ: số mục không đổi, không có mục bị thay', () => {
    const prev = makeBrief({ constraints: TWENTY_TWO, constraintsBase: 10 })
    const out = nextBrief(prev, routed({ relation: 'refine', goal: '', constraints: ['ràng buộc tiếp nối 3.'] }), 'x', 2)
    expect(out.brief.constraints).toHaveLength(22)
    expect(out.brief.constraints[12]).toBe('ràng buộc tiếp nối 3.')
    expect(out.replaced).toEqual([])
  })

  test('yêu cầu cùng khóa thay tại chỗ: số mục không đổi, không có mục bị thay', () => {
    const prev = makeBrief({ requirements: items('Yêu cầu', 30), requirementsBase: 30, constraints: TWENTY_TWO, constraintsBase: 10 })
    const out = nextBrief(prev, routed({ relation: 'refine', goal: '', requirements: ['YÊU CẦU 7.'] }), 'x', 2)
    expect(out.brief.requirements).toHaveLength(30)
    expect(out.brief.requirements?.[6]).toBe('YÊU CẦU 7.')
    expect(out.replaced).toEqual([])
  })
})

describe('0.8.9 C1: mục tiêu mới và lượt chạy thật prompt đã đối chiếu', () => {
  test('mục tiêu mới mang 3 quy định model, prompt mới 10 ràng buộc không nêu model: đủ 13 mục, quy định model đứng đầu', () => {
    const rules = ['Việc lọc tin chạy sonnet', 'Việc tổng hợp chạy opus', 'Việc đọc log chạy haiku']
    const prev = makeBrief({ goalId: 1, constraints: [...rules, 'Ràng buộc cũ 1'], constraintsBase: 4 })
    const fresh = items('Ràng buộc mục tiêu mới', 10)
    const out = nextBrief(prev, routed({ relation: 'new', goal: 'Mục tiêu khác hẳn', constraints: fresh }), 'mục tiêu mới', 2)
    expect(out.isNewGoal).toBe(true)
    expect(out.brief.constraints).toEqual([...rules, ...fresh])
    expect(out.brief.constraintsBase).toBe(13)
  })

  test('promoteReference: lượt đối chiếu 15 ràng buộc, lượt chạy 10 ràng buộc khác: đủ 25 mục', () => {
    const prev = makeBrief({ isReference: true, constraints: items('Ràng buộc đối chiếu', 15), constraintsBase: 15 })
    const brief = promoteReference(prev, routed({ relation: 'continue', goal: 'Chạy thật', runReference: true, constraints: items('Ràng buộc chạy', 10) }), 'chạy thật đi', 2)
    expect(brief.constraints).toEqual([...items('Ràng buộc đối chiếu', 15), ...items('Ràng buộc chạy', 10)])
    expect(brief.constraintsBase).toBe(25)
  })
})
