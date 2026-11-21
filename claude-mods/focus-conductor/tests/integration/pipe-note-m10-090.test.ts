// 0.9.0 vòng 2 M10: lệnh kiểm đi qua ống mà mã thoát bị che (không có pipefail), kể cả `2>&1 | tail -1`, không được tính thì có dòng nhắc
// đi qua ống và lý do chặn của cổng nêu ống. Luật S5 giữ nguyên (quyết định của chủ mod 19/11/2026): lệnh qua tail, head, cat có dòng cuối là
// dòng tổng kết chặt vẫn tính, nên output của các ca không pipefail ở đây không có dòng tổng kết. Có pipefail: `tee -a <tệp>`, `grep -c <mẫu>`,
// `grep -E <mẫu>` tính theo mã thoát của cả ống.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, paneText, sampleSetup, stopSample } from '../support/closing-sample'

const OPTS = SAMPLE_OPTS({ checkCommands: 'bash tests/kiem.sh' })
const STEPS = [{ title: 'Việc 1: sửa' }]
const HIDDEN = ['bash tests/kiem.sh 2>&1 | tail -1', 'bash tests/kiem.sh | tee -a /tmp/k.log', 'bash tests/kiem.sh | grep -c ĐẠT']
const PIPEFAIL = ['set -o pipefail; bash tests/kiem.sh | tee -a /tmp/k.log', 'set -o pipefail; bash tests/kiem.sh | grep -c TỔNG', "set -o pipefail; bash tests/kiem.sh | grep -E 'TỔNG|ĐẠT'"]

describe('0.9.0 vòng 2 M10: ống lệnh che mã thoát', () => {
  for (const command of HIDDEN) {
    test(`${command}: không tính, có dòng nhắc đi qua ống, lý do chặn nêu ống`, OPTS, async ($, on) => {
      const sample = sampleSetup(on)
      sample.outputs[command] = { text: 'Đã chạy 5 ca' }
      await openSample($, sample, STEPS)
      await editSample($)
      const out = await callTool($, { tool: 'Bash', command })
      expect((out.context ?? []).some(c => c.includes('đi qua ống'))).toBe(true)
      await closeAll($, 1)
      const block = await stopSample($)
      expect(block).toContain('chưa có lần kiểm đạt')
      expect(block).toContain('đi qua ống')
    })
  }
  for (const command of PIPEFAIL) {
    test(`${command} chạy đạt: tính là lần kiểm đạt`, OPTS, async ($, on) => {
      const sample = sampleSetup(on)
      sample.outputs[command] = { text: 'C1 ĐẠT\nTỔNG: ĐẠT' }
      await openSample($, sample, STEPS)
      await editSample($)
      await callTool($, { tool: 'Bash', command })
      expect(await paneText($)).toContain('Kiểm: đạt')
    })
    test(`${command} chạy lỗi: tính là lần kiểm lỗi`, OPTS, async ($, on) => {
      const sample = sampleSetup(on)
      sample.outputs[command] = { text: 'C1 FAIL\nTỔNG: FAIL 1/5', isError: true }
      await openSample($, sample, STEPS)
      await editSample($)
      await callTool($, { tool: 'Bash', command })
      expect(await paneText($)).toContain('Kiểm: chưa đạt')
    })
  }
})
