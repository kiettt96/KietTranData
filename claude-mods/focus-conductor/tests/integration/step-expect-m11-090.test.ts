// 0.9.0 vòng 2 M11: bước có check dạng `lệnh` => kết quả: dù lệnh là lệnh kiểm mod nhận ra, chỉ nâng verified khi output của lần chạy có
// kết quả mong đợi theo luật so của lệnh riêng của bước (B10). Bước không có vế `=>` giữ luật hiện có.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, sampleSetup } from '../support/closing-sample'

const CMD = 'python3 -m pytest tests/'
function track(on: On): { status: () => string } {
  let last = ''
  on('state.set', (_$, e, next) => {
    const ev = e as { key?: string; value?: { plan?: Array<{ status?: string }> } }
    if (ev.key === 'core' && Array.isArray(ev.value?.plan) && ev.value.plan[0] !== undefined) last = String(ev.value.plan[0].status ?? '')
    return next(e)
  })
  return { status: () => last }
}

describe('0.9.0 vòng 2 M11: so kết quả mong đợi của bước', () => {
  for (const [output, expected] of [['3 passed in 0.2s', 'done'], ['4 passed in 0.2s', 'verified']] as const) {
    test(`check \`${CMD}\` => 4 passed, output "${output}": bước ${expected}`, SAMPLE_OPTS(), async ($, on) => {
      const plan = track(on)
      const sample = sampleSetup(on)
      sample.outputs[CMD] = { text: output }
      await openSample($, sample, [{ title: 'Việc 1: chạy test', check: `\`${CMD}\` => 4 passed` }])
      await editSample($)
      await closeAll($, 1)
      await callTool($, { tool: 'Bash', command: CMD })
      expect(plan.status()).toBe(expected)
    })
  }
  test('bước không có vế =>: lệnh kiểm mod nhận ra chạy đạt thì nâng như trước', SAMPLE_OPTS(), async ($, on) => {
    const plan = track(on)
    const sample = sampleSetup(on)
    sample.outputs[CMD] = { text: '3 passed in 0.2s' }
    await openSample($, sample, [{ title: 'Việc 1: chạy test', check: `\`${CMD}\`` }])
    await editSample($)
    await closeAll($, 1)
    await callTool($, { tool: 'Bash', command: CMD })
    expect(plan.status()).toBe('verified')
  })
})
