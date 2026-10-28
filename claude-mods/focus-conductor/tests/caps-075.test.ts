// 0.7.5 B11: ràng buộc (trần 12) và yêu cầu (trần 30) đã đầy ở prompt tiếp nối: mục mới thay mục cũ nhất không phải quy định
// model (quy định model không bao giờ bị thay), và có một cảnh báo; trước đây mục mới bị bỏ.

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { makeBrief } from './support/commands'
import { PANE, base, plan, submit } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const rules = ['Việc lọc tin chạy sonnet', ...Array.from({ length: 11 }, (_, i) => `Ràng buộc cũ ${i}`)]

describe('0.7.5 B11: ràng buộc đầy trần', () => {
  test('mục mới thay ràng buộc cũ nhất không phải quy định model; quy định model còn', () => {
    const prev = makeBrief({ constraints: rules })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', constraints: ['Không tạo bộ kiểm mới'] }), 'tiếp', 2)
    expect(out.brief.constraints.length).toBe(12)
    expect(out.brief.constraints).toContain('Không tạo bộ kiểm mới')
    expect(out.brief.constraints).toContain('Việc lọc tin chạy sonnet')
    expect(out.brief.constraints).not.toContain('Ràng buộc cũ 0')
    expect(out.replaced).toEqual(['Ràng buộc cũ 0'])
  })

  test('chưa đầy: không thay gì', () => {
    const prev = makeBrief({ constraints: ['Việc lọc tin chạy sonnet'] })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', constraints: ['Không tạo bộ kiểm mới'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual(['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'])
    expect(out.replaced).toEqual([])
  })

  test('mọi ràng buộc cũ đều là quy định model: không thay, mục mới bị bỏ', () => {
    const models = ['Việc ghi chạy bằng mô hình của phiên', ...Array.from({ length: 11 }, (_, i) => `Việc loại ${i} chạy opus`)]
    const out = nextBrief(makeBrief({ constraints: models }), routed({ relation: 'continue', goal: '', constraints: ['Mục mới'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual(models)
  })
})

describe('0.7.5 B11: yêu cầu đầy trần', () => {
  test('yêu cầu mới thay yêu cầu cũ nhất; việc cũ không còn phủ chỗ bị thay', () => {
    const requirements = Array.from({ length: 30 }, (_, i) => `Yêu cầu ${i + 1}`)
    const prev = makeBrief({
      requirements,
      tasks: [{ index: 1, title: 'Việc 1', run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', covers: [1, 2] }],
    })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', requirements: ['Yêu cầu mới'], tasks: [{ title: 'Việc mới', run: 'main', model: 'sonnet', effort: 'medium', kind: 'edit', covers: [1] }] }), 'tiếp', 2)
    expect(out.brief.requirements?.length).toBe(30)
    expect(out.brief.requirements?.[0]).toBe('Yêu cầu mới')
    expect(out.brief.tasks[0]?.covers).toEqual([2])
    expect(out.brief.tasks[1]?.covers).toEqual([1])
    expect(out.replaced).toEqual(['Yêu cầu 1'])
  })
})

describe('0.7.5 B11: một cảnh báo khi thay', () => {
  test('prompt tiếp nối làm đầy trần ràng buộc: cảnh báo nêu mục bị thay', {}, async ($, on) => {
    // Router đọc prompt chỉ nhận tối đa 10 ràng buộc một lượt: hai lượt tiếp nối mới đầy trần 12 của mục tiêu.
    base(on, {
      router: request =>
        request.startsWith('tiếp 1')
          ? plan({ relation: 'continue', goal: '', constraints: ['Thêm A', 'Thêm B'] })
          : request.startsWith('tiếp 2')
            ? plan({ relation: 'continue', goal: '', constraints: ['Không tạo bộ kiểm mới'] })
            : plan({ goal: 'Cập nhật dữ liệu', constraints: rules.slice(0, 10) }),
    })
    await submit($, 'Cập nhật dữ liệu theo các lô')
    await submit($, 'tiếp 1 lô sau')
    await submit($, 'tiếp 2 lô sau nữa')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /mục mới thay 1 mục cũ: Ràng buộc cũ 0/ })).toBeDefined()
  })
})
