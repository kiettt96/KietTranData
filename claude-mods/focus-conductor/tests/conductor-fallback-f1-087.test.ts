// 0.8.7 F1: Fable không dùng được (họ fable bị chặn hay router Fable tạm ngừng) thì họ dự phòng (option conductorFallback, mặc định opus)
// nhận vai điều phối; nguyên nhân là cấu hình (option, mode, headless, session) thì không. Họ dự phòng bị chặn hay tạm ngừng thì không có
// họ điều phối, như 0.8.6. Đoạn dặn ghi đúng họ đang điều phối, giữ trần. Nạp trạng thái 0.8.6 (không có Core.fallback) không lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelFamily } from '../types'
import { activeConductor, conductorBlocker, conductorFallbackOf } from '../hooks/lib/conductor'
import type { ConductorInputs } from '../hooks/lib/conductor'
import { CONDUCTOR_CHARS, CONDUCTOR_KEEP_CHARS, conductorContext, conductorKeepText } from '../hooks/lib/text'
import * as S from '../hooks/lib/state'

const READY: ConductorInputs = { option: 'fable', mode: 'auto', headless: false, blocked: new Set(), pauseLeft: 0, sessionPolicy: 'auto', sessionFamily: null, fallback: 'opus', fallbackPauseLeft: 0 }
const set = (...families: ModelFamily[]) => new Set<ModelFamily>(families)

describe('0.8.7 F1: option conductorFallback', () => {
  test('mặc định opus; sonnet; off là không có; giá trị khác là mặc định', () => {
    expect(conductorFallbackOf({})).toBe('opus')
    expect(conductorFallbackOf({ conductorFallback: 'opus' })).toBe('opus')
    expect(conductorFallbackOf({ conductorFallback: 'sonnet' })).toBe('sonnet')
    expect(conductorFallbackOf({ conductorFallback: 'off' })).toBeNull()
    expect(conductorFallbackOf({ conductorFallback: 'haiku' })).toBe('opus')
  })
})

describe('0.8.7 F1: họ đang điều phối', () => {
  test('Fable sẵn sàng: fable, không phải dự phòng', () => {
    expect(activeConductor(READY)).toEqual({ family: 'fable', isFallback: false, reason: null })
  })

  test('họ fable bị chặn hay router Fable tạm ngừng: họ dự phòng nhận vai, kèm lý do', () => {
    expect(activeConductor({ ...READY, blocked: set('fable') })).toEqual({ family: 'opus', isFallback: true, reason: 'blocked' })
    expect(activeConductor({ ...READY, pauseLeft: 2 })).toEqual({ family: 'opus', isFallback: true, reason: 'paused' })
    expect(activeConductor({ ...READY, pauseLeft: 2, fallback: 'sonnet' })).toEqual({ family: 'sonnet', isFallback: true, reason: 'paused' })
  })

  test('nguyên nhân là cấu hình (option, mode, headless, session): không kích hoạt dự phòng', () => {
    expect(activeConductor({ ...READY, option: 'off', pauseLeft: 2 })).toBeNull()
    expect(activeConductor({ ...READY, mode: 'off', pauseLeft: 2 })).toBeNull()
    expect(activeConductor({ ...READY, headless: true, pauseLeft: 2 })).toBeNull()
    expect(activeConductor({ ...READY, mode: 'suggest', pauseLeft: 2 })).toBeNull()
    expect(activeConductor({ ...READY, sessionPolicy: 'fixed', sessionFamily: 'sonnet', pauseLeft: 2 })).toBeNull()
    // Như 0.8.6: nguyên nhân của Fable nêu trước, không có điều phối.
    expect(conductorBlocker({ ...READY, mode: 'suggest', pauseLeft: 2 })).toBe('paused')
    expect(conductorBlocker({ ...READY, sessionPolicy: 'fixed', sessionFamily: 'sonnet', pauseLeft: 2 })).toBe('paused')
  })

  test('conductorFallback off, họ dự phòng bị chặn hay tạm ngừng: không có họ điều phối, như 0.8.6', () => {
    expect(activeConductor({ ...READY, pauseLeft: 2, fallback: null })).toBeNull()
    expect(activeConductor({ ...READY, pauseLeft: 2, blocked: set('opus') })).toBeNull()
    expect(activeConductor({ ...READY, blocked: set('fable', 'opus') })).toBeNull()
    expect(activeConductor({ ...READY, pauseLeft: 2, fallbackPauseLeft: 1 })).toBeNull()
    expect(conductorBlocker({ ...READY, pauseLeft: 2, fallback: null })).toBe('paused')
    expect(conductorBlocker({ ...READY, pauseLeft: 2, fallbackPauseLeft: 1 })).toBe('paused')
  })

  test('dự phòng đang hoạt động: điều phối khả dụng (conductorBlocker null)', () => {
    expect(conductorBlocker({ ...READY, pauseLeft: 2 })).toBeNull()
    expect(conductorBlocker({ ...READY, blocked: set('fable') })).toBeNull()
  })
})

describe('0.8.7 F1: đoạn dặn theo họ đang điều phối', () => {
  test('mặc định trùng 0.8.6 (fable); với opus: có opus, không có fable, giữ trần 480 và 200', () => {
    expect(conductorContext()).toBe(conductorContext('fable'))
    expect(conductorContext()).toContain('fable/medium')
    expect(conductorContext('opus')).toContain('opus/medium')
    expect(conductorContext('opus').includes('fable')).toBe(false)
    expect(conductorContext('opus').length).toBeLessThanOrEqual(CONDUCTOR_CHARS)
    expect(conductorKeepText('opus')).toContain('opus/medium')
    expect(conductorKeepText('opus').includes('fable')).toBe(false)
    expect(conductorKeepText('opus').length).toBeLessThanOrEqual(CONDUCTOR_KEEP_CHARS)
  })
})

describe('0.8.7 F1: nạp trạng thái 0.8.6', () => {
  test('không có Core.fallback: giá trị mặc định, không có họ dự phòng đang hoạt động', () => {
    const old = { ...S.EMPTY_CORE } as Record<string, unknown>
    delete old['fallback']
    const core = S.normalizeCore(old as never)
    expect(core.fallback).toEqual({ failures: 0, pauseLeft: 0, promptPaused: false, active: null, briefedFamily: null })
  })
})
