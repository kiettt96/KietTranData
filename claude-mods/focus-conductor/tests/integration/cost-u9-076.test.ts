// 0.7.6 U9: chi phí hiển thị trên band và pane theo dạng "$1,81" (vi, dấu phẩy thập phân) hay "$1.81" (en), hai chữ số thập phân; dưới
// 0,01 thì "<$0,01". 0.7.6 W2 gom thêm /conductor status và
// sổ chi phí về cùng hàm formatCost (trước đó là shownUsd).

import { describe, expect, test } from 'claude-code/testing'
import * as ledger from '../../hooks/lib/ledger'
import { PANE, base, submit } from '../support/engine'

// Hàm mới gọi qua import * để tệp nạp được cả trên mã trước khi sửa (đỏ ở khẳng định, không đỏ vì thiếu export).
const shownUsd = (value: number, lang: 'vi' | 'en'): string => ((ledger as Record<string, unknown>).formatCost as ((v: number, l: string) => string) | undefined)?.(value, lang) ?? ''
const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

describe('0.7.6 U9: định dạng chi phí hiển thị', () => {
  test('formatCost: hai chữ số thập phân, dấu theo ngôn ngữ, dưới 0,01 là "<$0,01"', () => {
    expect(shownUsd(1.807, 'vi')).toBe('$1,81')
    expect(shownUsd(12.5, 'vi')).toBe('$12,50')
    expect(shownUsd(0.007, 'vi')).toBe('<$0,01')
    expect(shownUsd(0, 'vi')).toBe('$0,00')
    expect(shownUsd(1.807, 'en')).toBe('$1.81')
    expect(shownUsd(0.004, 'en')).toBe('<$0.01')
  })

  test('band: chi phí nhỏ của router hiện "<$0,01", không còn "$0.0070"', async ($, on) => {
    base(on)
    await submit($, 'Sửa lỗi đăng nhập trong module xác thực và thêm test')
    const band = await $.ui.mount(BAND)
    const texts = (await band.findAll({ type: 'Text' })).map(e => e.text ?? '')
    await band.unmount()
    expect(texts.some(t => t.includes('<$0,01'))).toBe(true)
    expect(texts.some(t => /\$0\.\d{3,}/.test(t))).toBe(false)
  })

  test('pane: bảng chi phí dùng cùng định dạng', async ($, on) => {
    base(on)
    await submit($, 'Sửa lỗi đăng nhập trong module xác thực và thêm test')
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '')
    await pane.unmount()
    expect(texts.some(t => t.includes('<$0,01'))).toBe(true)
    expect(texts.some(t => /\$0\.\d{3,}/.test(t))).toBe(false)
  })
})
