// 0.9.0 vòng 3 N4: mục tiêu đã có thay đổi mà còn lệnh đỏ từ nền thì lần Stop đầu bị chặn đúng một lần, lý do đòi mục "Lệnh kiểm đỏ từ nền"
// trong câu trả lời cuối; lần Stop kế không chặn vì lý do này. Mục tiêu chưa có thay đổi (A0) thì không bị đòi.

import { describe, expect, test } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopSample } from '../support/baseline-red'

const LABEL = 'Lệnh kiểm đỏ từ nền'

describe('0.9.0 vòng 3 N4: đòi nêu lệnh đỏ từ nền trong câu trả lời cuối', () => {
  test('A1 có lượt duyệt ĐẠT: Stop lần một có nhãn mới và tên lệnh, Stop lần hai trả rỗng', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await runTsc($)
    await closeAll($)
    await reviewSample($)
    const first = await stopSample($)
    expect(first).toContain(LABEL)
    expect(first).toContain(TSC)
    expect(await stopSample($)).toBe('')
  })

  test('A0 chưa có thay đổi: không bị đòi mục lệnh đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await runTsc($)
    await closeAll($)
    expect(await stopSample($)).not.toContain(LABEL)
  })
})
