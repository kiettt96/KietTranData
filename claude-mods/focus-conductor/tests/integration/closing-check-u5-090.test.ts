// 0.9.0 vòng 2, U5: bước Kiểm của các bước đóng chỉ hiện khi mục tiêu đã có thay đổi không nhẹ cần kiểm.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, closeAll, editSample, openSample, paneText, sampleSetup, stopSample } from '../support/closing-sample'

describe('0.9.0 vòng 2 U5: bước Kiểm chỉ hiện khi đã có thay đổi', () => {
  test('vừa mở mục tiêu mẫu: pane không có "Kiểm:"; sau một lần Edit: "Kiểm: chờ"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    const before = await paneText($)
    expect(before).toContain('Bước đóng (mod)')
    expect(before).not.toContain('Kiểm:')
    await editSample($)
    expect(await paneText($)).toContain('Kiểm: chờ')
  })
  test('lúc kế hoạch còn chờ duyệt, chưa sửa file: pane không có "Kiểm:"', SAMPLE_OPTS({ planApproval: 'auto' }), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    expect(await paneText($)).not.toContain('Kiểm:')
  })
  test('đóng hết bước mà không sửa file nào: lý do chặn (nếu có) không nhắc thiếu kiểm', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await closeAll($)
    expect(await stopSample($)).not.toContain('chưa có lần kiểm đạt')
  })
})
