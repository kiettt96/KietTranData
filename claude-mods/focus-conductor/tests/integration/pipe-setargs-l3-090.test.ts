// 0.9.0 vòng 2 L3: pipefail chỉ được nhận khi là tùy chọn của chính lệnh set; `set -- -o pipefail` chỉ đặt tham số vị trí nên lệnh kiểm
// đi qua ống sau đó giữ như dòng K19: không tính, có dòng nhắc ống lệnh. Lệnh tái hiện lấy từ kiểm độc lập trên 3259cd6.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, reviewSample, sampleSetup, stopSample } from '../support/closing-sample'

const OPTS = SAMPLE_OPTS({ checkCommands: 'bash tests/kiem.sh' })
const STEPS = [{ title: 'Việc 1: sửa' }]
const COMMAND = 'set -- -o pipefail; bash tests/kiem.sh | tee /tmp/k.log'

describe('0.9.0 vòng 2 L3: set -- không bật pipefail', () => {
  test(`${COMMAND}: giữ như K19, không tính, có dòng nhắc ống lệnh`, OPTS, async ($, on) => {
    const sample = sampleSetup(on)
    sample.outputs[COMMAND] = { text: 'TỔNG: ĐẠT' }
    await openSample($, sample, STEPS)
    await editSample($)
    const out = await callTool($, { tool: 'Bash', command: COMMAND })
    expect((out.context ?? []).some(c => c.includes('đi qua ống'))).toBe(true)
    await reviewSample($, 'ĐẠT')
    await closeAll($, 1)
    expect(await stopSample($)).toContain('chưa có lần kiểm đạt')
  })
})
