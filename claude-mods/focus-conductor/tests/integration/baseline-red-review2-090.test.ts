// 0.9.0 vòng 3, kiểm độc lập lần hai: (1) lệnh đỏ từ nền chạy lại trong một dòng lệnh không có lệnh kiểm nào khác (qua ống, sau cd, kèm echo,
// hay chung với một lệnh đỏ từ nền khác) vẫn được bỏ qua ở bước Kiểm; (4) đường dẫn đi qua .focus-conductor/ rồi ra ngoài là thay đổi.

import { describe, expect, test } from 'claude-code/testing'
import { BASE_OPTS, TSC, TSC_OUT, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopActive, stopSample } from '../support/baseline-red'
import { callTool, paneText } from '../support/closing-sample'

const NO_PASS = 'chưa có lần kiểm đạt sau thay đổi cuối'
const GATE = 'Còn lệnh kiểm chưa đạt'
const LINT = 'bunx eslint .'

describe('0.9.0 vòng 3 kiểm độc lập lần hai lỗi 1: dòng lệnh chỉ có lệnh đỏ từ nền', () => {
  for (const command of [`${TSC} 2>&1 | tail -3`, `set -o pipefail; ${TSC} 2>&1 | tail -3`, `cd /repo && ${TSC}`, `${TSC}; echo xong`]) {
    test(`${command}: bước Kiểm đạt, Stop không đòi lần kiểm đạt`, BASE_OPTS(), async ($, on) => {
      const sample = baseSetup(on)
      sample.outputs[command] = { text: TSC_OUT(27), isError: true }
      await baseOpen($, sample)
      await runTsc($)
      await editSample($)
      await runKiem($)
      await callTool($, { tool: 'Bash', command })
      await closeAll($)
      await reviewSample($)
      expect(await paneText($, 40, 80)).toContain('Kiểm: đạt')
      expect(await stopSample($)).not.toContain(NO_PASS)
    })
  }

  test('hai lệnh đỏ từ nền chạy chung một dòng lệnh: bước Kiểm đạt, Stop không đòi lần kiểm đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    sample.outputs[LINT] = { text: '3 problems (3 errors, 0 warnings)\n', isError: true }
    sample.outputs[`${TSC}; ${LINT}`] = { text: `${TSC_OUT(27)}3 problems (3 errors, 0 warnings)\n`, isError: true }
    await baseOpen($, sample)
    await runTsc($)
    await callTool($, { tool: 'Bash', command: LINT })
    await editSample($)
    await runKiem($)
    await callTool($, { tool: 'Bash', command: `${TSC}; ${LINT}` })
    await closeAll($)
    await reviewSample($)
    expect(await paneText($, 40, 80)).toContain('Kiểm: đạt')
    expect(await stopSample($)).not.toContain(NO_PASS)
  })
})

describe('0.9.0 vòng 3 kiểm độc lập lần hai lỗi 4: đường dẫn đi qua .focus-conductor/ rồi ra ngoài', () => {
  test('Write /repo/.focus-conductor/../src/a.ts rồi tsc đỏ: lệnh không là đỏ từ nền, cổng lệnh kiểm chưa đạt chặn', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await callTool($, { tool: 'Write', file_path: '/repo/.focus-conductor/../src/a.ts', content: 'x' })
    await runTsc($)
    await closeAll($)
    expect([await stopSample($), await stopActive($)].some(reason => reason.includes(GATE))).toBe(true)
  })
})
