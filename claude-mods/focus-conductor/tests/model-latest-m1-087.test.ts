// 0.8.7 M1: mod dùng phiên bản model mới nhất engine biết. Router ($.model.complete) và lời gọi Agent nhận alias ở mọi engine đã kiểm;
// luồng chính (turn.step) chỉ nhận alias từ engine 2.1.323 (engine 2.1.296 gửi nguyên chuỗi alias cho API), nên resolveModelId nhận cờ
// useAlias do cổng phiên bản engine quyết định. Ghi đè modelMap, ID của phiên cùng họ và ID có tiền tố nhà cung cấp giữ như 0.8.6.

import { describe, expect, test } from 'claude-code/testing'
import { FAMILIES, engineTakesAlias, familyOf, pinnedId, resolveModelId } from '../hooks/lib/route'
import { fableModelId } from '../hooks/lib/conductor'
import { routerRequest } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const COND: Policy = { ...OPEN, conductor: true }
const SHORT = 'Sửa luồng thanh toán. ' + 'c'.repeat(5_000 - 22)

describe('0.8.7 M1: resolveModelId', () => {
  test('họ khác họ của phiên, không ghi đè, ID phiên không có tiền tố, engine nhận alias: trả alias của họ, cả bốn họ', () => {
    for (const family of FAMILIES) {
      const session = family === 'haiku' ? 'claude-opus-5-5' : 'claude-haiku-5-5'
      expect(resolveModelId(family, session, {}, true)).toBe(family)
    }
  })

  test('engine cũ (không nhận alias ở luồng chính): trả ID ghim như 0.8.6', () => {
    expect(resolveModelId('opus', 'claude-sonnet-5-5', {}, false)).toBe('claude-opus-5-5')
    expect(resolveModelId('fable', 'claude-sonnet-5-5', {})).toBe('claude-fable-5-2')
  })

  test('có ghi đè trong modelMap: trả đúng ID ghi đè', () => {
    expect(resolveModelId('opus', 'claude-sonnet-5-5', { opus: 'claude-opus-4-6' }, true)).toBe('claude-opus-4-6')
    expect(resolveModelId('opus', 'claude-sonnet-5-5', { opus: 'claude-opus-4-6' }, false)).toBe('claude-opus-4-6')
  })

  test('cùng họ với phiên: trả đúng ID của phiên, kể cả bản cũ hơn hay mới hơn ID ghim', () => {
    expect(resolveModelId('opus', 'claude-opus-4-6', {}, true)).toBe('claude-opus-4-6')
    expect(resolveModelId('opus', 'claude-opus-6-0', {}, true)).toBe('claude-opus-6-0')
    expect(resolveModelId('sonnet', 'claude-sonnet-5-5[1m]', {}, true)).toBe('claude-sonnet-5-5[1m]')
  })

  test('ID phiên có tiền tố nhà cung cấp: trả tiền tố cộng ID ghim như 0.8.6, kể cả khi engine nhận alias', () => {
    expect(resolveModelId('sonnet', 'us.anthropic.claude-opus-5-5', {}, true)).toBe(`us.anthropic.${pinnedId('sonnet')}`)
    expect(resolveModelId('sonnet', 'us.anthropic.claude-opus-5-5', {}, false)).toBe('us.anthropic.claude-sonnet-5-5')
  })
})

describe('0.8.7 M1: familyOf', () => {
  test('ID có số phiên bản bất kỳ và chính alias: đúng họ; chuỗi không chứa tên họ nào: null', () => {
    expect(familyOf('claude-opus-6-0')).toBe('opus')
    expect(familyOf('claude-sonnet-7')).toBe('sonnet')
    expect(familyOf('opus')).toBe('opus')
    expect(familyOf('fable')).toBe('fable')
    expect(familyOf('claude-unknown-1')).toBeNull()
  })
})

describe('0.8.7 M1: cổng phiên bản engine', () => {
  test('so theo từng phần số: 2.1.323 trở lên nhận alias; cũ hơn, rỗng hay không đọc được thì không', () => {
    expect(engineTakesAlias('2.1.296')).toBe(false)
    expect(engineTakesAlias('2.1.322')).toBe(false)
    expect(engineTakesAlias('2.1.323')).toBe(true)
    expect(engineTakesAlias('2.1.1000')).toBe(true)
    expect(engineTakesAlias('2.2.0')).toBe(true)
    expect(engineTakesAlias('3.0.0')).toBe(true)
    expect(engineTakesAlias('')).toBe(false)
    expect(engineTakesAlias('bản thử')).toBe(false)
    expect(engineTakesAlias('2.1.323-dev.20261113.t101500.sha1a2b3c4')).toBe(true)
    expect(engineTakesAlias('2.1.322-dev.20261113.t101500.sha1a2b3c4')).toBe(false)
  })
})

describe('0.8.7 M1: model của router Fable', () => {
  test('không ghi đè, phiên không thuộc họ fable: alias fable; ghi đè thắng; phiên họ fable giữ ID phiên; có tiền tố giữ như 0.8.6', () => {
    expect(fableModelId({}, 'claude-opus-5-5')).toBe('fable')
    expect(fableModelId({}, null)).toBe('fable')
    expect(fableModelId({ fable: 'claude-fable-5-1' }, 'claude-opus-5-5')).toBe('claude-fable-5-1')
    expect(fableModelId({}, 'claude-fable-5-3')).toBe('claude-fable-5-3')
    expect(fableModelId({}, 'us.anthropic.claude-opus-5-5')).toBe('us.anthropic.claude-fable-5-2')
  })

  test('prompt 5.000 ký tự: prompt, maxTokens, timeoutMs, effort của request router như khi model là ID ghim', () => {
    for (const [policy, isFable] of [[OPEN, false], [COND, true]] as const) {
      const a = routerRequest({ text: SHORT, prev: null, ran: null, policy, model: isFable ? 'fable' : 'sonnet', ...(isFable ? { isFable: true } : {}) })
      const b = routerRequest({ text: SHORT, prev: null, ran: null, policy, model: isFable ? 'claude-fable-5-2' : 'claude-sonnet-5-5', ...(isFable ? { isFable: true } : {}) })
      expect([a.prompt, a.maxTokens, a.timeoutMs, a.effort]).toEqual([b.prompt, b.maxTokens, b.timeoutMs, b.effort])
    }
  })
})
