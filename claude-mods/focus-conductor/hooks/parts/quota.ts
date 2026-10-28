// Bảo vệ hạn mức (0.6.0): đọc số đo hạn mức, dừng ở ranh giới tool call khi hạn mức phiên hoặc tuần sắp hết.
// Đăng ký trước mọi nhóm hook khác (register.tsx), nên hook tool.call ở đây là lớp ngoài cùng: lệnh bị từ chối
// trước khi hook Agent kịp hỏi router chấm subagent, và trước mọi bước theo dõi của consistency.

import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { QuotaCheckpoint, QuotaPause, QuotaState } from '../../types'
import { addTouched, buildCheckpoint, pruneKeys, pushRecent, recentLine, storeKey } from '../lib/checkpoint'
import type { CheckpointInput } from '../lib/checkpoint'
import { classifyBash, filePathOf, isInScope, isMutation, restorableSteps } from '../lib/drift'
import { FILE_TOOLS } from '../lib/drift/tool'
import { EMPTY_QUOTA, QUOTA_CACHE_MS, deniedInput, evaluateQuota, blockingHits, isPauseActive, newPause, normalizeQuota, noteDenial, overrideOf, allowScopes, pauseAllowIssues, pauseAllowPaths, quotaSettings, reasonsOf, softNotices } from '../lib/quota'
import type { QuotaEval } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { PLAN_TOOL_FULL, quotaDenyText, quotaNoticeText } from '../lib/text'
import { viewOf } from '../atoms'
import type { Ctx } from '../context'
import { PERSON_ORIGINS, SLASH_COMMAND } from '../context'

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

/** Số đo hạn mức đọc thẳng từ $.session.usage(), không qua cache (prompt và kết thúc phiên hiếm, đọc không tốn chi phí). */
async function usageLimits($: EngineInterface): Promise<readonly unknown[] | null> {
  let usage: { rateLimits?: unknown } | null = null
  try {
    usage = await $.session.usage()
  } catch {
    usage = null
  }
  return usage !== null && Array.isArray(usage.rateLimits) ? usage.rateLimits : null
}

/**
 * Điểm dừng giai đoạn một của lần dừng `pause` từ trạng thái hiện tại (mục tiêu, checklist, việc giao, năm tool call
 * cuối, file đã sửa). `previous` là điểm dừng open của chính lần dừng này: giữ id, giờ tạo, note và lệnh bị từ chối.
 */
async function pauseCheckpoint($: EngineInterface, pause: QuotaPause, now: number, previous: QuotaCheckpoint | null): Promise<QuotaCheckpoint> {
  const q = normalizeQuota(await read($, quotaState))
  const fresh = S.normalizeCore(await read($, coreState))
  const cp = buildCheckpoint({
    id: previous?.id ?? `cp-${now}`,
    now: previous?.createdAt ?? now,
    cwd: previous?.cwd ?? (await checkpointDir($)),
    reason: pause.reason,
    brief: fresh.brief,
    plan: fresh.plan,
    delegations: fresh.delegations.goalId === fresh.brief?.goalId ? fresh.delegations.items : [],
    recent: q.recent,
    files: await fileStats($, q.touched.goalId === (fresh.brief?.goalId ?? 0) ? q.touched.paths : []),
    denied: previous?.denied ?? null,
  })
  return previous?.note ? { ...cp, note: previous.note } : cp
}

/**
 * Vào trạng thái dừng do hạn mức (lần đầu của lần dừng này): việc giao subagent đang chạy chuyển lỗi để giao lại, ghi
 * pause, rồi ghi điểm dừng giai đoạn một vào $.state và $.store. Dùng chung cho tool.call, session.measure,
 * prompt.submit và session.end, nên điểm dừng có cả khi hạn mức qua ngưỡng mà không còn tool call nào. Đã có pause thì
 * trả lại pause đó, không ghi gì.
 */
