// 0.9.0 vòng 2, U6: /conductor status có một dòng bước đóng ngay sau checklist khi đội hình bật; trợ giúp của /conductor nêu waive review.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, closeAll, editSample, openSample, runCheck, runCommand, sampleGoal, sampleSetup } from '../support/closing-sample'

describe('0.9.0 vòng 2 U6: /conductor status và trợ giúp nêu bước đóng', () => {
  test('mục tiêu mẫu đã sửa file và chạy lệnh của bước: status có "Bước đóng (mod): Kiểm đạt · Duyệt chờ" ngay sau checklist', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    const text = await runCommand($, 'status')
    expect(text).toContain('Bước đóng (mod): Kiểm đạt · Duyệt chờ')
    const lines = text.split('\n')
    const at = lines.findIndex(line => line.startsWith('Bước đóng (mod):'))
    expect(lines[at - 1]).toContain('Việc 3: báo cáo')
  })
  test('sau lệnh miễn: bước chưa đạt ghi "đã miễn"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await runCommand($, 'waive review')
    expect(await runCommand($, 'status')).toContain('Duyệt đã miễn')
  })
  test('mục tiêu light: không có dòng "Bước đóng"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on, sampleGoal({ depth: 'light', volume: 'small' }))
    await openSample($, sample)
    await editSample($)
    expect(await runCommand($, 'status')).not.toContain('Bước đóng')
  })
  test('trợ giúp của /conductor có waive review', SAMPLE_OPTS(), async ($, on) => {
    sampleSetup(on)
    expect(await runCommand($, 'help')).toContain('waive review')
  })
})
