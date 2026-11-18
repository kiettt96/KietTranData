// 0.9.0 vòng 2, U4: miễn duyệt (/conductor waive review) lưu mã mục tiêu trong Core; cổng đóng, pane và mục cần chú ý đọc từ đó.

import { describe, expect, test } from 'claude-code/testing'
import * as S from '../../hooks/lib/state'
import { SAMPLE_OPTS, closeAll, editSample, openSample, paneText, runCheck, runCommand, sampleSetup, stopSample } from '../support/closing-sample'
import { submit } from '../support/engine'


describe('0.9.0 vòng 2 U4: miễn duyệt lưu trong Core', () => {
  test('sửa file, chạy lệnh của bước, đóng hết bước, người gõ miễn duyệt: pane có "– Duyệt: đã miễn", cổng Stop không chặn', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await runCommand($, 'waive review')).toContain('Đã miễn duyệt độc lập')
    const pane = await paneText($)
    expect(pane).toContain('– Duyệt: đã miễn')
    expect(pane).toContain('Kiểm: đạt')
    expect(await stopSample($)).toBe('')
  })
  test('miễn duyệt còn sau khi nạp lại mod (session.start): cổng Stop không chặn, pane vẫn ghi đã miễn', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await runCommand($, 'waive review')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    expect(await stopSample($)).toBe('')
    expect(await paneText($)).toContain('\u2013 Duyệt: đã miễn')
  })
  test('normalizeCore giữ trường miễn qua JSON; trạng thái không có trường đọc là chưa miễn', () => {
    const base = S.normalizeCore({} as never)
    expect(base.closingWaived).toBeUndefined()
    const kept = S.normalizeCore(JSON.parse(JSON.stringify({ ...base, closingWaived: 3 })))
    expect(kept.closingWaived).toBe(3)
    expect(S.normalizeCore(JSON.parse(JSON.stringify({ ...base, closingWaived: 'x' }))).closingWaived).toBeUndefined()
  })
  test('mục tiêu kế tiếp không còn miễn: cổng chặn lại vì thiếu duyệt', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await runCommand($, 'waive review')
    expect(await stopSample($)).toBe('')
    await submit($, 'Việc mới: thêm cờ xuất CSV')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Việc 1: cờ CSV', check: '`bash tests/kiem.sh`' }] } as never)
    await editSample($)
    await runCheck($)
    await closeAll($, 1)
    expect(await paneText($)).not.toContain('đã miễn')
    expect(await stopSample($)).toContain('duyệt độc lập')
  })
  test('lệnh từ origin không phải người gõ vẫn bị từ chối, không ghi trường miễn', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await runCommand($, 'waive review', { kind: 'plugin', name: 'khac' })).toContain('Chỉ nhận /conductor waive do người gõ')
    expect(await paneText($)).not.toContain('đã miễn')
    expect(await stopSample($)).toContain('duyệt độc lập')
  })
})
