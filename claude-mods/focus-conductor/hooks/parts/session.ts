// Phiên và đọc prompt: session.start/end, mục system prompt cố định, prompt.submit (router đọc prompt).

import { DEFAULT_CONDUCTOR, familyLabel } from '../lib/families'
import { atom, derive, read, update } from 'claude-code'
import { caught, noteBehavior, noteHookError, noteMistyped } from '../lib/errlog'
import type { ApprovalState, Brief, Core, Depth, Mode, ModelFamily, QuotaCheckpoint, Warning } from '../../types'
import { blockerText, isBigGoal, isMainConducting } from '../lib/conductor'
import { FALLBACK_TIMEOUT_MS, fullRetryTokens, readParamsOf } from '../lib/reading'
import type { ReadPlan } from '../lib/reading'
import { fableStep } from './fable'
import { briefFromCheckpoint, changedFiles, storeKey } from '../lib/checkpoint'
import { openSteps, restorableSteps } from '../lib/drift'
import { PLAN_TOOL_SPEC } from '../lib/plan'
import { describePick, effortRank, familyOf, familyRank } from '../lib/route'
import { clipText, keptLines } from '../lib/decisions'
import { CLIPPED_CONTEXT, NEW_GOAL_CONFIDENCE, answerMentionsGoal, askRouter, requestPlan, bareBrief, clampIntent, isAside, clippedWarning, dropSplit, isClippedPrompt, failFields, isSkippable, needsCoverageRecheck, nextBrief, parseRoute, routerFailOf, routerRequest } from '../lib/router'
import type { RouterOutcome, RouterPlan } from '../lib/router'
import { EMPTY_QUOTA, blockingHits, evaluateQuota, isPauseActive, normalizeQuota, overrideOf, quotaSettings, reasonsOf, softNotices } from '../lib/quota'
import * as S from '../lib/state'
import { statusTextOf } from '../ui/direction'
import type { View } from '../lib/state'
import { DISCIPLINE, asideContext, conductorContext, conductorKeepText, phaseNotice, briefContext, droppedGoalNotice, droppedItemsText, droppedPlanNotice, followUpContext, intentResumeContext, intentStatusContext, interjectContext, interjectMovedNote, quotaPausedContext, resetLabel, resumeCommand, nothingLeftContext, restorableLabel, restoreGoalOnlyContext, restoreResumeContext, resumeContext, resumePendingContext, skippedContext, unroutedContext } from '../lib/text'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { PERSON_ORIGINS, SLASH_COMMAND, newDelegation } from '../context'
import { PANE_ROWS, shouldAutoOpenPane } from '../lib/pane'
import { taskRows } from '../lib/progress'
import { PANE, PANE_TITLE } from '../ui/pane'
import { approvalDenial, approvedContext, askContext, needsApproval, planningContext } from '../lib/approval'

/** Mở pane chi tiết cho mục tiêu mới nếu cần (0.7.2): không focus, không chiếm phím; kết quả đặt hay chưa đặt ghi vào nhật ký quyết định. */
async function autoOpenPane($: EngineInterface, ctx: Ctx, goalId: number, at: number, depth: Depth | null): Promise<void> {
  const panes = await $.ui.panes().catch(caught('ui.panes', []))
  const isOpen = panes.some(pane => pane.id === PANE)
  if (!shouldAutoOpenPane({ enabled: ctx.autoPane, goalId, closedGoal: await read($, paneClosedState), isOpen, depth })) return
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS }).catch(caught('ui.open', null))
  // Chỉ ghi khi pane chưa được đặt (màn hình hẹp, chưa có surface, engine từ chối): đặt được là trường hợp bình thường, không cần dòng log.
  if (opened?.isPlaced === true) return
  ctx.record(at, 'pane', { goalId, isPlaced: false, reason: opened === null ? 'engine từ chối mở pane' : opened.reason })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text))
}

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)

/** Áp kết quả một lượt router gửi Fable vào Core (0.8.4 C6): vừa tạm ngừng thì toast và một dòng nhật ký conductor. */
async function noteFableRouter($: EngineInterface, ctx: Ctx, isOk: boolean, family?: ModelFamily): Promise<void> {
  const at = await $.clock.now()
  const core = S.normalizeCore(await read($, coreState))
  // Họ dự phòng (0.8.7 F1): lỗi của nó đếm riêng; router Fable vừa tạm ngừng thì câu báo nêu họ dự phòng nhận vai nếu dùng được.
  const primary = ctx.conductorFamily
  const step = fableStep(core, isOk, ctx.routerModel, at, family, (family ?? primary) === primary ? ctx.fallbackUsable(core) : null, primary)
  if (step === null) return
  await update($, coreState, step.change)
  if (step.text !== null) $.ui.toast(step.text)
  if (step.log !== null) {
    ctx.record(at, 'conductor', step.log)
    await ctx.flushDecisions((path, body) => $.fs.write(path, body))
  }
}
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
/** Mod đã tự đặt mode off vì phiên không tương tác (0.8.0 A13): mở lại tương tác thì trả mode về cấu hình. */
const headlessState = atom({ plugin: 'focus-conductor', key: 'headlessOff' } as const, false)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)
// Mục tiêu mà người dùng đã tự đóng pane chi tiết (-1 là chưa); ghi ở hook ui.close của parts/ui.tsx.
const paneClosedState = atom({ plugin: 'focus-conductor', key: 'paneClosedGoal' } as const, -1)

/** Số đo hạn mức tươi lúc prompt đến (không tốn chi phí); engine không có hoặc lỗi thì null. */
async function quotaLimits($: EngineInterface): Promise<readonly unknown[] | null> {
  let usage: { rateLimits?: unknown } | null = null
  try {
    usage = await $.session.usage()
  } catch {
    usage = null
  }
  return usage !== null && Array.isArray(usage.rateLimits) ? usage.rateLimits : null
}

/** Thư mục của khóa điểm dừng: thư mục gốc của phiên, không có thì `fallback`. */
async function checkpointDir($: EngineInterface, fallback: string): Promise<string> {
  const root = await $.session.root().catch(caught('session.root', null))
  return root || fallback
}

