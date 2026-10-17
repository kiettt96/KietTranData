// Giao diện: band trên prompt và pane chi tiết.

import { atom, derive, read, update } from 'claude-code'
import { EMPTY_QUOTA, evaluateQuota, isPauseActive, normalizeQuota, overrideOf, quotaBadge, quotaSettings } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { quotaOverview, quotaPaneText } from '../lib/text'
import { renderBand } from '../ui/band'
import { labels } from '../ui/labels'
import { PANE, PANE_TITLE, renderPane } from '../ui/pane'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { viewOf } from '../atoms'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
// Mốc thời gian (ms) tới khi nút Đặt lại chờ bấm lần hai; 0 là không chờ. Là mốc chứ không phải cờ, nên hết hạn đúng cả
// khi mod nạp lại và hủy mất bộ hẹn giờ: lần vẽ sau so mốc với đồng hồ.
const resetArmedState = atom({ plugin: 'focus-conductor', key: 'resetArmedUntil' } as const, 0)
const RESET_CONFIRM_MS = 10_000
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerUi(on: On, ctx: Ctx): void {
  const { resetLocal } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))

  // ------------------------------------------------------- giao diện

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { maxRows, bodyColumns, isWorking } = e.props
    // Bảo vệ hạn mức (0.6.0): nhãn theo số đo gần nhất đã lưu (không gọi engine khi vẽ).
    const settings = quotaSettings(ctx.options)
    const q = normalizeQuota(await read($, quotaState))
    const now = await $.clock.now()
    const evaluation = evaluateQuota(q.readings, now, settings)
    const badge = settings.enabled ? quotaBadge(isPauseActive(true, evaluation.hits, q.pause, overrideOf(q), now) || q.pause !== null, evaluation) : null
    const tree = renderBand($.ui.resolve(e), await read($, view), { maxRows, columns: bodyColumns, isWorking, now }, {
      onDetails: () => $.ui.open({ id: PANE, title: PANE_TITLE }),
      onHide: () => update($, bandHiddenState, () => true),
    }, badge)
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'focus-conductor' }, async ($, e) => {
    const current = await read($, view)
    const l = labels(current.lang)
    const now = await $.clock.now()
    const isResetArmed = (await read($, resetArmedState)) > now
    // Mục Hạn mức theo số đo đã lưu (không gọi engine khi vẽ), cùng số liệu với /conductor status.
    const settings = quotaSettings(ctx.options)
    const q = normalizeQuota(await read($, quotaState))
    const quota = settings.enabled
      ? quotaPaneText(
          quotaOverview({ enabled: true, limits: q.readings, thresholds: settings, pause: q.pause, overrideUntil: q.overrideUntil, overrideKinds: q.overrideKinds, checkpoint: q.checkpoint, now }),
          current.lang,
        )
      : null
    return renderPane($.ui.resolve(e), current, { columns: e.props.bodyColumns, placement: e.props.placement, isResetArmed, now }, {
      onMode: picked => update($, modeState, () => picked),
      onReset: async () => {
        // Hai bước: lần đầu chỉ chờ xác nhận; lần hai trong hạn mới xóa.
        const now = await $.clock.now()
        if ((await read($, resetArmedState)) > now) {
          await update($, resetArmedState, () => 0)
          resetLocal()
          await update($, coreState, S.resetCore)
          await showStatus($, await read($, view), ctx.options)
          $.ui.toast(l.resetDoneToast)
          return
        }
        await update($, resetArmedState, () => now + RESET_CONFIRM_MS)
        $.ui.toast(l.resetArmedToast)
        // Hẹn giờ chỉ để vẽ lại và báo hủy; căn cứ hết hạn vẫn là mốc ở trên.
        $.clock.after(RESET_CONFIRM_MS, async () => {
          const until = await read($, resetArmedState)
          if (until === 0 || until > (await $.clock.now())) return
          await update($, resetArmedState, () => 0)
          $.ui.toast(l.resetExpiredToast)
        })
      },
      onToggleBand: () => update($, bandHiddenState, hidden => !hidden),
    }, quota)
  })
}
