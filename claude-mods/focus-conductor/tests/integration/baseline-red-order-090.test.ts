// 0.9.0 vòng 3 B1: lệnh Bash mod ghi là lần chạy kiểm (lệnh ở check của một bước, hay lần chạy kiểm mod nhận ra, kể cả lệnh khai trong
// checkCommands), có lần ghi cùng lệnh đó ở mức không definite và không có đường dẫn đích, không là thay đổi khi xét lệnh đỏ từ nền và khi
// xét mục tiêu đã có thay đổi của lần đòi nêu. Lần ghi của lệnh không là lần chạy kiểm, lần ghi definite có đích, vẫn là thay đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, runKiem, runTsc, stopSample } from '../support/baseline-red'
import { callTool } from '../support/closing-sample'

const BASE_LINE = 'đỏ từ trước khi có thay đổi'
const FAIL_LINE = 'Lệnh kiểm chưa đạt'
const LABEL = 'Lệnh kiểm đỏ từ nền'
const SCRIPT = './scripts/check.sh'
const notice = async ($: Engine) => ((await runTsc($)).context ?? []).find(line => line.includes(TSC)) ?? ''

describe('0.9.0 vòng 3 B1: lệnh kiểm chạy trước không làm mất nền', () => {
  test('ca 1: bash tests/kiem.sh (lệnh ở check của bước) rồi tsc: tsc đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runKiem($)
    const line = await notice($)
    expect(line).toContain(BASE_LINE)
    expect(line).not.toContain(FAIL_LINE)
  })

  test('ca 2: script khai trong checkCommands rồi tsc: tsc đỏ từ nền', BASE_OPTS({ checkCommands: SCRIPT }), async ($, on) => {
    const sample = baseSetup(on)
    sample.outputs[SCRIPT] = { text: 'OK 3/3' }
    await baseOpen($, sample)
    await callTool($, { tool: 'Bash', command: SCRIPT })
    expect(await notice($)).toContain(BASE_LINE)
  })

  test('ca 3: sau ca 1, Stop khi chưa sửa gì: không đòi mục Lệnh kiểm đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample, undefined, false)
    await runKiem($)
    await runTsc($)
    await closeAll($)
    expect(await stopSample($)).not.toContain(LABEL)
  })

  test('ca 4: python3 gen.py (không là lệnh kiểm) rồi tsc: tsc là mục thường', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await callTool($, { tool: 'Bash', command: 'python3 gen.py' })
    expect(await notice($)).toContain(FAIL_LINE)
  })

  test('ca 5: sed -i rồi bash tests/kiem.sh trong một lệnh, rồi tsc: tsc là mục thường', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await callTool($, { tool: 'Bash', command: 'sed -i s/a/b/ thong-ke.sh && bash tests/kiem.sh' })
    expect(await notice($)).toContain(FAIL_LINE)
  })

  test('ca 6: bash tests/kiem.sh > ket-qua.txt trong thư mục dự án, rồi tsc: tsc là mục thường', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await callTool($, { tool: 'Bash', command: 'bash tests/kiem.sh > ket-qua.txt' })
    expect(await notice($)).toContain(FAIL_LINE)
  })
})
