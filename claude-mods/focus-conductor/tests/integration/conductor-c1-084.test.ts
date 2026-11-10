// 0.8.4 C1: option conductor (off mặc định, fable) và các định nghĩa của Fable điều phối ở một chỗ (hooks/lib/conductor.ts): Fable
// sẵn sàng, mục tiêu lớn, điều phối khả dụng, luồng chính điều phối; ID Fable theo modelMap, rồi ID phiên họ fable, rồi ID mặc định
// claude-fable-5-2. Chính sách model của phiên ceiling hay fixed với phiên không phải Fable thì không điều phối, cảnh báo một lần.

import { describe, expect, test } from 'claude-code/testing'
import type { Brief, Core } from '../../types'
import * as C from '../../hooks/lib/conductor'
import * as S from '../../hooks/lib/state'
import { resolveModelId } from '../../hooks/lib/route'
import { COMPLEX_PROMPT, base, plan, step, submit } from '../support/engine'

const brief = (over: Partial<Brief>) => ({ goalId: 1, depth: 'substantial', kind: 'edit', isReference: false, ...over }) as Brief
const READY = { option: 'fable' as const, mode: 'auto', headless: false, blocked: new Set<never>(), pauseLeft: 0 }

describe('0.8.4 C1: option conductor', () => {
  for (const raw of [undefined, '', 'off', 'Fable', 'opus']) {
    test(`conductorOf(${JSON.stringify(raw)}) là off`, () => expect(C.conductorOf(raw === undefined ? {} : { conductor: raw })).toBe('off'))
  }
  test('conductorOf(fable) là fable', () => expect(C.conductorOf({ conductor: 'fable' })).toBe('fable'))
})

describe('0.8.4 C1: mục tiêu lớn', () => {
  const cases: Array<[string, Partial<Brief>, boolean]> = [
    ['substantial, edit', { depth: 'substantial', kind: 'edit' }, true],
    ['hard, mixed', { depth: 'hard', kind: 'mixed' }, true],
    ['substantial, investigate', { depth: 'substantial', kind: 'investigate' }, true],
    ['light, edit', { depth: 'light', kind: 'edit' }, false],
    ['hard, answer', { depth: 'hard', kind: 'answer' }, false],
    ['substantial, edit, đối chiếu', { isReference: true }, false],
    ['substantial, edit, mục tiêu tối thiểu', { isBare: true }, false],
  ]
  for (const [name, over, big] of cases) test(`${name}: ${big ? 'lớn' : 'không lớn'}`, () => expect(C.isBigGoal(brief(over))).toBe(big))
  test('không có mục tiêu: không lớn', () => expect(C.isBigGoal(null)).toBe(false))
})

describe('0.8.4 C1: Fable sẵn sàng và điều phối khả dụng', () => {
  test('đủ điều kiện: sẵn sàng, điều phối khả dụng, luồng chính điều phối mục tiêu lớn', () => {
    expect(C.fableBlocker(READY)).toBeNull()
    expect(C.conductorBlocker({ ...READY, sessionPolicy: 'auto', sessionFamily: 'opus' })).toBeNull()
    expect(C.isMainConducting({ ...READY, sessionPolicy: 'auto', sessionFamily: null }, brief({}))).toBe(true)
    expect(C.isMainConducting({ ...READY, sessionPolicy: 'auto', sessionFamily: null }, brief({ depth: 'light' }))).toBe(false)
  })
  test('nguyên nhân không sẵn sàng: option, chế độ, headless, họ bị chặn, router tạm ngừng', () => {
    expect(C.fableBlocker({ ...READY, option: 'off' })).toBe('option')
    expect(C.fableBlocker({ ...READY, mode: 'off' })).toBe('mode')
    expect(C.fableBlocker({ ...READY, headless: true })).toBe('headless')
    expect(C.fableBlocker({ ...READY, blocked: new Set(['fable' as const]) })).toBe('blocked')
    expect(C.fableBlocker({ ...READY, pauseLeft: 2 })).toBe('paused')
  })
  test('chế độ subagents: Fable sẵn sàng nhưng luồng chính không điều phối', () => {
    expect(C.fableBlocker({ ...READY, mode: 'subagents' })).toBeNull()
    expect(C.conductorBlocker({ ...READY, mode: 'subagents', sessionPolicy: 'auto', sessionFamily: null })).toBe('mode')
  })
  test('sessionModel fixed hay ceiling với phiên không phải Fable: không điều phối; phiên Fable thì được', () => {
    expect(C.conductorBlocker({ ...READY, sessionPolicy: 'fixed', sessionFamily: 'opus' })).toBe('session')
    expect(C.conductorBlocker({ ...READY, sessionPolicy: 'ceiling', sessionFamily: 'sonnet' })).toBe('session')
    expect(C.conductorBlocker({ ...READY, sessionPolicy: 'fixed', sessionFamily: 'fable' })).toBeNull()
  })
})

describe('0.8.4 C1: ID của Fable', () => {
  test('modelMap có fable thì dùng ID đó', () => expect(C.fableModelId({ fable: 'x-fable' }, 'claude-opus-5-5')).toBe('x-fable'))
  test('phiên họ fable có hậu tố: dùng nguyên ID của phiên', () => expect(C.fableModelId({}, 'claude-fable-5-2[1m]')).toBe('claude-fable-5-2[1m]'))
  test('còn lại: ID mặc định đã kiểm claude-fable-5-2', () => {
    expect(C.fableModelId({}, 'claude-opus-5-5')).toBe('claude-fable-5-2')
    expect(C.fableModelId({}, null)).toBe('claude-fable-5-2')
    expect(resolveModelId('fable', 'claude-opus-5-5', {})).toBe('claude-fable-5-2')
  })
})

describe('0.8.4 C1: chính sách model của phiên thắng', () => {
  test("sessionModel fixed, phiên opus, conductor fable: luồng chính giữ opus, đúng một cảnh báo trong phiên", { options: { planApproval: 'off', sessionModel: 'fixed', conductor: 'fable' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' } }) })
    await submit($, COMPLEX_PROMPT)
    const first = await step($, seen, { model: 'claude-opus-5-5' })
    const second = await step($, seen, { model: 'claude-opus-5-5', turnId: 't2' })
    expect(first?.model).toContain('opus')
    expect(second?.model).toContain('opus')
    expect(seen.toasts.filter(t => t.includes('sessionModel')).length).toBe(1)
  })
})

describe('0.8.4 C1: trạng thái từ bản cũ', () => {
  test('Core 0.8.3 không có trường fable: nạp được, mặc định không tạm ngừng, chưa ghi trạng thái', () => {
    const core = S.normalizeCore(JSON.parse(JSON.stringify({ ...S.EMPTY_CORE, fable: undefined })) as Partial<Core>)
    expect(core.fable).toEqual({ failures: 0, pauseLeft: 0, ready: null, reason: '', holdKey: '' })
  })
})