async function enterQuotaPause($: EngineInterface, ctx: Ctx, evaluation: QuotaEval, now: number): Promise<QuotaPause> {
  const q = normalizeQuota(await read($, quotaState))
  if (q.pause !== null) return q.pause
  const pause = newPause(now, 'quota', reasonsOf(blockingHits(evaluation.hits, overrideOf(q), now)))
  // Subagent đang chạy sẽ bị từ chối và tự kết thúc: việc đã phân của nó phải được giao lại.
  const core = S.normalizeCore(await read($, coreState))
  const goalId = core.brief?.goalId
  if (goalId !== undefined && ctx.local.delegation.goalId === goalId) {
    for (const index of [...ctx.local.delegation.running.keys()]) ctx.moveDelegation(goalId, index, 'failed')
    await update($, coreState, S.withDelegations(goalId, ctx.delegationItems(core.brief)))
  }
  $.ui.toast('Focus Conductor: tạm dừng vì hạn mức sắp hết; Claude ghi điểm dừng rồi kết thúc')
  await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause }))
  // Giai đoạn một: mod tự ghi điểm dừng ngay, nên dù Claude không kịp gọi plan checkpoint vẫn tiếp tục được.
  const cp = await pauseCheckpoint($, pause, now, null)
  await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp }))
  if (!(await storeCheckpoint($, cp))) $.ui.toast('Focus Conductor: không lưu được điểm dừng vào kho của mod; điểm dừng chỉ còn trong phiên này')
  return pause
}

/**
 * session.end: đang dừng (hay đang ở vùng dừng) mà checklist còn bước mở hoặc đang chờ thì điểm dừng của lần dừng này
 * phải có trong kho. Chưa có lần dừng thì vào dừng; đã có điểm dừng open của chính lần dừng này thì chỉ cập nhật
 * (không tạo bản trùng); chưa có thì ghi mới.
 */
async function savePauseOnEnd($: EngineInterface, ctx: Ctx): Promise<void> {
  const settings = quotaSettings(ctx.options)
  if (!settings.enabled || S.modeOf(await read($, modeState), ctx.options) === 'off') return
  const now = await $.clock.now()
  const evaluation = evaluateQuota(await usageLimits($), now, settings)
  const q = normalizeQuota(await read($, quotaState))
  if (q.pause === null && !isPauseActive(true, evaluation.hits, null, overrideOf(q), now)) return
  if (restorableSteps(S.normalizeCore(await read($, coreState)).plan).length === 0) return
  if (q.pause === null) {
    await enterQuotaPause($, ctx, evaluation, now)
    return
  }
  const previous = q.checkpoint !== null && q.checkpoint.status === 'open' && q.checkpoint.createdAt >= q.pause.at ? q.checkpoint : null
  const cp = await pauseCheckpoint($, q.pause, now, previous)
  await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp }))
  await storeCheckpoint($, cp)
}

/**
 * session.end khi điểm dừng đang resuming (0.7.5): turn chạy tiếp chưa xong mà phiên đã kết thúc, nên điểm dừng trong kho
 * về open, phiên sau tiếp tục được (trước đây chỉ session.start kế mới đổi).
 */
async function reopenResuming($: EngineInterface): Promise<void> {
  const q = normalizeQuota(await read($, quotaState))
  if (q.checkpoint === null || q.checkpoint.status !== 'resuming') return
  const cp: QuotaCheckpoint = { ...q.checkpoint, status: 'open' }
  await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp, resume: null }))
  await storeCheckpoint($, cp)
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

/** Ngưỡng báo mềm không hợp lệ (0.7.4): cảnh báo một lần mỗi phiên, bằng toast và Core.warnings. */
async function warnNoticeIssues($: EngineInterface, issues: readonly string[], flag: { isWarned: boolean }): Promise<void> {
  if (flag.isWarned || issues.length === 0) return
  flag.isWarned = true
  const at = await $.clock.now()
  await update($, coreState, S.withWarnings(...issues.map(text => ({ at, kind: 'cost' as const, text }))))
  $.ui.toast(`Focus Conductor: ${issues.join('; ')}`)
}

