// 0.7.0 điểm 7: router đọc kỹ prompt và tự chia việc. Router liệt kê `requirements` (mọi yêu cầu của prompt), mỗi việc có `covers`
// (số thứ tự các yêu cầu nó phủ); yêu cầu chưa việc nào phủ được nhắc lại cho Claude; quá nhiều yêu cầu thì lượt đọc được kiểm
// lại một lần ở effort cao; bước đang mở của checklist hiện tại đi kèm request để router xếp đúng quan hệ.

import { describe, expect, test } from 'claude-code/testing'
import type { Brief, ModelFamily } from '../types'
import { briefContext } from '../hooks/lib/text'
import { askRouter, followUpOf, parseRoute, routerRequest, routerSystem, uncoveredRequirements } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import * as S from '../hooks/lib/state'
import { makeBrief } from './support/commands'
import { plan, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const textOf = (value: unknown): string => (typeof value === 'string' ? value : Array.isArray(value) ? value.map(b => (b as { text: string }).text).join('') : '')

const reqs = (n: number) => Array.from({ length: n }, (_, i) => `Yêu cầu ${i + 1}`)
const parsed = (over: Record<string, unknown>) => {
  const result = parseRoute(JSON.stringify(plan(over)), OPEN)
  if (result === null) throw new Error('không đọc được')
  return result
}

describe('0.7.0 7: đọc requirements và covers', () => {
  test('requirements và covers của từng việc được đọc đúng', () => {
    const result = parsed({
      requirements: ['Đọc tài liệu v10', 'Cập nhật skill', 'Không đổi tên file'],
      tasks: [task('Đọc tài liệu', 'main', 'sonnet', 'medium', { covers: [1] }), task('Cập nhật skill', 'main', 'sonnet', 'medium', { covers: [2, 3] })],
    })
    expect(result.requirements).toEqual(['Đọc tài liệu v10', 'Cập nhật skill', 'Không đổi tên file'])
    expect(result.tasks.map(t => t.covers)).toEqual([[1], [2, 3]])
  })

  test('thiếu trường: requirements rỗng, covers vắng (tương thích với câu trả lời cũ)', () => {
    const result = parsed({ tasks: [task('Việc', 'main', 'sonnet', 'medium')] })
    expect(result.requirements).toEqual([])
    expect(result.tasks[0]?.covers).toBeUndefined()
  })

  test('giới hạn: tối đa 30 yêu cầu, mỗi mục 160 ký tự; covers chỉ nhận số nguyên từ 1, không trùng', () => {
    const result = parsed({
      requirements: [...reqs(40), 'x'.repeat(300)],
      tasks: [task('Việc', 'main', 'sonnet', 'medium', { covers: [1, 1, 2, 0, -3, 'a', 2.5, 99] })],
    })
    expect(result.requirements.length).toBe(30)
    expect(result.requirements.every(r => r.length <= 160)).toBe(true)
    expect(result.tasks[0]?.covers).toEqual([1, 2])
  })

  test('mỗi yêu cầu cắt về 160 ký tự (kiểm riêng, không lẫn với giới hạn số mục)', () => {
    const [only] = parsed({ requirements: ['y'.repeat(300)] }).requirements
    expect(only?.length).toBeLessThanOrEqual(160)
    expect(only?.length).toBeGreaterThan(100)
  })

  test('requirements không phải mảng chuỗi: bỏ qua phần hỏng', () => {
    expect(parsed({ requirements: 'không phải mảng' }).requirements).toEqual([])
    expect(parsed({ requirements: ['A', 5, null, '', 'B'] }).requirements).toEqual(['A', 'B'])
  })
})

describe('0.7.0 7: yêu cầu chưa có việc nào phủ', () => {
  const briefWith = (requirements: string[], covers: number[][]): Brief =>
    makeBrief({
      requirements,
      tasks: covers.map((c, i) => ({ index: i + 1, title: `Việc ${i + 1}`, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '', covers: c })),
    })

  test('liệt kê đúng các yêu cầu mà không việc nào phủ', () => {
    expect(uncoveredRequirements(briefWith(['A', 'B', 'C'], [[1], [3]]))).toEqual(['B'])
    expect(uncoveredRequirements(briefWith(['A', 'B'], [[1, 2]]))).toEqual([])
  })

  test('không có việc nào (yêu cầu một khối) hay không có yêu cầu: không có gì để nhắc', () => {
    expect(uncoveredRequirements(briefWith(['A', 'B'], []))).toEqual([])
    expect(uncoveredRequirements(briefWith([], [[1]]))).toEqual([])
    expect(uncoveredRequirements(makeBrief())).toEqual([])
  })

  test('việc cũ không có covers (router bản cũ) thì không suy ra yêu cầu bị bỏ sót', () => {
    expect(uncoveredRequirements(briefWith(['A', 'B'], [[], []]))).toEqual(['A', 'B'].slice(0, 0))
  })

  test('briefContext nhắc yêu cầu chưa được phủ, và không nhắc khi đã phủ đủ', () => {
    const missing = briefContext(briefWith(['Giữ nguyên API công khai', 'Viết test'], [[2]]), { family: 'sonnet', effort: 'medium' })
    expect(missing).toContain('Yêu cầu chưa có việc nào phủ')
    expect(missing).toContain('Giữ nguyên API công khai')
    expect(missing).not.toContain('Viết test')
    expect(briefContext(briefWith(['A', 'B'], [[1, 2]]), { family: 'sonnet', effort: 'medium' })).not.toContain('Yêu cầu chưa có việc nào phủ')
  })

  test('prompt tiếp nối: yêu cầu mới nối vào danh sách, covers của việc mới trỏ đúng yêu cầu sau khi gộp', () => {
    const prev = briefWith(['A', 'B'], [[1], [2]])
    const next = followUpOf(prev, parsed({ relation: 'continue', goal: '', requirements: ['B', 'C'], tasks: [task('Việc C', 'main', 'sonnet', 'medium', { covers: [2] })] }), 9)
    expect(next.brief.requirements).toEqual(['A', 'B', 'C'])
    expect(next.added[0]?.covers).toEqual([3])
  })
})

describe('0.7.0 7: yêu cầu sống qua trạng thái lưu', () => {
  test('normalizeCore giữ requirements của brief; brief cũ không có thì vẫn không có', () => {
    expect(S.normalizeCore({ brief: makeBrief({ requirements: ['A', 'B'] }) }).brief?.requirements).toEqual(['A', 'B'])
    expect(S.normalizeCore({ brief: makeBrief() }).brief?.requirements).toBeUndefined()
  })
})

describe('0.7.0 7: kiểm lại khi có quá nhiều yêu cầu', () => {
  const request = routerRequest({ text: 'Cập nhật skill lên v10', prev: null, ran: null, policy: OPEN, model: 'sonnet' })
  const parse = (text: string) => parseRoute(text, OPEN)
  const recheck = (r: { requirements: string[] }) => r.requirements.length > 8
  function asker(replies: string[]) {
    const seen: string[] = []
    const ask = async (r: typeof request) => {
      seen.push(`${textOf(r.prompt)}|effort=${r.effort}`)
      return { isAnswered: true as const, text: replies.shift() ?? '', usage: USAGE }
    }
    return { ask, seen }
  }

  // 0.7.2: kiểm lại phủ yêu cầu chạy ở effort medium (effort high hết giờ chờ ở prompt dài); điều kiện kiểm lại do hook truyền vào.
  test('9 yêu cầu: lượt đọc được kiểm lại một lần ở effort medium, kèm câu trả lời trước; lần hai được dùng', async () => {
    const { ask, seen } = asker([JSON.stringify(plan({ goal: 'Lần một', requirements: reqs(9) })), JSON.stringify(plan({ goal: 'Lần hai', requirements: reqs(11) }))])
    const outcome = await askRouter(ask, request, parse, recheck)
    expect(outcome.result?.goal).toBe('Lần hai')
    expect(outcome.retried).toBe(true)
    expect(outcome.usages.length).toBe(2)
    expect(seen[1]).toContain('<previous_answer>')
    expect(seen[1]).toContain('|effort=medium')
    expect(seen[1]).toContain('every requirement')
  })

  test('8 yêu cầu hay ít hơn: không kiểm lại', async () => {
    const { ask, seen } = asker([JSON.stringify(plan({ goal: 'Lần một', requirements: reqs(8) }))])
    const outcome = await askRouter(ask, request, parse, recheck)
    expect(outcome.retried).toBe(false)
    expect(seen.length).toBe(1)
  })

  test('lần kiểm lại hỏng thì giữ câu trả lời lần một', async () => {
    const { ask } = asker([JSON.stringify(plan({ goal: 'Lần một', requirements: reqs(9) })), '{"hỏng'])
    expect((await askRouter(ask, request, parse, recheck)).result?.goal).toBe('Lần một')
  })

  test('không truyền điều kiện kiểm lại: hành vi như cũ', async () => {
    const { ask, seen } = asker([JSON.stringify(plan({ goal: 'Lần một', requirements: reqs(12) }))])
    expect((await askRouter(ask, request, parse)).retried).toBe(false)
    expect(seen.length).toBe(1)
  })
})

describe('0.7.0 7: request của router', () => {
  const base = { text: 'Làm tiếp phần còn lại', prev: null, ran: null, policy: OPEN, model: 'sonnet' } as const

  test('bước đang mở của checklist hiện tại đi kèm (tối đa 10); không có thì không có dòng nào', () => {
    const steps = Array.from({ length: 12 }, (_, i) => `Bước mở ${i + 1}`)
    const withSteps = textOf(routerRequest({ ...base, openSteps: steps }).prompt)
    expect(withSteps).toContain('Open checklist steps')
    expect(withSteps).toContain('Bước mở 10')
    expect(withSteps).not.toContain('Bước mở 11')
    expect(textOf(routerRequest(base).prompt)).not.toContain('Open checklist steps')
    expect(textOf(routerRequest({ ...base, openSteps: [] }).prompt)).not.toContain('Open checklist steps')
  })

  test('lời dặn: liệt kê requirements, covers, chia theo cách làm tốt nhất, tối đa 8 việc, chỉ giao phần độc lập', () => {
    const system = routerSystem()
    expect(system).toContain('requirements')
    expect(system).toContain('covers')
    expect(system).toContain('at most 8 tasks')
    expect(system).toContain('truly independent')
    expect(system).not.toContain('Never invent your own sub-steps')
  })

  test('mã đề mục (K4.1, Bước 2) vẫn là một việc riêng, không bị gộp', () => {
    expect(routerSystem()).toContain('K4.1')
    expect(routerSystem()).toMatch(/is its own task/)
    expect(routerSystem()).toContain('never merge coded headings')
  })
})
