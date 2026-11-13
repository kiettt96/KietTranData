// Đường lùi của router Fable (0.8.4 C6), phần thuần: kết quả một lượt router gửi Fable (đọc prompt, chấm subagent, kiểm lạc đề, rà kế
// hoạch) đổi Core.fable thế nào. Lỗi ROUTER_FAIL_LIMIT lần liên tiếp thì router Fable tạm ngừng ROUTER_PAUSE prompt: kèm một cảnh báo
// model và câu báo cho toast, dòng nhật ký conductor. Lỗi của Fable không cộng vào bộ đếm tạm ngừng router cũ. Mỗi tệp gọi router áp
// kết quả bằng hàm cục bộ (engine không cho truyền $ qua import).

import type { Core, ModelFamily } from '../../types'
import * as S from '../lib/state'
import { blockerText, fableAfterCall, pauseText } from '../lib/conductor'
import { DEFAULT_CONDUCTOR, familyLabel } from '../lib/families'
import { ROUTER_FAIL_LIMIT, ROUTER_PAUSE } from '../context'

/** Thay đổi của một lượt router Fable: reducer cho Core, câu báo khi vừa tạm ngừng (null là không báo) và dữ liệu dòng nhật ký. */
export type FableStep = { change: (c: Core) => Core; text: string | null; log: Record<string, unknown> | null }

/**
 * Kết quả một lượt router của họ điều phối. `family` là họ đã gọi: fable dùng Core.fable như 0.8.4; họ dự phòng (0.8.7 F1) dùng
 * Core.fallback cùng luật đếm. `takeover` là họ dự phòng sẽ nhận vai khi router Fable vừa tạm ngừng (null là không có, câu báo như 0.8.6).
 */
export function fableStep(core: Core, isOk: boolean, fallback: string, at: number, family?: ModelFamily, takeover: ModelFamily | null = null, primary: ModelFamily = DEFAULT_CONDUCTOR): FableStep | null {
  const n = S.normalizeCore(core)
  // Họ chính (0.8.7 G1: giá trị của option conductor) dùng Core.fable; họ khác là họ dự phòng, dùng Core.fallback.
  if ((family ?? primary) !== primary) {
    const stored = n.fallback
    const next = fableAfterCall(stored, isOk, ROUTER_FAIL_LIMIT, ROUTER_PAUSE)
    if (next.failures === stored.failures && next.pauseLeft === stored.pauseLeft) return null
    if (!next.isPausedNow) return { change: S.withFallback(() => ({ failures: next.failures })), text: null, log: null }
    const text = `Model điều phối dự phòng ${family} tạm ngừng: router ${family} lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; ${ROUTER_PAUSE} prompt tới router dùng ${fallback}, luồng chính theo lựa chọn của router`
    return {
      change: c => S.withFallback(() => ({ failures: next.failures, pauseLeft: next.pauseLeft }))(S.withWarnings({ at, kind: 'model', text })(c)),
      text,
      log: { ready: false, family, reason: `router ${family} tạm ngừng sau các lần lỗi` },
    }
  }
  const stored = n.fable
  const next = fableAfterCall(stored, isOk, ROUTER_FAIL_LIMIT, ROUTER_PAUSE)
  if (next.failures === stored.failures && next.pauseLeft === stored.pauseLeft) return null
  if (!next.isPausedNow) return { change: S.withFable(() => ({ failures: next.failures })), text: null, log: null }
  const text =
    takeover === null
      ? `${pauseText(primary)}: router ${familyLabel(primary)} lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; ${ROUTER_PAUSE} prompt tới router dùng ${fallback}, luồng chính theo lựa chọn của router`
      : `${pauseText(primary)}: router ${familyLabel(primary)} lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; ${ROUTER_PAUSE} prompt tới ${takeover} nhận vai điều phối (dự phòng)`
  return {
    change: c => S.withFable(() => ({ failures: next.failures, pauseLeft: next.pauseLeft, ready: false, reason: 'paused' }))(S.withWarnings({ at, kind: 'model', text })(c)),
    text,
    log: { ready: false, reason: blockerText('paused', primary) },
  }
}
