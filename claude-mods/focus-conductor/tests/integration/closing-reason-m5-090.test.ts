// 0.9.0 vòng 2 M5: lý do chặn của cổng đóng nêu đúng nguyên nhân. Lượt duyệt gần nhất báo chưa đạt thì nêu điều đó kèm số đếm; có file sửa
// sau lần kiểm đạt gần nhất hay sau lượt duyệt gần nhất thì nêu tối đa ba tên file, kể cả khi bước còn thiếu là bước kiểm.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, closeAll, editSample, openSample, reviewSample, runCheck, sampleSetup, stopSample } from '../support/closing-sample'

describe('0.9.0 vòng 2 M5: lý do chặn nêu đúng nguyên nhân', () => {
  test('lượt duyệt CHƯA ĐẠT 2/5 rồi dừng: lý do có "chưa đạt" và "2/5"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, 'CHƯA ĐẠT 2/5')
    const block = await stopSample($)
    expect(block).toContain('chưa đạt')
    expect(block).toContain('2/5')
  })
  test('kiểm đạt, sửa /repo/thong-ke.sh, dừng: lý do có thong-ke.sh', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await editSample($)
    await closeAll($)
    expect(await stopSample($)).toContain('thong-ke.sh')
  })
})
