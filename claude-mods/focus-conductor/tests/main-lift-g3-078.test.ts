// 0.7.8 G3: luồng chính đủ sức cho việc khó nhất nó giữ. Họ và effort của luồng chính là mức cao nhất giữa main và các việc
// run: main (xét riêng họ và effort), qua fitPick lần nữa để chính sách phiên vẫn là bước cuối; pick của từng việc không đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelFamily } from '../types'
import { parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { base, plan, step, submit, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const routed = (over: Record<string, unknown>, policy: Policy = OPEN): RouterPlan => parseRoute(JSON.stringify(plan(over)), policy)!
const RACE = task('K1 Sửa race condition ghi cache', 'main', 'opus', 'high', { depth: 'hard' })

describe('0.7.8 G3: nâng luồng chính theo việc nó giữ', () => {
  test('main sonnet/medium, việc run: main opus/high: luồng chính opus/high kèm ghi chú; pick của việc giữ nguyên', () => {
    const r = routed({ main: { model: 'sonnet', effort: 'medium' }, tasks: [RACE] })
    expect(r.main).toEqual({ family: 'opus', effort: 'high' })
    expect(r.notes.join('; ')).toContain('việc 1 giữ ở luồng chính cần opus/high: nâng luồng chính')
    expect(r.tasks[0]?.pick).toEqual({ family: 'opus', effort: 'high' })
  })

  test('xét riêng họ và effort: việc opus/low và việc sonnet/high cho luồng chính opus/high', () => {
    const r = routed({
      main: { model: 'sonnet', effort: 'medium' },
      tasks: [task('Một', 'main', 'opus', 'low'), task('Hai', 'main', 'sonnet', 'high')],
    })
    expect(r.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('việc run: agent opus không nâng luồng chính', () => {
    const r = routed({ main: { model: 'sonnet', effort: 'medium' }, tasks: [task('K1 Sửa race condition', 'agent', 'opus', 'high')] })
    expect(r.main).toEqual({ family: 'sonnet', effort: 'medium' })
    expect(r.notes.join('; ')).not.toContain('nâng luồng chính')
  })

  test('việc run: main thấp hơn main không hạ luồng chính', () => {
    const r = routed({ main: { model: 'opus', effort: 'high' }, tasks: [task('Nhỏ', 'main', 'haiku', 'low', { kind: 'answer' })] })
    expect(r.main).toEqual({ family: 'opus', effort: 'high' })
    expect(r.notes.join('; ')).not.toContain('nâng luồng chính')
  })

  test('model phiên ceiling sonnet: luồng chính giữ sonnet kèm ghi chú kẹp', () => {
    const r = routed({ main: { model: 'sonnet', effort: 'medium' }, tasks: [RACE] }, { ...OPEN, session: { family: 'sonnet', policy: 'ceiling' } })
    expect(r.main.family).toBe('sonnet')
    expect(r.notes.join('; ')).toContain('nâng luồng chính')
    expect(r.notes.length).toBeGreaterThanOrEqual(2)
  })

  test('việc fable khi chưa bật allowFable: luồng chính về opus', () => {
    const r = routed({ main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Khó nhất', 'main', 'fable', 'high')] })
    expect(r.main.family).toBe('opus')
  })

  test('brief isReference không nâng', () => {
    const r = routed({ reference: true, main: { model: 'sonnet', effort: 'medium' }, tasks: [RACE] })
    expect(r.main).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('prompt tiếp nối có việc mới run: main opus/high: luồng chính của lượt đó là opus', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Thêm')
          ? plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [RACE] })
          : plan({ goal: 'Sửa cache', main: { model: 'sonnet', effort: 'medium' } }),
    })
    await submit($, 'Sửa cache')
    expect((await step($, seen, { turnId: 't1' }))?.model).toContain('sonnet')
    await submit($, 'Thêm: sửa race condition ghi cache')
    expect((await step($, seen, { turnId: 't2' }))?.model).toContain('opus')
  })
})
