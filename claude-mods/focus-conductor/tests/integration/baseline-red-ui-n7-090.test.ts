// 0.9.0 vòng 3 N7: giao diện của lệnh đỏ từ nền. /conductor status có mục "Lệnh kiểm đỏ từ nền" (en "Checks red at baseline") liệt kê lệnh;
// pane có một dòng mức warning `đỏ từ nền: <lệnh>` xếp cùng hạng với dòng "đã miễn"; band và status line không báo lỗi vì lệnh đó. Bề rộng
// pane: dòng mới không vượt bề rộng ở 42 và 80 cột, và số nút chữ vượt bề rộng ở 30, 42, 80 cột không nhiều hơn trước bản sửa (đo trên
// 5eded8c với cùng kịch bản; các mục chi phí, ràng buộc, điều phối vượt từ trước, ngoài phạm vi mục này).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc } from '../support/baseline-red'
import { bandText, lastStatus, paneText, runCommand } from '../support/closing-sample'
import type { Sample } from '../support/closing-sample'

/** Số nút chữ vượt bề rộng trước bản sửa, theo ngôn ngữ rồi số cột. */
const BEFORE: Record<string, Record<number, number>> = { vi: { 30: 16, 42: 6, 80: 2 }, en: { 30: 11, 42: 7, 80: 2 } }
const TEXT = {
  vi: { line: `đỏ từ nền: \`${TSC}\``, title: 'Lệnh kiểm đỏ từ nền', failed: 'Lần kiểm gần nhất chưa đạt' },
  en: { line: `red at baseline: \`${TSC}\``, title: 'Checks red at baseline', failed: 'Latest check did not pass' },
}
const width = (line: string) => [...line].length

async function scene($: Engine, sample: Sample) {
  await baseOpen($, sample)
  await runTsc($)
  await editSample($)
  await runKiem($)
  await closeAll($)
  await reviewSample($)
}

for (const lang of ['vi', 'en'] as const) {
  describe(`0.9.0 vòng 3 N7: giao diện lệnh đỏ từ nền (${lang})`, () => {
    test('pane có dòng đỏ từ nền; status có mục và lệnh; band và status line không báo lần kiểm chưa đạt', BASE_OPTS({ uiLanguage: lang }), async ($, on) => {
      const sample = baseSetup(on)
      await scene($, sample)
      const pane = await paneText($, 40, 80)
      expect(pane).toContain(TEXT[lang].line)
      expect(pane).not.toContain(TEXT[lang].failed)
      const status = await runCommand($, 'status')
      expect(status).toContain(TEXT[lang].title)
      expect(status.slice(status.indexOf(TEXT[lang].title))).toContain(TSC)
      for (const cols of [56, 72, 120]) expect(await bandText($, cols)).not.toContain(TEXT[lang].failed)
      expect(lastStatus(sample)).not.toContain(TEXT[lang].failed)
    })

    for (const cols of [30, 42, 80]) {
      test(`pane ${cols} cột: dòng mới ${cols >= 42 ? 'không vượt bề rộng, ' : ''}số nút chữ vượt không nhiều hơn trước`, BASE_OPTS({ uiLanguage: lang }), async ($, on) => {
        const sample = baseSetup(on)
        await scene($, sample)
        const lines = (await paneText($, 40, cols)).split('\n')
        const line = lines.find(l => l.includes(lang === 'vi' ? 'đỏ từ nền' : 'red at baseline'))
        expect(line).toBeDefined()
        if (cols >= 42) expect(width(line ?? '')).toBeLessThanOrEqual(cols)
        expect(lines.filter(l => width(l) > cols).length).toBeLessThanOrEqual(BEFORE[lang]?.[cols] ?? 0)
      })
    }
  })
}
