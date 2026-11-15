// Bắt mẫu 075-S8a (sống sót từ trước 0.7.8, lộ ra ở lượt đột biến của 0.7.8): cảnh báo mục của prompt tiếp nối không giữ được mang kind
// "dropped" nên đứng hạng 4 trong "Cần chú ý", trên cảnh báo chưa kiểm (hạng 5); kind "model" sẽ đứng hạng 7, dưới cảnh báo chưa kiểm.

// 0.8.9 C1: ràng buộc không còn trần, nên mod không còn tạo cảnh báo mục bị bỏ cho mục tiêu mới; cảnh báo loại này chỉ còn ở trạng thái
// đã lưu từ bản cũ. Ca này giữ tên và kỳ vọng, dựng Core có sẵn hai cảnh báo (mục bị bỏ đến trước) và đọc thứ tự của "Cần chú ý".
import { describe, expect, test } from 'claude-code/testing'
import { droppedItemsText } from '../../hooks/lib/text'
import * as S from '../../hooks/lib/state'
import { attentionItems } from '../../hooks/ui/attention'
import type { Core } from '../../types'
import { makeBrief } from '../support/commands'

describe('kind dropped xếp trên cảnh báo chưa kiểm trong Cần chú ý', () => {
  test('mục bị bỏ (hạng 4) đứng trước cảnh báo chưa kiểm (hạng 5) dù đến trước', () => {
    const core: Core = {
      ...S.EMPTY_CORE,
      brief: makeBrief({ at: 1 }),
      warnings: [
        { at: 2, kind: 'dropped', text: droppedItemsText(8) },
        { at: 3, kind: 'unverified', text: 'Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào' },
      ],
    }
    const texts = attentionItems(core, 'vi').map(item => item.text)
    const dropped = texts.findIndex(t => t.includes('mục của prompt tiếp nối không giữ được'))
    const unverified = texts.findIndex(t => t.includes('không chạy bước kiểm tra nào'))
    expect(dropped).toBeGreaterThanOrEqual(0)
    expect(unverified).toBeGreaterThanOrEqual(0)
    expect(dropped).toBeLessThan(unverified)
  })
})
