// 0.8.8 N6c: bảng nền sáng. Các màu đơn dùng trên ô (bốn họ model, ok, attention, error) đạt tương phản từ 4,5 trên 1 với nền ô của bảng nền
// sáng (#e6e8f0), không chỉ với nền trắng.

import { describe, expect, test } from 'claude-code/testing'
import { LIGHT_SOLIDS, contrast } from '../hooks/ui/neon'

describe('0.8.8 N6c: màu đơn của bảng nền sáng trên nền ô', () => {
  for (const name of ['haiku', 'sonnet', 'opus', 'fable', 'ok', 'attention', 'error'] as const) {
    test(`${name}: từ 4,5 với nền ô và với nền trắng`, () => {
      expect(contrast(LIGHT_SOLIDS[name], LIGHT_SOLIDS.cell)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(LIGHT_SOLIDS[name], '#ffffff')).toBeGreaterThanOrEqual(4.5)
    })
  }
})
