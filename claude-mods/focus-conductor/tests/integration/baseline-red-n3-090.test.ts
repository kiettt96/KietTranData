// 0.9.0 vòng 3 N3: còn duy nhất lệnh kiểm đỏ từ nền chưa đạt thì cổng lệnh kiểm chưa đạt không chặn kết thúc. Kịch bản đo trên 9111be7:
// A0 chưa sửa gì; A1 sửa, các lệnh khác đạt, tsc chạy lại vẫn đỏ, có lượt duyệt ĐẠT; A2 như A1 nhưng tsc không chạy lại; A5 mục tiêu light
// sửa một file. Lần chặn đòi nêu lệnh đỏ từ nền trong câu trả lời cuối (N4) và các cổng khác không thuộc mục này.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopActive, stopSample } from '../support/baseline-red'
import { sampleGoal } from '../support/closing-sample'

const GATE = 'Còn lệnh kiểm chưa đạt'
/** Ba lần Stop liền nhau (lần cuối mang stop_hook_active). */
const stops = async ($: Engine) => [await stopSample($), await stopSample($), await stopActive($)]

describe('0.9.0 vòng 3 N3: cổng Stop không chặn vì lệnh đỏ từ nền', () => {
  test('A0: chưa sửa gì, tsc đỏ từ nền, đóng hết bước, không mời agent (cổng đóng không áp): không chặn lần nào, kể cả khi stop_hook_active', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await runTsc($)
    await closeAll($)
    expect(await stops($)).toEqual(['', '', ''])
  })

  test('A1: sửa, kiem đạt, tsc chạy lại vẫn đỏ, có lượt duyệt ĐẠT: không lần Stop nào có câu của cổng lệnh kiểm chưa đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await runTsc($)
    await closeAll($)
    await reviewSample($)
    for (const reason of await stops($)) expect(reason).not.toContain(GATE)
  })

  test('A2: như A1 nhưng tsc không chạy lại ở cuối: không lần Stop nào có câu của cổng lệnh kiểm chưa đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await closeAll($)
    await reviewSample($)
    for (const reason of await stops($)) expect(reason).not.toContain(GATE)
  })

  test('A5: mục tiêu light sửa một file, tsc đỏ từ nền: không lần Stop nào có câu của cổng lệnh kiểm chưa đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on, sampleGoal({ depth: 'light', volume: 'small' }))
    await baseOpen($, sample, [{ title: 'Việc 1: sửa' }])
    await runTsc($)
    await editSample($)
    await closeAll($, 1)
    for (const reason of await stops($)) expect(reason).not.toContain(GATE)
  })
})
