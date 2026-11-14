// Giao diện: band trên prompt và pane chi tiết.

import { atom, derive, read, update } from 'claude-code'
import { caught, noteHookError } from '../lib/errlog'
import { EMPTY_QUOTA, evaluateQuota, isPauseActive, normalizeQuota, overrideOf, quotaBadge, quotaSettings, softNotices } from '../lib/quota'
import * as S from '../lib/state'
import { statusTextOf } from '../ui/direction'
import type { View } from '../lib/state'
import { bandQuota, quotaOverview, quotaPaneText } from '../lib/text'
import { renderBand } from '../ui/band'
import { labels } from '../ui/labels'
import { isPersonClose } from '../lib/pane'
import { PANE, PANE_TITLE, renderPane } from '../ui/pane'
import type { EngineInterface, On, Timer } from 'claude-code'
import type { Ctx } from '../context'
import { viewOf } from '../atoms'
import { isMoving, neonStyleOf } from '../ui/neon'

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
// Mục tiêu mà người dùng đã tự đóng pane chi tiết (-1 là chưa), để autoPane không mở lại trong mục tiêu đó (0.7.2).
const paneClosedState = atom({ plugin: 'focus-conductor', key: 'paneClosedGoal' } as const, -1)
// Mã turn luồng chính đang chạy, rỗng khi không có (0.7.9, UI2). Chỉ ghi lúc turn bắt đầu và kết thúc, không ghi mỗi nhịp.
const runningTurnState = atom({ plugin: 'focus-conductor', key: 'runningTurn' } as const, '')

/**
 * Nhịp vẽ lại (0.7.9, UI2): thời gian đã chạy ở band và pane tính lúc vẽ, nên có turn đang chạy thì cứ 60 giây xin engine vẽ lại một lần.
 * Mỗi lần nạp mod giữ nhiều nhất một nhịp: lần nạp lại thì engine tự hủy các lần chờ của môi trường cũ, còn session.start (phát cả khi nạp
 * lại) hủy nhịp đang giữ rồi đặt lại khi $.state còn ghi turn đang chạy.
 */
const TICK_MS = 60_000
/**
 * Nhịp của màu chạy (0.8.8 N5): neon khác off và neonMotion là on thì có turn đang chạy là vẽ lại mỗi giây, để dải màu dịch một ô mỗi nhịp.
 * $.clock.every nhận chu kỳ từ 1 ms [Nguồn: khai báo kiểu của engine 2.1.296 và 2.1.325]. Nhịp vẫn chỉ xin vẽ lại.
 */
const MOTION_TICK_MS = 1_000
type Tick = { timer: Timer | null }

function stopTick(tick: Tick): void {
  tick.timer?.cancel()
  tick.timer = null
}

/** Một nhịp: $.state không còn turn đang chạy thì nhịp tự hủy và không vẽ lại; còn thì chỉ xin vẽ lại, không ghi $.state, không chèn context. */
async function redrawTick($: EngineInterface, tick: Tick): Promise<void> {
  if ((await read($, runningTurnState)) === '') {
    stopTick(tick)
    return
  }
  $.ui.invalidate('ui.render')
}

