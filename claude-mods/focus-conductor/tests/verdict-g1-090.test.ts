// 0.9.0 vòng 2, G1: dòng kết luận mở đầu bằng "not pass", "not passed", "did not pass", "does not pass" đọc là chưa đạt. Trước đó dòng
// này không là dòng kết luận, nên lượt có tiền tố duyệt mà không có dòng kết luận được tính là đạt (luật sau phiên thật D4).

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'
import { SAMPLE_OPTS, closeAll, editSample, openSample, paneText, reviewSample, runCheck, sampleSetup, stopSample } from './support/closing-sample'

describe('0.9.0 vòng 2 G1: phủ định của từ đạt', () => {
  test('bốn cụm phủ định, hoa và thường, có và không có số đếm: chưa đạt', () => {
    for (const phrase of ['not pass', 'not passed', 'did not pass', 'does not pass']) {
      for (const text of [phrase, phrase.toUpperCase(), `${phrase} 3/5`, `${phrase.toUpperCase()} 3/5`, `**Verdict: ${phrase.toUpperCase()}.** Two checks fail.`]) {
        expect(verdictOf(text)?.verdict, text).toBe('fail')
      }
    }
  })
  test('PASS, ĐẠT, NOT READY, CHƯA ĐẠT 2/13 giữ kết luận như trước', () => {
    expect(verdictOf('PASS')?.verdict).toBe('pass')
    expect(verdictOf('ĐẠT')?.verdict).toBe('pass')
    expect(verdictOf('NOT READY')?.verdict).toBe('not-ready')
    expect(verdictOf('CHƯA ĐẠT 2/13')).toEqual({ verdict: 'fail', count: '2/13' })
  })
  test('tích hợp: lượt "Kiểm độc lập: " trả NOT PASS: cổng Stop vẫn đòi duyệt, pane có "Duyệt: chưa đạt"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, 'NOT PASS')
    expect(await paneText($)).toContain('Duyệt: chưa đạt')
    expect(await stopSample($)).toContain('duyệt')
  })
})
