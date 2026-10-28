// Turn lỗi của luồng chính (0.7.3): turn.complete với reason "error" để lại một bản ghi riêng `Core.turnFault`, nhãn trên status
// line, một toast và một dòng nhật ký loại net. Tách hẳn khỏi bảo vệ hạn mức: không tạo hay sửa điểm dừng, không chặn tool call
// nào, không đổi hành vi hook turn.complete của parts/quota.ts. Không nói "mất mạng": reason "error" gồm mọi lỗi API.
//
// Option netResume (mặc định TẮT): có turn lỗi thì dò nhẹ bằng $.http.fetch định kỳ; có phản hồi (mã nào cũng được) thì tự gửi một
// prompt tiếp tục đúng một lần cho mỗi mục tiêu. Tôn trọng dừng hạn mức và mode off; người dùng gõ prompt, turn trả lời hay
// session.end thì hủy chờ; số lần dò có trần.

import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { EMPTY_QUOTA, evaluateQuota, isPauseActive, normalizeQuota, overrideOf, quotaSettings } from '../lib/quota'
import { openSteps } from '../lib/drift'
import * as S from '../lib/state'
import { netResumeText } from '../lib/text'
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
/** Chu kỳ dò mạng (ms) và số lần dò tối đa cho một lần chờ (120 lần x 30 giây là một giờ). */
const PROBE_MS = 30_000
const MAX_PROBES = 120
/** Địa chỉ dò: chỉ cần có phản hồi HTTP (mã nào cũng được), không gửi dữ liệu của phiên. */
const PROBE_URL = 'https://api.anthropic.com'

/** Bộ đếm dò mạng của phiên: một bộ đếm tại một thời điểm; `resumed` là các mục tiêu đã tự tiếp tục (tối đa một lần mỗi mục tiêu). */
type Watch = { timer: { cancel: () => void } | null; probes: number; resumed: Set<number | null> }

function stopWatch(watch: Watch): void {
  watch.timer?.cancel()
  watch.timer = null
  watch.probes = 0
}

/** Một nhịp dò: còn bản ghi turn lỗi, mod còn bật, không đang dừng hạn mức thì dò; có phản hồi thì tự tiếp tục. */
async function probeTick($: EngineInterface, ctx: Ctx, watch: Watch): Promise<void> {
  if (watch.timer === null) return
  const core = S.normalizeCore(await read($, coreState))
  const fault = core.turnFault
  if (fault === null || S.modeOf(await read($, modeState), ctx.options) === 'off') {
    stopWatch(watch)
    return
  }
  // Đang dừng vì hạn mức (hay người dùng tạm dừng), hay số đo đã lưu có cửa sổ chạm ngưỡng dừng cứng (0.7.5, dù chưa vào trạng
  // thái dừng): giữ bộ đếm, không dò, không gửi.
  const q = normalizeQuota(await read($, quotaState))
  if (q.pause !== null) return
  const now = await $.clock.now()
  if (isPauseActive(true, evaluateQuota(q.readings, now, quotaSettings(ctx.options)).hits, null, overrideOf(q), now)) return
  watch.probes += 1
  const probes = watch.probes
  // 429 (quá giới hạn) không tính là có mạng (0.7.5): tự gửi prompt lúc đó chỉ lỗi lần nữa.
  const isReachable = await $.http.fetch(PROBE_URL).then(response => response.status !== 429, () => false)
  // Bị hủy trong lúc chờ phản hồi (người dùng gõ prompt, turn trả lời, session.end).
  if (watch.timer === null) return
  const at = await $.clock.now()
  if (isReachable) {
    stopWatch(watch)
    watch.resumed.add(fault.goalId)
    ctx.record(at, 'net', { reason: 'auto-resume', goalId: fault.goalId, probes })
    await ctx.flushDecisions((path, text) => $.fs.write(path, text))
    await $.prompt.submit({ text: netResumeText(fault) }).catch(() => undefined)
    return
  }
  if (probes >= MAX_PROBES) {
    stopWatch(watch)
    ctx.record(at, 'net', { reason: 'probe-gave-up', goalId: fault.goalId, probes })
    await ctx.flushDecisions((path, text) => $.fs.write(path, text))
  }
}

/** Status line kèm các nhãn của mod (hạn mức, lỗi router, turn lỗi). */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerTurnFault(on: On, ctx: Ctx): void {
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const watch: Watch = { timer: null, probes: 0, resumed: new Set() }
  const isNetResume = ctx.options['netResume'] === true

  // Người dùng gõ prompt (turn luồng chính mới bắt đầu): hủy chờ, vì họ đã tự chạy lại.
  on('turn.start', { text: /.*/ }, async ($, e, next) => {
    if (e.agentId === undefined) stopWatch(watch)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', { reason: /./ }, async ($, e, next) => {
    stopWatch(watch)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', { reason: /.*/ }, async ($, e, next) => {
    const result = await next(e)
    // Chỉ luồng chính; subagent có đường báo lỗi riêng (consistency.ts).
    if (e.agentId !== undefined) return result
    if (S.modeOf(await read($, modeState), ctx.options) === 'off') return result
    const core = S.normalizeCore(await read($, coreState))
    if (e.reason === 'answer') {
      // Một turn trả lời xong thì lần lỗi trước đã qua.
      stopWatch(watch)
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
    // netResume bật: dò mạng để tự tiếp tục, tối đa một lần mỗi mục tiêu; đã có bộ đếm thì giữ.
    if (isNetResume && watch.timer === null && !watch.resumed.has(core.brief?.goalId ?? null)) {
      watch.timer = $.clock.every(PROBE_MS, () => {
        void probeTick($, ctx, watch).catch(() => undefined)
      })
    }
    return result
  }).catch(($, e, next) => next(e))
}
