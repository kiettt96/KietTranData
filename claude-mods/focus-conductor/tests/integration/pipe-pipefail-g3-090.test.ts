// 0.9.0 vòng 2, G3: lệnh kiểm chạy sau set -o pipefail (hay set -euo pipefail) rồi đi qua | tee <tệp> hay | grep <mẫu> được tính theo mã
// thoát của cả ống: chạy đạt là lần kiểm đạt, chạy lỗi là lần kiểm lỗi. Không có pipefail thì giữ như K19: không tính, có dòng nhắc ống lệnh.
// Lệnh tái hiện lấy từ kiểm độc lập lần 1 của vòng 2 (dòng K19); dạng grep theo đúng dạng của đặc tả G3.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, paneText, reviewSample, sampleSetup, stopSample } from '../support/closing-sample'

const OPTS = SAMPLE_OPTS({ checkCommands: 'bash tests/kiem.sh' })
const STEPS = [{ title: 'Việc 1: sửa' }]
const TEE = 'set -o pipefail; bash tests/kiem.sh | tee /tmp/k.log'
const GREP = 'set -euo pipefail; bash tests/kiem.sh | grep TỔNG'

describe('0.9.0 vòng 2 G3: ống lệnh có pipefail qua tee, grep', () => {
  for (const command of [TEE, GREP]) {
    test(`${command} chạy đạt: tính là lần kiểm đạt, cổng không chặn vì thiếu kiểm`, OPTS, async ($, on) => {
      const sample = sampleSetup(on)
      sample.outputs[command] = { text: 'C1 ĐẠT\nTỔNG: ĐẠT' }
      await openSample($, sample, STEPS)
      await editSample($)
      const out = await callTool($, { tool: 'Bash', command })
      expect((out.context ?? []).some(c => c.includes('đi qua ống'))).toBe(false)
      expect(await paneText($)).toContain('Kiểm: đạt')
      await reviewSample($, 'ĐẠT')
      await closeAll($, 1)
      expect(await stopSample($)).toBe('')
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
  for (const command of ['bash tests/kiem.sh | tee /tmp/k.log', 'bash tests/kiem.sh | grep TỔNG']) {
    test(`${command} không có pipefail: giữ như K19, không tính, có dòng nhắc ống lệnh`, OPTS, async ($, on) => {
      const sample = sampleSetup(on)
      sample.outputs[command] = { text: 'TỔNG: ĐẠT' }
      await openSample($, sample, STEPS)
      await editSample($)
      const out = await callTool($, { tool: 'Bash', command })
      expect((out.context ?? []).some(c => c.includes('đi qua ống'))).toBe(true)
      await reviewSample($, 'ĐẠT')
      await closeAll($, 1)
      expect(await stopSample($)).toContain('chưa có lần kiểm đạt')
    })
  }
})
