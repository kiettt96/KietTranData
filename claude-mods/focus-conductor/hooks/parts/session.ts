// Phiên và đọc prompt: session.start/end, mục system prompt cố định, prompt.submit (router đọc prompt).

import { atom, derive, read, update } from 'claude-code'
import type { Brief, Core, QuotaCheckpoint, Warning } from '../../types'
import { briefFromCheckpoint, changedFiles, storeKey } from '../lib/checkpoint'
import { openSteps, restorableSteps } from '../lib/drift'
import { PLAN_TOOL_SPEC } from '../lib/plan'
import { describePick, familyOf } from '../lib/route'
import { clipText, keptLines } from '../lib/decisions'
import { ROUTER_TASK_LIMIT, askRouter, bareBrief, failFields, isSkippable, needsCoverageRecheck, nextBrief, parseRoute, routerFailOf, routerRequest } from '../lib/router'
import type { RouterOutcome, RouterPlan } from '../lib/router'
import { EMPTY_QUOTA, blockingHits, evaluateQuota, isPauseActive, normalizeQuota, overrideOf, quotaSettings, reasonsOf } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { DISCIPLINE, briefContext, droppedPlanNotice, followUpContext, quotaPausedContext, resetLabel, resumeCommand, restorableLabel, resumeContext, resumePendingContext, skippedContext, unroutedContext } from '../lib/text'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { PERSON_ORIGINS, SLASH_COMMAND, newDelegation } from '../context'
import { PANE_ROWS, shouldAutoOpenPane } from '../lib/pane'
import { PANE, PANE_TITLE } from '../ui/pane'

/** Mở pane chi tiết cho mục tiêu mới nếu cần (0.7.2): không focus, không chiếm phím; kết quả đặt hay chưa đặt ghi vào nhật ký quyết định. */
async function autoOpenPane($: EngineInterface, ctx: Ctx, goalId: number, at: number): Promise<void> {
  const panes = await $.ui.panes().catch(() => [])
  const isOpen = panes.some(pane => pane.id === PANE)
  if (!shouldAutoOpenPane({ enabled: ctx.autoPane, goalId, closedGoal: await read($, paneClosedState), isOpen })) return
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS }).catch(() => null)
  // Chỉ ghi khi pane chưa được đặt (màn hình hẹp, chưa có surface, engine từ chối): đặt được là trường hợp bình thường, không cần dòng log.
  if (opened?.isPlaced === true) return
  ctx.record(at, 'pane', { goalId, isPlaced: false, reason: opened === null ? 'engine từ chối mở pane' : opened.reason })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text))
}

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
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
  const root = await $.session.root().catch(() => null)
  return root || fallback
}

