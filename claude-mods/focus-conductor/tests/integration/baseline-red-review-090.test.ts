// 0.9.0 vòng 3, kiểm độc lập: (1) lệnh đỏ từ nền chạy chung một lệnh Bash với lệnh kiểm của bước, lệnh kiểm đó lỗi: bước Kiểm vẫn chưa đạt
// và cổng đóng vẫn chặn, như khi lệnh kiểm lỗi chạy riêng; lỗi còn lại của lệnh đỏ từ nền không bị thay bằng lỗi của lệnh kia. (4) Ghi vào
// .focus-conductor/ không tính là thay đổi khi xét lệnh đỏ từ nền.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, TSC_OUT, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopActive, stopSample } from '../support/baseline-red'
import { CHECK, callTool, paneText, runCommand } from '../support/closing-sample'
import type { Sample } from '../support/closing-sample'

const NO_PASS = 'chưa có lần kiểm đạt sau thay đổi cuối'
const GATE = 'Còn lệnh kiểm chưa đạt'
const KIEM_FAIL = 'KIEM: 2/5 FAIL'

async function together($: Engine, sample: Sample, command: string) {
  // Output theo thứ tự hai lệnh trong dòng lệnh.
  sample.outputs[command] = { text: command.startsWith(CHECK) ? `${KIEM_FAIL}\n${TSC_OUT(27)}` : `${TSC_OUT(27)}${KIEM_FAIL}\n`, isError: true }
  await baseOpen($, sample)
  await runTsc($)
  await editSample($)
  await runKiem($)
  await callTool($, { tool: 'Bash', command })
  await closeAll($)
  await reviewSample($)
}

describe('0.9.0 vòng 3 kiểm độc lập lỗi 1: lệnh đỏ từ nền chạy chung với lệnh kiểm của bước', () => {
  for (const command of [`${TSC}; ${CHECK}`, `${CHECK}; ${TSC}`]) {
    test(`${command}, kiem lỗi: pane không ghi Kiểm đạt, Stop đòi lần kiểm đạt`, BASE_OPTS(), async ($, on) => {
      const sample = baseSetup(on)
      await together($, sample, command)
      expect(await paneText($, 40, 80)).not.toContain('Kiểm: đạt')
      expect(await stopSample($)).toContain(NO_PASS)
    })
  }

  test('lỗi còn lại của lệnh đỏ từ nền trong /conductor status không là lỗi của lệnh chạy chung', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await together($, sample, `${CHECK}; ${TSC}`)
    const status = await runCommand($, 'status')
    const part = status.slice(status.indexOf('Lệnh kiểm đỏ từ nền'))
    expect(part).not.toContain(KIEM_FAIL)
  })
})

describe('0.9.0 vòng 3 kiểm độc lập lỗi 4: ghi vào .focus-conductor/ không là thay đổi', () => {
  test('Write .focus-conductor/note.md rồi tsc đỏ: lệnh vẫn đỏ từ nền, cổng lệnh kiểm chưa đạt không chặn', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await callTool($, { tool: 'Write', file_path: '/repo/.focus-conductor/note.md', content: 'ghi chú' })
    await runTsc($)
    await closeAll($)
    for (const reason of [await stopSample($), await stopActive($)]) expect(reason).not.toContain(GATE)
  })
})
