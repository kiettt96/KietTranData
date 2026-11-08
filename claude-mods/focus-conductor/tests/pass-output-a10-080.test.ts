// 0.8.0 A10: output đạt của lệnh kiểm riêng. "0 dòng đỏ", "0 phép đỏ", "đỏ: 0", "0 red" là số lỗi bằng 0 (không phải dữ liệu rỗng); cùng
// dạng với số khác 0 là dấu hiệu lỗi. Dòng tổng kết "<nhãn>: ĐẠT | 13 phép, 0 phép đỏ" là dòng đạt khi có mục đếm lớn hơn 0 và mọi mục đếm lỗi
// bằng 0. Option passLines (tiền tố nguyên văn, chỉ cho lệnh khai) nhận thêm dòng cuối bắt đầu bằng tiền tố đó, vẫn qua mọi dấu hiệu lỗi.

import { describe, expect, test } from 'claude-code/testing'
import * as drift from '../hooks/lib/drift'
import { customPassed, lacksSummary, ranNothing } from '../hooks/lib/drift/output'
import { verifiedAfter } from './support/commands'

const RUN = '/usr/bin/python3 -B /repo/tools/check_a.py'
type Apply = (prefixes: string[]) => void
type Parse = (raw: unknown) => string[]
const api = drift as unknown as Record<string, unknown>

function declared(body: () => void, passLines = ''): void {
  drift.applyCheckCommands(drift.parseCheckCommands(RUN))
  const apply = api['applyPassLines'] as Apply | undefined
  const parse = api['parsePassLines'] as Parse | undefined
  if (passLines !== '') {
    if (apply === undefined || parse === undefined) throw new Error('chưa có option passLines')
    apply(parse(passLines))
  }
  try {
    body()
  } finally {
    drift.applyCheckCommands([])
    apply?.([])
  }
}
const visible = (output: string) => verifiedAfter(RUN, { output })
const piped = (output: string) => verifiedAfter(`${RUN} 2>&1 | tail -5`, { output })

const PASS = ['K1: ĐẠT (0 dòng đỏ)', 'K2: ĐẠT (0 dòng đỏ)', 'K3: ĐẠT (0 dòng đỏ)', 'TỔNG: ĐẠT | 13 phép, 0 phép đỏ'].join('\n')

describe('0.8.0 A10: output đạt dạng "(0 dòng đỏ)" và "TỔNG: ĐẠT | N phép, 0 phép đỏ"', () => {
  test('mã thoát 0, đường visible: đạt', () => declared(() => expect(visible(PASS)).toBe(true)))
  test('qua | tail -5, không pipefail: đạt', () => declared(() => expect(piped(PASS)).toBe(true)))
  test('"0 dòng đỏ" không phải dữ liệu rỗng', () => expect(ranNothing('K1: ĐẠT (0 dòng đỏ)')).toBe(false))
  test('"0 phép đỏ", "0 mục đỏ", "đỏ: 0", "0 red" không phải dữ liệu rỗng hay dấu hiệu lỗi', () => {
    for (const line of ['Kiểm xong 13 phép, 0 phép đỏ\nOK', 'Rà 4 mục, 0 mục đỏ\nOK', 'Số dòng 12, đỏ: 0\nOK', '12 checks, 0 red\nOK']) {
      expect(ranNothing(line), line).toBe(false)
      expect(customPassed(line), line).toBe(true)
    }
  })
  test('"TỔNG: ĐẠT | 13 phép, 2 phép đỏ": không đạt, có dấu hiệu lỗi', () => {
    const output = PASS.replace('0 phép đỏ', '2 phép đỏ')
    expect(customPassed(output)).toBe(false)
    expect(lacksSummary(output)).toBe(false)
    declared(() => expect(piped(output)).toBe(false))
  })
  test('"K1: CHƯA ĐẠT (3 dòng đỏ)": không đạt, có dấu hiệu lỗi', () => {
    expect(customPassed('K1: CHƯA ĐẠT (3 dòng đỏ)')).toBe(false)
    expect(lacksSummary('K1: CHƯA ĐẠT (3 dòng đỏ)')).toBe(false)
  })
  test('"đỏ: 2" và "3 red" là dấu hiệu lỗi; chữ "đỏ" đứng riêng không tính là gì', () => {
    expect(lacksSummary('Số dòng 12, đỏ: 2\nOK')).toBe(false)
    expect(lacksSummary('12 checks, 3 red\nOK')).toBe(false)
    expect(customPassed('Tô màu đỏ cho cột giá mới\nOK')).toBe(true)
  })
  test('dòng tổng kết có mục đếm nhưng không mục nào lớn hơn 0: không phải dòng đạt', () => {
    expect(customPassed('TỔNG: ĐẠT | 0 phép, 0 phép đỏ')).toBe(false)
  })
  test('các dạng PASS, OK và dấu phân tách khác', () => {
    for (const last of ['Tổng: PASS, 13 checks, 0 failed', 'Kết quả: OK - 4 mục, 0 lỗi', 'TỔNG: ĐẠT (13 phép, 0 phép đỏ)']) {
      expect(customPassed(`Đã chạy\n${last}`), last).toBe(true)
    }
  })
})

describe('0.8.0 A10: ca giữ nguyên của ranNothing', () => {
  test('"0 dòng" đứng riêng, "Rỗng:", "0 passed", "Ran 0 tests" vẫn là không kiểm gì', () => {
    for (const output of ['Đã đọc 0 dòng', 'Rỗng: bảng giá', '0 passed', 'Ran 0 tests']) expect(ranNothing(output), output).toBe(true)
  })
})

describe('0.8.0 A10: option passLines', () => {
  const OUT = 'Đã chạy 3 phần\nTỔNG: ĐẠT toàn bộ'
  test('chưa khai passLines: "TỔNG: ĐẠT toàn bộ" qua tail không đạt như cũ', () => declared(() => expect(piped(OUT)).toBe(false)))
  test('passLines là "TỔNG: ĐẠT": output kết bằng "TỔNG: ĐẠT toàn bộ" qua tail đạt', () => {
    declared(() => expect(piped(OUT)).toBe(true), 'TỔNG: ĐẠT')
  })
  test('không phân biệt hoa thường', () => declared(() => expect(piped('Đã chạy\ntổng: đạt toàn bộ')).toBe(true), 'TỔNG: ĐẠT'))
  test('có thêm dòng Traceback thì không đạt', () => {
    declared(() => expect(piped(`Traceback (most recent call last)\n${OUT}`)).toBe(false), 'TỔNG: ĐẠT')
  })
  test('output không kiểm gì vẫn không đạt', () => declared(() => expect(piped('Ran 0 tests\nTỔNG: ĐẠT toàn bộ')).toBe(false), 'TỔNG: ĐẠT'))
  test('lệnh không khai: passLines không áp', () => {
    declared(() => expect(verifiedAfter(`pytest 2>&1 | tail -5`, { output: OUT })).toBe(false), 'TỔNG: ĐẠT')
  })
})
