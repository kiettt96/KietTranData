// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 2 và 12: `/conductor reset` và `/clear` xoá mục tiêu, nhưng tệp `.focus-conductor/state.json` (M15) và
// bản ghi cổng đóng trong $.state (M6) còn nguyên, nên `claude -p --continue` hay lần nạp lại mod đưa mục tiêu và kết luận cũ trở lại.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, runCommand, sampleSetup } from '../support/closing-sample'
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
function stateWrites(on: On, into: Record<string, unknown>) {
  on('state.set', (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string; value?: unknown }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string') into[ev.key] = JSON.parse(JSON.stringify(ev.value ?? null))
    return next(e)
  })
}

describe('0.9.0 vòng 2 I2: đặt lại xoá trạng thái đã lưu', () => {
  test('nạp từ tệp rồi /conductor reset: tệp trạng thái bị xoá nội dung', SAMPLE_OPTS(), async ($, on) => {
    const writes = engineFs(on, 's-1', saved('s-1', 1000))
    sampleSetup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
    await runCommand($, 'reset')
    await $.classic.Stop({ stop_hook_active: false } as never)
    expect(writes.at(-1)).toBe('')
  })

  test('nạp từ tệp rồi /conductor reset: bản ghi cổng đóng trong state về rỗng', SAMPLE_OPTS(), async ($, on) => {
    engineFs(on, 's-1', saved('s-1', 1000))
    const state: Record<string, unknown> = {}
    stateWrites(on, state)
    sampleSetup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
    await runCommand($, 'reset')
    const closing = state['closing'] as { verdicts?: { items?: unknown[] } } | undefined
    expect(closing?.verdicts?.items).toEqual([])
  })
})
