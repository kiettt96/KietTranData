// 0.7.9 điểm R2: phán quyết của mutate.ts không còn tính nhầm KILLED cho lượt không đọc được kết quả hay lượt quá hạn, và
// engine được chọn tường minh rồi kiểm phiên bản. Chỉ kiểm hàm thuần (môi trường test không spawn được tiến trình).

import { describe, expect, test } from 'claude-code/testing'

import { ENGINE_VERSION, engineMatches, engineOf, verdictOf } from '../scripts/verdict'

const base = { failed: 0, loads: true, timedOut: false, equivalent: false }

describe('0.7.9 R2: verdictOf', () => {
  test('có ca lỗi là KILLED', () => {
    expect(verdictOf({ ...base, failed: 3 })).toBe('KILLED')
  })

  test('không ca lỗi: SURVIVED, hoặc EQUIVALENT khi mẫu đã ghi tương đương', () => {
    expect(verdictOf(base)).toBe('SURVIVED')
    expect(verdictOf({ ...base, equivalent: true })).toBe('EQUIVALENT')
  })

  test('mod không nạp được là KILLED dù failed là -1', () => {
    expect(verdictOf({ ...base, failed: -1, loads: false })).toBe('KILLED')
  })

  test('failed -1 mà mod nạp được (không đọc được kết quả) là ERROR, không phải KILLED', () => {
    expect(verdictOf({ ...base, failed: -1 })).toBe('ERROR')
  })

  test('quá hạn là TIMEOUT, trước mọi điều kiện khác', () => {
    expect(verdictOf({ ...base, timedOut: true })).toBe('TIMEOUT')
    expect(verdictOf({ ...base, timedOut: true, failed: -1, loads: false })).toBe('TIMEOUT')
    expect(verdictOf({ ...base, timedOut: true, failed: 2 })).toBe('TIMEOUT')
  })
})

describe('0.7.9 R2: engineMatches', () => {
  test('đúng phiên bản', () => {
    expect(ENGINE_VERSION).toBe('2.1.296')
    expect(engineMatches('2.1.296 (Claude Code)')).toBe(true)
    expect(engineMatches('2.1.296 (Claude Code)\n')).toBe(true)
  })

  test('phiên bản khác hay chuỗi dài hơn thì sai', () => {
    expect(engineMatches('2.1.000 (Claude Code)')).toBe(false)
    expect(engineMatches('2.1.2960')).toBe(false)
    expect(engineMatches('12.1.296')).toBe(false)
    expect(engineMatches('')).toBe(false)
  })
})

describe('0.7.9 R2: engineOf', () => {
  test('cờ --claude thắng biến môi trường', () => {
    expect(engineOf(['--claude', 'x/claude', 'P1'], { FC_CLAUDE: 'y/claude' })).toBe('x/claude')
  })

  test('không cờ thì lấy FC_CLAUDE', () => {
    expect(engineOf(['P1'], { FC_CLAUDE: 'y/claude' })).toBe('y/claude')
  })

  test('không cờ, không biến thì là claude theo PATH', () => {
    expect(engineOf([], {})).toBe('claude')
    expect(engineOf(['--claude'], { FC_CLAUDE: '' })).toBe('claude')
  })
})
