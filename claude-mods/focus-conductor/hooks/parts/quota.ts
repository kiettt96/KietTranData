// Bảo vệ hạn mức (0.6.0): đọc số đo hạn mức, dừng ở ranh giới tool call khi hạn mức phiên hoặc tuần sắp hết.
// Đăng ký trước mọi nhóm hook khác (register.tsx), nên hook tool.call ở đây là lớp ngoài cùng: lệnh bị từ chối
// trước khi hook Agent kịp hỏi router chấm subagent, và trước mọi bước theo dõi của consistency.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { QuotaState } from '../../types'
import { EMPTY_QUOTA, QUOTA_CACHE_MS, deniedInput, evaluateQuota, isPauseActive, newPause, normalizeQuota, noteDenial, quotaSettings, reasonsOf } from '../lib/quota'
import * as S from '../lib/state'
import { PLAN_TOOL_FULL, quotaDenyText } from '../lib/text'
import type { Ctx } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó).
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

type LimitCache = { at: number; limits: readonly unknown[] | null }

/**
 * Số đo hạn mức tươi từ $.session.usage() (không tốn chi phí), dùng lại trong QUOTA_CACHE_MS. Engine không có hàm này
 * hay trả lỗi thì null (không biết): mod không dừng gì.
 */
async function freshLimits($: EngineInterface, cache: LimitCache, now: number): Promise<readonly unknown[] | null> {
  if (now - cache.at < QUOTA_CACHE_MS) return cache.limits
  let usage: { rateLimits?: unknown } | null = null
  try {
    usage = await $.session.usage()
  } catch {
    usage = null
  }
  cache.at = now
  cache.limits = usage !== null && Array.isArray(usage.rateLimits) ? usage.rateLimits : null
  return cache.limits
}

export function registerQuota(on: On, ctx: Ctx): void {
  const settings = quotaSettings(ctx.options)
  const cache: LimitCache = { at: Number.NEGATIVE_INFINITY, limits: null }

  // Số đo mới sau mỗi turn hay khi một cửa sổ nhích: chỉ cập nhật $.state cho band và status, không dừng gì ở đây
  // (dừng thật nằm ở tool.call, ranh giới nguyên tử).
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (!settings.enabled) return result
    const now = await $.clock.now()
    const evaluation = evaluateQuota(e.rateLimits, now, settings)
    cache.at = now
    cache.limits = Array.isArray(e.rateLimits) ? e.rateLimits : null
    await update($, quotaState, q => ({ ...normalizeQuota(q), zone: evaluation.zone, readings: [...(e.rateLimits ?? [])], measuredAt: now }))
    return result
  }).catch(($, e, next) => next(e))

  // Turn luồng chính đang chạy: $.turn.abort cần đúng turnId của nó.
  on('turn.start', { turnId: /.*/ }, async ($, e, next) => {
    const result = await next(e)
    if (settings.enabled) await update($, quotaState, q => ({ ...normalizeQuota(q), mainTurnId: e.turnId }))
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /.*/ }, async ($, e, next) => {
    if (!settings.enabled || S.modeOf(await read($, modeState), ctx.options) === 'off') return next(e)
    const now = await $.clock.now()
    const limits = await freshLimits($, cache, now)
    const evaluation = evaluateQuota(limits, now, settings)
    const q = normalizeQuota(await read($, quotaState))
    if (!isPauseActive(true, evaluation.zone, q.pause, q.overrideUntil, now)) {
      // Hạn mức đã làm mới hay người dùng ép tiếp: dừng do hạn mức tự mở; điểm dừng (nếu có) vẫn còn để tiếp tục.
      if (q.pause !== null || q.zone !== evaluation.zone) {
        await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: null }))
      }
      return next(e)
    }
    let pause = q.pause
    if (pause === null) {
      pause = newPause(now, 'quota', reasonsOf(evaluation.hits))
      // Subagent đang chạy sẽ bị từ chối và tự kết thúc: việc đã phân của nó phải được giao lại.
      const core = S.normalizeCore(await read($, coreState))
      const goalId = core.brief?.goalId
      if (goalId !== undefined && ctx.local.delegation.goalId === goalId) {
        for (const index of [...ctx.local.delegation.running.keys()]) ctx.moveDelegation(goalId, index, 'failed')
        await update($, coreState, S.withDelegations(goalId, ctx.delegationItems(core.brief)))
      }
      $.ui.toast('Focus Conductor: tạm dừng vì hạn mức sắp hết; Claude ghi điểm dừng rồi kết thúc')
      const entered = pause
      await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: entered }))
    }
    // Tool plan của chính mod được qua: Claude cần nó để ghi điểm dừng.
    if (e.tool === PLAN_TOOL_FULL) return next(e)
    const isAgent = e.agentId !== undefined
    let abort = false
    if (!isAgent) {
      const noted = noteDenial(pause, q.mainTurnId, { tool: e.tool, input: deniedInput(e as unknown as Record<string, unknown>) })
      pause = noted.pause
      abort = noted.abort
    }
    const saved = pause
    await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: saved }))
    // Dừng cứng dự phòng: model vẫn gọi tool bị từ chối lần thứ ba trong cùng turn. Gọi tại ranh giới tool call,
    // lệnh bị từ chối chưa chạy.
    if (abort) await $.turn.abort({ turnId: q.mainTurnId }).catch(() => undefined)
    return { deny: quotaDenyText(saved.reason, saved.source === 'user', isAgent) }
  }).catch(($, e, next) => next(e))
}
