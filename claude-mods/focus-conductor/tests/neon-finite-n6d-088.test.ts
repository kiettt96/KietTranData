// 0.8.8 N6d: colorAt và gradientRuns coi frame hay vị trí không hữu hạn là 0, không văng lỗi; số âm vẫn quay vòng trong chu kỳ.

import { describe, expect, test } from 'claude-code/testing'
import { DARK_GRADIENTS, colorAt, gradientRuns } from '../hooks/ui/neon'

const STOPS = DARK_GRADIENTS.cyber
const HEX = /^#[0-9a-f]{6}$/

describe('0.8.8 N6d: giá trị không hữu hạn', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    test(`colorAt(${String(bad)}) là màu ở vị trí 0`, () => {
      expect(colorAt(STOPS, bad)).toBe(colorAt(STOPS, 0))
    })
    test(`gradientRuns với frame ${String(bad)} như frame 0`, () => {
      expect(gradientRuns('━'.repeat(10), STOPS, bad)).toEqual(gradientRuns('━'.repeat(10), STOPS, 0))
    })
  }

  test('số âm: quay vòng trong chu kỳ 24 ô, màu hợp lệ', () => {
    expect(colorAt(STOPS, -1)).toBe(colorAt(STOPS, 23))
    expect(colorAt(STOPS, -25)).toBe(colorAt(STOPS, 23))
    for (const run of gradientRuns('━'.repeat(30), STOPS, -7)) expect(run.color).toMatch(HEX)
  })
})
