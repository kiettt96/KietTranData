// Bảo vệ hạn mức (0.6.0): đọc số đo hạn mức, dừng ở ranh giới tool call khi hạn mức phiên hoặc tuần sắp hết.
// Đăng ký trước mọi nhóm hook khác (register.tsx), nên hook tool.call ở đây là lớp ngoài cùng: lệnh bị từ chối
// trước khi hook Agent kịp hỏi router chấm subagent, và trước mọi bước theo dõi của consistency.

import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { QuotaCheckpoint, QuotaState } from '../../types'
import { addTouched, buildCheckpoint, pruneKeys, pushRecent, recentLine, storeKey } from '../lib/checkpoint'
import type { CheckpointInput } from '../lib/checkpoint'
import { classifyBash, filePathOf, isMutation } from '../lib/drift'
import { EMPTY_QUOTA, QUOTA_CACHE_MS, deniedInput, evaluateQuota, isPauseActive, newPause, normalizeQuota, noteDenial, quotaBadge, quotaSettings, reasonsOf } from '../lib/quota'
import type { QuotaEval } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { PLAN_TOOL_FULL, quotaDenyText, withQuotaStatus } from '../lib/text'
import { viewOf } from '../atoms'
import type { Ctx } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó).
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)

type LimitCache = { at: number; limits: readonly unknown[] | null }

/** Thư mục làm việc của phiên cho khóa điểm dừng: thư mục gốc, nếu không có thì thư mục hiện tại; rỗng khi engine không trả được. */
async function checkpointDir($: EngineInterface): Promise<string> {
  const root = await $.session.root().catch(() => null)
  if (root) return root
  return (await $.session.cwd().catch(() => null)) ?? ''
}

/**
 * Ghi điểm dừng vào $.store (khóa theo thư mục), rồi bỏ bản ghi thừa để kho còn tối đa năm. Kho từ chối (vượt 4 MiB...)
 * thì không ném ra: trả false để hook báo toast; bản sao trong $.state vẫn giữ.
 */
async function storeCheckpoint($: EngineInterface, cp: QuotaCheckpoint): Promise<boolean> {
  try {
    const key = storeKey(cp.cwd)
    await $.store.set(key, cp)
    const keys = (await $.store.keys()).filter(k => k.startsWith('checkpoint:'))
    const entries: Array<{ key: string; status: QuotaCheckpoint['status']; createdAt: number }> = []
    for (const k of keys) {
      const value = (await $.store.get(k)) as Partial<QuotaCheckpoint> | undefined
      entries.push({ key: k, status: value?.status ?? 'consumed', createdAt: value?.createdAt ?? 0 })
    }
    for (const k of pruneKeys(entries, key)) await $.store.delete(k)
    return true
  } catch {
    return false
  }
}

/** Kích thước và thời điểm sửa của các file đã thấy bị sửa, để lúc tiếp tục biết file nào đổi sau điểm dừng. */
async function fileStats($: EngineInterface, paths: readonly string[]): Promise<CheckpointInput['files']> {
  const out: Array<{ path: string; mtimeMs: number; size: number }> = []
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(() => null)
    out.push({ path, mtimeMs: stat?.mtimeMs ?? -1, size: stat?.size ?? -1 })
  }
  return out
}

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

/** Đặt status line kèm nhãn hạn mức (đang dừng, hay phần còn lại khi gần ngưỡng). */
function setQuotaStatus($: EngineInterface, current: View, isPaused: boolean, evaluation: QuotaEval): void {
  $.ui.status(withQuotaStatus(S.statusOf(current), quotaBadge(isPaused, evaluation), current.lang))
}

