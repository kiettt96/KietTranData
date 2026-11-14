// 0.8.9 C2: ràng buộc không còn trần (C1), nên nơi chèn vào context và gửi router chỉ nêu tối đa 22 mục kèm số mục còn lại.
// shownConstraints giữ `base` mục đầu (mục của prompt lập mục tiêu) và các mục mới nhất cho đủ 22. Với không quá 22 ràng buộc, bốn đầu ra
// dạng chuỗi trùng 7682ef7 từng ký tự (tests/fixtures/constraints-c2-089.ts). Request tiếp nối giữ trần ký tự của ruleItems như cũ.

import { describe, expect, test } from 'claude-code/testing'
import * as router from '../hooks/lib/router'
import { STRINGS_22 } from './fixtures/constraints-c2-089'
import { constraintAt, constraintList, printedOutputs } from './support/constraints-shown'

// Hàm mới của C2 lấy qua namespace, để test đỏ đếm từng ca khi mã chưa có hàm.
type Shown = { items: string[]; hidden: number }
const shownConstraints = (constraints: readonly string[], base?: number): Shown =>
  ((router as unknown as Record<string, unknown>)['shownConstraints'] as (c: readonly string[], b?: number) => Shown)(constraints, base)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => constraintAt(from + i))

describe('0.8.9 C2: shownConstraints', () => {
  test('rỗng, 1 mục, 22 mục: nguyên danh sách, hidden 0', () => {
    expect(shownConstraints([], 10)).toEqual({ items: [], hidden: 0 })
    expect(shownConstraints(constraintList(1), 10)).toEqual({ items: constraintList(1), hidden: 0 })
    expect(shownConstraints(constraintList(22), 10)).toEqual({ items: constraintList(22), hidden: 0 })
  })

  test('30 mục, base 10: 10 mục đầu rồi 12 mục cuối, đúng thứ tự, hidden 8', () => {
    expect(shownConstraints(constraintList(30), 10)).toEqual({ items: [...range(1, 10), ...range(19, 30)], hidden: 8 })
  })

  test('base thiếu: 22 mục đầu; base 25: 22 mục đầu, hidden là số mục trừ 22', () => {
    expect(shownConstraints(constraintList(30))).toEqual({ items: range(1, 22), hidden: 8 })
    expect(shownConstraints(constraintList(30), 25)).toEqual({ items: range(1, 22), hidden: 8 })
  })
})

describe('0.8.9 C2: bốn đầu ra dạng chuỗi', () => {
  test('22 ràng buộc: context mục tiêu, context tiếp tục, request tiếp nối, request rà kế hoạch trùng 7682ef7', () => {
    const out = printedOutputs(22)
    expect(out.brief).toBe(STRINGS_22.brief)
    expect(out.resume).toBe(STRINGS_22.resume)
    expect(out.followUp).toBe(STRINGS_22.followUp)
    expect(out.review).toBe(STRINGS_22.review)
  })

  test('60 ràng buộc, base 10: context mục tiêu, context tiếp tục, request rà kế hoạch nêu đúng 10 mục đầu và 12 mục mới nhất, kèm một dòng 38 mục', () => {
    const out = printedOutputs(60)
    const shown = [...range(1, 10), ...range(49, 60)]
    for (const [name, text, more] of [
      ['brief', out.brief, '(và 38 ràng buộc khác)'],
      ['resume', out.resume, '(và 38 ràng buộc khác)'],
      ['review', out.review, '(38 more constraints)'],
    ] as const) {
      for (const item of shown) expect(text.includes(item), `${name}: ${item}`).toBe(true)
      for (const item of range(11, 48)) expect(text.includes(item), `${name}: ${item}`).toBe(false)
      expect(text.split(more).length - 1, name).toBe(1)
    }
  })

  test('60 ràng buộc: request tiếp nối có mục đầu và mục mới nhất, không có mục bị ẩn, một vế 38 mục, không dài hơn bản 22 quá 40 ký tự', () => {
    const out = printedOutputs(60)
    expect(out.followUp).toContain(constraintAt(1))
    expect(out.followUp).toContain(constraintAt(60))
    for (const item of range(11, 48)) expect(out.followUp.includes(item), item).toBe(false)
    expect(out.followUp.split('(38 more constraints)').length - 1).toBe(1)
    expect(out.followUp.length - printedOutputs(22).followUp.length).toBeLessThanOrEqual(40)
  })
})
