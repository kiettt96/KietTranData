// Giữ mục tiêu qua lần nén (0.7.4): session.compact của luồng chính nối vào instructions một khối ngắn (mục tiêu, bước còn mở
// kèm số, ràng buộc kể cả quy định model, yêu cầu chưa có việc nào phủ), luôn chuyển tiếp, không bao giờ skip. Nối cả ở
// precompute: lần nén thật có thể dùng lại bản tóm tắt tính trước. Lần nén thật (không precompute, không skip) đặt lời nhắc
// sau nén; parts/consistency.ts gắn nó một lần vào kết quả tool kế tiếp của luồng chính, dựng từ trạng thái lúc nhắc.

import { atom, derive, read } from 'claude-code'
import type { On } from 'claude-code'
import * as S from '../lib/state'
import { compactKeepText } from '../lib/text'
import { modeOf } from '../atoms'
import type { Ctx } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó).
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

export function registerCompact(on: On, ctx: Ctx): void {
  const L = ctx.local
  const mode = derive([modeState], modeOf(ctx.options))

  on('session.compact', { trigger: /.*/ }, async ($, e, next) => {
    if (e.agentId !== undefined || (await read($, mode)) === 'off') return next(e)
    const core = S.normalizeCore(await read($, coreState))
    if (core.brief === null) return next(e)
    const block = compactKeepText(core.brief, core.plan)
    const instructions = e.instructions ? `${e.instructions}\n\n${block}` : block
    const result = await next({ ...e, instructions })
    if (e.trigger !== 'precompute' && result.skip === undefined) {
      L.compaction.pending = true
      L.compaction.hooked = true
    }
    return result
  }).catch(($, e, next) => next(e))
}
