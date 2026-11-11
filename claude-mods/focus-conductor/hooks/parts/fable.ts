// Đường lùi của router Fable (0.8.4 C6), phần thuần: kết quả một lượt router gửi Fable (đọc prompt, chấm subagent, kiểm lạc đề, rà kế
// hoạch) đổi Core.fable thế nào. Lỗi ROUTER_FAIL_LIMIT lần liên tiếp thì router Fable tạm ngừng ROUTER_PAUSE prompt: kèm một cảnh báo
// model và câu báo cho toast, dòng nhật ký conductor. Lỗi của Fable không cộng vào bộ đếm tạm ngừng router cũ. Mỗi tệp gọi router áp
// kết quả bằng hàm cục bộ (engine không cho truyền $ qua import).

import type { Core } from '../../types'
import * as S from '../lib/state'
import { FABLE_PAUSE_TEXT, blockerText, fableAfterCall } from '../lib/conductor'
import { ROUTER_FAIL_LIMIT, ROUTER_PAUSE } from '../context'

/** Thay đổi của một lượt router Fable: reducer cho Core, câu báo khi vừa tạm ngừng (null là không báo) và dữ liệu dòng nhật ký. */
export type FableStep = { change: (c: Core) => Core; text: string | null; log: Record<string, unknown> | null }

export function fableStep(core: Core, isOk: boolean, fallback: string, at: number): FableStep | null {
  const stored = S.normalizeCore(core).fable
  const next = fableAfterCall(stored, isOk, ROUTER_FAIL_LIMIT, ROUTER_PAUSE)
  if (next.failures === stored.failures && next.pauseLeft === stored.pauseLeft) return null
  if (!next.isPausedNow) return { change: S.withFable(() => ({ failures: next.failures })), text: null, log: null }
  const text = `${FABLE_PAUSE_TEXT}: router Fable lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; ${ROUTER_PAUSE} prompt tới router dùng ${fallback}, luồng chính theo lựa chọn của router`
  return {
    change: c => S.withFable(() => ({ failures: next.failures, pauseLeft: next.pauseLeft, ready: false, reason: 'paused' }))(S.withWarnings({ at, kind: 'model', text })(c)),
    text,
    log: { ready: false, reason: blockerText('paused') },
  }
}
