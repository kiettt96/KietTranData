// 0.9.0 vòng 2, U1: mục cần chú ý của bước đóng lấy theo Core.team (trạng thái sống), đủ ba bước, câu theo bước chưa đạt đầu tiên; ô hướng
// của band có nhãn riêng. Band đọc ở 72 cột hai dòng, pane ở 24 dòng. Ký hiệu viết bằng mã \u.

import { describe, expect, test } from 'claude-code/testing'
import { SAMPLE_OPTS, bandNodes, bandText, closeAll, editSample, openSample, paneText, reviewSample, runCheck, sampleGoal, sampleSetup, stopSample } from '../support/closing-sample'

const WARN = '△'
const has = (nodes: readonly string[], text: string) => nodes.some(node => node === text)

describe('0.9.0 vòng 2 U1: mục cần chú ý của bước đóng', () => {
  test('ca a: đóng hết bước, chưa có lượt duyệt, chưa dừng: band nêu chưa duyệt, không "Hoàn thành"; ô hướng "Chưa duyệt"; pane cùng câu', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    const band = await bandText($)
    expect(band).toContain('Chưa duyệt độc lập')
    expect(band).not.toContain('Hoàn thành')
    expect(has(await bandNodes($), `${WARN} Chưa duyệt`)).toBe(true)
    expect(await paneText($, 24)).toContain('Chưa duyệt độc lập')
  })
  test('ca b: chạy lệnh rồi mới sửa, đóng hết bước, cổng chặn vì thiếu kiểm: câu thiếu kiểm, ô hướng "Chưa kiểm"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await runCheck($)
    await editSample($)
    await closeAll($)
    expect(await stopSample($)).toContain('chưa có lần kiểm đạt')
    expect(await bandText($)).toContain('Chưa có lần kiểm đạt sau thay đổi cuối')
    expect(has(await bandNodes($), `${WARN} Chưa kiểm`)).toBe(true)
    expect(await paneText($, 24)).toContain('Chưa có lần kiểm đạt sau thay đổi cuối')
  })
  test('ca c: sau lần chặn thiếu duyệt, sửa lại, chạy lại, lượt duyệt ĐẠT xong, chưa dừng: band và pane không còn mục của bước đóng', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    expect(await stopSample($)).toContain('duyệt độc lập')
    await editSample($)
    await runCheck($)
    await reviewSample($, 'ĐẠT')
    const band = await bandText($)
    const pane = await paneText($, 24)
    for (const text of [band, pane]) {
      expect(text).not.toContain('Chưa duyệt độc lập')
      expect(text).not.toContain('Chưa có lần kiểm đạt')
    }
  })
  test('ca d: lượt duyệt CHƯA ĐẠT: câu "Duyệt độc lập: chưa đạt"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, 'CHƯA ĐẠT')
    expect(await bandText($)).toContain('Duyệt độc lập: chưa đạt')
    expect(has(await bandNodes($), `${WARN} Chưa duyệt`)).toBe(true)
    expect(await paneText($, 24)).toContain('Duyệt độc lập: chưa đạt')
  })
  test('ca e: hard, uiLanguage en, duyệt PASS, cổng chặn vì thiếu sẵn sàng: "No readiness assessment yet", ô hướng "Not ready"', SAMPLE_OPTS({ uiLanguage: 'en' }), async ($, on) => {
    const sample = sampleSetup(on, sampleGoal({ depth: 'hard' }))
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewSample($, 'PASS')
    expect(await stopSample($)).not.toBe('')
    expect(await bandText($)).toContain('No readiness assessment yet')
    expect(has(await bandNodes($), `${WARN} Not ready`)).toBe(true)
    expect(await paneText($, 24)).toContain('No readiness assessment yet')
  })
  test('checklist còn bước mở: không có mục của bước đóng dù bước Duyệt đang chờ', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($, 1)
    for (const text of [await bandText($), await paneText($, 24)]) {
      expect(text).not.toContain('Chưa duyệt độc lập')
      expect(text).not.toContain('Chưa có lần kiểm đạt')
    }
  })
  test('phiên chưa mời agent nào, sau một lần dừng: câu "Chưa duyệt độc lập (phiên không có subagent)"', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample, undefined, false)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await stopSample($)
    expect(await bandText($)).toContain('Chưa duyệt độc lập (phiên không có subagent)')
    expect(await paneText($, 24)).toContain('Chưa duyệt độc lập (phiên không có subagent)')
  })
  test('mục tiêu không bật đội hình (light): band, pane không có mục của bước đóng', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on, sampleGoal({ depth: 'light', volume: 'small' }))
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    for (const text of [await bandText($), await paneText($, 24)]) {
      expect(text).not.toContain('Chưa duyệt')
      expect(text).not.toContain('Bước đóng (mod)')
    }
  })
})
