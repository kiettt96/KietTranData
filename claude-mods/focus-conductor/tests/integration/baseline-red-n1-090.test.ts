// 0.9.0 vòng 3 N1: lệnh kiểm lỗi trước mọi thay đổi của mục tiêu được ghi trong $.state (mục của cổng lệnh kiểm chưa đạt) với cờ đỏ từ
// nền; lệnh lỗi lần đầu sau một lần Edit thì không có cờ. Trạng thái lưu từ bản trước (mục không có trường mới) nạp được, không văng lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BASE_OPTS, TSC, baseOpen, baseSetup, editSample, runTsc } from '../support/baseline-red'
import { offerAgent, sampleGoal, stopSample } from '../support/closing-sample'
import { step, submit } from '../support/engine'
import { M6_STATE } from '../support/m6-state'
import { checkSignature } from '../../hooks/lib/drift/evidence'

type Item = { command: string; baseline?: boolean; round: number }
type CoreLike = { retry?: { goalId: number; items: Item[] } }

/** Chép mọi lần ghi state của mod vào `into`; `values` cấp giá trị của lần nạp trước cho tới khi mod ghi lại khóa đó. */
function stateHooks(on: On, into: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const pending = new Map(Object.entries(values))
  on('state.get', async (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string }
    const read = (await next(e)) as { value?: { value?: unknown; version: number } }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string' && pending.has(ev.key)) return { value: { value: pending.get(ev.key), version: read.value?.version ?? 0 } } as never
    return read as never
  })
  on('state.set', (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string; value?: unknown }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string') {
      pending.delete(ev.key)
      into[ev.key] = JSON.parse(JSON.stringify(ev.value ?? null))
    }
    return next(e)
  })
}
const tscItem = (into: Record<string, unknown>) => ((into['core'] as CoreLike | undefined)?.retry?.items ?? []).find(item => item.command === TSC)

describe('0.9.0 vòng 3 N1: ghi nhận lệnh kiểm đỏ từ nền', () => {
  test('tsc lỗi trước mọi thay đổi: mục trong $.state có cờ đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const into: Record<string, unknown> = {}
    stateHooks(on, into)
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    expect(tscItem(into)?.baseline).toBe(true)
  })

  test('tsc lỗi lần đầu sau một lần Edit: mục không có cờ', BASE_OPTS(), async ($, on) => {
    const into: Record<string, unknown> = {}
    stateHooks(on, into)
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await editSample($)
    await runTsc($)
    expect(tscItem(into)).toBeDefined()
    expect(tscItem(into)?.baseline).not.toBe(true)
  })

  test('nạp trạng thái lưu từ bản trước, mục không có trường mới: không văng lỗi, mục giữ không cờ, cổng vẫn chặn như 0.9.0', BASE_OPTS(), async ($, on) => {
    const into: Record<string, unknown> = {}
    const saved = JSON.parse(JSON.stringify(M6_STATE)) as Record<string, Record<string, unknown>>
    const old = { sig: checkSignature({ check: 'static', command: TSC }), check: 'static', command: TSC, round: 1, levels: ['sonnet/medium'], floor: null, isTop: false, lastError: 'Found 27 errors', noticed: 1, edited: 0, calls: 0, closedSteps: [], exhausted: false, reportAsked: false, logged: false, step: null, more: [], restore: null, retried: false, idle: 0, runner: '', ranAt: '10:00' }
    ;(saved['core'] as Record<string, unknown>)['retry'] = { goalId: 1, items: [old] }
    stateHooks(on, into, saved)
    const sample = baseSetup(on, sampleGoal({ relation: 'continue' }))
    await offerAgent($)
    await submit($, 'Làm tiếp')
    await $.turn.start({ text: 'Làm tiếp', turnId: 't2' })
    await step($, sample.seen, { turnId: 't2' })
    await editSample($)
    expect(await stopSample($)).toContain('Còn lệnh kiểm chưa đạt')
    expect(tscItem(into)?.baseline).not.toBe(true)
  })
})
