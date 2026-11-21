// 0.9.0 vòng 2 M18: khi subagent mang tiền tố vai duyệt hay sẵn sàng đang chạy và bước đóng tương ứng chưa đạt, band, pane và ô hướng ghi
// đang duyệt (mức thông tin, không phải cảnh báo); subagent xong thì trở về luật của U1.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, bandNodes, bandText, closeAll, editSample, openSample, paneText, runCheck, sampleSetup } from '../support/closing-sample'

describe('0.9.0 vòng 2 M18: câu đang duyệt', () => {
  test('lượt Kiểm độc lập chưa trả lời: band, pane và ô hướng ghi đang duyệt; trả CHƯA ĐẠT thì band ghi Duyệt độc lập: chưa đạt', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    const description = 'Kiểm độc lập: thống kê'
    await $.tool.call({ tool: 'Agent', tool_use_id: 'm18', description, prompt: 'Rà.' } as never)
    await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: 'm18' } as never)
    expect(await bandText($)).toContain('Đang duyệt độc lập')
    expect(await paneText($)).toContain('Đang duyệt độc lập')
    expect((await bandNodes($)).some(t => t.includes('Đang duyệt'))).toBe(true)
    expect(await bandText($)).not.toContain('Chưa duyệt độc lập')
    await $.turn.complete({ turnId: 'x-m18', agentId: 'a-m18', answer: 'CHƯA ĐẠT', durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
    expect(await bandText($)).toContain('Duyệt độc lập: chưa đạt')
  })
  // Bốn nơi hiển thị không nói trái nhau (vòng 2 M20): status line cũng ghi đang duyệt khi lượt duyệt vừa được sinh.
  test('lượt Kiểm độc lập vừa sinh: status line ghi đang duyệt, không còn chưa duyệt', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    const description = 'Kiểm độc lập: thống kê'
    await $.tool.call({ tool: 'Agent', tool_use_id: 'm18s', description, prompt: 'Rà.' } as never)
    await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: 'm18s' } as never)
    const status = sample.seen.statuses.filter(Boolean).at(-1) ?? ''
    expect(status).toContain('đang duyệt')
    expect(status).not.toContain('chưa duyệt')
  })
})
