// 0.9.0 vòng 2 M15: engine không giữ $.state giữa hai tiến trình (`claude -p` rồi `claude -p --continue`, đo bằng một cặp phiên thật).
// Mod ghi trạng thái mục tiêu vào `.focus-conductor/state.json` của dự án ở mỗi lần đổi, và nạp lại ở session.start khi mã phiên trùng (phiên
// chạy tiếp giữ mã transcript), tệp không cũ hơn 24 giờ và đúng định dạng, và state chưa có mục tiêu. Phiên mới hoàn toàn không nạp.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, closeAll, editSample, openSample, paneText, reviewSample, runCheck, sampleSetup } from '../support/closing-sample'
import { M6_STATE } from '../support/m6-state'

const FILE = '/repo/.focus-conductor/state.json'
const saved = (sessionId: string, savedAt: number) => JSON.stringify({ v: 1, sessionId, savedAt, core: M6_STATE['core'], closing: M6_STATE['closing'] })
function engineFs(on: On, sessionId: string, file: string | null) {
  const writes: string[] = []
  on('session.id', () => ({ value: sessionId }) as never)
  on('fs.read', (_$, e, next) => {
    const ev = e as { path?: string }
    if (ev.path === FILE) return file === null ? next(e) : ({ value: file } as never)
    return next(e)
  })
  on('fs.write', (_$, e, next) => {
    const ev = e as { path?: string; text?: string }
    if (ev.path === FILE) writes.push(String(ev.text ?? ''))
    return next(e)
  })
  return writes
}
describe('0.9.0 vòng 2 M15: trạng thái sống qua --continue', () => {
  test('phiên chạy tiếp (cùng mã phiên, tệp mới): mục tiêu, checklist và bước đóng còn nguyên', SAMPLE_OPTS(), async ($, on) => {
    engineFs(on, 's-1', saved('s-1', 1000))
    sampleSetup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
    const pane = await paneText($)
    expect(pane).toContain('Sửa thống kê')
    expect(pane).toContain('Việc 1: tách hàm')
    expect(pane).toContain('Duyệt: đạt')
  })
  test('phiên mới hoàn toàn (mã phiên khác): không nạp trạng thái cũ', SAMPLE_OPTS(), async ($, on) => {
    engineFs(on, 's-2', saved('s-1', 1000))
    sampleSetup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
    expect(await paneText($)).toContain('Chưa có mục tiêu')
  })
  test('tệp cũ hơn 24 giờ hay sai định dạng: không nạp', SAMPLE_OPTS(), async ($, on) => {
    engineFs(on, 's-1', saved('s-1', 1000 - 25 * 3600 * 1000))
    sampleSetup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
    expect(await paneText($)).toContain('Chưa có mục tiêu')
  })
  test('mục tiêu đổi trạng thái: tệp trạng thái được ghi kèm mã phiên và Core', SAMPLE_OPTS(), async ($, on) => {
    const writes = engineFs(on, 's-3', null)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, 'ĐẠT')
    await $.classic.Stop({ stop_hook_active: false } as never)
    const last = JSON.parse(writes.at(-1) ?? '{}') as { sessionId?: string; core?: { brief?: { goal?: string } } }
    expect(last.sessionId).toBe('s-3')
    expect(last.core?.brief?.goal).toBe('Sửa thống kê')
  })
})
