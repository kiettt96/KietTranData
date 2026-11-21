// 0.9.0 vòng 3 N6: lệnh đỏ từ nền mất cờ, trở về luật thường của cổng lệnh kiểm chưa đạt, trong ba trường hợp: chạy đạt một lần rồi đỏ lại;
// số đếm lỗi đọc được ở lần sau lớn hơn số đếm ở lần nền; option baselineChecks đặt off. Lần nền và lần sau đều không đọc được số đếm thì
// giữ cờ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopActive, stopSample } from '../support/baseline-red'
import { sampleGoal } from '../support/closing-sample'

const GATE = 'Còn lệnh kiểm chưa đạt'
const notice = (out: { context?: string[] }) => (out.context ?? []).find(line => line.includes(TSC)) ?? ''

describe('0.9.0 vòng 3 N6: đạt rồi đỏ lại', () => {
  test('tsc đỏ từ nền, sửa, tsc đạt, tsc đỏ lại: lượt 1/3 và Stop chặn như 0.9.0', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    sample.count = 0
    await runTsc($)
    sample.count = 27
    expect(notice(await runTsc($))).toContain('lượt 1/3')
    await closeAll($)
    expect(await stopSample($)).toContain(GATE)
  })
})

describe('0.9.0 vòng 3 N6: số đếm lỗi tăng so với nền', () => {
  test('nền Found 27 errors rồi Found 31 errors: thành mục thường lượt 1, dòng báo nêu 27 và 31, Stop chặn', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    sample.count = 31
    const line = notice(await runTsc($))
    expect(line).toContain('lượt 1/3')
    expect(line).toContain('27')
    expect(line).toContain('31')
    await closeAll($)
    expect(await stopSample($)).toContain(GATE)
  })

  test('nền và lần sau đều không đọc được số đếm: giữ cờ, Stop không có câu của cổng lệnh kiểm chưa đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    sample.count = null
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runTsc($)
    await closeAll($)
    for (const reason of [await stopSample($), await stopSample($), await stopActive($)]) expect(reason).not.toContain(GATE)
  })
})

/** Ba lần Stop liền nhau (lần cuối mang stop_hook_active): có lần nào mang câu của cổng không. */
const anyGate = async ($: Engine) => [await stopSample($), await stopSample($), await stopActive($)].some(reason => reason.includes(GATE))

describe('0.9.0 vòng 3 N6: baselineChecks off', () => {
  const OFF = BASE_OPTS({ baselineChecks: 'off' })
  test('A0 off: chặn như 0.9.0', OFF, async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await runTsc($)
    await closeAll($)
    expect(await stopSample($)).toContain(GATE)
    expect(await stopActive($)).toContain(GATE)
  })

  test('A1 off: chặn như 0.9.0', OFF, async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await runTsc($)
    await closeAll($)
    await reviewSample($)
    expect(await anyGate($)).toBe(true)
  })

  test('A2 off: chặn như 0.9.0', OFF, async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await closeAll($)
    await reviewSample($)
    expect(await anyGate($)).toBe(true)
  })

  test('A5 off: chặn như 0.9.0', OFF, async ($, on) => {
    const sample = baseSetup(on, sampleGoal({ depth: 'light', volume: 'small' }))
    await baseOpen($, sample, [{ title: 'Việc 1: sửa' }])
    await runTsc($)
    await editSample($)
    await closeAll($, 1)
    expect(await anyGate($)).toBe(true)
  })
})