/** Kích thước và thời điểm sửa hiện tại của các file trong điểm dừng (null khi không còn). */
async function currentStats($: EngineInterface, paths: readonly string[]): Promise<Map<string, { mtimeMs: number; size: number } | null>> {
  const out = new Map<string, { mtimeMs: number; size: number } | null>()
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(caught('fs.stat', null))
    out.set(path, stat === null ? null : { mtimeMs: stat.mtimeMs, size: stat.size })
  }
  return out
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(statusTextOf(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

/** Trạng thái Fable điều phối (0.8.4 C1): ghi dòng conductor khi bật, tắt hay đổi nguyên nhân; option off từ đầu thì không ghi gì. */
async function noteConductor($: EngineInterface, ctx: Ctx, core: Core, current: Mode): Promise<void> {
  // Đổi họ điều phối có họ dự phòng tham gia (0.8.7 F1): một toast, một cảnh báo model, một dòng nhật ký conductor nêu từ họ nào sang họ nào
  // và lý do. Fable bật hay tắt mà không có họ dự phòng thì như 0.8.6 (chỉ dòng nhật ký bên dưới).
  if (ctx.conductorOption !== 'off') {
    const primary = ctx.conductorFamily
    const active = ctx.activeConductorOf(core, current, (await read($, headlessState)) === true)
    const from = S.normalizeCore(core).fallback.active
    const to = active?.family ?? null
    if (from !== to) {
      await update($, coreState, S.withFallback(() => ({ active: to })))
      if ((from !== null && from !== primary) || (to !== null && to !== primary)) {
        const at = await $.clock.now()
        const reason = active?.isFallback === true ? (active.reason === 'paused' ? `router ${familyLabel(primary)} tạm ngừng` : `họ ${primary} bị chặn vì không phản hồi`) : to === primary ? `${familyLabel(primary)} dùng lại được` : `${from ?? ''} không dùng được`
        const text = to === null ? `Model điều phối ${from ?? ''} không dùng được (${reason}); luồng chính theo lựa chọn của router` : `Model điều phối đổi từ ${from ?? 'không có'} sang ${to}${active?.isFallback === true ? ' (dự phòng)' : ''}: ${reason}`
        $.ui.toast(text)
        await update($, coreState, S.withWarnings({ at, kind: 'model', text }))
        ctx.record(at, 'conductor', { from: from ?? 'none', to: to ?? 'none', reason })
      }
    }
  }
  const blocker = ctx.conductorState(core, current, (await read($, headlessState)) === true)
  const ready = blocker === null
  const stored = core.fable
  if (ctx.conductorOption === 'off' && stored.ready === null) return
  if (stored.ready === ready && stored.reason === (blocker ?? '')) return
  ctx.record(await $.clock.now(), 'conductor', { ready, ...(blocker !== null ? { reason: blockerText(blocker) } : {}) })
  await update($, coreState, S.withFable(() => ({ ready, reason: blocker ?? '' })))
}

/**
 * Mục tiêu đã nhận đoạn dặn của đúng họ đang điều phối (0.8.4 V1, 0.8.7 F1): khóa Core.fable.briefedGoal cộng họ đã dặn
 * Core.fallback.briefedFamily (vắng ở trạng thái 0.8.6 là fable). Họ điều phối đổi giữa mục tiêu thì đoạn dặn được chèn lại một lần.
 */
function isBriefedFor(core: Core, goalId: number, family: ModelFamily): boolean {
  const n = S.normalizeCore(core)
  return n.fable.briefedGoal === goalId && (n.fallback.briefedFamily ?? DEFAULT_CONDUCTOR) === family
}

function markBriefed(goalId: number, family: ModelFamily): (c: Core) => Core {
  return c => S.withFallback(() => ({ briefedFamily: family }))(S.withFable(() => ({ briefedGoal: goalId }))(c))
}

/** Hết chờ câu trả lời câu hỏi làm rõ (0.8.3 R3): xóa cờ trong Core nếu đang bật; trả trạng thái duyệt đã xóa cờ. */
async function clearAwaiting($: EngineInterface, approval: ApprovalState): Promise<ApprovalState> {
  if (!approval.awaitingAnswer) return approval
  const cleared = { ...approval, awaitingAnswer: false }
  await update($, coreState, S.withApproval(cleared))
  return cleared
}

/** permission_mode mà lần thoát plan mode là người dùng tự bấm duyệt (0.8.2 N2). */
const PERSON_MODES: ReadonlySet<string> = new Set(['plan', 'default', 'acceptEdits'])
/** Tool có thể bị chặn khi kế hoạch chưa duyệt (0.8.2 N2): sửa file, Bash (chỉ lệnh ghi file), Agent (trừ Explore, Plan). */
const GATED_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit|Bash|Agent)$/

export function registerSession(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { decisionLog, flushDecisions, delegationItems, expectedMain, isRouterPaused, noteRouter, noteRouterTime, ranText, record, resetLocal, routerFallback, skipPhrases, trackDelegations, wantedPick } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ---------------------------------------------------------------- phiên

  on('session.start', async ($, e, next) => {
    // Nhật ký lỗi của mod (0.7.9 L1): tự xóa lỗi đã sửa theo sổ, báo trạng thái sai kiểu, gộp lỗi đang chờ ghi.
    noteMistyped('normalizeCore', await read($, coreState), S.EMPTY_CORE)
    noteMistyped('normalizeQuota', await read($, quotaState), EMPTY_QUOTA)
    await ctx.openErrors({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), root: () => $.session.root() })
    // Log quyết định nối tiếp file cũ (giữ DECISION_LIMIT dòng cuối); file chưa có hoặc đọc lỗi thì bắt đầu mới.
    if (decisionLog) {
      const old = await $.fs.read(decisionLog).catch(caught('fs.read', ''))
      L.decisions = typeof old === 'string' ? keptLines(old) : []
    }
    // Phiên không tương tác (0.8.0 A13): claude -p hay SDK, isInteractive false (SessionStartInput). headlessRouting off (mặc định) thì mod chạy
    // như routing off trong phiên đó, không ghi đè mode người dùng đã đặt; ghi một dòng headless-off. Mở lại tương tác thì trả mode về cấu hình.
    if (e.isInteractive === false && ctx.options['headlessRouting'] !== 'auto') {
      if ((await read($, modeState)) === null) {
        await update($, modeState, () => 'off')
        await update($, headlessState, () => true)
        record(await $.clock.now(), 'headless-off', {})
        await flushDecisions((path, text) => $.fs.write(path, text))
      }
    } else if (e.isInteractive !== false && (await read($, headlessState))) {
      await update($, modeState, () => null)
      await update($, headlessState, () => false)
    }
    await $.tool.register(PLAN_TOOL_SPEC)
    await $.command.register({
      name: 'conductor',
      description: 'Focus Conductor: mục tiêu, checklist và điều phối model/effort/agent',
      argumentHint: '[status | mode auto|subagents|suggest|off | goal <mô tả> | reroute | reset | pause | resume [force|discard] | approve | errors [clear]]',
    })
    // Bảo vệ hạn mức: nạp điểm dừng còn mở của thư mục này (phiên mới hay resume). Bản resuming của phiên trước (chết
    // giữa chừng) quay về open. Chỉ khi chưa có mục tiêu thì khôi phục mục tiêu và checklist; không tự gửi prompt nào.
    if (quotaSettings(ctx.options).enabled && (await read($, mode)) !== 'off') {
      const dir = await checkpointDir($, e.cwd)
      const raw = (await $.store.get(storeKey(dir)).catch(caught('store.get', undefined))) as QuotaCheckpoint | undefined
      if (raw !== undefined && raw !== null && raw.version === 1 && raw.cwd === dir && raw.status !== 'consumed') {
        const cp: QuotaCheckpoint = { ...raw, status: 'open' }
        if (raw.status !== 'open') await $.store.set(storeKey(dir), cp).catch(caught('store.set', undefined))
        await update($, quotaState, q => ({ ...normalizeQuota(q), checkpoint: cp, resume: null }))
        const core = S.normalizeCore(await read($, coreState))
        if (core.brief === null) {
          const now = await $.clock.now()
          const outcome = S.restoreArchived({ ...core, archived: [{ brief: briefFromCheckpoint(cp, now), plan: cp.plan }, ...core.archived] }, 1)
          if (!('error' in outcome)) {
            await update($, coreState, () => outcome.core)
            const restored = outcome.restored.brief
            trackDelegations(restored.goalId, restored.tasks)
            for (const item of cp.delegations) if (item.state === 'done') ctx.moveDelegation(restored.goalId, item.index, 'done')
            await update($, coreState, S.withDelegations(restored.goalId, delegationItems(restored)))
            $.ui.toast(`Có điểm dừng chưa tiếp tục (tạo lúc ${resetLabel(new Date(cp.createdAt).toISOString()) || 'không rõ giờ'}); gõ prompt để Claude tiếp tục từ đó`)
          }
        }
      }
    }
    await showStatus($, await read($, view), ctx.options)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await ctx.flushErrors({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), root: () => $.session.root() })
    if (e.reason === 'clear') {
      resetLocal()
      // /clear không phát session.start (0.7.5): điểm dừng đang mở không tự chèn ở prompt kế tiếp, chỉ gợi ý /conductor resume.
      const q = normalizeQuota(await read($, quotaState))
      L.noAutoResume = q.checkpoint?.status === 'open'
      await update($, coreState, S.resetCore)
      await showStatus($, await read($, view), ctx.options)
    }
    return next(e)
  })

  // Mục system prompt cố định: không đổi giữa các turn nên không phá cache.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, mode)) === 'off') return result
    return {
      sections: [...result.sections, { id: 'focus-conductor:discipline', text: DISCIPLINE, scope: 'session' as const }],
    }
  })

  // ------------------------------------------------- 1. đọc kỹ prompt

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text === '' || SLASH_COMMAND.test(text) || !PERSON_ORIGINS.has(e.origin.kind)) return next(e)
    const current = await read($, mode)
    if (current === 'off') return next(e)
    const isApplied = current === 'auto'

    // Bảo vệ hạn mức: đang dừng thì không gọi router (mỗi lượt router tốn thêm hạn mức đúng lúc hạn mức cạn);
    // prompt đi thẳng, kèm một dòng báo trạng thái.
    const quota = quotaSettings(ctx.options)
    // Điểm dừng mở chỉ được tiếp tục khi prompt là tiếp nối (router xếp continue, refine, dissatisfied; câu routerSkip;
    // hoặc người dùng vừa gõ /conductor resume). Prompt việc khác giữ điểm dừng open và chỉ nhắc một dòng.
    let openCp: QuotaCheckpoint | null = null
    let isArmed = false
    // Vùng báo hạn mức mềm lúc prompt đến (0.7.9 F1): prompt này không dặn tách việc thành phiên con.
    let isSoftZone = false
    if (quota.enabled) {
      const now = await $.clock.now()
      const limits = await quotaLimits($)
      const evaluation = evaluateQuota(limits, now, quota)
      isSoftZone = softNotices(limits, now, quota).length > 0
      const q = normalizeQuota(await read($, quotaState))
      if (isPauseActive(true, evaluation.hits, q.pause, overrideOf(q), now)) {
        // Lần dừng (nếu mới vào vùng dừng) đã được ghi kèm điểm dừng ở hook prompt.submit của parts/quota.ts.
        const reasons = q.pause?.reason.length ? q.pause.reason : reasonsOf(blockingHits(evaluation.hits, overrideOf(q), now))
        const isUser = q.pause?.source === 'user'
        $.ui.toast(`Focus Conductor: ${isUser ? 'đang tạm dừng theo lệnh' : 'đang tạm dừng vì hạn mức'}; dùng ${resumeCommand(isUser)} để chạy tiếp ngay`)
        return next({ ...e, context: [quotaPausedContext(reasons, isUser), ...(e.context ?? [])] })
      }
      // Không còn ở vùng dừng (đã làm mới hay người dùng ép) mà có điểm dừng mở: chuyển sang resuming, so file với lúc
      // dừng, rồi chèn một khối ĐIỂM DỪNG đặt trước mọi context khác. Điểm dừng chỉ thành consumed khi turn này xong.
      // Dừng do hạn mức đã hết hiệu lực (làm mới hay ép tiếp): bỏ lần dừng cũ, như tool.call sẽ làm.
      if (q.pause !== null || q.resumeArmed) await update($, quotaState, c => ({ ...normalizeQuota(c), pause: null, resumeArmed: false }))
      if (q.checkpoint !== null && q.checkpoint.status === 'open') {
        openCp = q.checkpoint
        isArmed = q.resumeArmed
      }
    }
    // Tiếp tục: chuyển sang resuming, so file với lúc dừng, trả khối ĐIỂM DỪNG đặt trước mọi context khác. Điểm dừng
    // chỉ thành consumed khi turn này xong bằng câu trả lời.
    const startResume = async (): Promise<string[]> => {
      if (openCp === null) return []
      const stats = await currentStats($, openCp.files.map(f => f.path))
      const cp: QuotaCheckpoint = { ...openCp, status: 'resuming' }
      await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp, resume: { id: cp.id, turnId: '' } }))
      await $.store.set(storeKey(cp.cwd), cp).catch(caught('store.set', undefined))
      // Luồng chính điều phối mục tiêu được tiếp tục (0.8.4 V1): kèm câu nhắc lại vai điều phối.
      const now = S.normalizeCore(await read($, coreState))
      const keepRole = isMainConducting(ctx.conductorInputs(now, current, (await read($, headlessState)) === true), now.brief)
      return [resumeContext(cp, changedFiles(cp.files, stats)), ...(keepRole ? [conductorKeepText(ctx.activeConductorOf(now, current, (await read($, headlessState)) === true)?.family)] : [])]
    }
    const pending = openCp !== null ? [resumePendingContext(openCp, L.noAutoResume && !isArmed)] : []

    const arrived = S.normalizeCore(await read($, coreState))
    // Một prompt đi qua trong lúc router Fable tạm ngừng (0.8.4 C6); lượt này vẫn đọc theo trạng thái lúc prompt đến. Cờ của prompt nằm trong
    // Core.fable.promptPaused (0.8.5 K10), ghi cùng lượt giảm số prompt còn tạm ngừng; mọi quyết định điều phối phía sau của prompt này đọc
    // cùng một bản `before` đã mang cờ, kể cả noteConductor (0.8.4 W4: nhật ký không đọc cờ của prompt trước).
    const isPromptPaused = arrived.fable.pauseLeft > 0
    await update($, coreState, S.withFable(f => ({ promptPaused: f.pauseLeft > 0, pauseLeft: Math.max(0, f.pauseLeft - 1) })))
    // Router họ dự phòng tạm ngừng (0.8.7 F1): cùng luật đếm prompt như router Fable.
    const isFallbackPaused = arrived.fallback.pauseLeft > 0
    await update($, coreState, S.withFallback(f => ({ promptPaused: f.pauseLeft > 0, pauseLeft: Math.max(0, f.pauseLeft - 1) })))
    const before: Core = { ...arrived, fable: { ...arrived.fable, promptPaused: isPromptPaused }, fallback: { ...arrived.fallback, promptPaused: isFallbackPaused } }
    // Fable điều phối (0.8.4 C1): ghi một dòng nhật ký mỗi khi trạng thái điều phối đổi (bật, tắt kèm nguyên nhân).
    await noteConductor($, ctx, before, current)
    const prev = before.brief
    // routerSkip (người dùng tự bật): câu ngắn đúng nguyên văn trong danh sách thì là tiếp nối, không hỏi router.
    if (prev !== null && isSkippable(text, skipPhrases)) {
      const at = await $.clock.now()
      record(at, 'skip', { prompt: text, goalId: prev.goalId })
      // Câu tiếp nối ngắn: turn này làm tiếp mục tiêu đang mở.
      L.promptIntent = { relation: 'continue', kind: prev.isReference ? 'answer' : prev.kind }
      await flushDecisions((path, text) => $.fs.write(path, text))
      const lead = L.noAutoResume && !isArmed ? [] : await startResume()
      // Quay lại mục tiêu đã cất (0.8.5 K7): cùng luật với nhánh có router (S.resumeTarget), trên Core đọc ngay lúc này; không gọi router,
      // không cộng chi phí router. Tin chạy tiếp điểm dừng đang mở giữ ưu tiên.
      const skipCore = S.normalizeCore(await read($, coreState))
      const skipBack = lead.length === 0 ? S.resumeTarget(skipCore) : null
      const skipFrom = skipBack !== null ? skipCore.archived[skipBack - 1] : undefined
      const skipped = skipBack !== null ? ctx.restoreGoal(skipCore, skipBack) : null
      if (skipped !== null && !('error' in skipped) && skipFrom !== undefined) {
        await update($, coreState, () => skipped.core)
        const restored = skipped.brief
        L.promptIntent = { relation: 'continue', kind: restored.kind }
        L.lastPrompt = { text, prev: restored, goalId: restored.goalId }
        record(at, 'restore', { prompt: clipText(text), goalId: restored.goalId, from: skipFrom.brief.goalId, cause: 'resume' })
        await flushDecisions((path, text) => $.fs.write(path, text))
        await showStatus($, await read($, view), ctx.options)
        const core = S.normalizeCore(await read($, coreState))
        const wanted = wantedPick(restored, core.lift, core, current)
        const conductNote = e.turnId === undefined && wanted?.isConducting === true && !isBriefedFor(core, restored.goalId, wanted.family) ? [conductorContext(wanted.family)] : []
        if (conductNote.length > 0 && wanted !== null) await update($, coreState, markBriefed(restored.goalId, wanted.family))
        const backLine = core.plan.length === 0 ? restoreGoalOnlyContext(restored.goal) : restoreResumeContext(restored.goal, openSteps(core.plan)[0])
        const backPlanning = S.approvalOf(core).status === 'planning' ? [planningContext()] : []
        return next({ ...e, context: [...(e.context ?? []), backLine, ...conductNote, ...backPlanning, ...pending] })
      }
      // Kế hoạch đang lập (0.8.2 N2): câu tiếp nối ngắn vẫn kèm đoạn dặn lập kế hoạch. Câu tiếp nối ngắn không phải câu trả lời câu hỏi
      // làm rõ: cờ chờ câu trả lời giữ nguyên (0.8.5 K1).
      const planning = S.approvalOf(before).status === 'planning' ? [planningContext()] : []
      return next({ ...e, context: [...lead, ...(e.context ?? []), skippedContext(prev, before.plan), ...planning, ...(lead.length === 0 ? pending : [])] })
    }

    // Tin chen ngang (0.7.8 G9): người dùng gửi khi luồng chính đang chạy (engine kèm turnId của turn đó) và đã có mục tiêu. Router đọc
    // như prompt tiếp nối; không cất checklist, không đặt lại theo dõi giao việc. Chỉ dựa vào turnId của prompt.submit nên hot reload giữa turn không làm mất khả năng nhận diện.
    const isInterject = e.turnId !== undefined && prev !== null
    L.promptCount += 1
    // Model của phiên chưa biết (prompt đầu, trước step đầu): hỏi engine, để router và chính sách phiên dùng được ngay.
    if (L.sessionFamily === null) L.sessionFamily = familyOf(await $.session.model().catch(caught('session.model', '')))
    // Số phần tối đa của việc tách (0.7.9 F1) theo option và theo việc engine đã từ chối phiên con hay chưa.
    const basePolicy = ctx.routePolicy(before, ctx.maxForks >= 2 ? await $.session.root().catch(caught('session.root', null)) : null)
    // Fable điều phối (0.8.4 C4): điều phối khả dụng thì router dùng biến thể điều phối và parseRoute kẹp việc sửa file của việc lớn.
    const rules = ctx.conductorState(before, current, (await read($, headlessState)) === true) === null ? { ...basePolicy, conductor: true, goalIsBig: isBigGoal(before.brief) } : basePolicy
    // Model của lượt router (0.8.4 C2): Fable khi sẵn sàng, không thì option router. Tạm ngừng router cũ chỉ áp khi không gọi Fable (C6).
    const target = ctx.routerTarget(before, current, (await read($, headlessState)) === true)
    const isPaused = !target.isFable && isRouterPaused()
    // Duyệt kế hoạch (0.8.2 N2): kế hoạch đã trình thì router biết tin này có thể là lời duyệt; vừa dặn hỏi làm rõ thì tin này là câu trả lời.
    const approvalStored = S.approvalOf(before)
    const isPresented = prev !== null && approvalStored.status === 'presented'
    const isAnswering = prev !== null && approvalStored.awaitingAnswer
    let outcome: RouterOutcome<RouterPlan> = { result: null, reason: 'router đang tạm ngừng sau các lần lỗi liên tiếp', usages: [], usageModels: [], retried: false, failure: 'paused', timeoutMs: null, maxTokens: null, outputTokens: null }
    let waitedMs = 0
    let pauseText: string | null = null
    let apiFamily: ModelFamily | null = null
    let apiModel: string | null = null
    // Lượt đọc của đích router (0.8.7 L3): mọi model đọc trọn prompt tới sức chứa của lượt đó.
    const reading = ctx.routerReading(target)
    let promptRead: ReadPlan = requestPlan({ text, prev, ran: ranText(before), policy: rules, model: target.model, reading, ...(target.isFable ? { isFable: true } : {}) })
    if (!isPaused) {
      const observed = L.observed.join('; ')
      L.observed = []
      const args = { text, prev, ran: ranText(before), policy: rules, model: target.model, reading, ...(target.isFable ? { isFable: true } : {}), sessionFamily: L.sessionFamily, openSteps: openSteps(before.plan).map(s => s.title), ...(observed ? { observed } : {}), ...(isInterject ? { interject: { step: openSteps(before.plan)[0]?.title ?? '' } } : {}), ...(isPresented ? { awaiting: 'approval' as const } : isAnswering ? { awaiting: 'answer' as const } : {}) }
      promptRead = requestPlan(args)
      // Lượt đọc trọn prompt dài (0.8.7 L3) có thể mất vài phút, nên chữ chờ nói rõ.
      $.ui.status(promptRead.isFull ? 'router đang đọc trọn prompt dài, có thể mất vài phút...' : 'router đang đọc prompt...')
      const request = routerRequest(args)
      // Lượt đọc trọn hết giờ hay bị API từ chối thì thử lại bằng request cắt theo trần cũ, với trọn FALLBACK_TIMEOUT_MS (0.8.7 L3).
      const fallback = promptRead.isFull ? { ...routerRequest({ ...args, reading: { ...reading, window: 0 } }), timeoutMs: FALLBACK_TIMEOUT_MS } : undefined
      const full = promptRead.isFull ? { tokenCap: fullRetryTokens(promptRead.maxTokens, readParamsOf(reading.family)) } : undefined
      // Lượt đọc của Fable bị API từ chối (0.8.7 F1): cùng request trọn gửi họ dự phòng, với thời gian chờ và maxTokens theo thông số của họ đó.
      const backup = target.family === ctx.conductorFamily ? ctx.fallbackTarget(before, current, (await read($, headlessState)) === true) : null
      apiFamily = backup?.family ?? null
      apiModel = backup?.model ?? null
      const apiFallback = backup !== null ? routerRequest({ ...args, model: backup.model, reading: ctx.routerReading(backup) }) : undefined
      const startedAt = await $.clock.now()
      outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules), needsCoverageRecheck, { retryMissingConfidence: true, ...(target.isFable ? { isFable: true } : {}), ...(fallback !== undefined ? { fallback } : {}), ...(full !== undefined ? { full } : {}), ...(apiFallback !== undefined ? { apiFallback } : {}) })
      ctx.noteRouterFailure('prompt', outcome.failure)
      waitedMs = (await $.clock.now()) - startedAt
      noteRouterTime(waitedMs)
      // Lỗi của router Fable có bộ đếm riêng trong Core (0.8.4 C6), không cộng vào bộ đếm tạm ngừng router cũ.
      if (outcome.viaFallback === true && apiFamily !== null) {
        await noteFableRouter($, ctx, false)
        await noteFableRouter($, ctx, outcome.result !== null, apiFamily)
      } else if (target.isFable) await noteFableRouter($, ctx, outcome.result !== null, target.family)
      else pauseText = noteRouter(outcome.result !== null)
    }
    // Chi phí router (0.8.7 F1; 0.8.9 U2): mỗi usage tính theo giá của họ model đã nhận lời gọi đó; lời gọi bị engine từ chối không có usage.
    const familyOfCall = (model: string | undefined): ModelFamily => (apiFamily !== null && model !== undefined && model === apiModel ? apiFamily : target.family)
    const charge = (c: Core): Core => outcome.usages.reduce((acc, usage, i) => S.withAnalyzerUsage([usage], familyOfCall(outcome.usageModels[i]))(acc), c)
    // Tiếp tục điểm dừng khi router xếp tiếp nối, hoặc khi người dùng vừa gõ /conductor resume (khi đó router xếp mục
    // tiêu mới thì vẫn giữ mục tiêu đã khôi phục).
    // Tin hỏi tiến độ (0.8.2 N1) không tiếp tục điểm dừng: chỉ báo cáo.
    const isResuming = openCp !== null && (isArmed || (!L.noAutoResume && outcome.result !== null && outcome.result.relation !== 'new' && outcome.result.intent !== 'status'))
    if (isArmed) L.noAutoResume = false
    const routed = outcome.result !== null && isResuming && isArmed && prev !== null && outcome.result.relation === 'new' ? { ...outcome.result, relation: 'continue' as const } : outcome.result
    // Tin chen ngang router xếp mục tiêu mới: không đổi mục tiêu, việc và ràng buộc vào như prompt tiếp nối (0.7.8 G9). Bản này chỉ dùng
    // cho intent và câu trả lời câu hỏi làm rõ (công thức như trước 0.8.4 A1); bản cuối `interjected` để tin ngoài lề đứng ngoài.
    const interjectedBase = isInterject && routed !== null && routed.relation === 'new' ? { ...routed, relation: 'continue' as const } : routed
    // Ý của tin nhắn (0.8.2 N1): chỉ có nghĩa khi đã có mục tiêu; approve khi không có kế hoạch chờ duyệt là resume.
    let intent = interjectedBase !== null && prev !== null ? clampIntent(interjectedBase.intent, isPresented) : 'task'
    // Câu trả lời câu hỏi làm rõ (0.8.2 N2), chạy sau bước kẹp intent và thắng nó: router xếp mục tiêu mới thì giữ mục tiêu, coi như amend,
    // trừ khi router chắc (confidence từ NEW_GOAL_CONFIDENCE, thiếu là chưa chắc) VÀ prompt không nhắc gì tới mục tiêu (answerMentionsGoal).
    const isHeldAnswer = isAnswering && prev !== null && interjectedBase !== null && interjectedBase.relation === 'new' && !((interjectedBase.confidence ?? 0) >= NEW_GOAL_CONFIDENCE && !answerMentionsGoal(text, prev))
    // Tin ngoài lề (0.8.4 A1): xét trên kế hoạch router trả, trước khi tin chen ngang bị đổi thành tiếp nối; câu trả lời câu hỏi làm rõ thắng.
    const isAsideMsg = routed !== null && prev !== null && !isHeldAnswer && isAside(routed, prev, { open: openSteps(before.plan).length, total: before.plan.length, approval: approvalStored.status, turnsDone: S.turnsOf(before).done })
    const interjected = isInterject && routed !== null && routed.relation === 'new' && !isAsideMsg ? { ...routed, relation: 'continue' as const } : routed
    // Câu trả lời đến rồi: hết chờ câu trả lời (0.8.3 R3: cờ nằm trong Core). Tin ngoài lề (0.8.4 A1), tin hỏi tiến độ và tin bảo chạy tiếp
    // (0.8.5 K1, intent sau bước kẹp) không phải câu trả lời nên không xóa cờ; router lỗi thì intent là task và cờ được xóa như cũ.
    const isKeptAwaiting = isAsideMsg || intent === 'status' || intent === 'resume'
    const approvalBefore = isKeptAwaiting ? approvalStored : await clearAwaiting($, approvalStored)
    const steered = isHeldAnswer && interjected !== null ? { ...interjected, relation: 'continue' as const, intent: 'amend' as const } : interjected
    if (isHeldAnswer && prev !== null) {
      intent = 'amend'
      record(await $.clock.now(), 'answer-held', { prompt: clipText(text), confidence: interjected?.confidence ?? null, goalId: prev.goalId })
    }
    L.lastIntent = steered !== null ? intent : null
    // Tin bảo chạy tiếp hay duyệt kế hoạch: không thêm việc, không gộp yêu cầu.
    const plan = steered !== null && (intent === 'resume' || intent === 'approve') ? { ...steered, tasks: [], requirements: [] } : steered
    const lead = isResuming ? await startResume() : []
    const tail = isResuming ? [] : pending
    const now = await $.clock.now()
    // Tin bảo chạy tiếp sau một việc chen vào (0.8.4 A2): mục tiêu đã cất nào được quay lại do S.resumeTarget quyết; khôi phục bằng cùng
    // đường với plan action restore. Tin chạy tiếp điểm dừng giữ ưu tiên.
    const isResumeMsg = plan !== null && prev !== null && intent === 'resume' && !isResuming
    const backIndex = isResumeMsg ? S.resumeTarget(before) : null
    const lastArchived = backIndex !== null ? before.archived[backIndex - 1] : undefined
    if (backIndex !== null && plan !== null && prev !== null && lastArchived !== undefined) {
      // Khôi phục trên Core đọc ngay lúc này, không trên before (0.8.4 Z1): các lần ghi Core trước đó của prompt này (lượt Fable đạt
      // đưa bộ đếm lỗi về 0, giảm số prompt còn tạm ngừng, hết chờ câu trả lời) không bị ghi đè.
      const back = ctx.restoreGoal(S.normalizeCore(await read($, coreState)), backIndex)
      if (!('error' in back)) {
        await update($, coreState, () => S.withRouterFail(null)(charge(back.core)))
        const restored = back.brief
        L.promptIntent = { relation: 'continue', kind: restored.kind }
        // Brief trước prompt là brief vừa khôi phục (0.8.5 K6): /conductor reroute đọc lại prompt này trên mục tiêu đã khôi phục.
        L.lastPrompt = { text, prev: restored, goalId: restored.goalId }
        record(now, 'restore', { prompt: clipText(text), goalId: restored.goalId, from: lastArchived.brief.goalId, cause: 'resume' })
        await flushDecisions((path, text) => $.fs.write(path, text))
        await showStatus($, await read($, view), ctx.options)
        // Mục tiêu khôi phục là mục tiêu lớn: đoạn dặn điều phối theo khóa Core.fable.briefedGoal như mọi mục tiêu (0.8.4 V1). Tin chen ngang
        // (0.8.5 K4): turn đang chạy giữ model của nó, nên không dặn và không ghi khóa; prompt kế tiếp ngoài turn dặn theo cơ chế chung.
        const core = S.normalizeCore(await read($, coreState))
        const wanted = wantedPick(restored, core.lift, core, current)
        const conductNote = !isInterject && wanted?.isConducting === true && !isBriefedFor(core, restored.goalId, wanted.family) ? [conductorContext(wanted.family)] : []
        if (conductNote.length > 0 && wanted !== null) await update($, coreState, markBriefed(restored.goalId, wanted.family))
        // Mục tiêu đã cất chưa có checklist (0.8.5 K2): một dòng riêng; đang lập kế hoạch thì kèm đoạn dặn như mọi mục tiêu planning.
        const backLine = core.plan.length === 0 ? restoreGoalOnlyContext(restored.goal) : restoreResumeContext(restored.goal, openSteps(core.plan)[0])
        const backPlanning = S.approvalOf(core).status === 'planning' ? [planningContext()] : []
        return next({ ...e, context: [...lead, ...(e.context ?? []), backLine, ...conductNote, ...backPlanning, ...tail] })
      }
    }
    // Tin hỏi tiến độ (0.8.2 N1): không đổi brief, checklist, việc, yêu cầu hay ràng buộc; chỉ cộng chi phí router. Tin gửi khi không có
    // turn đang chạy thì turn đó là hỏi đáp (không qua các cổng Stop); tin chen ngang không đổi trạng thái thực thi của turn đang chạy.
    if (plan !== null && prev !== null && intent === 'status') {
      if (!isInterject) L.promptIntent = { relation: 'continue', kind: 'answer' }
      await update($, coreState, c => S.withRouterFail(null)(charge(c)))
      L.lastPrompt = { text, prev, goalId: prev.goalId }
      record(now, 'route', { prompt: clipText(text), relation: plan.relation, intent, confidence: plan.confidence, retried: outcome.retried, ...(outcome.firstFail !== undefined ? { firstFail: outcome.firstFail } : {}), goalId: prev.goalId })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      return next({ ...e, context: [...lead, ...(e.context ?? []), intentStatusContext(isInterject), ...tail] })
    }
    // Tin ngoài lề (0.8.4 A1): như tin hỏi tiến độ, không đổi brief, checklist, việc, yêu cầu, ràng buộc, trạng thái duyệt hay mục tiêu đã
    // cất; không mở đợt mới. Ngoài turn thì turn đó là hỏi đáp; tin chen ngang không đổi trạng thái thực thi của turn đang chạy.
    if (isAsideMsg && plan !== null && prev !== null) {
      if (!isInterject) L.promptIntent = { relation: 'continue', kind: 'answer' }
      await update($, coreState, c => S.withRouterFail(null)(charge(c)))
      L.lastPrompt = { text, prev, goalId: prev.goalId }
      record(now, 'route', { prompt: clipText(text), relation: plan.relation, intent: 'aside', confidence: plan.confidence, retried: outcome.retried, ...(outcome.firstFail !== undefined ? { firstFail: outcome.firstFail } : {}), goalId: prev.goalId })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      return next({ ...e, context: [...lead, ...(e.context ?? []), asideContext(isInterject, openSteps(before.plan)[0]), ...tail] })
    }
    // Router không đọc được thì không biết turn là hỏi đáp hay làm tiếp: Stop chỉ dựa vào hành vi tool.
    L.promptIntent = plan !== null ? { relation: plan.relation, kind: plan.isReference && !plan.runReference ? 'answer' : plan.kind } : null
    const withUsage = (c: Core): Core =>
      charge(c)

    if (plan === null) {
      // Mặc định không đoán: giữ mục tiêu, việc đã phân, phạm vi, ràng buộc và checklist; chỉ bỏ lựa chọn model
      // luồng chính. routerFallback "reuse" (người dùng tự bật) giữ cả lựa chọn của prompt trước.
      const isReuse = routerFallback === 'reuse' && prev !== null && prev.main !== null
      const kept: Brief | null = prev ? { ...prev, ...(isReuse ? {} : { main: null }), at: now } : null
      // Prompt tiếp nối (0.7.5): phân việc đã có và trạng thái giao của từng việc vẫn giữ; chỉ bỏ lựa chọn luồng chính.
      if (!isReuse && prev === null) L.delegation = newDelegation()
      const failText = isReuse
        ? `Router (${target.model}) không đọc được prompt (${outcome.reason}); dùng lại lựa chọn của prompt trước`
        : `Router (${target.model}) không đọc được prompt (${outcome.reason}); turn này chạy theo model của phiên`
      const warnings: Warning[] = [
        ...(isPaused ? [] : [{ at: now, kind: 'model' as const, text: failText }]),
        ...(pauseText ? [{ at: now, kind: 'model' as const, text: pauseText }] : []),
      ]
      // Route lưu về null (trừ khi dùng lại): mốc cache là model engine thật sự chạy, không phải route của lượt trước.
      const fail = routerFailOf(outcome, now, waitedMs)
      // Chưa có mục tiêu nào: lập mục tiêu tối thiểu từ prompt (0.7.2), để band, pane, phản chiếu, verified và giám sát vẫn chạy;
      // lần router đọc được tiếp theo (prompt kế hay /conductor reroute) nâng cấp nó mà giữ goalId.
      const bare: Brief | null = prev === null ? { ...bareBrief(text, Math.max(0, before.ledger.goal.goalId, ...before.archived.map(a => a.brief.goalId)) + 1, now), isBare: true } : null
      await update($, coreState, c => {
        const used = S.withRouterFail(fail)(withUsage(bare ? S.adoptGoal(bare)(c) : c))
        const withKept = kept ? S.withBrief(kept)(used) : used
        const withNotes = S.withWarnings(...warnings)(isReuse ? withKept : S.withRoute(null)(withKept))
        return isReuse || prev !== null ? withNotes : S.withDelegations(bare?.goalId ?? -1, [])(withNotes)
      })
      if (bare) {
        L.goalPrompt = { text, prev, goalId: bare.goalId }
        L.isGoalNew = true
        L.pinnedGoalId = null
        trackDelegations(bare.goalId, [])
        await update($, bandHiddenState, () => false)
        await autoOpenPane($, ctx, bare.goalId, now, null)
      }
      L.lastPrompt = { text, prev, goalId: bare?.goalId ?? kept?.goalId ?? null }
      record(now, 'router-fail', { prompt: clipText(text), reason: outcome.reason, retried: outcome.retried, reuse: isReuse, ...failFields(fail) })
      await flushDecisions((path, text) => $.fs.write(path, text))
      if (!isPaused) $.ui.toast(pauseText ?? failText)
      await showStatus($, await read($, view), ctx.options)
      // Router lỗi khi chen ngang (0.7.8 G9): mục tiêu, phân việc và checklist đã giữ; vẫn dặn thêm bước cho yêu cầu mới.
      const unrouted = isInterject && prev !== null
        ? interjectContext(prev, before.plan, [], [], { main: 'model đang chạy', mayReplace: true, isRouted: false })
        : unroutedContext(outcome.reason, bare !== null, prev !== null && prev.tasks.length > 0)
      // Router lỗi khi kế hoạch đang lập (0.8.2 N2): trạng thái giữ nguyên, vẫn dặn lập kế hoạch.
      const planning = prev !== null && approvalBefore.status === 'planning' ? [planningContext()] : []
      return next({ ...e, context: [...lead, ...(e.context ?? []), unrouted, ...planning, ...tail] })
    }

    // Mục tiêu mới, chạy thật prompt đã đối chiếu, hoặc tiếp nối cùng mục tiêu.
    // Việc đã xong theo checklist hiện tại (0.8.0 A3): có bước riêng và các bước đó đã đóng hết; được cất khi prompt này mở đợt mới. Việc chưa
    // có bước riêng không tính là xong chỉ vì checklist đóng hết (checklist đó có thể là của đợt trước).
    const doneTasks = new Set(taskRows(before, now).filter(row => row.index !== undefined && row.kind !== 'main' && row.state === 'done' && row.bar.kind === 'steps').map(row => row.index as number))
    const { brief, added, isNewGoal, replaced, held, dropped, phase } = nextBrief(prev, plan, text, now, { openSteps: openSteps(before.plan).map(s => s.title), sessionFamily: L.sessionFamily, doneTasks, isPending: S.pendingOf(before) })
    // Router xếp mục tiêu mới với tin cậy thấp khi checklist còn bước mở (0.7.5): giữ mục tiêu, ghi nhật ký quyết định.
    if (held && prev !== null) {
      L.promptIntent = { relation: 'continue', kind: plan.kind }
      record(now, 'new-held', { prompt: clipText(text), confidence: plan.confidence, goalId: prev.goalId })
    }
    // Đợt mới (0.8.0 A3): nhật ký phase, khóa Y6 tính theo đợt, một câu báo chèn một lần.
    const phaseNote = phase !== undefined ? phaseNotice(phase.number, phase.added, phase.tasks) : null
    if (phase !== undefined) {
      record(now, 'phase', { phase: phase.number, tasks: phase.tasks, items: phase.items, cause: 'prompt' })
      await update($, coreState, S.withNoCheckNudged(-1))
    }
    // adoptGoal lưu checklist cũ còn bước mở (khôi phục được bằng plan restore); chi phí router cộng sau, thuộc mục tiêu mới.
    const core = await update($, coreState, c => S.withRouterFail(null)(withUsage(isNewGoal ? S.adoptGoal(brief)(c) : S.withDecision(brief)(c))))
    L.lastPrompt = { text, prev, goalId: brief.goalId }
    // Ràng buộc hay yêu cầu đã đầy trần (0.7.5): mục mới thay mục ở cuối danh sách (ít quan trọng nhất) không phải quy định model, không
    // bao giờ thay mục của prompt lập mục tiêu (vòng sửa 2, M3); báo một cảnh báo.
    if (replaced.length > 0) {
      const text = `Ràng buộc và yêu cầu của mục tiêu đã đầy; mục mới thay ${replaced.length} mục cũ: ${replaced.map(item => clipText(item, 60)).join('; ')}`
      await update($, coreState, S.withWarnings({ at: now, kind: 'model', text }))
      noteBehavior('replaced', `mục mới thay ${replaced.length} mục cũ vì ràng buộc và yêu cầu đã đầy`)
    }
    // Phần tràn cũng đầy (vòng rà soát 3): mục của prompt tiếp nối không giữ được thì báo số mục, không bỏ im lặng.
    // Kind riêng (S8): chip của pane ghi "mục bị bỏ", không phải "model".
    if (dropped > 0) {
      await update($, coreState, S.withWarnings({ at: now, kind: 'dropped', text: droppedItemsText(dropped) }))
      noteBehavior('dropped', `${dropped} mục của prompt tiếp nối không giữ được vì ràng buộc và yêu cầu đã đầy`)
    }
    // Prompt dài hơn trần của router (0.7.8 G8): phần giữa bị lược, báo một cảnh báo và một dòng context cho prompt đó.
    // Sức chứa của lượt đã đọc prompt này (0.8.7 L3); kết quả của lượt dự phòng là bản cắt theo trần cũ.
    const isFellBack = outcome.fellBack === true
    const isClipped = isFellBack ? isClippedPrompt(text) : isClippedPrompt(text, promptRead.capacity)
    const clipInfo = isFellBack ? { family: reading.family, head: 60_000, tail: 20_000, limit: 'fallback' as const } : { family: reading.family, head: promptRead.head, tail: promptRead.tail, limit: promptRead.limit }
    if (isClipped) await update($, coreState, S.withWarnings({ at: now, kind: 'model', text: clippedWarning(text.length, clipInfo) }))
    if (isNewGoal) {
      L.goalPrompt = { text, prev, goalId: brief.goalId }
      L.isGoalNew = true
      L.pinnedGoalId = null
      // Ẩn band (nút Ẩn) chỉ có tác dụng trong mục tiêu đang làm: mục tiêu mới thì band hiện lại (0.6.1).
      await update($, bandHiddenState, () => false)
      await autoOpenPane($, ctx, brief.goalId, now, brief.depth)
    }

    // Phiên con đang tắt (option forks, maxForks 0, engine từ chối): router vẫn ghi split thì bỏ, ghi fork-off một lần mỗi phiên (0.7.9 F1).
    if ((plan.droppedSplits ?? 0) > 0 && core.forks.off === 'none') {
      record(now, 'fork-off', { reason: ctx.maxForks < 2 ? 'option' : 'engine', dropped: plan.droppedSplits })
      await update($, coreState, S.withForkOffLogged)
    }
    // Không dặn tách (0.7.9 F1) khi đã vào vùng báo hạn mức mềm, hay còn lệnh kiểm chưa đạt ở lượt 2 hay 3 (W4 cần model cao hơn mà phiên
    // con luôn chạy model của luồng chính).
    const isSplitHeld = isSoftZone || (core.retry.goalId === brief.goalId && core.retry.items.some(item => !item.exhausted && item.round >= 2 && !S.isWaived(core, item.sig)))
    const wanted = wantedPick(brief, core.lift, core, current)
    // Model sẽ thật sự chạy (có thể là model cũ được giữ để bảo toàn cache): việc "làm trực tiếp" so với model này.
    const expected = wanted !== null && isNewGoal ? expectedMain(core, brief, wanted, now) : wanted
    if (isNewGoal) trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
    else if (!brief.isReference) trackDelegations(brief.goalId, added, true)
    await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
    const newConstraints = plan.constraints.filter(c => !prev?.constraints.includes(c))
    // Luồng chính đang chạy (0.7.8 G9): route đã chốt ở step đầu của turn đó; turn không có route thì là model của phiên.
    const running = isInterject && L.turnRoute.turnId === e.turnId ? L.turnRoute.route : null
    // Tin chen ngang: việc run: main cần họ hay effort cao hơn luồng chính đang chạy chờ engine báo tin được chèn vào turn đang chạy thì
    // mới chuyển sang subagent (session.append); tin thành turn mới thì lựa chọn của router áp ở turn đó như cũ.
    const family = running?.family ?? L.sessionFamily
    const lift = isInterject && !isNewGoal ? added.filter(t => t.run === 'main' && family !== null && (familyRank(t.pick.family) > familyRank(family) || (running !== null && effortRank(t.pick.effort) > effortRank(running.effort)))) : []
    // Khối dặn tách chỉ cho việc vẫn ở luồng chính: việc có thể chuyển sang subagent khi tin chen ngang được chèn thì không dặn tách.
    const lifted = new Set(lift.map(t => t.index))
    const shownAdded = added.map(t => (isSplitHeld || lifted.has(t.index) ? dropSplit(t) : t))
    const shownBrief: Brief = isSplitHeld ? { ...brief, tasks: brief.tasks.map(dropSplit) } : brief
    // Duyệt kế hoạch (0.8.2 N2). Mục tiêu mới: thuộc diện duyệt thì planning, skipApproval thì skipped, còn lại none. Cùng mục tiêu: đã
    // trình mà duyệt thì approved, sửa thì về planning (lượt rà về 0); còn lại giữ nguyên. Hỏi làm rõ một lần mỗi mục tiêu khi planning.
    // Bổ sung lớn sau khi đã duyệt (0.8.5 D2): mục tiêu thuộc diện duyệt, tin amend mà router đọc là substantial hay hard, edit hay mixed, có
    // việc mới: kế hoạch về planning để trình lại.
    const isBigAmend = !isNewGoal && approvalBefore.status === 'approved' && intent === 'amend' && needsApproval(brief, ctx.planApproval, false) && (plan.depth === 'substantial' || plan.depth === 'hard') && (plan.kind === 'edit' || plan.kind === 'mixed') && added.length > 0
    const stage = isNewGoal
      ? { goalId: brief.goalId, status: needsApproval(brief, ctx.planApproval, plan.skipApproval === true) ? ('planning' as const) : plan.skipApproval === true ? ('skipped' as const) : ('none' as const), rounds: 0, asked: false, awaitingAnswer: false }
      : isPresented && intent === 'approve'
        ? { ...approvalBefore, status: 'approved' as const }
        : isPresented && intent === 'amend'
          ? { ...approvalBefore, status: 'planning' as const, rounds: 0 }
          : isBigAmend
            ? { ...approvalBefore, status: 'planning' as const, rounds: 0 }
            : approvalBefore
    const isAsking = stage.status === 'planning' && !stage.asked && (plan.questions?.length ?? 0) > 0
    // Dặn hỏi làm rõ: chờ câu trả lời ở prompt kế tiếp (0.8.3 R3, ghi vào Core cùng lượt ghi trạng thái duyệt).
    const approval = isAsking ? { ...stage, asked: true, awaitingAnswer: true } : stage
    if (approval !== approvalBefore && (isNewGoal ? approval.status !== 'none' : true)) {
      await update($, coreState, S.withApproval(approval))
      if (approval.status !== approvalBefore.status || isNewGoal) record(now, 'approval', { goalId: brief.goalId, status: approval.status, cause: isNewGoal ? 'goal' : intent })
    }
    const approvalNotes = isAsking ? [askContext(plan.questions ?? [])] : approval.status === 'planning' ? [planningContext()] : []
    const isApproved = !isNewGoal && isPresented && approval.status === 'approved'
    const context = isApproved
      ? approvedContext(core.plan)
      : intent === 'resume' && !isNewGoal
      ? isResumeMsg && S.isNothingLeft(before) ? nothingLeftContext() : intentResumeContext(core.plan)
      : isInterject && !isNewGoal
      ? interjectContext(brief, core.plan, shownAdded, newConstraints, { main: running !== null ? describePick(running) : 'model đang chạy', mayReplace: routed?.relation === 'new', isRouted: true })
      : isNewGoal
        ? briefContext(shownBrief, expected, isApplied)
        : followUpContext(brief, core.plan, newConstraints, shownAdded, expected, isApplied)
    if (isInterject && !isNewGoal) {
      L.pendingInterject = lift.length > 0 ? { goalId: brief.goalId, lift: lift.map(t => ({ index: t.index, family: t.pick.family, effort: t.pick.effort })) } : null
      record(now, 'interject', { relation: routed?.relation ?? plan.relation, tasks: added.length, constraints: newConstraints.length, toAgent: 0, liftable: lift.length })
      $.ui.toast(`Đã nhận yêu cầu chen ngang: ${added.length > 0 ? `thêm ${added.length} việc` : 'chỉ thêm ràng buộc'}`)
    }
    // Checklist cũ còn bước mở không bị mất: nó được lưu, Claude khôi phục được nếu router xếp nhầm mục tiêu mới.
    const archived = isNewGoal ? restorableSteps(before.plan) : []
    // Mục tiêu đang dở chưa có checklist (0.8.5 K2) cũng được lưu: một dòng báo riêng.
    const isGoalSaved = isNewGoal && archived.length === 0 && prev !== null && S.pendingOf(before)
    const notice = archived.length > 0 ? [droppedPlanNotice(archived)] : isGoalSaved && prev !== null ? [droppedGoalNotice(prev.goal)] : []
    record(now, 'route', {
      prompt: clipText(text),
      relation: plan.relation,
      intent,
      confidence: plan.confidence,
      retried: outcome.retried,
      ...(outcome.firstFail !== undefined ? { firstFail: outcome.firstFail } : {}),
      main: brief.main,
      expected,
      notes: plan.notes,
      tasks: brief.tasks.map(t => ({ index: t.index, run: t.run, agentType: t.agentType, pick: t.pick, ...(t.split !== undefined ? { split: t.split.length } : {}) })),
    })
    await flushDecisions((path, text) => $.fs.write(path, text))
    if (outcome.retried) $.ui.toast('Router đã đọc lại một lần (câu trả lời đầu hỏng hoặc tin cậy thấp)')
    if (isNewGoal) {
      const delegated = brief.isReference ? 0 : brief.tasks.filter(task => task.run === 'agent').length
      $.ui.toast(
        archived.length > 0
          ? `Mục tiêu mới; checklist cũ còn ${restorableLabel(archived)} đã được lưu (khôi phục bằng plan action "restore")`
          : `Router đã đọc prompt: ${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}${delegated > 0 ? `, ${delegated} việc giao subagent` : ''}`,
      )
    }
    await showStatus($, await read($, view), ctx.options)
    // Vai điều phối (0.8.4 C5, V1): đoạn dặn đầy đủ một lần mỗi mục tiêu, ở prompt đầu tiên luồng chính điều phối mục tiêu đó (mục tiêu
    // mới, hay mục tiêu mở lúc Fable chưa sẵn sàng); khóa Core.fable.briefedGoal.
    const isBriefed = wanted !== null && isBriefedFor(S.normalizeCore(await read($, coreState)), brief.goalId, wanted.family)
    const conductNote = wanted?.isConducting === true && !isBriefed ? [conductorContext(wanted.family)] : []
    if (conductNote.length > 0 && wanted !== null) await update($, coreState, markBriefed(brief.goalId, wanted.family))
    return next({ ...e, context: [...lead, ...(e.context ?? []), context, ...conductNote, ...approvalNotes, ...(phaseNote !== null ? [phaseNote] : []), ...notice, ...(isClipped ? [CLIPPED_CONTEXT] : []), ...tail] })
  }).catch(($, e, next) => (noteHookError('prompt.submit', next.error), next(e)))

  // Chặn sửa trước khi duyệt kế hoạch (0.8.2 N2): chỉ luồng chính, khi mục tiêu đang planning hay presented. Đăng ký ở đây (trước hook
  // Agent của parts/agents.ts) nên lời gọi Agent bị từ chối không tốn lượt router chấm subagent. Tool plan của mod và tool chỉ đọc qua.
  on('tool.call', { tool: GATED_TOOLS }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if ((await read($, mode)) === 'off') return next(e)
    if (!S.isPlanGated(await read($, coreState))) return next(e)
    const reason = approvalDenial(e.tool, e as unknown as Record<string, unknown>)
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) => (noteHookError('tool.call approval', next.error), next(e)))

  // Chấp nhận kế hoạch qua plan mode của engine (0.8.2 N2): ExitPlanMode chạy xong không lỗi (PostToolUse chỉ phát khi tool thành công) ở
  // luồng chính tính là duyệt CHỈ khi permission_mode là plan, default hay acceptEdits (người dùng bấm duyệt); auto, bypassPermissions,
  // dontAsk hay vắng là tự duyệt, không tính.
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    if (e.tool_name !== 'ExitPlanMode' || e.agent_id !== undefined || !PERSON_MODES.has(e.permission_mode ?? '')) return result
    if ((await read($, mode)) === 'off') return result
    const core = S.normalizeCore(await read($, coreState))
    if (core.brief === null || !S.isPlanGated(core)) return result
    await update($, coreState, S.withApproval({ ...S.approvalOf(core), status: 'approved' }))
    record(await $.clock.now(), 'approval', { goalId: core.brief.goalId, status: 'approved', cause: 'exit-plan-mode' })
    await flushDecisions((path, text) => $.fs.write(path, text))
    await showStatus($, await read($, view), ctx.options)
    return result
  }).catch(($, e, next) => (noteHookError('classic.PostToolUse', next.error), next(e)))

  // Engine chèn tin chen ngang vào turn đang chạy (0.7.8 G9): hàng attachment queued_command của luồng chính, door delivery (vòng sửa 2, V1; door
  // attachment vẫn nhận để phòng engine đổi cách phân loại). Các việc run: main cần
  // model cao hơn luồng chính đang chạy chuyển sang subagent general-purpose, giữ đúng pick router chấm; câu báo đi kèm kết quả tool kế.
  on('session.append', async ($, e, next) => {
    const pending = L.pendingInterject
    if (pending === null || e.agentId !== undefined || (e.door !== 'delivery' && e.door !== 'attachment') || e.message.name !== 'queued_command') return next(e)
    L.pendingInterject = null
    const core = S.normalizeCore(await read($, coreState))
    const brief = core.brief
    if (brief === null || brief.goalId !== pending.goalId) return next(e)
    const indices = new Set(pending.lift.map(item => item.index))
    // Việc chuyển sang subagent không còn tách bằng phiên con (0.7.9 F1): split của việc đó bị bỏ.
    const tasks = brief.tasks.map(t =>
      indices.has(t.index) && t.run === 'main'
        ? { ...dropSplit(t), run: 'agent' as const, agentType: 'general-purpose', why: [t.why, `chen ngang giữa turn: giao subagent để chạy đúng ${t.pick.family}/${t.pick.effort}`].filter(Boolean).join('; ') }
        : t,
    )
    const moved = tasks.filter(t => indices.has(t.index) && t.run === 'agent')
    if (moved.length === 0) return next(e)
    const next_ = { ...brief, tasks }
    trackDelegations(brief.goalId, moved, true)
    await update($, coreState, c => S.withDelegations(brief.goalId, delegationItems(next_))(S.withBrief(next_)(c)))
    L.interjectNote = interjectMovedNote(moved)
    record(await $.clock.now(), 'interject-deliver', { goalId: brief.goalId, toAgent: moved.length, tasks: moved.map(t => t.index) })
    await flushDecisions((path, text) => $.fs.write(path, text))
    return next(e)
  }).catch(($, e, next) => (noteHookError('session.append', next.error), next(e)))
}