export function registerQuota(on: On, ctx: Ctx): void {
  const settings = quotaSettings(ctx.options)
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
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
    const q = normalizeQuota(await read($, quotaState))
    if (S.modeOf(await read($, modeState), ctx.options) !== 'off') setQuotaStatus($, await read($, view), q.pause !== null, evaluation)
    return result
  }).catch(($, e, next) => next(e))

  // Turn luồng chính đang chạy: $.turn.abort cần đúng turnId của nó.
  on('turn.start', { turnId: /.*/ }, async ($, e, next) => {
    const result = await next(e)
    if (!settings.enabled) return result
    // Turn đầu tiên sau khi chèn khối ĐIỂM DỪNG là turn tiếp tục: nó xong không lỗi thì điểm dừng thành consumed.
    await update($, quotaState, q => {
      const n = normalizeQuota(q)
      return { ...n, mainTurnId: e.turnId, resume: n.resume !== null && n.resume.turnId === '' ? { ...n.resume, turnId: e.turnId } : n.resume }
    })
    return result
  }).catch(($, e, next) => next(e))

  // Vòng đời điểm dừng: turn tiếp tục kết thúc không lỗi và không dừng lại vì hạn mức thì consumed; lỗi thì về open.
  // Dừng lại lần nữa thì điểm dừng mới (ghi lúc vào vùng dừng) đã thay bản cũ.
  // Ghi trạng thái trước khi chuyển tiếp: một turn lỗi vẫn phải đưa điểm dừng về open dù lớp trong ném lỗi.
  on('turn.complete', { turnId: /.*/ }, async ($, e, next) => {
    if (!settings.enabled || e.agentId !== undefined) return next(e)
    const q = normalizeQuota(await read($, quotaState))
    if (q.resume === null || q.resume.turnId !== e.turnId) return next(e)
    const cp = q.checkpoint
    if (q.pause !== null || cp === null || cp.id !== q.resume.id) {
      await update($, quotaState, c => ({ ...normalizeQuota(c), resume: null }))
      return next(e)
    }
    const after: QuotaCheckpoint = { ...cp, status: e.reason === 'error' ? 'open' : 'consumed' }
    await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: after, resume: null }))
    if (!(await storeCheckpoint($, after))) $.ui.toast('Focus Conductor: không cập nhật được điểm dừng trong kho của mod')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /.*/ }, async ($, e, next) => {
    if (!settings.enabled || S.modeOf(await read($, modeState), ctx.options) === 'off') return next(e)
    const now = await $.clock.now()
    const isFresh = now - cache.at >= QUOTA_CACHE_MS
    const limits = await freshLimits($, cache, now)
    const evaluation = evaluateQuota(limits, now, settings)
    if (isFresh) await update($, quotaState, c => ({ ...normalizeQuota(c), readings: [...(limits ?? [])] as QuotaState['readings'], measuredAt: now }))
    const q = normalizeQuota(await read($, quotaState))
    if (!isPauseActive(true, evaluation.zone, q.pause, q.overrideUntil, now)) {
      // Hạn mức đã làm mới hay người dùng ép tiếp: dừng do hạn mức tự mở; điểm dừng (nếu có) vẫn còn để tiếp tục.
      if (q.pause !== null || q.zone !== evaluation.zone) {
        await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: null }))
        setQuotaStatus($, await read($, view), false, evaluation)
      }
      const result = await next(e)
      if (e.tool === PLAN_TOOL_FULL || result.deny !== undefined) return result
      const observation = { tool: e.tool, input: e as unknown as Record<string, unknown>, isError: result.isError === true, isReadOnly: result.isReadOnly === true }
      const path = filePathOf(observation)
      // Năm tool call cuối của luồng chính và các file thấy bị sửa trong mục tiêu: dữ liệu cho điểm dừng (không có output).
      const command = e.tool === 'Bash' ? String((e as unknown as { command?: unknown }).command ?? '') : ''
      const line = e.agentId === undefined ? recentLine(e.tool, path || command, observation.isError) : null
      const paths = isMutation(observation) ? (path ? [path] : command ? classifyBash(command).paths : []) : []
      if (line !== null || paths.length > 0) {
        const goalId = S.normalizeCore(await read($, coreState)).brief?.goalId ?? 0
        await update($, quotaState, c => {
          const n = normalizeQuota(c)
          return { ...n, recent: line !== null ? pushRecent(n.recent, line) : n.recent, touched: paths.length > 0 ? addTouched(n.touched, goalId, paths) : n.touched }
        })
      }
      return result
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
      setQuotaStatus($, await read($, view), true, evaluation)
      // Giai đoạn một: mod tự ghi điểm dừng ngay, nên dù Claude không kịp gọi plan checkpoint vẫn tiếp tục được.
      const fresh = S.normalizeCore(await read($, coreState))
      const cp = buildCheckpoint({
        id: `cp-${now}`,
        now,
        cwd: await checkpointDir($),
        reason: entered.reason,
        brief: fresh.brief,
        plan: fresh.plan,
        delegations: fresh.delegations.goalId === fresh.brief?.goalId ? fresh.delegations.items : [],
        recent: q.recent,
        files: await fileStats($, q.touched.goalId === (fresh.brief?.goalId ?? 0) ? q.touched.paths : []),
        denied: null,
      })
      await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp }))
      if (!(await storeCheckpoint($, cp))) $.ui.toast('Focus Conductor: không lưu được điểm dừng vào kho của mod; điểm dừng chỉ còn trong phiên này')
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
    const before = normalizeQuota(await read($, quotaState))
    // Lệnh bị từ chối đầu tiên là điểm tiếp tục chính xác: ghi vào điểm dừng một lần.
    const isFirstDenial = saved.denied !== null && before.pause?.denied === null && before.checkpoint !== null
    const withDenied = isFirstDenial && before.checkpoint !== null ? { ...before.checkpoint, denied: saved.denied } : before.checkpoint
    await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: saved, checkpoint: withDenied }))
    if (isFirstDenial && withDenied !== null && !(await storeCheckpoint($, withDenied))) {
      $.ui.toast('Focus Conductor: không lưu được điểm dừng vào kho của mod; điểm dừng chỉ còn trong phiên này')
    }
    // Dừng cứng dự phòng: model vẫn gọi tool bị từ chối lần thứ ba trong cùng turn. Gọi tại ranh giới tool call,
    // lệnh bị từ chối chưa chạy.
    if (abort) await $.turn.abort({ turnId: q.mainTurnId }).catch(() => undefined)
    return { deny: quotaDenyText(saved.reason, saved.source === 'user', isAgent) }
  }).catch(($, e, next) => next(e))
}
