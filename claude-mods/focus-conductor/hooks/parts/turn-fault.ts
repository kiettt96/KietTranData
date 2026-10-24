// Turn lỗi của luồng chính (0.7.3): turn.complete với reason "error" để lại một bản ghi riêng `Core.turnFault`, nhãn trên status
// line, một toast và một dòng nhật ký loại net. Tách hẳn khỏi bảo vệ hạn mức: không tạo hay sửa điểm dừng, không chặn tool call
// nào, không đổi hành vi hook turn.complete của parts/quota.ts. Không nói "mất mạng": reason "error" gồm mọi lỗi API.

import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { EMPTY_QUOTA, normalizeQuota, quotaSettings } from '../lib/quota'
import { openSteps } from '../lib/drift'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { viewOf } from '../atoms'
import type { Ctx } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó).
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)

/** Số bước còn mở ghi vào bản ghi turn lỗi. */
const OPEN_STEPS_SHOWN = 5

/** Status line kèm các nhãn của mod (hạn mức, lỗi router, turn lỗi). */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerTurnFault(on: On, ctx: Ctx): void {
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))

  on('turn.complete', { reason: /.*/ }, async ($, e, next) => {
    const result = await next(e)
    // Chỉ luồng chính; subagent có đường báo lỗi riêng (consistency.ts).
    if (e.agentId !== undefined) return result
    if (S.modeOf(await read($, modeState), ctx.options) === 'off') return result
    const core = S.normalizeCore(await read($, coreState))
    if (e.reason === 'answer') {
      // Một turn trả lời xong thì lần lỗi trước đã qua.
      if (core.turnFault === null) return result
      await update($, coreState, S.withTurnFault(null))
      await showStatus($, await read($, view), ctx.options)
      return result
    }
    // aborted và refusal không phải lỗi và không xóa bản ghi đang có.
    if (e.reason !== 'error') return result
    const at = await $.clock.now()
    await update($, coreState, S.withTurnFault({
      goalId: core.brief?.goalId ?? null,
      goal: core.brief?.goal ?? null,
      openSteps: openSteps(core.plan).slice(0, OPEN_STEPS_SHOWN).map(step => step.title),
      at,
    }))
    if (core.turnFault === null) $.ui.toast('Focus Conductor: turn lỗi, turn đã kết thúc vì lỗi. Gõ tiếp để chạy lại; mod không tự chạy lại.')
    ctx.record(at, 'net', { reason: 'turn-error', goalId: core.brief?.goalId ?? null, openSteps: openSteps(core.plan).length })
    await ctx.flushDecisions((path, text) => $.fs.write(path, text))
    await showStatus($, await read($, view), ctx.options)
    return result
  }).catch(($, e, next) => next(e))
}