/** Đặt nhịp khi chưa có: một nhịp tại một thời điểm, kể cả khi turn mới bắt đầu trước khi nhịp của turn cũ kịp tự hủy. */
function startTick($: EngineInterface, tick: Tick, ms: number): void {
  if (tick.timer !== null) return
  tick.timer = $.clock.every(ms, () => {
    void redrawTick($, tick).catch(caught('redrawTick', undefined, 'hook'))
  })
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(statusTextOf(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerUi(on: On, ctx: Ctx): void {
  const { resetLocal } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const tick: Tick = { timer: null }
  const tickMs = isMoving(neonStyleOf(ctx.options)) ? MOTION_TICK_MS : TICK_MS

  // ------------------------------------------------ nhịp vẽ lại (UI2)

  // Turn luồng chính bắt đầu: ghi mã turn vào $.state và đặt nhịp. Turn của subagent không đổi gì.
  // Mỗi sự kiện đã có hook không matcher ở file khác: engine chỉ nhận lần đăng ký thứ hai khi có matcher riêng.
  on('turn.start', { turnId: /./ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await update($, runningTurnState, () => e.turnId)
    startTick($, tick, tickMs)
    return result
  }).catch(($, e, next) => (noteHookError('turn.start', next.error), next(e)))

  // Turn luồng chính kết thúc (mọi reason): xóa mã turn; nhịp kế tiếp đọc thấy rỗng thì tự hủy mà không vẽ lại.
  on('turn.complete', { reason: /./ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await update($, runningTurnState, () => '')
    return result
  }).catch(($, e, next) => (noteHookError('turn.complete', next.error), next(e)))

  // Nạp mod (lần đầu hay nạp lại): hủy nhịp đang giữ, rồi đặt lại khi $.state còn ghi turn đang chạy (nạp lại giữa turn).
  on('session.start', { cwd: /.*/ }, async ($, e, next) => {
    const result = await next(e)
    stopTick(tick)
    if ((await read($, runningTurnState)) !== '') startTick($, tick, tickMs)
    return result
  }).catch(($, e, next) => (noteHookError('session.start', next.error), next(e)))

  on('session.end', { sessionId: /.*/ }, async ($, e, next) => {
    stopTick(tick)
    await update($, runningTurnState, () => '')
    return next(e)
  }).catch(($, e, next) => (noteHookError('session.end', next.error), next(e)))

  // ------------------------------------------------------- giao diện

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { maxRows, bodyColumns, isWorking } = e.props
    // Bảo vệ hạn mức (0.6.0): nhãn theo số đo gần nhất đã lưu (không gọi engine khi vẽ).
    const settings = quotaSettings(ctx.options)
    const q = normalizeQuota(await read($, quotaState))
    const now = await $.clock.now()
    const evaluation = evaluateQuota(q.readings, now, settings)
    const isPaused = isPauseActive(true, evaluation.hits, q.pause, overrideOf(q), now) || q.pause !== null
    const badge = settings.enabled ? quotaBadge(isPaused, evaluation) : null
    const current = await read($, view)
    // Dòng tạm dừng và câu báo mềm của band (0.7.6, U3), cùng số đo đã lưu với mục Hạn mức của pane.
    const pause = settings.enabled
      ? bandQuota(quotaOverview({ enabled: true, limits: q.readings, thresholds: settings, pause: q.pause, overrideUntil: q.overrideUntil, overrideKinds: q.overrideKinds, checkpoint: q.checkpoint, now }), isPaused ? [] : softNotices(q.readings, now, settings), current.lang)
      : null
    // frame (0.8.8 N5): số giây của đồng hồ lúc vẽ; band và pane dùng chung.
    const tree = renderBand($.ui.resolve(e), current, { maxRows, columns: bodyColumns, isWorking, now, frame: Math.floor(now / 1000) }, {
      onDetails: () => $.ui.open({ id: PANE, title: PANE_TITLE }),
      onHide: () => update($, bandHiddenState, () => true),
    }, badge, pause)
    return tree ?? next(e)
  })

  // Người dùng tự đóng pane (dấu đóng hay phím): nhớ mục tiêu hiện tại để autoPane không mở lại. Luôn cho đóng đi tiếp (next): hook không
  // gọi next thì engine giữ pane mở và người dùng không đóng được.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (isPersonClose(e.origin)) {
      const goalId = S.normalizeCore(await read($, coreState)).brief?.goalId ?? -1
      if (goalId >= 0) await update($, paneClosedState, () => goalId)
    }
    return next(e)
  }).catch(($, e, next) => (noteHookError('ui.close', next.error), next(e)))

  on('ui.render', { component: 'Pane', requestId: 'focus-conductor' }, async ($, e) => {
    const current = await read($, view)
    const l = labels(current.lang)
    const now = await $.clock.now()
    const isResetArmed = (await read($, resetArmedState)) > now
    // Mục Hạn mức theo số đo đã lưu (không gọi engine khi vẽ), cùng số liệu với /conductor status.
    const settings = quotaSettings(ctx.options)
    const q = normalizeQuota(await read($, quotaState))
    const overview = settings.enabled
      ? quotaOverview({ enabled: true, limits: q.readings, thresholds: settings, pause: q.pause, overrideUntil: q.overrideUntil, overrideKinds: q.overrideKinds, checkpoint: q.checkpoint, now })
      : null
    // Chưa có số đo, không dừng, không có điểm dừng (0.7.5): ẩn mục Hạn mức, nhường chỗ cho checklist.
    const hasNotice = overview !== null && overview.state === 'ok' && softNotices(q.readings, now, settings).length > 0
    const quota = overview !== null && (overview.state !== 'none' || overview.checkpoint !== null) ? quotaPaneText(overview, current.lang, hasNotice, settings.notice) : null
    // Mục Cần chú ý của pane (0.7.6, W1): cùng phép tính tạm dừng và báo mềm với band.
    const isPaused = isPauseActive(true, evaluateQuota(q.readings, now, settings).hits, q.pause, overrideOf(q), now) || q.pause !== null
    const pause = overview !== null ? bandQuota(overview, isPaused ? [] : softNotices(q.readings, now, settings), current.lang) : null
    return renderPane($.ui.resolve(e), current, { columns: e.props.bodyColumns, placement: e.props.placement, isResetArmed, now, rows: e.props.scroll.bodyRows, frame: Math.floor(now / 1000) }, {
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
    }, quota, pause)
  })
}
