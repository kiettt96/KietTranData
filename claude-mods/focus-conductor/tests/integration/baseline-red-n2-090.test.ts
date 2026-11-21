// 0.9.0 vòng 3 N2: lệnh đỏ từ nền chạy lại vẫn đỏ bốn lần (kịch bản A4: lần đầu trước mọi thay đổi, rồi một lần sửa, mỗi lần chạy kèm một
// lần Stop): lượt không tăng, không có lời dặn giao "Sửa lỗi kiểm: ", không bước nào bị mod ghi blocked. Dòng báo ở lần chạy đầu nêu lệnh
// đỏ từ trước khi có thay đổi, không sửa nếu ngoài việc được giao, nêu trong câu trả lời cuối, và không dài hơn dòng báo của lệnh kiểm chưa đạt.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BASE_OPTS, TSC, baseOpen, baseSetup, editSample, runTsc, stopSample } from '../support/baseline-red'
import { retryFailNotice } from '../../hooks/lib/text'

type Core = { retry?: { items: Array<{ command: string; round: number }> }; plan?: Array<{ status: string }> }

function capture(on: On, into: { core?: Core }) {
  on('state.set', (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string; value?: unknown }
    if (ev.plugin === 'focus-conductor' && ev.key === 'core') into.core = JSON.parse(JSON.stringify(ev.value ?? null)) as Core
    return next(e)
  })
}

describe('0.9.0 vòng 3 N2: lệnh đỏ từ nền không tính lượt', () => {
  test('bốn lần chạy lại vẫn đỏ: lượt giữ 1, không dặn giao Sửa lỗi kiểm, không bước blocked; dòng báo đầu đúng nội dung và độ dài', BASE_OPTS(), async ($, on) => {
    const into: { core?: Core } = {}
    capture(on, into)
    const sample = baseSetup(on)
    await baseOpen($, sample)
    const texts: string[] = []
    const first = await runTsc($)
    const notice = (first.context ?? []).find(line => line.includes(TSC)) ?? ''
    await editSample($)
    texts.push(...(first.context ?? []), await stopSample($))
    for (let k = 0; k < 3; k++) {
      const again = await runTsc($)
      texts.push(...(again.context ?? []), await stopSample($))
    }
    const item = (into.core?.retry?.items ?? []).find(i => i.command === TSC)
    expect(item?.round).toBe(1)
    expect(texts.join('\n')).not.toContain('Sửa lỗi kiểm: ')
    expect((into.core?.plan ?? []).some(s => s.status === 'blocked')).toBe(false)
    expect(notice).toContain('đỏ từ trước khi có thay đổi')
    expect(notice).toContain('ngoài việc được giao')
    expect(notice).toContain('câu trả lời cuối')
    expect(notice.length).toBeLessThanOrEqual(retryFailNotice({ command: TSC, more: [], round: 1 }).length)
  })
})
