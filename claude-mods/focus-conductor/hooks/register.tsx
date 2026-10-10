// focus-conductor: điểm vào của mod. File này nối hook với các module thuần
// trong lib/ và ui/. Theo quy tắc của engine, $ chỉ được dùng tại chỗ trong
// thân hook ($.noun.event(...), read($, ...), update($, ...)), nên mọi lệnh
// gọi $ nằm ở đây; lib/ và ui/ chỉ tính toán và dựng cây giao diện.
//
// Luồng một turn:
//   prompt.submit  đọc prompt (cục bộ, tùy chọn Haiku làm nguồn chính), lưu brief
//                  (độ sâu, khối lượng, bản chất), gắn khối phân tích vào context.
//   turn.step      step đầu tiên của turn chốt model + effort cho luồng chính, theo
//                  độ sâu, khối lượng và chi phí ghi lại cache. Mọi step sau giữ nguyên.
//   tool.call      Agent: chọn model/effort cho subagent theo độ khó, không thấp hơn
//                  mức của mục tiêu cha. plan: checklist của Claude. Mọi tool: theo
//                  dõi lặp lỗi, vượt ngân sách, ngoài phạm vi, nhắc checkpoint.
//   classic.Stop   checklist còn mở thì yêu cầu hoàn thành hoặc giải thích.
//   turn.complete  cộng chi phí đo được vào sổ (luồng chính hoặc subagent theo agentId),
//                  hiệu chỉnh ước lượng, tổng kết cảnh báo cuối turn.
// Giao diện: band trên prompt, pane chi tiết, status line, lệnh /conductor.

import { atom, derive, read, update } from 'claude-code'
import type { PromptOrigin, Register } from 'claude-code'

import type { Brief, Core, Depth, Effort, Lift, Mode, ModelFamily, Route, RouteEvent, Tier, Warning } from '../types'
import { analyzeHeuristic, analyzerRequest, isSameIdea, localRelation, mergeAnalysis } from './lib/analyze'
import { filePathOf, isExecuting, isPlanFile, newTracker, observe, openSteps, summarize } from './lib/drift'
import type { TurnTracker } from './lib/drift'
import { DEFAULT_CONTEXT, fixedContextTokens, turnCost } from './lib/cost'
import { addUsage, calibrate, countSpawn, formatUsd, ledgerLines } from './lib/ledger'
import { PLAN_TOOL_SPEC, applyPlan } from './lib/plan'
import type { PlanInput } from './lib/plan'
import {
  EFFORTS,
  adviseSubtasks,
  applySession,
  decideMain,
  describePick,
  familyOf,
  familyRank,
  matchSubtask,
  parseModelMap,
  parseWindows,
  planAgent,
  raisePick,
  resolveModelId,
  wantedMain,
} from './lib/route'
import type { AgentPlan, Choice, SessionModel, SessionPolicy, SubtaskAdvice } from './lib/route'
import { stepDepth } from './lib/scale'
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
/** Số subagent trong một mục tiêu trước khi cảnh báo chi phí fan-out (chỉ cảnh báo, không chặn). */
const FANOUT_WARN = 6
/** Ngữ cảnh rớt xuống dưới tỷ lệ này so với turn trước thì coi là đã nén (compaction). */
const COMPACTION_DROP = 0.6
/** Cửa sổ ngữ cảnh khi chưa đọc được từ phiên [Giả định]. */
const DEFAULT_WINDOW = 200_000
/** Tool sửa file của luồng chính (dùng để nhắc giao việc đã phân). */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Số lỗi tool trong một turn để nâng effort cho turn sau. */
const ERROR_BURST = 3

const COMMAND_HELP = [
  '/conductor             mở pane Focus Conductor',
  '/conductor status      tóm tắt mục tiêu, checklist, điều phối và chi phí',
  '/conductor mode X      X là auto, subagents, suggest hoặc off',
  '/conductor goal ...    đặt mục tiêu thủ công',
  '/conductor reset       xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn',
].join('\n')

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function previewRoute(brief: Brief, pick: Choice): Route {
  return { family: pick.family, effort: pick.effort, tier: brief.tier, goalId: brief.goalId, reason: 'dự kiến' }
}

