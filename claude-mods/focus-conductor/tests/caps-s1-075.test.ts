// 0.7.5 S1 (vòng rà soát 4): phần tràn giữ mọi lần tinh chỉnh. Còn chỗ trong trần cộng CAP_OVERFLOW thì mục mới luôn được thêm; mục
// có sẵn (kể cả mục tràn) chỉ bị thay khi mục mới trùng khóa với nó; phần tràn đầy thì mục mới bị bỏ, đếm ở `dropped` kèm cảnh báo.

import { describe, expect, test } from 'claude-code/testing'
import { CAP_OVERFLOW, nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import type { Brief } from '../types'
import { makeBrief } from './support/commands'
import { plan, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const REQUIREMENTS = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const CONSTRAINTS = ['Việc lọc tin chạy sonnet', ...Array.from({ length: 11 }, (_, i) => `Ràng buộc gốc ${i + 1}`)]
const REFINES = ['BẮT BUỘC xuất file Excel', 'Thêm cột tổng theo tháng', 'Gửi bản tóm tắt cho kế toán']

function refine(prev: Brief, text: string, n: number) {
  return nextBrief(prev, routed({ relation: 'refine', goal: '', requirements: [text], constraints: [`Ràng buộc tinh chỉnh ${n}`], tasks: [task(`Việc tinh chỉnh ${n}`, 'main', 'sonnet', 'medium', { covers: [1] })] }), text, n + 1)
}

describe('0.7.5 S1: ba lần tinh chỉnh liên tiếp khi đã đầy trần', () => {
  test('cả 3 yêu cầu và 3 ràng buộc tinh chỉnh còn trong brief, mỗi yêu cầu có việc phủ', () => {
    let brief = makeBrief({ requirements: REQUIREMENTS, requirementsBase: 30, constraints: CONSTRAINTS, constraintsBase: 12, tasks: [] })
    REFINES.forEach((text, i) => {
      brief = refine(brief, text, i + 1).brief
    })
    const requirements = brief.requirements ?? []
    expect(requirements.slice(0, 30)).toEqual(REQUIREMENTS)
    for (const [i, text] of REFINES.entries()) {
      expect(requirements, text).toContain(text)
      const at = requirements.indexOf(text) + 1
      expect(brief.tasks.find(t => t.title === `Việc tinh chỉnh ${i + 1}`)?.covers, text).toEqual([at])
      expect(brief.constraints).toContain(`Ràng buộc tinh chỉnh ${i + 1}`)
    }
    expect(brief.constraints.slice(0, 12)).toEqual(CONSTRAINTS)
  })

  test('không có cảnh báo thay và không bỏ mục nào khi phần tràn còn chỗ', () => {
    let brief = makeBrief({ requirements: REQUIREMENTS, requirementsBase: 30, constraints: CONSTRAINTS, constraintsBase: 12, tasks: [] })
    for (const [i, text] of REFINES.entries()) {
      const out = refine(brief, text, i + 1)
      expect(out.replaced, text).toEqual([])
      expect(out.dropped, text).toBe(0)
      brief = out.brief
    }
  })

  test('chưa đầy trần mà đã có mục tiếp nối: mục tiếp nối mới vẫn được thêm, không thay mục tiếp nối cũ', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Mục ${i + 1}`)
    let brief = makeBrief({ constraints: eleven, constraintsBase: 10 })
    brief = nextBrief(brief, routed({ relation: 'continue', goal: '', constraints: ['Mục mới A'] }), 'a', 2).brief
    brief = nextBrief(brief, routed({ relation: 'continue', goal: '', constraints: ['Mục mới B'] }), 'b', 3).brief
    expect(brief.constraints).toEqual([...eleven, 'Mục mới A', 'Mục mới B'])
  })
})

describe('0.7.5 S1: mục trùng khóa và phần tràn đầy', () => {
  test('mục mới trùng khóa với mục tràn (khác hoa thường, khoảng trắng, dấu chấm cuối) thay mục đó tại chỗ, không thêm mục', () => {
    const brief = makeBrief({ requirements: [...REQUIREMENTS, 'Xuất file Excel'], requirementsBase: 30 })
    const out = nextBrief(brief, routed({ relation: 'refine', goal: '', requirements: ['xuất  file excel.'] }), 'x', 2)
    expect(out.brief.requirements).toHaveLength(31)
    expect(out.brief.requirements?.[30]).toBe('xuất  file excel.')
  })

  test(`phần tràn đầy (${CAP_OVERFLOW} mục): mục mới bị bỏ và đếm ở dropped`, () => {
    const full = [...REQUIREMENTS, ...Array.from({ length: CAP_OVERFLOW }, (_, i) => `Tràn ${i + 1}`)]
    const out = nextBrief(makeBrief({ requirements: full, requirementsBase: 30 }), routed({ relation: 'refine', goal: '', requirements: ['Mục thứ 41'] }), 'x', 2)
    expect(out.brief.requirements).toEqual(full)
    expect(out.dropped).toBe(1)
  })
})
