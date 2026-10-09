// focus-conductor: điểm vào của mod. File này nối hook với các module thuần
// trong lib/ và ui/. Theo quy tắc của engine, $ chỉ được dùng tại chỗ trong
// thân hook ($.noun.event(...), read($, ...), update($, ...)), nên mọi lệnh
// gọi $ nằm ở đây; lib/ và ui/ chỉ tính toán và dựng cây giao diện.
//
// Luồng một turn:
//   prompt.submit  đọc prompt (heuristic, tùy chọn Haiku), lưu brief, gắn
//                  khối phân tích vào context của prompt.
//   turn.step      step đầu tiên của turn chốt model + effort cho luồng chính
//                  (có tính chi phí cache), mọi step sau giữ nguyên.
//   tool.call      Agent: chọn model/effort/loại agent cho subagent.
//                  plan: checklist của Claude. Mọi tool: theo dõi lặp lỗi,
//                  vượt ngân sách, ngoài phạm vi, nhắc checkpoint tự kiểm tra.
//   classic.Stop   checklist còn mở thì yêu cầu hoàn thành hoặc giải thích.
//   turn.complete  tổng kết cảnh báo cuối turn.
// Giao diện: band trên prompt, pane chi tiết, status line, lệnh /conductor.

import { atom, derive, read, update } from 'claude-code'
import type { PromptOrigin, Register } from 'claude-code'

import type { Brief, Core, Mode, ModelFamily, Route, RouteEvent, Warning } from '../types'
import { analyzeHeuristic, analyzerRequest, mergeAnalysis } from './lib/analyze'
import { isExecuting, newTracker, observe, openSteps, summarize } from './lib/drift'
import type { TurnTracker } from './lib/drift'
import { PLAN_TOOL_SPEC, applyPlan } from './lib/plan'
import type { PlanInput } from './lib/plan'
import { decideMain, describePick, familyOf, parseModelMap, planAgent, resolveModelId, wantedMain } from './lib/route'
import type { AgentPlan } from './lib/route'
import * as S from './lib/state'
import type { View } from './lib/state'
import { DISCIPLINE, PLAN_TOOL_FULL, briefContext, droppedPlanNotice, followUpContext, renderPlan, stopBlockReason } from './lib/text'
import { renderBand } from './ui/band'
import { PANE, PANE_TITLE, renderPane } from './ui/pane'

// Atom khai báo ngay trong module hooks (engine quét tham chiếu state tại
// đây); reducer thuần để áp lên chúng nằm ở lib/state.ts.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

/** Prompt do chính người dùng gửi (hoặc lịch họ đặt), không phải thông báo nội bộ. */
const PERSON_ORIGINS = new Set<PromptOrigin['kind']>(['composer', 'bridge', 'sdk', 'scheduled-trigger'])

/** Lệnh slash (/conductor, /plugin:cmd), không phải đường dẫn như /home/... */
const SLASH_COMMAND = /^\/[a-z][\w:-]*(\s|$)/i

/** Số turn liên tiếp một họ model phải lỗi mới bị chặn, và số turn bị chặn. */
const FAIL_LIMIT = 2
const BLOCK_TURNS = 5

const COMMAND_HELP = [
  '/conductor             mở pane Focus Conductor',
  '/conductor status      tóm tắt mục tiêu, checklist, điều phối',
  '/conductor mode X      X là auto, subagents, suggest hoặc off',
  '/conductor goal ...    đặt mục tiêu thủ công',
  '/conductor reset       xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn',
].join('\n')

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function previewRoute(brief: Brief, pick: { family: ModelFamily; effort: Route['effort'] }): Route {
  return { ...pick, tier: brief.tier, goalId: brief.goalId, reason: 'dự kiến' }
}

