// 0.9.0 vòng 2 M6: trạng thái cổng đóng (kết luận của các lượt có vai, lần chạy và mốc check của bước, ghi chú ống lệnh, số lần chặn và khóa
// trạng thái, số vòng chưa đạt) nằm trong $.state nên còn nguyên sau khi mod nạp lại. Mỗi ca test là một lần nạp mod mới; ca nạp lại cấp
// trạng thái dựng sẵn (tests/support/m6-state.ts) qua state.get sau một vòng JSON, như engine giữ $.state qua lần nạp lại.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, closeAll, editSample, offerAgent, openSample, paneText, reviewSample, runCheck, sampleGoal, sampleSetup, stopSample } from '../support/closing-sample'
import { step, submit } from '../support/engine'
import { M6_STATE } from '../support/m6-state'

/** Một cặp hook state: cấp sẵn giá trị của lần nạp trước (`values`) cho tới khi mod ghi lại khóa đó, và chép mọi lần ghi vào `into`. */
function stateHooks(on: On, into: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const pending = new Map(Object.entries(values))
  on('state.get', async (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string }
    const read = (await next(e)) as { value?: { value?: unknown; version: number } }
    // Kết quả của hook là { value: { value, version } }; phiên bản thật của kit giữ nguyên để lần ghi có điều kiện của mod khớp.
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string' && pending.has(ev.key)) return { value: { value: pending.get(ev.key), version: read.value?.version ?? 0 } } as never
    return read as never
  })
  on('state.set', (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string; value?: unknown }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string') {
      pending.delete(ev.key)
      into[ev.key] = JSON.parse(JSON.stringify(ev.value ?? null))
    }
    return next(e)
  })
}

describe('0.9.0 vòng 2 M6: trạng thái cổng đóng nằm trong state', () => {
  test('lượt duyệt đạt sau hai lần chặn: state có kết luận và số lần chặn 2', SAMPLE_OPTS(), async ($, on) => {
    const saved: Record<string, unknown> = {}
    stateHooks(on, saved)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await stopSample($)).not.toBe('')
    await reviewSample($, 'CHƯA ĐẠT')
    expect(await stopSample($)).not.toBe('')
    await reviewSample($, 'ĐẠT')
    expect(await stopSample($)).toBe('')
    const closing = saved['closing'] as { closingState?: { blocks?: number }; verdicts?: { items?: Array<{ verdict?: unknown }> } } | undefined
    expect(closing?.closingState?.blocks).toBe(2)
    expect(closing?.verdicts?.items?.some(v => v.verdict === 'pass')).toBe(true)
  })
  test('mod nạp lại với trạng thái dựng sẵn: pane còn Duyệt: đạt, cổng không chặn lại, số lần chặn còn 2', SAMPLE_OPTS(), async ($, on) => {
    const again: Record<string, unknown> = {}
    stateHooks(on, again, JSON.parse(JSON.stringify(M6_STATE)) as Record<string, unknown>)
    // Sau lần nạp lại, người dùng gửi prompt tiếp nối của cùng mục tiêu; phiên giao được subagent như trước lần nạp.
    const sample = sampleSetup(on, sampleGoal({ relation: 'continue' }))
    await offerAgent($)
    await submit($, 'Làm tiếp')
    await $.turn.start({ text: 'Làm tiếp', turnId: 't2' })
    await step($, sample.seen, { turnId: 't2' })
    await callTool($, { tool: 'Read', file_path: '/repo/thong-ke.sh' })
    expect(await stopSample($)).toBe('')
    expect(await paneText($)).toContain('Duyệt: đạt')
    const closing = (again['closing'] ?? M6_STATE['closing']) as { closingState?: { blocks?: number } } | undefined
    expect(closing?.closingState?.blocks).toBe(2)
  })
  test('state của bản cũ không có trường cổng đóng: giá trị mặc định, cổng vẫn đòi duyệt', SAMPLE_OPTS(), async ($, on) => {
    stateHooks(on, {}, { closing: {} })
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await stopSample($)).toContain('duyệt độc lập')
  })
})