export const register: Register = (on, options) => {
  // Biến module: chỉ giữ thứ tạm thời của turn đang chạy; hot-reload làm
  // mất chúng mà không ảnh hưởng tính đúng (trạng thái bền nằm trong $.state).
  let tracker: TurnTracker = newTracker('')
  let turnRoute: { turnId: string; route: Route | null } = { turnId: '', route: null }
  let turnContext = 0
  let isGoalNew = false
  let lastSession: { model: string; effort: string } | null = null
  let sessionFamily: ModelFamily | null = null
  let sessionNoticed = false
  let pinnedGoalId: number | null = null
  const blocked = new Set<ModelFamily>()
  // Một lần lỗi có thể chỉ là tạm thời (429, quá tải): chỉ chặn một họ model
  // khi nó lỗi ở hai turn liên tiếp, và tự hết chặn sau BLOCK_TURNS turn.
  const failures = new Map<ModelFamily, { count: number; lastTurn: number }>()
  const blockedUntil = new Map<ModelFamily, number>()
  let turnCount = 0
  const offered = new Set<string>()
  // Một lời gọi Agent đang chờ spawn: kế hoạch, model và effort thật sự đã gửi đi.
  const pendingAgents = new Map<
    string,
    AgentPlan & { isApplied: boolean; description: string; sentFamily: ModelFamily | null; sentEffort: Effort }
  >()
  // Subagent đã khởi động. `pick` là model và effort mod đã điều phối; `sentEffort` là effort thật
  // lần gần nhất engine nhận; `enforceModel` là mod được phép ép model (không khi model không thuộc họ Claude,
  // hoặc agent workflow do script chọn model).
  type AgentMeta = {
    description: string
    tier: Tier
    goalId: number
    family: ModelFamily
    effort: Effort
    volume: AgentPlan['volume']
    depth: Depth
    pick: Choice
    applied: boolean
    enforceModel: boolean
    sentEffort?: Effort
    warned: boolean
    fallback: boolean
  }
  const agents = new Map<string, AgentMeta>()
  const agentTrackers = new Map<string, TurnTracker>()
  const agentFailures: { description: string; goalId: number }[] = []
  const modelMap = parseModelMap(options['modelMap'])
  const rawPolicy = options['sessionModel']
  const sessionPolicy: SessionPolicy = rawPolicy === 'ceiling' || rawPolicy === 'fixed' ? rawPolicy : 'auto'
  const ttl = Number(options['cacheTtlMinutes'])
  const cacheTtlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 5) * 60_000
  const contextWindows = parseWindows(options['contextWindows'])
  let lastWindow = DEFAULT_WINDOW
  // Việc đã ghi "giao subagent" của mục tiêu hiện tại mà chưa có Agent nào nhận.
  let delegation = { goalId: -1, pending: new Map<number, string>(), isNudged: false, isWarned: false }

  // Một lần đọc cho mọi thứ band, pane và status line cần.
  const view = derive(
    [coreState, modeState, bandHiddenState],
    (core, override, isBandHidden): View => ({
      core: S.normalizeCore(core),
      mode: S.modeOf(override, options),
      isBandHidden,
    }),
  )
  const mode = derive([modeState], (override): Mode => S.modeOf(override, options))

  /** Chấm model và effort cho từng việc đã tách của mục tiêu (rỗng khi chưa đủ việc để giao). */
  function adviceFor(brief: Brief, main: Choice) {
    return adviseSubtasks({
      subtasks: brief.attached?.subtasks ?? brief.subtasks,
      main,
      allowFable: options['allowFable'] === true,
      blocked,
      offered,
      session: sessionModel(),
    })
  }

  /**
   * Phân việc của một brief: với prompt đính kèm (chỉ để đối chiếu) thì so với luồng chính
   * của chính prompt đó và không giao subagent; còn lại theo luồng chính đã chọn.
   */
  function adviceOf(brief: Brief, expected: Choice, lift: Lift): { advice: SubtaskAdvice[]; reference?: string } {
    if (!brief.attached) return { advice: adviceFor(brief, expected) }
    const main = wantedMain(brief.attached, lift, options, blocked, sessionModel())
    return { advice: adviceFor(brief, main), reference: describePick(main) }
  }

  /** Xóa phần trạng thái cục bộ (không thuộc $.state). */
  function resetLocal(): void {
    tracker = newTracker('')
    turnRoute = { turnId: '', route: null }
    turnContext = 0
    isGoalNew = false
    lastSession = null
    sessionFamily = null
    sessionNoticed = false
    pinnedGoalId = null
    blocked.clear()
    failures.clear()
    blockedUntil.clear()
    turnCount = 0
    agents.clear()
    agentTrackers.clear()
    agentFailures.length = 0
    delegation = { goalId: -1, pending: new Map(), isNudged: false, isWarned: false }
    lastWindow = DEFAULT_WINDOW
    pendingAgents.clear()
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

  /** Chính sách model của phiên dùng cho mọi lựa chọn (luồng chính và subagent). */
  function sessionModel(): SessionModel | null {
    return sessionFamily ? { family: sessionFamily, policy: sessionPolicy } : null
  }

  /**
   * Quyết định model + effort cho luồng chính so với mốc đang chạy, theo chi phí
   * cache (dùng cho turn thật và cho bản dự kiến lúc nhận prompt).
   */
  function mainDecision(args: {
    core: Core
    brief: Brief
    wanted: Choice
    model: string
    effort: string
    at: number
    context: number
    window: number
    turnsLeft: number
  }) {
    const { core, brief, wanted, model, effort, at, context, window } = args
    // Cache đã nguội (quá TTL), hoặc ngữ cảnh vừa bị nén: đổi model không mất gì.
    const isFree =
      core.lastTurnAt === 0 ||
      at - core.lastTurnAt > cacheTtlMs ||
      (core.lastContext > 0 && context < COMPACTION_DROP * core.lastContext)
    // Route trước bị bỏ (người dùng tự đổi model, hoặc model được chọn không phản
    // hồi): mốc so sánh chi phí là model và effort engine đang thực sự chạy.
    const engineFamily = familyOf(model)
    const baseline: Route | null =
      core.route ??
      (core.lastTurnAt > 0 && engineFamily !== null
        ? {
            family: engineFamily,
            effort: EFFORTS.find(x => x === effort) ?? 'medium',
            tier: brief.tier,
            goalId: brief.goalId,
            reason: 'model của engine',
          }
        : null)
    return decideMain({
      current: baseline,
      wanted,
      volume: brief.volume,
      tier: brief.tier,
      goalId: brief.goalId,
      context,
      window,
      turnsLeft: args.turnsLeft,
      isFree,
      calib: core.ledger.calib,
      ...(core.sysTokens > 0 ? { sysTokens: core.sysTokens } : {}),
      ...(contextWindows[wanted.family] !== undefined ? { targetWindow: contextWindows[wanted.family] } : {}),
    })
  }

  /** Model luồng chính sẽ thật sự chạy cho mục tiêu mới (có tính việc giữ model để bảo toàn cache). */
  function expectedMain(core: Core, brief: Brief, wanted: Choice, at: number): Choice {
    const decision = mainDecision({
      core,
      brief,
      wanted,
      model: lastSession?.model ?? '',
      effort: lastSession?.effort ?? '',
      at,
      context: core.lastContext > 0 ? core.lastContext : DEFAULT_CONTEXT,
      window: lastWindow,
      turnsLeft: 2,
    })
    return decision.isHeld ? { family: decision.route.family, effort: decision.route.effort } : wanted
  }

  /** Ghi lại các việc được giao subagent của mục tiêu mới để theo dõi. */
  function trackDelegations(goalId: number, advice: readonly SubtaskAdvice[]): void {
    const pending = new Map<number, string>()
    for (const item of advice) {
      if (!item.direct) pending.set(item.subtask.index, `${item.subtask.index} (${describePick(item.pick)})`)
    }
    delegation = { goalId, pending, isNudged: false, isWarned: false }
  }

  /** Danh sách việc giao còn chờ của mục tiêu này, rỗng nếu không có. */
  function pendingFor(brief: Brief | null): string[] {
    return brief && delegation.goalId === brief.goalId ? [...delegation.pending.values()] : []
  }

  /**
   * Quyết định route cho một turn của luồng chính (thuần, không gọi $).
   * `stored` là route ghi vào $.state làm mốc cache cho turn sau. `notices` là
   * thông báo một lần (toast) mà hook sẽ hiện.
   */
  function decideTurn(args: {
    core: Core
    model: string
    effort: string
    current: Mode
    at: number
    context: number
    window: number
  }) {
    const { core, model, effort, current, at, context, window } = args
    const logs: RouteEvent[] = []
    const notices: string[] = []
    const brief = core.brief
    if (brief === null) return { route: null, stored: core.route, logs, notices }

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
    if (pinnedGoalId === brief.goalId) return { route: null, stored: null, logs, notices }

    const wanted = wantedMain(brief, core.lift, options, blocked, sessionModel())
    const decision = mainDecision({ core, brief, wanted, model, effort, at, context, window, turnsLeft: isGoalNew ? 2 : 1 })
    isGoalNew = false
    const capNote = wanted.capped ? ' (bị giới hạn bởi model của phiên)' : ''
    if (decision.isChanged || decision.isHeld || core.route?.goalId !== brief.goalId) {
      const shown = decision.isHeld ? decision.wanted : decision.route
      logs.push({
        at,
        where: 'main',
        label: 'turn',
        family: shown.family,
        effort: shown.effort,
        reason: (current === 'suggest' ? `${decision.reason} (chỉ đề xuất)` : decision.reason) + capNote,
        isApplied: current === 'auto' && !decision.isHeld,
      })
    }
    if (
      sessionPolicy === 'auto' &&
      sessionFamily !== null &&
      current === 'auto' &&
      !decision.isHeld &&
      decision.route.family !== sessionFamily &&
      !sessionNoticed
    ) {
      sessionNoticed = true
      notices.push(`Focus Conductor chạy luồng chính bằng ${decision.route.family}, khác model của phiên (${sessionFamily}).`)
    }
    return { route: decision.route, stored: decision.route, logs, notices }
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

    const before = S.normalizeCore(await read($, coreState))
    const prev = before.brief
    let brief = analyzeHeuristic(text, prev, await $.clock.now())
    // Haiku là nguồn chính khi bật analyzer model: hỏi cho mục tiêu mới (bỏ câu
    // xã giao dưới 4 từ), và cho bước tinh chỉnh từ 6 từ trở lên.
    const relation = localRelation(text, prev)
    const words = wordCount(text)
    const askModel =
      options['analyzer'] === 'model' && (relation === 'new' ? words >= 4 : relation === 'refine' && words >= 6)
    if (askModel) {
      $.ui.status('đang đọc prompt...')
      const reply = await $.model.complete(analyzerRequest(text, prev)).catch(() => null)
      if (reply?.isAnswered) {
        await update($, coreState, S.withLedger(ledger => addUsage(ledger, 'analyzer', 'haiku', reply.usage).ledger))
        brief = mergeAnalysis(brief, prev, reply.text, text)
      }
    }

    const isNewGoal = prev === null || brief.goalId !== prev.goalId
    const core = await update($, coreState, isNewGoal ? S.adoptGoal(brief) : S.withBrief(brief))
    if (isNewGoal) {
      isGoalNew = true
      pinnedGoalId = null
    }

    const wanted = wantedMain(brief, core.lift, options, blocked, sessionModel())
    // Model sẽ thật sự chạy (có thể là model cũ được giữ để bảo toàn cache): phân việc so với model này.
    const expected = isNewGoal ? expectedMain(core, brief, wanted, await $.clock.now()) : wanted
    const shown = isNewGoal ? adviceOf(brief, expected, core.lift) : { advice: [] }
    if (isNewGoal) trackDelegations(brief.goalId, brief.attached ? [] : shown.advice)
    const context = isNewGoal
      ? briefContext(brief, previewRoute(brief, expected), shown.advice, shown.reference)
      : followUpContext(brief, core.plan, brief.constraints.filter(c => !prev?.constraints.includes(c)))
    // Checklist cũ còn bước mở bị bỏ theo mục tiêu mới: báo, kẻo mất tiến độ trong im lặng.
    const dropped = isNewGoal ? openSteps(before.plan) : []
    const notice = dropped.length > 0 ? [droppedPlanNotice(dropped)] : []
    if (isNewGoal) {
      $.ui.toast(
        dropped.length > 0
          ? `Mục tiêu mới, checklist cũ còn ${dropped.length} bước mở đã bị bỏ`
          : `Đã đọc prompt: ${brief.depth}, khối lượng ${brief.volume}, luồng chính ${describePick(expected)}`,
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
    // Subagent: ép effort (và model, với agent workflow không do script chọn) theo điều phối đã ghi.
    if (e.agentId !== undefined) {
      const agent = agents.get(e.agentId)
      const isEnforced =
        agent !== undefined && agent.applied && !agent.fallback && (current === 'auto' || current === 'subagents')
      if (agent === undefined || !isEnforced) {
        // Không ép: vẫn ghi effort thật engine gửi, để hiệu chỉnh chi phí theo đúng thực tế.
        const real = EFFORTS.find(x => x === e.effort)
        if (agent !== undefined && real !== undefined) agent.sentEffort = real
        return yield* next(e)
      }
      const effort = agent.pick.effort
      const model = agent.enforceModel ? resolveModelId(agent.pick.family, e.model, modelMap) : e.model
      const sent = EFFORTS.find(x => x === effort)
      if (sent !== undefined) agent.sentEffort = sent
      if (model === e.model && effort === e.effort) return yield* next(e)
      if (!agent.warned) {
        agent.warned = true
        const text = `Agent ${e.agentId.slice(0, 6)}: mod ép về ${model}/${effort} đã điều phối (engine gửi ${e.model}/${e.effort ?? 'mặc định'})`
        await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text }))
      }
      const stream = next({ ...e, model, effort })
      let chunks = 0
      try {
        for await (const chunk of stream) {
          chunks += 1
          yield chunk
        }
        const result = await stream.result
        const isEmpty = result.stopReason === null && result.usage === null
        if (!isEmpty || !agent.enforceModel || chunks > 0 || next.signal.aborted) return result
      } catch (error) {
        if (!agent.enforceModel || chunks > 0 || next.signal.aborted) throw error
      }
      // Model được chọn cho agent workflow không phản hồi: agent này quay về model của engine.
      agent.fallback = true
      const text = `Agent ${e.agentId.slice(0, 6)}: ${model} không phản hồi; agent này quay về model của engine`
      await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text }))
      $.ui.toast(text)
      return yield* next(e)
    }
    // Chế độ subagents/off không chạm luồng chính.
    if (current === 'off' || current === 'subagents') return yield* next(e)

    if (turnRoute.turnId !== e.turnId) {
      turnCount += 1
      expireBlocks()
      sessionFamily = familyOf(e.model)
      const usage = await $.session.usage().catch(() => null)
      turnContext = usage?.context.tokens ?? DEFAULT_CONTEXT
      lastWindow = usage?.context.window ?? DEFAULT_WINDOW
      // Đo một lần phần cố định của ngữ cảnh (ước lượng cục bộ của engine, không tốn request).
      if (S.normalizeCore(await read($, coreState)).sysTokens === 0) {
        const detail = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
        const fixed = fixedContextTokens(detail?.context.breakdown?.categories)
        if (fixed !== null) await update($, coreState, S.withSysTokens(fixed))
      }
      const decided = decideTurn({
        core: S.normalizeCore(await read($, coreState)),
        model: e.model,
        effort: String(e.effort ?? ''),
        current,
        at: await $.clock.now(),
        context: turnContext,
        window: lastWindow,
      })
      turnRoute = { turnId: e.turnId, route: decided.route }
      await update($, coreState, c => S.withLog(...decided.logs)(S.withRoute(decided.stored)(c)))
      for (const notice of decided.notices) $.ui.toast(notice)
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

  // Subagent: chọn model theo độ khó của việc con, không thấp hơn mức của mục
  // tiêu cha, và cao hơn một bậc khi lần trước cùng việc đã lỗi. Model Claude
  // chỉ định được giữ, trừ khi thấp hơn sàn của việc khó.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.subagent_type === 'fork') return next(e)

    const core = S.normalizeCore(await read($, coreState))
    const brief = core.brief
    const goalId = brief?.goalId ?? 0
    // Lời gọi từ trong một subagent không khớp việc của luồng chính và không đụng phần giao còn chờ
    // của luồng chính; sàn độ sâu của nó là độ sâu của agent cha.
    const parentAgent = e.agentId !== undefined ? agents.get(e.agentId) : undefined
    const isNested = e.agentId !== undefined
    // Việc này khớp một việc đã tách lúc nhận prompt: dùng đúng đánh giá đã chấm,
    // không chấm lại từ prompt của agent và không kế thừa sàn của mục tiêu cha.
    const assigned = !isNested && brief ? matchSubtask(brief.subtasks, e.description, e.prompt) : undefined
    if (assigned && brief && delegation.goalId === brief.goalId) delegation.pending.delete(assigned.index)
    const floor = isNested
      ? parentAgent !== undefined
        ? { depth: parentAgent.depth }
        : null
      : brief && !assigned
        ? { depth: stepDepth(brief.depth, core.lift.depth) }
        : null
    let plan = planAgent({
      prompt: e.prompt,
      description: e.description,
      subagentType: e.subagent_type,
      offered,
      blocked,
      allowFable: options['allowFable'] === true,
      parent: floor,
      session: sessionModel(),
      ...(assigned ? { assessed: assigned } : {}),
    })
    let reason = assigned ? `việc ${assigned.index} đã phân trước: ${plan.reason}` : plan.reason
    if (agentFailures.some(f => f.goalId === goalId && isSameIdea(f.description, e.description))) {
      plan = { ...plan, ...raisePick(plan, options['allowFable'] === true) }
      reason = 'giao lại việc đã lỗi: nâng một bậc'
    }

    let model = e.model
    // Họ model thật sự gửi đi (null khi là model không thuộc họ Claude): để so với model engine chạy.
    let sentFamily: ModelFamily | null = e.model === undefined ? plan.family : null
    if (e.model !== undefined) {
      const claude = familyOf(e.model)
      const isUnder =
        claude !== null &&
        familyRank(claude) < familyRank(plan.family) &&
        (plan.depth === 'substantial' || plan.depth === 'hard')
      // Model Claude chỉ định vẫn chịu chính sách model của phiên (ceiling, fixed).
      const allowed = claude !== null && !isUnder ? applySession(claude, sessionModel()) : null
      const isCapped = allowed !== null && allowed !== claude
      model = isUnder ? plan.family : isCapped ? allowed : e.model
      sentFamily = isUnder ? plan.family : isCapped ? allowed : claude
      reason = isUnder
        ? `Claude chọn ${e.model} thấp hơn mức việc ${plan.depth} cần; nâng lên ${plan.family}`
        : isCapped
          ? `Claude chọn ${e.model}; giới hạn về ${allowed} theo model của phiên`
          : `giữ model Claude chỉ định (${e.model}); ${reason}`
    }

    const isApplied = current === 'auto' || current === 'subagents'
    const sentEffort = e.effort ?? plan.effort
    pendingAgents.set(e.tool_use_id, { ...plan, reason, isApplied, description: e.description, sentFamily, sentEffort })
    const spawned = await update($, coreState, S.withLedger(countSpawn))
    if (spawned.ledger.goal.spawned > FANOUT_WARN && !spawned.ledger.goal.fanoutWarned) {
      const at = await $.clock.now()
      const text = `Mục tiêu này đã giao ${spawned.ledger.goal.spawned} subagent; mỗi agent có chi phí riêng, xem /conductor status`
      await update($, coreState, c =>
        S.withWarnings({ at, kind: 'cost', text })(
          S.withLedger(ledger => ({ ...ledger, goal: { ...ledger.goal, fanoutWarned: true } }))(c),
        ),
      )
      $.ui.toast(text)
    }
    if (!isApplied) return next(e)

    const isGeneral = e.subagent_type === undefined || e.subagent_type === 'general-purpose'
    return next({
      ...e,
      model: model ?? plan.family,
      effort: sentEffort,
      ...(plan.agentType && isGeneral ? { subagent_type: plan.agentType } : {}),
    })
  })

  // Ghi nhật ký bằng model mà engine thực sự dùng cho subagent, kèm chi phí ước tính. Model engine
  // chạy khác model đã điều phối (agent của Agent tool) thì ghi và cảnh báo. Agent của workflow không
  // đi qua tool.call: mod chấm nó ở đây (trừ khi script đã chọn model) rồi ép ở từng bước.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const info = pendingAgents.get(e.tool_use_id)
    pendingAgents.delete(e.tool_use_id)
    if (result.deny !== undefined) return result
    const core = S.normalizeCore(await read($, coreState))
    const goalId = core.brief?.goalId ?? 0
    const current = await read($, mode)
    const isModeApplied = current === 'auto' || current === 'subagents'
    const isWorkflow = e.workflow !== undefined
    const isScriptModel = isWorkflow && e.model !== undefined
    const workflowPlan =
      info === undefined && isWorkflow && !isScriptModel
        ? planAgent({
            prompt: e.prompt,
            description: e.description,
            subagentType: e.subagentType,
            offered,
            blocked,
            allowFable: options['allowFable'] === true,
            parent: null,
            session: sessionModel(),
          })
        : undefined
    const plan = info ?? workflowPlan
    const applied = info !== undefined ? info.isApplied : workflowPlan !== undefined && isModeApplied
    const agentId = result.agentId
    const engineFamily = familyOf(result.model)
    const family = engineFamily ?? info?.family ?? workflowPlan?.family ?? 'sonnet'
    const sent = info?.sentFamily ?? null
    const isMismatch = info !== undefined && sent !== null && engineFamily !== null && engineFamily !== sent
    const shortId = agentId?.slice(0, 6) ?? '?'
    const reason = isMismatch
      ? `${info.reason}; engine chạy ${engineFamily} thay vì ${sent}`
      : info !== undefined
        ? info.reason
        : isWorkflow
          ? isScriptModel
            ? 'agent workflow, model do script chọn'
            : `agent workflow: ${workflowPlan?.reason ?? 'chưa rõ'}`
          : 'không qua điều phối'
    const at = await $.clock.now()
    const estimate = plan
      ? turnCost(family, plan.effort, plan.volume, Math.ceil(e.prompt.length / 4), core.ledger.calib[family])
      : undefined
    const entry: RouteEvent = {
      at,
      where: 'agent',
      label: e.description || e.subagentType,
      family,
      ...(plan !== undefined ? { effort: plan.effort } : {}),
      agentType: e.subagentType,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(estimate !== undefined ? { usd: estimate, measured: false } : {}),
      reason,
      isApplied: applied,
    }
    const warnings: Warning[] = []
    const mismatchText = `Agent ${shortId}: engine chạy ${engineFamily} thay vì ${sent} đã điều phối`
    if (isMismatch) warnings.push({ at, kind: 'model', text: mismatchText })
    await update($, coreState, c => S.withWarnings(...warnings)(S.withLog(entry)(c)))
    if (isMismatch) $.ui.toast(mismatchText)
    if (agentId !== undefined && plan !== undefined) {
      agents.set(agentId, {
        description: info?.description ?? e.description,
        tier: plan.tier,
        goalId,
        family,
        effort: plan.effort,
        volume: plan.volume,
        depth: plan.depth,
        // Agent của Agent tool được ép về họ model đã gửi lúc spawn; agent workflow về họ đã chấm.
        pick: {
          family: info !== undefined ? (info.sentFamily ?? plan.family) : plan.family,
          effort: info !== undefined ? info.sentEffort : plan.effort,
        },
        applied,
        enforceModel: info === undefined ? true : info.sentFamily !== null,
        warned: false,
        fallback: false,
      })
    }
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
    const outcome = applyPlan(S.normalizeCore(await read($, coreState)).plan, input)
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

  // Mọi tool: luồng chính được nhắc (context của kết quả tool) và nâng cấp theo
  // bằng chứng cho turn sau; subagent chỉ được ghi nhật ký, không bị nhắc.
  // Lời nhắc đi kèm kết quả tool, không sửa system prompt, nên không ảnh hưởng cache.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || e.tool === PLAN_TOOL_FULL) return result
    if ((await read($, mode)) === 'off') return result

    const observation = {
      tool: e.tool,
      input: e as unknown as Record<string, unknown>,
      isError: result.isError === true,
      isReadOnly: result.isReadOnly === true,
    }

    if (e.agentId !== undefined) {
      const meta = agents.get(e.agentId)
      if (meta === undefined) return result
      const agentTracker = agentTrackers.get(e.agentId) ?? newTracker('')
      agentTrackers.set(e.agentId, agentTracker)
      const findings = observe(agentTracker, observation, { goal: meta.description, scopePaths: [], tier: meta.tier }, [])
      const at = await $.clock.now()
      const warnings: Warning[] = []
      for (const finding of findings) {
        if (finding.kind === 'checkpoint') continue
        warnings.push({ at, kind: finding.kind, text: `Agent ${e.agentId.slice(0, 6)}: ${finding.text}` })
      }
      if (warnings.length > 0) await update($, coreState, S.withWarnings(...warnings))
      return result
    }

    const core = S.normalizeCore(await read($, coreState))
    const findings = observe(tracker, observation, core.brief, core.plan)
    const isErrorBurst = tracker.errors === ERROR_BURST
    // Luồng chính bắt đầu tự sửa file trong khi còn việc đã ghi giao subagent: nhắc một lần.
    // Ghi file kế hoạch của plan mode không phải là làm một việc đã phân.
    const pending = pendingFor(core.brief)
    const planFile = isPlanFile(filePathOf(observation))
    const nudge =
      EDIT_TOOLS.has(e.tool) && !planFile && !observation.isError && pending.length > 0 && !delegation.isNudged
        ? `[focus-conductor] Phân việc còn việc ghi giao subagent chưa giao: Việc ${pending.join(', ')}. Nếu thay đổi này thuộc các việc đó, giao qua Agent với description "Việc N: ..." để chạy đúng model đã chấm.`
        : null
    if (nudge) delegation.isNudged = true
    const withNudge = (r: typeof result) => (nudge ? { ...r, context: [...(r.context ?? []), nudge] } : r)
    if (findings.length === 0 && !isErrorBurst) return withNudge(result)

    const at = await $.clock.now()
    const warnings: Warning[] = []
    let depthLift = 0
    let effortLift = 0
    for (const finding of findings) {
      if (finding.kind === 'checkpoint') continue
      warnings.push({ at, kind: finding.kind, text: finding.text })
      if (finding.kind === 'loop' || finding.kind === 'scope') $.ui.toast(finding.text)
      // Lặp lỗi: turn sau nâng độ sâu. Vượt ngân sách: turn sau nâng effort.
      if (finding.kind === 'loop') depthLift = 1
      if (finding.kind === 'budget') effortLift = 1
    }
    if (isErrorBurst) {
      warnings.push({ at, kind: 'loop', text: `${ERROR_BURST} tool call lỗi trong turn này: turn sau nâng effort một bậc` })
      effortLift = 1
    }
    const lifts = depthLift > 0 || effortLift > 0
    if (warnings.length > 0 || lifts) {
      await update($, coreState, c => {
        const withWarnings = S.withWarnings(...warnings)(c)
        return lifts ? S.withLift(depthLift, effortLift)(withWarnings) : withWarnings
      })
    }

    const top = findings.filter(f => f.context).sort((a, b) => b.priority - a.priority)[0]
    if (!top?.context) return withNudge(result)
    return withNudge({ ...result, context: [...(result.context ?? []), top.context] })
  }).catch(($, e, next) => next(e))

  // Claude định kết thúc mà checklist còn mở: yêu cầu hoàn thành hoặc giải
  // thích. stop_hook_active chặn vòng lặp: chỉ nhắc một lần mỗi lần dừng.
  // Turn chỉ hỏi đáp (không thay đổi gì, không đụng checklist) thì không chặn.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block || result.preventContinuation || e.stop_hook_active || !isExecuting(tracker)) return result
    if (options['enforceChecklist'] !== true || (await read($, mode)) === 'off') return result
    const plan = S.normalizeCore(await read($, coreState)).plan
    if (openSteps(plan).length === 0) return result
    return { ...result, block: stopBlockReason(plan) }
  }).catch(($, e, next) => next(e))

  // Chi phí đo được: luồng chính (không có agentId) vào nhóm luồng chính; subagent
  // vào nhóm agent và gắn vào dòng nhật ký của đúng agent. Hiệu chỉnh ước lượng theo số đo.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, mode)) === 'off') return result
    const at = await $.clock.now()

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const meta = agents.get(agentId)
      if (e.usage) {
        const family = familyOf(e.usage.model) ?? meta?.family ?? 'sonnet'
        const core = S.normalizeCore(await read($, coreState))
        const added = addUsage(core.ledger, 'agent', family, e.usage)
        const ledger =
          meta !== undefined
            ? calibrate(added.ledger, family, e.usage.output_tokens, meta.volume, meta.sentEffort ?? meta.pick.effort)
            : added.ledger
        await update($, coreState, c => S.withAgentUsd(agentId, added.usd)(S.withLedger(() => ledger)(c)))
      }
      if (e.reason === 'error' && meta !== undefined) {
        agentFailures.push({ description: meta.description, goalId: meta.goalId })
        if (agentFailures.length > 10) agentFailures.shift()
      }
      return result
    }

    const core = S.normalizeCore(await read($, coreState))
    const findings = summarize(tracker, core.brief, core.plan)
    const warnings: Warning[] = findings.map(f => ({
      at,
      kind: f.kind === 'checkpoint' ? 'unverified' : f.kind,
      text: f.text,
    }))
    let ledger = core.ledger
    if (e.usage) {
      const family = familyOf(e.usage.model) ?? core.route?.family ?? 'sonnet'
      const added = addUsage(core.ledger, 'main', family, e.usage)
      // Chỉ hiệu chỉnh khi route của chính turn này đã được áp (chế độ auto, không
      // quay về model của engine); nếu không, effort thực tế không phải effort của route.
      const applied = turnRoute.turnId === e.turnId ? turnRoute.route : null
      const isApplied = applied !== null && (await read($, mode)) === 'auto'
      ledger =
        isApplied && core.brief
          ? calibrate(added.ledger, family, e.usage.output_tokens, core.brief.volume, applied.effort)
          : added.ledger
    }
    // Turn có thực thi mà các việc ghi giao subagent vẫn chưa được giao: cảnh báo chi phí một lần.
    const waiting = pendingFor(core.brief)
    if (waiting.length > 0 && !delegation.isWarned && isExecuting(tracker)) {
      delegation.isWarned = true
      warnings.push({ at, kind: 'cost', text: `Việc ${waiting.join(', ')} ghi giao subagent nhưng chưa được giao; luồng chính tự làm sẽ chạy ở model đắt hơn` })
    }
    const end = await $.session.usage().catch(() => null)
    const endContext = end?.context.tokens ?? turnContext
    await update($, coreState, c => S.withTurnMark(at, endContext)(S.withLedger(() => ledger)(S.withWarnings(...warnings)(c))))
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
      return { text: 'Đã xóa mục tiêu, checklist, cảnh báo, sổ chi phí và danh sách model bị chặn.' }
    }

    if (sub === 'goal') {
      if (arg === '') return { text: 'Cần mô tả mục tiêu: /conductor goal kèm mô tả' }
      const prev = S.normalizeCore(await read($, coreState)).brief
      const brief: Brief = { ...analyzeHeuristic(arg, null, await $.clock.now()), goalId: (prev?.goalId ?? 0) + 1 }
      await update($, coreState, S.adoptGoal(brief))
      isGoalNew = true
      pinnedGoalId = null
      $.ui.status(S.statusOf(await read($, view)))
      const wanted = wantedMain(brief, S.EMPTY_LIFT, options, blocked, sessionModel())
      const expected = expectedMain(S.normalizeCore(await read($, coreState)), brief, wanted, await $.clock.now())
      const shown = adviceOf(brief, expected, S.EMPTY_LIFT)
      trackDelegations(brief.goalId, brief.attached ? [] : shown.advice)
      return {
        text: `Đã đặt mục tiêu: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}).`,
        context: [`Người dùng đặt mục tiêu thủ công.\n${briefContext(brief, previewRoute(brief, expected), shown.advice, shown.reference)}`],
      }
    }

    if (sub === 'status') {
      const { core, mode: current } = await read($, view)
      const usage = await $.session.usage().catch(() => null)
      const costLines = ledgerLines(core.ledger)
      if (core.sysTokens > 0) costLines.push(`Phần cố định của ngữ cảnh (system prompt, tools): ${Math.round(core.sysTokens / 1000)}k token, đo ở đầu phiên`)
      if (usage?.cost) costLines.push(`Chi phí cả phiên theo Claude Code (gồm cả phần trước khi mod bắt đầu ghi sổ): ${formatUsd(usage.cost.usd)}`)
      if (core.brief === null) return { text: [`Chế độ ${current}. Chưa có mục tiêu.`, ...costLines].join('\n') }
      const routeLine = core.route ? `${describePick(core.route)} (${core.route.reason})` : 'model của phiên'
      const blockedLine = blocked.size > 0 ? `\nModel tạm ngừng dùng: ${[...blocked].join(', ')}` : ''
      const judged = `Đánh giá: độ sâu ${core.brief.depth}, khối lượng ${core.brief.volume}, bản chất ${core.brief.kind}`
      const agentLines = core.log
        .filter(entry => entry.where === 'agent')
        .slice(-5)
        .map(entry => {
          const cost = entry.usd !== undefined ? ` ${formatUsd(entry.usd)}${entry.measured ? '' : ' ước tính'}` : ''
          return `  ${entry.label}: ${entry.family}${entry.effort ? `/${entry.effort}` : ''}${cost} (${entry.reason})`
        })
      const agentBlock = agentLines.length > 0 ? `\nSubagent gần nhất:\n${agentLines.join('\n')}` : ''
      return {
        text: [
          `Chế độ ${current}`,
          judged,
          `Luồng chính: ${routeLine}${blockedLine}`,
          renderPlan(core.brief, core.plan),
          ...costLines,
        ].join('\n') + agentBlock,
      }
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