export const register: Register = (on, options) => {
  // Biến module: chỉ giữ thứ tạm thời của turn đang chạy; hot-reload làm
  // mất chúng mà không ảnh hưởng tính đúng (trạng thái bền nằm trong $.state).
  let tracker: TurnTracker = newTracker('')
  let turnRoute: { turnId: string; route: Route | null } = { turnId: '', route: null }
  let isGoalNew = false
  let lastSession: { model: string; effort: string } | null = null
  let pinnedGoalId: number | null = null
  const blocked = new Set<ModelFamily>()
  // Một lần lỗi có thể chỉ là tạm thời (429, quá tải): chỉ chặn một họ model
  // khi nó lỗi ở hai turn liên tiếp, và tự hết chặn sau BLOCK_TURNS turn.
  const failures = new Map<ModelFamily, { count: number; lastTurn: number }>()
  const blockedUntil = new Map<ModelFamily, number>()
  let turnCount = 0
  const offered = new Set<string>()
  const pendingAgents = new Map<string, AgentPlan & { isApplied: boolean }>()
  const modelMap = parseModelMap(options['modelMap'])

  // Một lần đọc cho mọi thứ band, pane và status line cần.
  const view = derive(
    [coreState, modeState, bandHiddenState],
    (core, override, isBandHidden): View => ({ core, mode: S.modeOf(override, options), isBandHidden }),
  )
  const mode = derive([modeState], (override): Mode => S.modeOf(override, options))

  /** Xóa phần trạng thái cục bộ (không thuộc $.state). */
  function resetLocal(): void {
    tracker = newTracker('')
    turnRoute = { turnId: '', route: null }
    isGoalNew = false
    lastSession = null
    pinnedGoalId = null
    blocked.clear()
    failures.clear()
    blockedUntil.clear()
    turnCount = 0
  }

  /** Hết chặn các họ model đã bị chặn đủ BLOCK_TURNS turn, để thử lại. */
  function expireBlocks(): void {
    for (const [family, until] of blockedUntil) {
      if (until > turnCount) continue
      blockedUntil.delete(family)
      failures.delete(family)
      blocked.delete(family)
    }
  }

  /**
   * Quyết định route cho một turn của luồng chính (thuần, không gọi $).
   * `stored` là route ghi vào $.state làm mốc cache cho turn sau.
   */
  function decideTurn(core: Core, model: string, effort: string, messageCount: number, current: Mode, at: number) {
    const logs: RouteEvent[] = []
    const brief = core.brief
    if (brief === null) return { route: null, stored: core.route, logs }

    // Người dùng tự đổi model hoặc effort giữa các turn: tôn trọng lựa chọn
    // đó tới khi có mục tiêu mới.
    if (lastSession && (lastSession.model !== model || lastSession.effort !== effort)) {
      pinnedGoalId = brief.goalId
      logs.push({
        at,
        where: 'main',
        label: 'người dùng',
        family: familyOf(model) ?? 'opus',
        reason: `người dùng đổi sang ${model}${effort ? `/${effort}` : ''}; tạm dừng tự điều phối tới mục tiêu mới`,
        isApplied: false,
      })
    }
    lastSession = { model, effort }
    if (pinnedGoalId === brief.goalId) return { route: null, stored: null, logs }

    const decision = decideMain({
      current: core.route,
      wanted: wantedMain(brief.tier, options, blocked),
      tier: brief.tier,
      goalId: brief.goalId,
      messageCount,
      isNewGoal: isGoalNew,
    })
    isGoalNew = false
    if (decision.isChanged || decision.isHeld || core.route?.goalId !== brief.goalId) {
      const shown = decision.isHeld ? decision.wanted : decision.route
      logs.push({
        at,
        where: 'main',
        label: 'turn',
        family: shown.family,
        effort: shown.effort,
        reason: current === 'suggest' ? `${decision.reason} (chỉ đề xuất)` : decision.reason,
        isApplied: current === 'auto' && !decision.isHeld,
      })
    }
    return { route: decision.route, stored: decision.route, logs }
  }

  // ---------------------------------------------------------------- phiên

  on('session.start', async ($, e, next) => {
    await $.tool.register(PLAN_TOOL_SPEC)
    await $.command.register({
      name: 'conductor',
      description: 'Focus Conductor: mục tiêu, checklist và điều phối model/effort/agent',
      argumentHint: '[status | mode auto|subagents|suggest|off | goal <mô tả> | reset]',
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
    if ((await read($, mode)) === 'off') return next(e)

    const before = await read($, coreState)
    const prev = before.brief
    let brief = analyzeHeuristic(text, prev, await $.clock.now())
    if (options['analyzer'] === 'model' && !brief.isFollowUp && wordCount(text) >= 12) {
      $.ui.status('đang đọc prompt...')
      const reply = await $.model.complete(analyzerRequest(text, prev)).catch(() => null)
      if (reply?.isAnswered) brief = mergeAnalysis(brief, prev, reply.text, text)
    }

    const isNewGoal = prev === null || brief.goalId !== prev.goalId
    const core = await update($, coreState, isNewGoal ? S.adoptGoal(brief) : S.withBrief(brief))
    if (isNewGoal) {
      isGoalNew = true
      pinnedGoalId = null
    }

    const wanted = wantedMain(brief.tier, options, blocked)
    const context = isNewGoal
      ? briefContext(brief, previewRoute(brief, wanted))
      : followUpContext(brief, core.plan, brief.constraints.filter(c => !prev?.constraints.includes(c)))
    // Checklist cũ còn bước mở bị bỏ theo mục tiêu mới: báo, kẻo mất tiến độ trong im lặng.
    const dropped = isNewGoal ? openSteps(before.plan) : []
    const notice = dropped.length > 0 ? [droppedPlanNotice(dropped)] : []
    if (isNewGoal) {
      $.ui.toast(
        dropped.length > 0
          ? `Mục tiêu mới, checklist cũ còn ${dropped.length} bước mở đã bị bỏ`
          : `Đã đọc prompt: ${brief.tier}, luồng chính ${describePick(wanted)}`,
      )
    }
    $.ui.status(S.statusOf(await read($, view)))
    return next({ ...e, context: [...(e.context ?? []), context, ...notice] })
  })

  // ------------------------------------- 2. điều phối model / effort

  on('turn.start', async ($, e, next) => {
    tracker = newTracker(e.turnId)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const current = await read($, mode)
    // Subagent đã được điều phối lúc spawn; chế độ subagents/off không chạm luồng chính.
    if (e.agentId !== undefined || current === 'off' || current === 'subagents') return yield* next(e)

    if (turnRoute.turnId !== e.turnId) {
      turnCount += 1
      expireBlocks()
      const core = await read($, coreState)
      const decided = decideTurn(core, e.model, String(e.effort ?? ''), e.messageCount, current, await $.clock.now())
      turnRoute = { turnId: e.turnId, route: decided.route }
      await update($, coreState, c => S.withLog(...decided.logs)(S.withRoute(decided.stored)(c)))
      $.ui.status(S.statusOf(await read($, view)))
    }
    const route = turnRoute.route
    if (route === null || current === 'suggest') return yield* next(e)

    // Chốt model + effort cho mọi step của turn: đổi giữa chừng sẽ mất cache.
    const input = { ...e, model: resolveModelId(route.family, e.model, modelMap), effort: route.effort }
    const isOverridden = input.model !== e.model
    const stream = next(input)
    let chunks = 0
    try {
      for await (const chunk of stream) {
        chunks += 1
        yield chunk
      }
      const result = await stream.result
      const isEmpty = result.stopReason === null && result.usage === null
      if (!isEmpty) failures.delete(route.family)
      if (!isOverridden || !isEmpty || chunks > 0 || next.signal.aborted) return result
    } catch (error) {
      if (!isOverridden || chunks > 0 || next.signal.aborted) throw error
    }

    // Model được chọn không phản hồi (không có quyền, bị chặn, sai ID, hoặc
    // lỗi tạm thời): quay về model của engine cho phần còn lại của turn. Chỉ
    // chặn họ model khi lỗi ở hai turn liên tiếp.
    const previous = failures.get(route.family)
    const count = previous && turnCount - previous.lastTurn <= 1 ? previous.count + 1 : 1
    failures.set(route.family, { count, lastTurn: turnCount })
    const isBlocked = count >= FAIL_LIMIT
    if (isBlocked) {
      blocked.add(route.family)
      blockedUntil.set(route.family, turnCount + BLOCK_TURNS)
    }
    turnRoute = { turnId: e.turnId, route: null }
    const text = isBlocked
      ? `${input.model} không phản hồi ${count} turn liên tiếp; quay về ${e.model} và tạm ngừng dùng ${route.family} trong ${BLOCK_TURNS} turn`
      : `${input.model} không phản hồi; turn này quay về ${e.model}, nếu lỗi lại sẽ tạm ngừng dùng ${route.family}`
    const warning: Warning = { at: await $.clock.now(), kind: 'model', text }
    await update($, coreState, c => S.withWarnings(warning)(S.withRoute(null)(c)))
    $.ui.toast(text)
    return yield* next(e)
  })

  // Ghi nhận loại agent nào đang được mời dùng, để chỉ đổi sang Explore khi có.
  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (result.isOffered) offered.add(e.agent)
    else offered.delete(e.agent)
    return result
  }).catch(($, e, next) => next(e))

  // Subagent: mỗi subagent là hội thoại mới, không có cache để mất, nên chọn
  // model theo đúng độ khó của nhiệm vụ. Model/effort Claude tự ghi thì giữ.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.subagent_type === 'fork') return next(e)

    const plan = planAgent({
      prompt: e.prompt,
      description: e.description,
      subagentType: e.subagent_type,
      offered,
      blocked,
    })
    const isApplied = current === 'auto' || current === 'subagents'
    const reason = e.model !== undefined ? `giữ model Claude chỉ định (${e.model}); ${plan.reason}` : plan.reason
    pendingAgents.set(e.tool_use_id, { ...plan, reason, isApplied })
    if (!isApplied) return next(e)

    const isGeneral = e.subagent_type === undefined || e.subagent_type === 'general-purpose'
    return next({
      ...e,
      model: e.model ?? plan.family,
      effort: e.effort ?? plan.effort,
      ...(plan.agentType && isGeneral ? { subagent_type: plan.agentType } : {}),
    })
  })

  // Ghi nhật ký bằng model mà engine thực sự dùng cho subagent.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    const info = pendingAgents.get(e.tool_use_id)
    pendingAgents.delete(e.tool_use_id)
    const entry: RouteEvent = {
      at: await $.clock.now(),
      where: 'agent',
      label: e.description || e.subagentType,
      family: familyOf(result.model) ?? info?.family ?? 'sonnet',
      ...(info ? { effort: info.effort } : {}),
      agentType: e.subagentType,
      reason: info?.reason ?? (e.workflow ? 'agent của workflow' : 'không qua điều phối'),
      isApplied: info?.isApplied ?? false,
    }
    await update($, coreState, S.withLog(entry))
    return result
  }).catch(($, e, next) => next(e))

  // ------------------------------------------ 3. giữ nhất quán

  // Tool plan chỉ đổi trạng thái nội bộ của mod: không cần hỏi quyền.
  on('tool.check', { tool: 'mcp__focus-conductor__plan' }, () => ({
    decision: 'allow' as const,
    reason: 'focus-conductor: checklist nội bộ của phiên',
  }))

  on('tool.call', { tool: 'mcp__focus-conductor__plan' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: 'Checklist chỉ dành cho luồng chính; subagent bỏ qua và làm đúng nhiệm vụ được giao.' }
    }
    const input = e as unknown as PlanInput
    const outcome = applyPlan((await read($, coreState)).plan, input)
    if (outcome.error !== undefined) return { deny: outcome.error }

    // "set" chốt lại mục tiêu và các bước: làm mới cả từ khóa của brief để
    // việc nhận diện prompt tiếp nối dựa trên mục tiêu mới, không phải mục tiêu cũ.
    const isSet = input.action === 'set'
    const titles = outcome.plan.map(step => step.title)
    const core = await update($, coreState, c => {
      const withPlan = S.withPlan(outcome.plan)(c)
      return isSet ? S.withRetarget(outcome.goal, titles)(withPlan) : withPlan
    })
    tracker.planUpdates += 1
    if (input.status === 'verified') {
      tracker.isVerified = true
      tracker.mutationsSinceCheck = 0
    }
    $.ui.status(S.statusOf(await read($, view)))
    return { result: renderPlan(core.brief, core.plan) }
  }).catch(() => ({ deny: 'focus-conductor: lỗi nội bộ khi cập nhật checklist; tiếp tục làm việc không cần tool này.' }))

  // Mọi tool của luồng chính: phát hiện lặp lỗi, vượt ngân sách, ngoài phạm
  // vi, và nhắc checkpoint. Lời nhắc đi kèm kết quả tool (context), không
  // sửa system prompt, nên không ảnh hưởng cache.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.deny !== undefined || e.tool === PLAN_TOOL_FULL) return result
    if ((await read($, mode)) === 'off') return result

    const core = await read($, coreState)
    const findings = observe(
      tracker,
      {
        tool: e.tool,
        input: e as unknown as Record<string, unknown>,
        isError: result.isError === true,
        isReadOnly: result.isReadOnly === true,
      },
      core.brief,
      core.plan,
    )
    if (findings.length === 0) return result

    const at = await $.clock.now()
    const warnings: Warning[] = []
    for (const finding of findings) {
      if (finding.kind === 'checkpoint') continue
      warnings.push({ at, kind: finding.kind, text: finding.text })
      if (finding.kind === 'loop' || finding.kind === 'scope') $.ui.toast(finding.text)
    }
    if (warnings.length > 0) await update($, coreState, S.withWarnings(...warnings))

    const top = findings.filter(f => f.context).sort((a, b) => b.priority - a.priority)[0]
    if (!top?.context) return result
    return { ...result, context: [...(result.context ?? []), top.context] }
  }).catch(($, e, next) => next(e))

  // Claude định kết thúc mà checklist còn mở: yêu cầu hoàn thành hoặc giải
  // thích. stop_hook_active chặn vòng lặp: chỉ nhắc một lần mỗi lần dừng.
  // Turn chỉ hỏi đáp (không thay đổi gì, không đụng checklist) thì không chặn.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block || result.preventContinuation || e.stop_hook_active || !isExecuting(tracker)) return result
    if (options['enforceChecklist'] !== true || (await read($, mode)) === 'off') return result
    const plan = (await read($, coreState)).plan
    if (openSteps(plan).length === 0) return result
    return { ...result, block: stopBlockReason(plan) }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || (await read($, mode)) === 'off') return result
    const core = await read($, coreState)
    const at = await $.clock.now()
    const findings = summarize(tracker, core.brief, core.plan)
    const warnings: Warning[] = findings.map(f => ({ at, kind: f.kind === 'checkpoint' ? 'unverified' : f.kind, text: f.text }))
    if (warnings.length > 0) await update($, coreState, S.withWarnings(...warnings))
    const unverified = findings.find(f => f.kind === 'unverified')
    if (unverified) $.ui.toast(unverified.text)
    $.ui.status(S.statusOf(await read($, view)))
    return result
  })

  // ------------------------------------------------------- lệnh /conductor

  on('command.run', { command: 'conductor' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()

    if (sub === '' || sub === 'show') {
      const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: opened.isPlaced ? 'Đã mở pane Focus Conductor.' : 'Pane Focus Conductor sẽ hiện khi màn hình đủ rộng.' }
    }

    if (sub === 'mode') {
      if (!S.isMode(arg)) return { text: `Chế độ phải là auto, subagents, suggest hoặc off.\n${COMMAND_HELP}` }
      await update($, modeState, () => arg)
      $.ui.status(S.statusOf(await read($, view)))
      return { text: `Focus Conductor chuyển sang chế độ ${arg}.` }
    }

    if (sub === 'reset') {
      resetLocal()
      await update($, coreState, S.resetCore)
      $.ui.status(S.statusOf(await read($, view)))
      return { text: 'Đã xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn.' }
    }

    if (sub === 'goal') {
      if (arg === '') return { text: 'Cần mô tả mục tiêu: /conductor goal kèm mô tả' }
      const prev = (await read($, coreState)).brief
      const brief: Brief = { ...analyzeHeuristic(arg, null, await $.clock.now()), goalId: (prev?.goalId ?? 0) + 1 }
      await update($, coreState, S.adoptGoal(brief))
      isGoalNew = true
      pinnedGoalId = null
      $.ui.status(S.statusOf(await read($, view)))
      const preview = previewRoute(brief, wantedMain(brief.tier, options, blocked))
      return {
        text: `Đã đặt mục tiêu: ${brief.goal} (${brief.tier}).`,
        context: [`Người dùng đặt mục tiêu thủ công.\n${briefContext(brief, preview)}`],
      }
    }

    if (sub === 'status') {
      const { core, mode: current } = await read($, view)
      if (core.brief === null) return { text: `Chế độ ${current}. Chưa có mục tiêu.` }
      const routeLine = core.route ? `${describePick(core.route)} (${core.route.reason})` : 'model của phiên'
      const blockedLine = blocked.size > 0 ? `\nModel tạm ngừng dùng: ${[...blocked].join(', ')}` : ''
      return { text: `Chế độ ${current}\nLuồng chính: ${routeLine}${blockedLine}\n${renderPlan(core.brief, core.plan)}` }
    }

    return { text: COMMAND_HELP }
  })

  // ------------------------------------------------------- giao diện

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const tree = renderBand($.ui.resolve(e), await read($, view), e.props.maxRows, {
      onDetails: () => $.ui.open({ id: PANE, title: PANE_TITLE }),
      onHide: () => update($, bandHiddenState, () => true),
    })
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'focus-conductor' }, async ($, e) =>
    renderPane($.ui.resolve(e), await read($, view), {
      onMode: picked => update($, modeState, () => picked),
      onReset: async () => {
        resetLocal()
        await update($, coreState, S.resetCore)
      },
      onToggleBand: () => update($, bandHiddenState, hidden => !hidden),
    }),
  )
}