/** Kích thước và thời điểm sửa hiện tại của các file trong điểm dừng (null khi không còn). */
async function currentStats($: EngineInterface, paths: readonly string[]): Promise<Map<string, { mtimeMs: number; size: number } | null>> {
  const out = new Map<string, { mtimeMs: number; size: number } | null>()
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(() => null)
    out.set(path, stat === null ? null : { mtimeMs: stat.mtimeMs, size: stat.size })
  }
  return out
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerSession(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { decisionLog, flushDecisions, delegationItems, expectedMain, isRouterPaused, noteRouter, noteRouterTime, policy, ranText, record, resetLocal, routerFallback, routerFamily, routerModel, skipPhrases, trackDelegations, wantedPick } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ---------------------------------------------------------------- phiên

  on('session.start', async ($, e, next) => {
    // Log quyết định nối tiếp file cũ (giữ DECISION_LIMIT dòng cuối); file chưa có hoặc đọc lỗi thì bắt đầu mới.
    if (decisionLog) {
      const old = await $.fs.read(decisionLog).catch(() => '')
      L.decisions = typeof old === 'string' ? keptLines(old) : []
    }
    await $.tool.register(PLAN_TOOL_SPEC)
    await $.command.register({
      name: 'conductor',
      description: 'Focus Conductor: mục tiêu, checklist và điều phối model/effort/agent',
      argumentHint: '[status | mode auto|subagents|suggest|off | goal <mô tả> | reroute | reset | pause | resume [force|discard]]',
    })
    // Bảo vệ hạn mức: nạp điểm dừng còn mở của thư mục này (phiên mới hay resume). Bản resuming của phiên trước (chết
    // giữa chừng) quay về open. Chỉ khi chưa có mục tiêu thì khôi phục mục tiêu và checklist; không tự gửi prompt nào.
    if (quotaSettings(ctx.options).enabled && (await read($, mode)) !== 'off') {
      const dir = await checkpointDir($, e.cwd)
      const raw = (await $.store.get(storeKey(dir)).catch(() => undefined)) as QuotaCheckpoint | undefined
      if (raw !== undefined && raw !== null && raw.version === 1 && raw.cwd === dir && raw.status !== 'consumed') {
        const cp: QuotaCheckpoint = { ...raw, status: 'open' }
        if (raw.status !== 'open') await $.store.set(storeKey(dir), cp).catch(() => undefined)
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
    if (e.reason === 'clear') {
      resetLocal()
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
    if (quota.enabled) {
      const now = await $.clock.now()
      const evaluation = evaluateQuota(await quotaLimits($), now, quota)
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
      await $.store.set(storeKey(cp.cwd), cp).catch(() => undefined)
      return [resumeContext(cp, changedFiles(cp.files, stats))]
    }
    const pending = openCp !== null ? [resumePendingContext(openCp)] : []

    const before = S.normalizeCore(await read($, coreState))
    const prev = before.brief
    // routerSkip (người dùng tự bật): câu ngắn đúng nguyên văn trong danh sách thì là tiếp nối, không hỏi router.
    if (prev !== null && isSkippable(text, skipPhrases)) {
      const at = await $.clock.now()
      record(at, 'skip', { prompt: text, goalId: prev.goalId })
      // Câu tiếp nối ngắn: turn này làm tiếp mục tiêu đang mở.
      L.promptIntent = { relation: 'continue', kind: prev.isReference ? 'answer' : prev.kind }
      await flushDecisions((path, text) => $.fs.write(path, text))
      const lead = await startResume()
      return next({ ...e, context: [...lead, ...(e.context ?? []), skippedContext(prev, before.plan)] })
    }

    L.promptCount += 1
    // Model của phiên chưa biết (prompt đầu, trước step đầu): hỏi engine, để router và chính sách phiên dùng được ngay.
    if (L.sessionFamily === null) L.sessionFamily = familyOf(await $.session.model().catch(() => ''))
    const rules = policy()
    const isPaused = isRouterPaused()
    let outcome: RouterOutcome<RouterPlan> = { result: null, reason: 'router đang tạm ngừng sau các lần lỗi liên tiếp', usages: [], retried: false, failure: 'paused', timeoutMs: null, maxTokens: null, outputTokens: null }
    let waitedMs = 0
    let pauseText: string | null = null
    if (!isPaused) {
      $.ui.status('router đang đọc prompt...')
      const observed = L.observed.join('; ')
      L.observed = []
      const request = routerRequest({ text, prev, ran: ranText(before), policy: rules, model: routerModel, sessionFamily: L.sessionFamily, openSteps: openSteps(before.plan).map(s => s.title), ...(observed ? { observed } : {}) })
      const startedAt = await $.clock.now()
      outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules), needsCoverageRecheck)
      waitedMs = (await $.clock.now()) - startedAt
      noteRouterTime(waitedMs)
      pauseText = noteRouter(outcome.result !== null)
    }
    // Tiếp tục điểm dừng khi router xếp tiếp nối, hoặc khi người dùng vừa gõ /conductor resume (khi đó router xếp mục
    // tiêu mới thì vẫn giữ mục tiêu đã khôi phục).
    const isResuming = openCp !== null && (isArmed || (outcome.result !== null && outcome.result.relation !== 'new'))
    const plan = outcome.result !== null && isResuming && isArmed && prev !== null && outcome.result.relation === 'new' ? { ...outcome.result, relation: 'continue' as const } : outcome.result
    const lead = isResuming ? await startResume() : []
    const tail = isResuming ? [] : pending
    const now = await $.clock.now()
    // Router không đọc được thì không biết turn là hỏi đáp hay làm tiếp: Stop chỉ dựa vào hành vi tool.
    L.promptIntent = plan !== null ? { relation: plan.relation, kind: plan.isReference && !plan.runReference ? 'answer' : plan.kind } : null
    const withUsage = (c: Core): Core =>
      S.withAnalyzerUsage(outcome.usages, routerFamily)(c)

    if (plan === null) {
      // Mặc định không đoán: giữ mục tiêu, việc đã phân, phạm vi, ràng buộc và checklist; chỉ bỏ lựa chọn model
      // luồng chính. routerFallback "reuse" (người dùng tự bật) giữ cả lựa chọn của prompt trước.
      const isReuse = routerFallback === 'reuse' && prev !== null && prev.main !== null
      const kept: Brief | null = prev ? { ...prev, ...(isReuse ? {} : { main: null }), at: now } : null
      // Prompt tiếp nối (0.7.5): phân việc đã có và trạng thái giao của từng việc vẫn giữ; chỉ bỏ lựa chọn luồng chính.
      if (!isReuse && prev === null) L.delegation = newDelegation()
      const failText = isReuse
        ? `Router (${routerModel}) không đọc được prompt (${outcome.reason}); dùng lại lựa chọn của prompt trước`
        : `Router (${routerModel}) không đọc được prompt (${outcome.reason}); turn này chạy theo model của phiên`
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
        await autoOpenPane($, ctx, bare.goalId, now)
      }
      L.lastPrompt = { text, prev, goalId: bare?.goalId ?? kept?.goalId ?? null }
      record(now, 'router-fail', { prompt: clipText(text), reason: outcome.reason, retried: outcome.retried, reuse: isReuse, ...failFields(fail) })
      await flushDecisions((path, text) => $.fs.write(path, text))
      if (!isPaused) $.ui.toast(pauseText ?? failText)
      await showStatus($, await read($, view), ctx.options)
      return next({ ...e, context: [...lead, ...(e.context ?? []), unroutedContext(outcome.reason, bare !== null, prev !== null && prev.tasks.length > 0), ...tail] })
    }

    // Mục tiêu mới, chạy thật prompt đã đối chiếu, hoặc tiếp nối cùng mục tiêu.
    const { brief, added, isNewGoal, replaced, held } = nextBrief(prev, plan, text, now, { hasOpenSteps: openSteps(before.plan).length > 0 })
    // Router xếp mục tiêu mới với tin cậy thấp khi checklist còn bước mở (0.7.5): giữ mục tiêu, ghi nhật ký quyết định.
    if (held && prev !== null) {
      L.promptIntent = { relation: 'continue', kind: plan.kind }
      record(now, 'new-held', { prompt: clipText(text), confidence: plan.confidence, goalId: prev.goalId })
    }
    // adoptGoal lưu checklist cũ còn bước mở (khôi phục được bằng plan restore); chi phí router cộng sau, thuộc mục tiêu mới.
    const core = await update($, coreState, c => S.withRouterFail(null)(withUsage(isNewGoal ? S.adoptGoal(brief)(c) : S.withDecision(brief)(c))))
    L.lastPrompt = { text, prev, goalId: brief.goalId }
    // Router chia quá ROUTER_TASK_LIMIT việc (0.7.5): phần sau bị bỏ khỏi Phân việc, báo một cảnh báo.
    if (plan.droppedTasks !== undefined) {
      const total = plan.droppedTasks + ROUTER_TASK_LIMIT
      await update($, coreState, S.withWarnings({ at: now, kind: 'model', text: `Router chia ${total} việc; giữ ${ROUTER_TASK_LIMIT} việc đầu trong Phân việc, các việc sau làm theo prompt gốc` }))
    }
    // Ràng buộc hay yêu cầu đã đầy trần (0.7.5): mục mới thay mục cũ nhất không phải quy định model; báo một cảnh báo.
    if (replaced.length > 0) {
      const text = `Ràng buộc và yêu cầu của mục tiêu đã đầy; mục mới thay ${replaced.length} mục cũ: ${replaced.map(item => clipText(item, 60)).join('; ')}`
      await update($, coreState, S.withWarnings({ at: now, kind: 'model', text }))
    }
    if (isNewGoal) {
      L.goalPrompt = { text, prev, goalId: brief.goalId }
      L.isGoalNew = true
      L.pinnedGoalId = null
      // Ẩn band (nút Ẩn) chỉ có tác dụng trong mục tiêu đang làm: mục tiêu mới thì band hiện lại (0.6.1).
      await update($, bandHiddenState, () => false)
      await autoOpenPane($, ctx, brief.goalId, now)
    }

    const wanted = wantedPick(brief, core.lift)
    // Model sẽ thật sự chạy (có thể là model cũ được giữ để bảo toàn cache): việc "làm trực tiếp" so với model này.
    const expected = wanted !== null && isNewGoal ? expectedMain(core, brief, wanted, now) : wanted
    if (isNewGoal) trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
    else if (!brief.isReference) trackDelegations(brief.goalId, added, true)
    await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
    const context = isNewGoal
      ? briefContext(brief, expected, isApplied)
      : followUpContext(brief, core.plan, plan.constraints.filter(c => !prev?.constraints.includes(c)), added, expected, isApplied)
    // Checklist cũ còn bước mở không bị mất: nó được lưu, Claude khôi phục được nếu router xếp nhầm mục tiêu mới.
    const archived = isNewGoal ? restorableSteps(before.plan) : []
    const notice = archived.length > 0 ? [droppedPlanNotice(archived)] : []
    record(now, 'route', {
      prompt: clipText(text),
      relation: plan.relation,
      confidence: plan.confidence,
      retried: outcome.retried,
      main: brief.main,
      expected,
      notes: plan.notes,
      tasks: brief.tasks.map(t => ({ index: t.index, run: t.run, agentType: t.agentType, pick: t.pick })),
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
    return next({ ...e, context: [...lead, ...(e.context ?? []), context, ...notice, ...tail] })
  }).catch(($, e, next) => next(e))
}
