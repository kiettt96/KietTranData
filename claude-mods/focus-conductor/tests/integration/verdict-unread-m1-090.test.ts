// 0.9.0 vòng 2 M1: lượt có vai mà cổng đóng dùng kết luận (duyệt, sẵn sàng) trả câu không có dòng nào đọc ra kết luận thì bước đó là chờ, không
// phải đạt. Cổng Stop chặn kèm câu đòi người duyệt trả lời lại, mở đầu bằng đúng từ kết luận của vai; lần chặn tính vào trần ba lần.
// Thay luật "lượt có tiền tố thiếu dòng kết luận vẫn được tính" (sau phiên thật D4, mục 1f), theo quyết định của chủ mod 19/11/2026.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, closeAll, editSample, openSample, paneText, reviewSample, runCheck, sampleSetup, stopSample } from '../support/closing-sample'

const UNREAD = 'Looks fine to me overall.'
const ASK = 'mở đầu bằng ĐẠT hay CHƯA ĐẠT'

describe('0.9.0 vòng 2 M1: kết luận không đọc được thì không tính', () => {
  test('lượt duyệt trả câu không có kết luận: cổng chặn kèm câu đòi trả lời lại, pane ghi Duyệt: chờ', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, UNREAD)
    const block = await stopSample($)
    expect(block).toContain(ASK)
    expect(block).toContain('trả lời lại')
    const pane = await paneText($)
    expect(pane).toContain('Duyệt: chờ')
    expect(pane).toContain('Lượt duyệt chưa có kết luận đọc được')
  })
  test('lượt kế trả ĐẠT: cổng cho qua', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, UNREAD)
    await stopSample($)
    await reviewSample($, 'ĐẠT')
    expect(await stopSample($)).toBe('')
  })
  test('tổng số lần chặn đã chạm trần ba: lần dừng kế cho qua dù lượt duyệt vẫn chưa đọc được', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await stopSample($)).not.toBe('')
    await reviewSample($, UNREAD)
    expect(await stopSample($)).toContain(ASK)
    await reviewSample($, 'Nothing stands out.')
    expect(await stopSample($)).toContain(ASK)
    await reviewSample($, 'Seems reasonable.')
    expect(await stopSample($)).toBe('')
  })
})
