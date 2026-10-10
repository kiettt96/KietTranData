// Phiên và đọc prompt: session.start/end, mục system prompt cố định, prompt.submit (router đọc prompt).

import { atom, derive, read, update } from 'claude-code'
import type { Brief, Core, Warning } from '../../types'
import { openSteps } from '../lib/drift'
import { addUsage } from '../lib/ledger'
import { PLAN_TOOL_SPEC } from '../lib/plan'
import { describePick } from '../lib/route'
import { clipText, keptLines } from '../lib/decisions'
import { askRouter, isSkippable, nextBrief, parseRoute, routerRequest } from '../lib/router'
import type { RouterOutcome, RouterPlan } from '../lib/router'
import * as S from '../lib/state'
import { DISCIPLINE, briefContext, droppedPlanNotice, followUpContext, skippedContext, unroutedContext } from '../lib/text'
import type { On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { PERSON_ORIGINS, SLASH_COMMAND } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

export function registerSession(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { decisionLog, decisionText, expectedMain, isRouterPaused, noteRouter, policy, ranText, record, resetLocal, routerFallback, routerFamily, routerModel, skipPhrases, trackDelegations, wantedPick } = ctx
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
      argumentHint: '[status | mode auto|subagents|suggest|off | goal <mô tả> | reroute | reset]',
    })
    $.ui.status(S.statusOf(await read($, view)))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      resetLocal()
      await update($, coreState, S.resetCore)
      $.ui.status(S.statusOf(await read($, view)))
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

    const before = S.normalizeCore(await read($, coreState))
    const prev = before.brief
    // routerSkip (người dùng tự bật): câu ngắn đúng nguyên văn trong danh sách thì là tiếp nối, không hỏi router.
    if (prev !== null && isSkippable(text, skipPhrases)) {
      const at = await $.clock.now()
      record(at, 'skip', { prompt: text, goalId: prev.goalId })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      return next({ ...e, context: [...(e.context ?? []), skippedContext(prev, before.plan)] })
    }

    L.promptCount += 1
    const rules = policy()
    const isPaused = isRouterPaused()
    let outcome: RouterOutcome<RouterPlan> = { result: null, reason: 'router đang tạm ngừng sau các lần lỗi liên tiếp', usages: [], retried: false }
    let pauseText: string | null = null
    if (!isPaused) {
      $.ui.status('router đang đọc prompt...')
      const request = routerRequest({ text, prev, ran: ranText(before), policy: rules, model: routerModel })
      outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseRoute(reply, rules))
      pauseText = noteRouter(outcome.result !== null)
    }
    const plan = outcome.result
    const now = await $.clock.now()
    const withUsage = (c: Core): Core =>
      outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), c)

    if (plan === null) {
      // Mặc định không đoán: giữ mục tiêu, việc đã phân, phạm vi, ràng buộc và checklist; chỉ bỏ lựa chọn model
      // luồng chính. routerFallback "reuse" (người dùng tự bật) giữ cả lựa chọn của prompt trước.
      const isReuse = routerFallback === 'reuse' && prev !== null && prev.main !== null
      const kept: Brief | null = prev ? { ...prev, ...(isReuse ? {} : { main: null }), at: now } : null
      if (!isReuse) L.delegation = { goalId: -1, pending: new Map(), isNudged: false, isWarned: false, blocks: 0 }
      const failText = isReuse
        ? `Router (${routerModel}) không đọc được prompt (${outcome.reason}); dùng lại lựa chọn của prompt trước`
        : `Router (${routerModel}) không đọc được prompt (${outcome.reason}); turn này chạy theo model của phiên`
      const warnings: Warning[] = [
        ...(isPaused ? [] : [{ at: now, kind: 'model' as const, text: failText }]),
        ...(pauseText ? [{ at: now, kind: 'model' as const, text: pauseText }] : []),
      ]
      // Route lưu về null (trừ khi dùng lại): mốc cache là model engine thật sự chạy, không phải route của lượt trước.
      await update($, coreState, c => {
        const used = withUsage(c)
        const withKept = kept ? S.withBrief(kept)(used) : used
        return S.withWarnings(...warnings)(isReuse ? withKept : S.withRoute(null)(withKept))
      })
      L.lastPrompt = { text, prev, goalId: kept?.goalId ?? null }
      record(now, 'router-fail', { prompt: clipText(text), reason: outcome.reason, retried: outcome.retried, reuse: isReuse })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      if (!isPaused) $.ui.toast(pauseText ?? failText)
      $.ui.status(S.statusOf(await read($, view)))
      return next({ ...e, context: [...(e.context ?? []), unroutedContext(outcome.reason)] })
    }

    // Mục tiêu mới, chạy thật prompt đã đối chiếu, hoặc tiếp nối cùng mục tiêu.
    const { brief, added, isNewGoal } = nextBrief(prev, plan, text, now)
    // adoptGoal lưu checklist cũ còn bước mở (khôi phục được bằng plan restore); chi phí router cộng sau, thuộc mục tiêu mới.
    const core = await update($, coreState, c => withUsage(isNewGoal ? S.adoptGoal(brief)(c) : S.withDecision(brief)(c)))
    L.lastPrompt = { text, prev, goalId: brief.goalId }
    if (isNewGoal) {
      L.isGoalNew = true
      L.pinnedGoalId = null
    }

    const wanted = wantedPick(brief, core.lift)
    // Model sẽ thật sự chạy (có thể là model cũ được giữ để bảo toàn cache): việc "làm trực tiếp" so với model này.
    const expected = wanted !== null && isNewGoal ? expectedMain(core, brief, wanted, now) : wanted
    if (isNewGoal) trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
    else if (!brief.isReference) trackDelegations(brief.goalId, added, true)
    const context = isNewGoal
      ? briefContext(brief, expected, isApplied)
      : followUpContext(brief, core.plan, plan.constraints.filter(c => !prev?.constraints.includes(c)), added, expected, isApplied)
    // Checklist cũ còn bước mở không bị mất: nó được lưu, Claude khôi phục được nếu router xếp nhầm mục tiêu mới.
    const archived = isNewGoal ? openSteps(before.plan) : []
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
    if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
    if (isNewGoal) {
      const delegated = brief.isReference ? 0 : brief.tasks.filter(task => task.run === 'agent').length
      $.ui.toast(
        archived.length > 0
          ? `Mục tiêu mới; checklist cũ còn ${archived.length} bước mở đã được lưu (khôi phục bằng plan action "restore")`
          : `Router đã đọc prompt: ${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}${delegated > 0 ? `, ${delegated} việc giao subagent` : ''}`,
      )
    }
    $.ui.status(S.statusOf(await read($, view)))
    return next({ ...e, context: [...(e.context ?? []), context, ...notice] })
  })
}
