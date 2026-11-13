// 0.8.5 K10: cờ "prompt này đi qua trong lúc Fable tạm ngừng" nằm trong Core.fable (promptPaused), nên nạp lại mod giữa prompt cuối của đợt
// tạm ngừng và turn của nó vẫn coi Fable chưa sẵn sàng cho turn đó. Core của 0.8.4 không có trường này thì false.

import { describe, expect, test } from 'claude-code/testing'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { createContext } from '../../hooks/context'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
/** 0.8.7 F1: các ca mô tả cách chạy khi Fable không dùng được mà không có họ dự phòng. */
const NO_FALLBACK = { options: { ...FABLE.options, conductorFallback: 'off' } }
const ID = 'fable'
const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' } })
const FOLLOW = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' } })
const prompts = (seen: Seen) => seen.routerCalls.filter(c => c.kind === 'prompt')

function setup(on: Parameters<typeof base>[0], fable: (n: number) => Json | null) {
  let n = 0
  const seen: Seen = base(on, { router: () => (seen.routerModels.at(-1) === ID ? fable(n++) : FOLLOW) })
  on('turn.complete', () => ({ text: '' }))
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return seen
}

describe('0.8.5 K10: cờ Fable tạm ngừng của prompt sống qua nạp lại mod', () => {
  test('prompt cuối của đợt tạm ngừng đến, nạp lại mod: turn của prompt đó vẫn chạy theo main của router, không phải Fable', NO_FALLBACK, async ($, on) => {
    const seen = setup(on, n => (n === 0 ? BIG : null))
    for (let i = 1; i <= 6; i++) await submit($, i === 1 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model).slice(-3)).toEqual(['sonnet', 'sonnet', 'sonnet'])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    const ran = await step($, seen, { turnId: 't6' })
    expect(`${ran?.model}/${String(ran?.effort)}`).toBe('claude-sonnet-5-5/medium')
  })

  // Bộ kit test không nạp lại module được (session.start giữ biến của module), nên ca trên chỉ ghim hành vi; ca này dựng ngữ cảnh mới bằng
  // createContext như khi engine nạp lại mod, và đọc Core đã qua vòng JSON.
  test('ngữ cảnh mới (như sau nạp lại) đọc Core có promptPaused, pauseLeft 0: Fable chưa sẵn sàng; không có cờ thì sẵn sàng', () => {
    const fresh = createContext({ conductor: 'fable', planApproval: 'off', conductorFallback: 'off' } as never)
    const paused = S.normalizeCore(JSON.parse(JSON.stringify(S.withFable(() => ({ pauseLeft: 0, promptPaused: true }) as never)(S.EMPTY_CORE))) as Partial<Core>)
    expect(fresh.conductorState(paused, 'auto')).not.toBeNull()
    const ready = S.withFable(() => ({ pauseLeft: 0, promptPaused: false }) as never)(S.EMPTY_CORE)
    expect(fresh.conductorState(ready, 'auto')).toBeNull()
  })

  test('Core của 0.8.4 không có trường promptPaused: false', () => {
    const old = { ...S.EMPTY_CORE, fable: { failures: 0, pauseLeft: 1, ready: true, reason: '', holdKey: '', briefedGoal: -1 } } as unknown as Core
    expect((S.normalizeCore(old).fable as { promptPaused?: unknown }).promptPaused).toBe(false)
  })
})