/**
 * Lời gọi ghi mà mọi đích nằm trong pauseAllowPaths (0.7.5): Write, Edit (tool file) có đường dẫn; Bash chỉ gồm tác động
 * ghi, đọc được mọi đích (không có đích lạ) và có ít nhất một đích. Đường dẫn tương đối neo theo thư mục gốc của phiên
 * (của Bash thì theo thư mục làm việc), như phạm vi.
 */
async function isAllowedWrite($: EngineInterface, input: Record<string, unknown> & { tool: string }, allowPaths: readonly string[]): Promise<boolean> {
  const root = await $.session.root().catch(() => null)
  if (input.tool === 'Bash') {
    const classified = classifyBash(String(input['command'] ?? ''))
    // Mọi tác động phải là ghi có đường dẫn đọc được (git commit, git push và lệnh lạ không đường dẫn bị từ chối), không có ln
    // (liên kết có thể trỏ ra ngoài), và mọi đường dẫn, kể cả nguồn của mv, nằm trong danh sách.
    const isWriteOnly = classified.effects.length > 0 && classified.effects.every(e => e.kind === 'write' && e.paths.length > 0 && e.name !== 'ln')
    if (classified.isUnknown || !isWriteOnly) return false
    const cwd = await $.session.cwd().catch(() => null)
    return classified.paths.every(path => isInScope(path, allowPaths, root, cwd))
  }
  // Đọc các đường dẫn được phép (file điểm dừng của lần trước) thì không cần ghi.
  if (input.tool === 'Read') {
    const path = String(input['file_path'] ?? '')
    return path !== '' && isInScope(path, allowPaths, root, null)
  }
  if (!FILE_TOOLS.has(input.tool)) return false
  const path = filePathOf({ tool: input.tool, input, isError: false, isReadOnly: false })
  return path !== '' && isInScope(path, allowPaths, root, null)
}

