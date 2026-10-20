// 0.7.0 điểm 3 và 4. Điểm 3: prompt tiếp nối (continue, refine, dissatisfied) không làm tier, tức ngân sách tool call, tụt xuống
// thấp hơn tier hiện có của mục tiêu. Điểm 4: mức nâng model/effort theo bằng chứng sống qua prompt tiếp nối (continue, refine),
// giảm một bậc sau một turn không có phát hiện mới, và bị xóa khi người dùng báo chưa đạt hay khi sang mục tiêu mới.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Brief } from '../../types'
import { followUpOf, parseRoute } from '../../hooks/lib/router'
import * as S from '../../hooks/lib/state'
import { OPEN } from '../golden/cases'
import { makeBrief } from '../support/commands'
import { base, plan, step, submit } from '../support/engine'

const routerPlan = (over: Record<string, unknown>) => {
  const parsed = parseRoute(JSON.stringify(plan(over)), OPEN)
  if (parsed === null) throw new Error('router plan không đọc được')
  return parsed
}
const brief = (over: Partial<Brief>): Brief => makeBrief({ goalId: 3, goal: 'Mục tiêu', ...over })

describe('0.7.0 3: tier của prompt tiếp nối không tụt', () => {
  test('continue, refine, dissatisfied giữ tier cao hơn của hai bên', () => {
    for (const relation of ['continue', 'refine', 'dissatisfied'] as const) {
      const next = followUpOf(brief({ tier: 'complex' }), routerPlan({ relation, depth: 'light', volume: 'small' }), 9).brief
      expect(next.tier, relation).toBe('complex')
      // depth và volume vẫn là cách router đọc prompt mới.
      expect(next.depth).toBe('light')
      expect(next.volume).toBe('small')
    }
  })

  test('prompt tiếp nối nặng hơn thì tier tăng theo router', () => {
    expect(followUpOf(brief({ tier: 'simple' }), routerPlan({ relation: 'continue', depth: 'hard', volume: 'large' }), 9).brief.tier).toBe('deep')
    expect(followUpOf(brief({ tier: 'moderate' }), routerPlan({ relation: 'refine', depth: 'substantial', volume: 'medium' }), 9).brief.tier).toBe('complex')
  })

  test('tier bằng nhau thì giữ nguyên', () => {
    expect(followUpOf(brief({ tier: 'moderate' }), routerPlan({ relation: 'continue', depth: 'light', volume: 'medium' }), 9).brief.tier).toBe('moderate')
  })

  const overBudget = async ($: Engine, calls: number) => {
    let text = ''
    await $.turn.start({ text: 'làm', turnId: 'tb' })
    for (let i = 0; i < calls; i++) {
      const out = await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` })
      text += `${(out.context ?? []).join('\n')}\n`
    }
    return text.includes('vượt mức dự kiến')
  }

  test('mục tiêu complex, prompt tiếp nối ngắn: 16 tool call chưa vượt ngân sách 60', {}, async ($, on) => {
    base(on, {
      router: request =>
        request.startsWith('Làm tiếp') ? plan({ relation: 'continue', goal: '', depth: 'light', volume: 'small' }) : plan({ goal: 'Sửa lớn', depth: 'substantial', volume: 'medium', kind: 'mixed' }),
    })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, 'Sửa lớn module thanh toán')
    await submit($, 'Làm tiếp phần test')
    expect(await overBudget($, 16)).toBe(false)
  })

  test('đối chứng: mục tiêu simple từ đầu thì 16 tool call vượt ngân sách 15', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa nhỏ', depth: 'light', volume: 'small' }) })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, 'Sửa nhỏ một chỗ')
    expect(await overBudget($, 16)).toBe(true)
  })
})

describe('0.7.0 4: mức nâng qua prompt tiếp nối', () => {
  const answer = (turnId: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' }) as never

  /** Mục tiêu có router trả `follow` cho prompt bắt đầu bằng "Làm tiếp"; turn đầu có ba tool call lỗi (nâng effort một bậc). */
  async function liftedGoal($: Engine, on: Parameters<typeof base>[0], follow: Record<string, unknown>) {
    const seen = base(on, { router: request => (request.startsWith('Làm tiếp') ? plan(follow) : plan({ goal: 'Sửa typo' })) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    await $.turn.complete(answer('t1'))
    return seen
  }

  test('continue: mức nâng còn cho turn của prompt tiếp nối', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'continue', goal: '' })
    await submit($, 'Làm tiếp phần còn lại')
    expect(await step($, seen, { turnId: 't2' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('refine: mức nâng còn cho turn của prompt tiếp nối', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'refine', goal: '' })
    await submit($, 'Làm tiếp, thêm một ràng buộc nhỏ')
    expect(await step($, seen, { turnId: 't2' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('mức nâng giảm một bậc sau một turn không có phát hiện mới', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'continue', goal: '' })
    await submit($, 'Làm tiếp phần còn lại')
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('high')
    await $.turn.complete(answer('t2'))
    // Cache nguội: không còn lý do giữ lựa chọn cũ, nên effort của turn sau phản ánh đúng mức nâng còn lại.
    await seen.clock.advance(2 * 60 * 60_000)
    expect((await step($, seen, { turnId: 't3' }))?.effort).toBe('medium')
  })

  test('turn lại có phát hiện mới (ba tool call lỗi) thì mức nâng không giảm', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'continue', goal: '' })
    await submit($, 'Làm tiếp phần còn lại')
    // Turn mới: bộ đếm lỗi của turn bắt đầu lại, nên ba lỗi nữa là một chuỗi lỗi mới.
    await $.turn.start({ text: 'Làm tiếp phần còn lại', turnId: 't2' })
    await step($, seen, { turnId: 't2' })
    for (const file of ['d.txt', 'e.txt', 'f.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    await $.turn.complete(answer('t2'))
    await seen.clock.advance(2 * 60 * 60_000)
    // Mức nâng 1 còn từ turn trước, cộng 1 của chuỗi lỗi mới: đủ hai bậc (trần), không giảm ở cuối turn.
    expect((await step($, seen, { turnId: 't3' }))?.effort).toBe('xhigh')
  })

  test('dissatisfied: router đã thấy model đã chạy, mod không nâng thêm', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'dissatisfied', goal: '', main: { model: 'sonnet', effort: 'medium' } })
    await submit($, 'Làm tiếp, vẫn sai')
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('medium')
  })

  test('mục tiêu mới xóa mức nâng', {}, async ($, on) => {
    const seen = await liftedGoal($, on, { relation: 'new', goal: 'Việc khác hẳn' })
    await submit($, 'Làm tiếp bằng một việc khác hẳn')
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('medium')
  })
})

describe('0.7.0 4: reducer', () => {
  const core = (lift: { depth: number; effort: number }, relation: Brief['relation']) => S.normalizeCore({ brief: brief({ relation }), lift })

  test('withDecision giữ mức nâng khi continue hay refine, xóa khi dissatisfied hay new', () => {
    const lift = { depth: 1, effort: 2 }
    expect(S.withDecision(brief({ relation: 'continue' }))(core(lift, 'continue')).lift).toEqual(lift)
    expect(S.withDecision(brief({ relation: 'refine' }))(core(lift, 'refine')).lift).toEqual(lift)
    expect(S.withDecision(brief({ relation: 'dissatisfied' }))(core(lift, 'dissatisfied')).lift).toEqual({ depth: 0, effort: 0 })
    expect(S.withDecision(brief({ relation: 'new' }))(core(lift, 'new')).lift).toEqual({ depth: 0, effort: 0 })
  })

  test('withLiftDecay giảm mỗi chiều một bậc, không xuống dưới 0', () => {
    expect(S.withLiftDecay(core({ depth: 2, effort: 1 }, 'continue')).lift).toEqual({ depth: 1, effort: 0 })
    expect(S.withLiftDecay(core({ depth: 0, effort: 0 }, 'continue')).lift).toEqual({ depth: 0, effort: 0 })
    expect(S.withLiftDecay(core({ depth: 0, effort: 2 }, 'continue')).lift).toEqual({ depth: 0, effort: 1 })
  })
})
