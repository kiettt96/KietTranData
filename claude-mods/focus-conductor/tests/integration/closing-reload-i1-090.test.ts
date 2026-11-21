// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 1: trạng thái cổng đóng khôi phục từ $.state (M6) hay từ tệp trạng thái (M15) mang mốc seq của lần
// nạp trước, còn sổ bằng chứng của lần nạp mới đếm lại từ 0. Lần sửa sau khi nạp lại phải mới hơn mọi kết luận và lần chạy kiểm cũ: cổng
// đòi duyệt lại, bước kiểm không được tính bằng lần chạy trước lần sửa.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, editSample, offerAgent, paneText, sampleGoal, sampleSetup, stopSample } from '../support/closing-sample'
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

async function reloaded($: Parameters<NonNullable<Parameters<typeof test>[2]>>[0], on: On) {
  stateHooks(on, {}, JSON.parse(JSON.stringify(M6_STATE)) as Record<string, unknown>)
  const sample = sampleSetup(on, sampleGoal({ relation: 'continue' }))
  await offerAgent($)
  await submit($, 'Làm tiếp')
  await $.turn.start({ text: 'Làm tiếp', turnId: 't2' })
  await step($, sample.seen, { turnId: 't2' })
  return sample
}

describe('0.9.0 vòng 2 I1: mốc seq sau khi nạp lại', () => {
  test('đối chứng: nạp lại, không sửa gì: cổng không chặn, pane Duyệt: đạt', SAMPLE_OPTS(), async ($, on) => {
    await reloaded($, on)
    await callTool($, { tool: 'Read', file_path: '/repo/thong-ke.sh' })
    expect(await stopSample($)).toBe('')
    expect(await paneText($)).toContain('Duyệt: đạt')
  })

  test('nạp lại rồi sửa file: kết luận đạt cũ hết hiệu lực, cổng chặn', SAMPLE_OPTS(), async ($, on) => {
    await reloaded($, on)
    await editSample($)
    expect(await stopSample($)).not.toBe('')
    expect(await paneText($)).not.toContain('Duyệt: đạt')
  })
})
