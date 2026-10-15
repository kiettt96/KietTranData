// Giao diện: band trên prompt và pane chi tiết.

import { atom, derive, read, update } from 'claude-code'
import { EMPTY_QUOTA, evaluateQuota, isPauseActive, normalizeQuota, quotaBadge, quotaSettings } from '../lib/quota'
import * as S from '../lib/state'
import { renderBand } from '../ui/band'
import { labels } from '../ui/labels'
import { PANE, PANE_TITLE, renderPane } from '../ui/pane'
import type { On } from 'claude-code'
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
    const badge = settings.enabled ? quotaBadge(isPauseActive(true, evaluation.zone, q.pause, q.overrideUntil, now) || q.pause !== null, evaluation) : null
    const tree = renderBand($.ui.resolve(e), await read($, view), { maxRows, columns: bodyColumns, isWorking }, {
      onDetails: () => $.ui.open({ id: PANE, title: PANE_TITLE }),
      onHide: () => update($, bandHiddenState, () => true),
    }, badge)
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'focus-conductor' }, async ($, e) => {
    const current = await read($, view)
    const l = labels(current.lang)
    const isResetArmed = (await read($, resetArmedState)) > (await $.clock.now())
    return renderPane($.ui.resolve(e), current, { columns: e.props.bodyColumns, placement: e.props.placement, isResetArmed }, {
      onMode: picked => update($, modeState, () => picked),
      onReset: async () => {
        // Hai bước: lần đầu chỉ chờ xác nhận; lần hai trong hạn mới xóa.
        const now = await $.clock.now()
        if ((await read($, resetArmedState)) > now) {
          await update($, resetArmedState, () => 0)
          resetLocal()
          await update($, coreState, S.resetCore)
          $.ui.status(S.statusOf(await read($, view)))
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
    })
  })
}
