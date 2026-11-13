// Hàm gộp cho các nguồn suy ra (derive) của mod. Engine chỉ nhận atom và derive viết trong chính file dùng chúng,
// nên mỗi file trong hooks/parts/ tự khai báo atom và gọi derive; ở đây chỉ có phần tính toán dùng chung.

import type { PluginOptions } from 'claude-code'

import type { Core, Mode } from '../types'
import * as S from './lib/state'
import type { View } from './lib/state'
import { langOf } from './ui/labels'
import { conductorOf } from './lib/conductor'

/** Một lần đọc cho mọi thứ band, pane và status line cần. */
export function viewOf(options: PluginOptions) {
  const lang = langOf(options['uiLanguage'])
  // Fable điều phối (0.8.4 C8): option off thì View như 0.8.3, không có trường conductor.
  const rawRouter = options['router']
  // 0.8.7 G1: họ điều phối chính là giá trị của option conductor (conductorOf).
  const primary = conductorOf(options)
  const conductor = primary !== 'off' ? { fallback: typeof rawRouter === 'string' && rawRouter.trim() !== '' ? rawRouter.trim() : 'sonnet', family: primary } : null
  return (core: Core, override: Mode | null, isBandHidden: boolean): View => ({
    core: S.normalizeCore(core),
    mode: S.modeOf(override, options),
    isBandHidden,
    lang,
    ...(conductor !== null ? { conductor } : {}),
  })
}

/** Chế độ đang có hiệu lực: ghi đè lúc chạy nếu có, nếu không thì theo cấu hình. */
export function modeOf(options: PluginOptions) {
  return (override: Mode | null): Mode => S.modeOf(override, options)
}