export function registerQuota(on: On, ctx: Ctx): void {
  const settings = quotaSettings(ctx.options)
  const allowPaths = pauseAllowPaths(ctx.options)
  const allowScope = allowScopes(allowPaths)
  const allowFlag = { isWarned: false }
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const cache: LimitCache = { at: Number.NEGATIVE_INFINITY, limits: null }
  const noticeFlag = { isWarned: false }

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
    if (S.modeOf(await read($, modeState), ctx.options) === 'off') return result
    // Qua ngưỡng lúc Claude đang trả lời bằng chữ (không còn tool call nào): điểm dừng vẫn phải có trong kho.
    const before = normalizeQuota(await read($, quotaState))
    if (before.pause === null && isPauseActive(true, evaluation.hits, null, overrideOf(before), now) && restorableSteps(S.normalizeCore(await read($, coreState)).plan).length > 0) {
      await enterQuotaPause($, ctx, evaluation, now)
    }
    const q = normalizeQuota(await read($, quotaState))
    await showStatus($, await read($, view), ctx.options)
    return result
  }).catch(($, e, next) => next(e))

  // Prompt đến khi đã ở vùng dừng mà chưa có lần dừng (ngưỡng bị vượt lúc Claude trả lời bằng chữ, không tool call nào
  // chạm tới): vào dừng và ghi điểm dừng trước khi parts/session.ts chèn dòng đang tạm dừng.
  on('prompt.submit', { text: /.*/ }, async ($, e, next) => {
    const text = e.text.trim()
    if (!settings.enabled || text === '' || SLASH_COMMAND.test(text) || !PERSON_ORIGINS.has(e.origin.kind)) return next(e)
    if (S.modeOf(await read($, modeState), ctx.options) === 'off') return next(e)
    const now = await $.clock.now()
    const limits = await usageLimits($)
    const evaluation = evaluateQuota(limits, now, settings)
    // Số đo vừa đọc thay số đã lưu: nhãn trên band và status line theo đúng hạn mức lúc này (đã làm mới thì nhãn mất).
    // Không ghi vào cache của tool.call: tool.call vẫn tự hỏi engine theo nhịp QUOTA_CACHE_MS như 0.6.0.
    // Prompt mới do người gõ (0.7.5): câu báo hạn mức mềm được gắn lại một lần trong turn của prompt này.
    await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, readings: [...(limits ?? [])] as QuotaState['readings'], measuredAt: now, noticed: [] }))
    const q = normalizeQuota(await read($, quotaState))
    if (q.pause === null && isPauseActive(true, evaluation.hits, null, overrideOf(q), now) && restorableSteps(S.normalizeCore(await read($, coreState)).plan).length > 0) {
      await enterQuotaPause($, ctx, evaluation, now)
    }
    await showStatus($, await read($, view), ctx.options)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Phiên kết thúc (kể cả /clear, trước khi parts/session.ts xóa trạng thái) khi đang ở vùng dừng mà checklist còn mở:
  // điểm dừng phải có trong kho cho phiên sau.
  on('session.end', { reason: /.*/ }, async ($, e, next) => {
    await savePauseOnEnd($, ctx).catch(() => undefined)
    await reopenResuming($).catch(() => undefined)
    // /clear (0.7.5): hội thoại mới không còn câu báo hạn mức mềm nào; đặt lại cờ đã báo.
    if (e.reason === 'clear') await update($, quotaState, q => ({ ...normalizeQuota(q), noticed: [] }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Turn luồng chính đang chạy: $.turn.abort cần đúng turnId của nó.
  on('turn.start', { turnId: /.*/ }, async ($, e, next) => {
    // Chỉ luồng chính: turn.start của subagent (e.agentId) không được ghi đè mã turn chính, nếu không $.turn.abort nhắm sai turn.
    if (e.agentId !== undefined) return next(e)
    const result = await next(e)
    if (!settings.enabled) return result
    // Turn đầu tiên sau khi chèn khối ĐIỂM DỪNG là turn tiếp tục: nó xong không lỗi thì điểm dừng thành consumed.
    await update($, quotaState, q => {
      const n = normalizeQuota(q)
      return { ...n, mainTurnId: e.turnId, resume: n.resume !== null && n.resume.turnId === '' ? { ...n.resume, turnId: e.turnId } : n.resume }
    })
    return result
  }).catch(($, e, next) => next(e))

  // Vòng đời điểm dừng: turn tiếp tục kết thúc bằng câu trả lời (reason answer) và không dừng lại vì hạn mức thì
  // consumed; ngắt, từ chối hay lỗi thì về open.
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
    // Chỉ một câu trả lời trọn vẹn mới là đã tiếp tục xong; người dùng ngắt (aborted), model từ chối hay lỗi thì về open,
    // dựng lại từ trạng thái hiện tại (0.7.5) để tiến độ của turn chạy tiếp không mất; giữ id, giờ tạo, note. Lệnh bị từ chối
    // của lần dừng cũ bị xóa (vòng sửa 2): turn chạy tiếp đã nhận nó trong khối ĐIỂM DỪNG và xử lý rồi.
    const after: QuotaCheckpoint =
      e.reason === 'answer'
        ? { ...cp, status: 'consumed' }
        : { ...(await pauseCheckpoint($, newPause(cp.createdAt, 'quota', cp.reason), await $.clock.now(), { ...cp, denied: null })), status: 'open' }
    await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: after, resume: null }))
    if (!(await storeCheckpoint($, after))) $.ui.toast('Focus Conductor: không cập nhật được điểm dừng trong kho của mod')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /.*/ }, async ($, e, next) => {
    if (!settings.enabled || S.modeOf(await read($, modeState), ctx.options) === 'off') return next(e)
    await warnNoticeIssues($, settings.noticeIssues, noticeFlag)
    await warnNoticeIssues($, pauseAllowIssues(ctx.options), allowFlag)
    const now = await $.clock.now()
    const isFresh = now - cache.at >= QUOTA_CACHE_MS
    const limits = await freshLimits($, cache, now)
    const evaluation = evaluateQuota(limits, now, settings)
    if (isFresh) await update($, quotaState, c => ({ ...normalizeQuota(c), readings: [...(limits ?? [])] as QuotaState['readings'], measuredAt: now }))
    const q = normalizeQuota(await read($, quotaState))
    if (!isPauseActive(true, evaluation.hits, q.pause, overrideOf(q), now)) {
      // Hạn mức đã làm mới hay người dùng ép tiếp: dừng do hạn mức tự mở; điểm dừng (nếu có) vẫn còn để tiếp tục.
      if (q.pause !== null || q.zone !== evaluation.zone) {
        await update($, quotaState, c => ({ ...normalizeQuota(c), zone: evaluation.zone, pause: null }))
        await showStatus($, await read($, view), ctx.options)
      }
      const result = await next(e)
      if (result.deny !== undefined) return result
      // Báo hạn mức mềm (0.7.4): cửa sổ vào vùng báo mà chưa báo thì gắn một lần vào kết quả tool của luồng chính (0.7.5:
      // cờ đặt lại ở mỗi prompt do người gõ, nên tối đa một lần mỗi cửa sổ trong turn của prompt đó; turn tiếp nối không có
      // prompt mới thì không báo lại). Kết quả lỗi không báo, không đánh dấu. Số đo đọc lại
      // sau next (0.7.5): lời gọi Agent dài có thể kết thúc khi hạn mức đã vào vùng báo. Đọc lại cờ sau next: lời gọi tool
      // song song có thể vừa báo cửa sổ này.
      const isNoticeable = e.agentId === undefined && result.isError !== true
      const later = isNoticeable ? await $.clock.now() : now
      const isRefetch = isNoticeable && later - cache.at >= QUOTA_CACHE_MS
      const current = isNoticeable ? await freshLimits($, cache, later) : limits
      if (isRefetch) await update($, quotaState, c => ({ ...normalizeQuota(c), readings: [...(current ?? [])] as QuotaState['readings'], measuredAt: later }))
      const shown = isNoticeable ? normalizeQuota(await read($, quotaState)).noticed : []
      const due = isNoticeable ? softNotices(current, later, settings).filter(hit => !shown.includes(hit.key)) : []
      const noticed = due.length > 0 ? { ...result, context: [...(result.context ?? []), quotaNoticeText(due)] } : result
      if (due.length > 0) {
        // Turn đã nhận câu báo mềm (0.7.5): Stop của turn này không chặn vì checklist còn mở (quy tắc dừng của prompt áp được).
        ctx.local.noticeTurn = ctx.local.tracker.turnId
        await update($, quotaState, c => {
          const n = normalizeQuota(c)
          return { ...n, noticed: [...n.noticed, ...due.map(hit => hit.key)].slice(-8) }
        })
        await showStatus($, await read($, view), ctx.options)
      }
      if (e.tool === PLAN_TOOL_FULL) return noticed
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
      return noticed
    }
    let pause = q.pause
    if (pause === null) {
      pause = await enterQuotaPause($, ctx, evaluation, now)
      await showStatus($, await read($, view), ctx.options)
    }
    // Tool plan của chính mod được qua: Claude cần nó để ghi điểm dừng.
    if (e.tool === PLAN_TOOL_FULL) return next(e)
    const isAgent = e.agentId !== undefined
    // pauseAllowPaths (0.7.5): luồng chính vẫn ghi được file checkpoint theo quy tắc dừng của prompt.
    if (!isAgent && allowPaths.length > 0 && (await isAllowedWrite($, e as unknown as Record<string, unknown> & { tool: string }, allowScope))) return next(e)
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
    return { deny: quotaDenyText(saved.reason, saved.source === 'user', isAgent, allowPaths) }
  }).catch(($, e, next) => next(e))
}
