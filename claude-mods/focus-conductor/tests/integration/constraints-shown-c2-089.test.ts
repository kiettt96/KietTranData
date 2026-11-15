// 0.8.9 C2 (tích hợp): mục ràng buộc của pane nêu tối đa 22 mục. Với 22 ràng buộc, cây chữ trùng 7682ef7 (vi và en, 80 và 44 cột).
// Với 60 ràng buộc (10 mục của prompt lập mục tiêu): đúng 22 mục (10 mục đầu, 12 mục mới nhất) và một dòng mờ nêu 38 mục còn lại.

import { describe, expect, test } from 'claude-code/testing'
import { PANE_en_44, PANE_en_80, PANE_vi_44, PANE_vi_80 } from '../fixtures/constraints-c2-089'
import { constraintAt, constraintSession, paneConstraints, submitConstraints } from '../support/constraints-shown'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => constraintAt(from + i))
const FIXTURE = { vi: { 80: PANE_vi_80, 44: PANE_vi_44 }, en: { 80: PANE_en_80, 44: PANE_en_44 } } as const
const MORE = { vi: '(và 38 ràng buộc khác)', en: '(and 38 more constraints)' } as const

describe('0.8.9 C2: mục ràng buộc của pane', () => {
  for (const lang of ['vi', 'en'] as const) {
    test(`${lang}, 22 ràng buộc: cây chữ trùng 7682ef7 ở 80 và 44 cột`, { options: { planApproval: 'off', neon: 'off', uiLanguage: lang } }, async ($, on) => {
      constraintSession(on, 22)
      await submitConstraints($, 22)
      expect(await paneConstraints($, 80)).toEqual([...FIXTURE[lang][80]])
      expect(await paneConstraints($, 44)).toEqual([...FIXTURE[lang][44]])
    })

    test(`${lang}, 60 ràng buộc: đúng 22 mục, 10 mục đầu và 12 mục mới nhất, một dòng nêu 38 mục còn lại, ở 80 và 44 cột`, { options: { planApproval: 'off', neon: 'off', uiLanguage: lang } }, async ($, on) => {
      constraintSession(on, 60)
      await submitConstraints($, 60)
      for (const columns of [80, 44]) {
        const texts = await paneConstraints($, columns)
        const shown = texts.filter(t => /^Ràng buộc số \d{3}/.test(t))
        expect(shown, String(columns)).toEqual([...range(1, 10), ...range(49, 60)])
        expect(texts.filter(t => t === MORE[lang]).length, String(columns)).toBe(1)
      }
    })
  }
})
