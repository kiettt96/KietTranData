// Ngữ cảnh dùng chung của các hook: hằng số, tùy chọn đã đọc, trạng thái tạm (local) và các hàm thuần
// mà nhiều nhóm hook cùng dùng. Không gọi $: lệnh gọi $ nằm trong thân hook ở hooks/parts/.

import type { PluginOptions, PromptOrigin } from 'claude-code'
import type { Brief, Choice, Core, Effort, Lift, Mode, ModelFamily, Route, RouteEvent, Task, Tier, Volume } from '../types'
import { newEvidenceLog, newTracker } from './lib/drift'
import type { EvidenceLog, TurnTracker } from './lib/drift'
import { DEFAULT_CONTEXT, DEFAULT_WINDOWS, applyPrices, parsePrices } from './lib/cost'
import { EFFORTS, decideMain, describePick, familyOf, liftPick, parseModelMap, parseWindows } from './lib/route'
import type { SessionModel, SessionPolicy } from './lib/route'
import { DECISION_LIMIT, decisionLine } from './lib/decisions'
import type { DecisionKind } from './lib/decisions'
import { fitPick, skipKey } from './lib/router'
import type { AgentRoute, Policy } from './lib/router'

/** Prompt do chính người dùng gửi (hoặc lịch họ đặt), không phải thông báo nội bộ. */
export const PERSON_ORIGINS = new Set<PromptOrigin['kind']>(['composer', 'bridge', 'sdk', 'scheduled-trigger'])

/** Lệnh slash (/conductor, /plugin:cmd), không phải đường dẫn như /home/... */
export const SLASH_COMMAND = /^\/[a-z][\w:-]*(\s|$)/i

/** Số turn liên tiếp một họ model phải lỗi mới bị chặn, và số turn bị chặn. */
export const FAIL_LIMIT = 2
export const BLOCK_TURNS = 5
/** Số subagent trong một mục tiêu trước khi cảnh báo chi phí fan-out (chỉ cảnh báo, không chặn). */
export const FANOUT_WARN = 6
/** Ngữ cảnh rớt xuống dưới tỷ lệ này so với turn trước thì coi là đã nén (compaction). */
export const COMPACTION_DROP = 0.6
/** Cửa sổ ngữ cảnh khi chưa đọc được từ phiên [Giả định]. */
export const DEFAULT_WINDOW = 200_000
/** Router lỗi liên tiếp bấy nhiêu lần thì tạm bỏ qua router trong ROUTER_PAUSE prompt kế tiếp. */
export const ROUTER_FAIL_LIMIT = 2
export const ROUTER_PAUSE = 3
/** Số kết quả chấm subagent nhớ lại trong phiên (agent workflow lặp lại không hỏi router lần nữa). */
export const AGENT_ROUTE_LIMIT = 50
/** Tool sửa file của luồng chính (dùng để nhắc giao việc đã phân). */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** strictDelegation "block": số lần tối đa từ chối luồng chính sửa file trong một mục tiêu. */
export const BLOCK_EDITS = 2
/** Số lỗi tool trong một turn để nâng effort cho turn sau. */
export const ERROR_BURST = 3

export const COMMAND_HELP = [
  '/conductor             mở pane Focus Conductor',
  '/conductor status      tóm tắt mục tiêu, checklist, điều phối và chi phí',
  '/conductor mode X      X là auto, subagents, suggest hoặc off',
  '/conductor goal ...    đặt mục tiêu thủ công',
  '/conductor reroute     router đọc lại prompt gần nhất (kể cả khi router đang tạm ngừng)',
  '/conductor reset       xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn',
].join('\n')

export function createContext(options: PluginOptions) {
  // Trạng thái tạm của turn và phiên: hot-reload làm mất chúng mà không ảnh hưởng tính đúng
  // (trạng thái bền nằm trong $.state).
  const local = {
    tracker: newTracker('') as TurnTracker,
    /** Lệnh và file luồng chính đã chạy trong mục tiêu hiện tại: đối chiếu evidence khi Claude ghi "verified". */
    evidenceLog: newEvidenceLog(-1) as EvidenceLog,
    turnRoute: { turnId: '', route: null } as { turnId: string; route: Route | null },
    turnContext: 0,
    isGoalNew: false,
    lastSession: null as { model: string; effort: string } | null,
    sessionFamily: null as ModelFamily | null,
    sessionNoticed: false,
    pinnedGoalId: null as number | null,
    turnCount: 0,
    /** Log quyết định (JSONL) của phiên, nối tiếp file cũ nếu có. */
    decisions: [] as string[],
    /** Prompt gần nhất đã qua router, brief trước nó và số mục tiêu sau lượt đó: cho /conductor reroute. */
    lastPrompt: null as { text: string; prev: Brief | null; goalId: number | null } | null,
    /** Lần đổi model gần nhất của phiên (classic.PostModelSwitch): người dùng hay engine tự đổi. */
    lastSwitch: null as { source: string; toModel: string } | null,
    /** Số prompt đã qua router; router lỗi liên tiếp thì tạm bỏ qua tới prompt `pausedUntil`. */
    promptCount: 0,
    routerTrouble: { failures: 0, pausedUntil: 0 },
    /** Router chấm subagent có bộ đếm riêng (theo số lần chấm): lỗi ở đó không làm tạm ngừng router đọc prompt. */
    agentCalls: 0,
    agentTrouble: { failures: 0, pausedUntil: 0 },
    lastWindow: DEFAULT_WINDOW,
    /** Việc đã ghi "giao subagent" của mục tiêu hiện tại mà chưa có Agent nào nhận. */
    delegation: { goalId: -1, pending: new Map<number, string>(), isNudged: false, isWarned: false, blocks: 0 },
  }
  const blocked = new Set<ModelFamily>()
  // Một lần lỗi có thể chỉ là tạm thời (429, quá tải): chỉ chặn một họ model
  // khi nó lỗi ở hai turn liên tiếp, và tự hết chặn sau BLOCK_TURNS turn.
  const failures = new Map<ModelFamily, { count: number; lastTurn: number }>()
  const blockedUntil = new Map<ModelFamily, number>()
  // Loại agent engine đang mời (agent.offer), kèm mô tả: danh mục thật của phiên cho router.
  const offered = new Map<string, string>()
  // Một lời gọi Agent đang chờ spawn: kết quả điều phối (null khi router không chấm được),
  // và họ model, effort thật sự đã gửi đi (null khi để engine tự chọn).
  type PendingAgent = {
    route: AgentRoute | null
    reason: string
    isApplied: boolean
    description: string
    sentFamily: ModelFamily | null
    sentEffort: Effort | null
  }
  const pendingAgents = new Map<string, PendingAgent>()
  // Subagent đã khởi động. `pick` là model và effort mod đã điều phối; `sentEffort` là effort thật
  // lần gần nhất engine nhận; `enforceModel` là mod được phép ép model (không khi model không thuộc họ Claude,
  // hoặc agent workflow do script chọn model).
  type AgentMeta = {
    description: string
    tier: Tier
    goalId: number
    family: ModelFamily
    volume: Volume
    /** Dạng việc (depth/volume/kind) khi router đã chấm; null khi không có kết quả chấm (không dùng để hiệu chỉnh). */
    shape: string | null
    pick: Choice
    applied: boolean
    enforceModel: boolean
    sentEffort?: Effort
    warned: boolean
    fallback: boolean
  }
  const agents = new Map<string, AgentMeta>()
  const agentTrackers = new Map<string, TurnTracker>()
  // Subagent đã chạy step trước khi mod kịp ghi điều phối của nó: không ép model về sau (đổi giữa chừng phá cache).
  const steppedEarly = new Set<string>()
  // Agent đã lỗi trong mục tiêu: gửi kèm cho router khi chấm subagent, để router tự nâng khi giao lại.
  const agentFailures: { description: string; goalId: number }[] = []
  // Kết quả router chấm subagent, theo description + prompt.
  const agentRoutes = new Map<string, AgentRoute>()
  // Option người dùng tự bật; mặc định giữ hành vi gốc (mọi prompt qua router, router lỗi thì không đoán).
  const skipPhrases = new Set(String(options['routerSkip'] ?? '').split(',').map(skipKey).filter(Boolean))
  const routerFallback = options['routerFallback'] === 'reuse' ? 'reuse' : 'session'
  const strictDelegation = options['strictDelegation'] === 'remind' || options['strictDelegation'] === 'block' ? options['strictDelegation'] : 'off'
  const remindSubagents = options['remindSubagents'] === true
  const semanticDrift = options['semanticDrift'] === true
  const decisionLog = typeof options['decisionLog'] === 'string' ? options['decisionLog'].trim() : ''
  const extraAgents = String(options['agentTypes'] ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
  // Agent engine báo đã khởi động (classic.SubagentStart), và agent đã đi qua agent.spawn của mod. Agent có trong
  // danh sách đầu mà không có trong danh sách sau là agent ngoài điều phối (untracked): mod không chấm, không ép, không đo.
  const startedAgents = new Map<string, string>()
  const spawnedIds = new Set<string>()
  const rawRouter = options['router']
  const routerModel = typeof rawRouter === 'string' && rawRouter.trim() !== '' ? rawRouter.trim() : 'sonnet'
  const routerFamily: ModelFamily = familyOf(routerModel) ?? 'sonnet'
  const modelMap = parseModelMap(options['modelMap'])
  const rawPolicy = options['sessionModel']
  const sessionPolicy: SessionPolicy = rawPolicy === 'ceiling' || rawPolicy === 'fixed' ? rawPolicy : 'auto'
  const ttl = Number(options['cacheTtlMinutes'])
  const cacheTtlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 5) * 60_000
  // Cửa sổ mặc định chỉ áp cho họ dùng model ID mặc định của mod (modelMap đổi ID thì người dùng khai cửa sổ của ID đó).
  const defaultWindows = Object.fromEntries(
    Object.entries(DEFAULT_WINDOWS).filter(([family]) => modelMap[family as ModelFamily] === undefined),
  ) as Partial<Record<ModelFamily, number>>
  const contextWindows = { ...defaultWindows, ...parseWindows(options['contextWindows']) }
  applyPrices(parsePrices(options['prices']))

  /** Chính sách áp lên mọi lựa chọn của router: allowFable, model của phiên, họ đang bị chặn, loại agent dùng được. */
  function policy(): Policy {
    return { allowFable: options['allowFable'] === true, blocked, session: sessionModel(), agents: agentCatalog() }
  }

  /** Loại agent dùng được: ba loại có sẵn, loại engine đang mời, và loại người dùng khai trong agentTypes. */
  function agentCatalog(): Map<string, string> {
    const catalog = new Map<string, string>([
      ['Explore', 'read-only search and lookup, cannot edit'],
      ['Plan', 'designs an approach, no edits'],
      ['general-purpose', 'anything, including edits'],
    ])
    for (const [name, about] of offered) catalog.set(name, about || catalog.get(name) || '')
    for (const name of extraAgents) if (!catalog.has(name)) catalog.set(name, '')
    return catalog
  }

  function record(at: number, kind: DecisionKind, data: Record<string, unknown>): void {
    if (!decisionLog) return
    local.decisions.push(decisionLine(at, kind, data))
    if (local.decisions.length > DECISION_LIMIT) local.decisions = local.decisions.slice(-DECISION_LIMIT)
  }

  function decisionText(): string {
    return `${local.decisions.join('\n')}\n`
  }

  /**
   * Model luồng chính mong muốn: lựa chọn của router, nâng theo bằng chứng lúc chạy, rồi kiểm lại
   * theo chính sách hiện tại (model của phiên chỉ biết từ step đầu; họ bị chặn có thể đã đổi).
   * Null khi router chưa chọn (mod không ép).
   */
  function wantedPick(brief: Brief, lift: Lift): (Choice & { notes: string[] }) | null {
    if (brief.main === null) return null
    const lifted = liftPick(brief.main, lift, options['allowFable'] === true)
    const fitted = fitPick(lifted, brief.isReference ? 'answer' : brief.kind, policy())
    return { ...fitted.pick, notes: fitted.notes }
  }

  /** Kết quả chấm đã nhớ, kiểm lại theo chính sách hiện tại (model của phiên và họ bị chặn có thể đã đổi). */
  function refit(route: AgentRoute): AgentRoute {
    return { ...route, pick: fitPick(route.pick, route.kind, policy()).pick }
  }

  /** Model và effort luồng chính đã thật sự chạy ở lượt trước, để router nâng khi người dùng báo chưa đạt. */
  function ranText(core: Core): string | null {
    if (core.route) return describePick(core.route)
    return local.lastSession ? `${local.lastSession.model}/${local.lastSession.effort || 'mặc định'}` : null
  }

  function isRouterPaused(): boolean {
    return local.routerTrouble.pausedUntil > 0 && local.promptCount <= local.routerTrouble.pausedUntil
  }

  /** Ghi nhận một lần router trả lời được hay không; trả câu cảnh báo khi vừa tạm ngừng router. */
  function noteRouter(isOk: boolean): string | null {
    if (isOk) {
      local.routerTrouble.failures = 0
      return null
    }
    local.routerTrouble.failures += 1
    if (local.routerTrouble.failures < ROUTER_FAIL_LIMIT) return null
    local.routerTrouble = { failures: 0, pausedUntil: local.promptCount + ROUTER_PAUSE }
    return `Router (${routerModel}) lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; tạm bỏ qua router trong ${ROUTER_PAUSE} prompt tới`
  }

  function isAgentRouterPaused(): boolean {
    return isRouterPaused() || (local.agentTrouble.pausedUntil > 0 && local.agentCalls <= local.agentTrouble.pausedUntil)
  }

  /** Như noteRouter, cho router chấm subagent; tạm ngừng tính theo số lần chấm. */
  function noteAgentRouter(isOk: boolean): string | null {
    if (isOk) {
      local.agentTrouble.failures = 0
      return null
    }
    local.agentTrouble.failures += 1
    if (local.agentTrouble.failures < ROUTER_FAIL_LIMIT) return null
    local.agentTrouble = { failures: 0, pausedUntil: local.agentCalls + ROUTER_PAUSE }
    return `Router chấm subagent (${routerModel}) lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; ${ROUTER_PAUSE} subagent tới giữ lựa chọn của Claude`
  }

  /** Việc đã phân mà router nhận ra lời gọi này đang làm (kết quả chấm có số việc). */
  function recognized(brief: Brief | null, route: AgentRoute | null): Task | undefined {
    if (brief === null || brief.isReference || route?.taskIndex === undefined) return undefined
    return brief.tasks.find(t => t.index === route.taskIndex)
  }

  function rememberAgentRoute(key: string, route: AgentRoute): void {
    agentRoutes.set(key, route)
    const oldest = agentRoutes.keys().next().value
    if (agentRoutes.size > AGENT_ROUTE_LIMIT && oldest !== undefined) agentRoutes.delete(oldest)
  }

  /** Xóa phần trạng thái cục bộ (không thuộc $.state). */
  function resetLocal(): void {
    local.tracker = newTracker('')
    local.evidenceLog = newEvidenceLog(-1)
    local.turnRoute = { turnId: '', route: null }
    local.turnContext = 0
    local.isGoalNew = false
    local.lastSession = null
    local.sessionFamily = null
    local.sessionNoticed = false
    local.pinnedGoalId = null
    blocked.clear()
    failures.clear()
    blockedUntil.clear()
    local.turnCount = 0
    agents.clear()
    agentTrackers.clear()
    agentFailures.length = 0
    local.delegation = { goalId: -1, pending: new Map(), isNudged: false, isWarned: false, blocks: 0 }
    local.lastWindow = DEFAULT_WINDOW
    pendingAgents.clear()
    steppedEarly.clear()
    agentRoutes.clear()
    local.promptCount = 0
    local.routerTrouble = { failures: 0, pausedUntil: 0 }
    local.agentCalls = 0
    local.agentTrouble = { failures: 0, pausedUntil: 0 }
    local.lastPrompt = null
    local.lastSwitch = null
    startedAgents.clear()
    spawnedIds.clear()
  }

  /** Hết chặn các họ model đã bị chặn đủ BLOCK_TURNS turn, để thử lại. */
  function expireBlocks(): void {
    for (const [family, until] of blockedUntil) {
      if (until > local.turnCount) continue
      blockedUntil.delete(family)
      failures.delete(family)
      blocked.delete(family)
    }
  }

  /** Chính sách model của phiên dùng cho mọi lựa chọn (luồng chính và subagent). */
  function sessionModel(): SessionModel | null {
    return local.sessionFamily ? { family: local.sessionFamily, policy: sessionPolicy } : null
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
      model: local.lastSession?.model ?? '',
      effort: local.lastSession?.effort ?? '',
      at,
      context: core.lastContext > 0 ? core.lastContext : DEFAULT_CONTEXT,
      window: local.lastWindow,
      turnsLeft: 2,
    })
    return decision.isHeld ? { family: decision.route.family, effort: decision.route.effort } : wanted
  }

  /**
   * Ghi lại các việc router ghi giao subagent để theo dõi. `isAdded`: việc thêm ở prompt tiếp nối
   * của cùng mục tiêu, nối vào phần đang chờ thay vì thay thế.
   */
  function trackDelegations(goalId: number, tasks: readonly Task[], isAdded = false): void {
    const keep = isAdded && local.delegation.goalId === goalId
    const pending = keep ? local.delegation.pending : new Map<number, string>()
    for (const task of tasks) {
      if (task.run === 'agent') pending.set(task.index, `${task.index} (${describePick(task.pick)})`)
    }
    local.delegation = keep ? local.delegation : { goalId, pending, isNudged: false, isWarned: false, blocks: 0 }
  }

  /** Danh sách việc giao còn chờ của mục tiêu này, rỗng nếu không có. */
  function pendingFor(brief: Brief | null): string[] {
    return brief && local.delegation.goalId === brief.goalId ? [...local.delegation.pending.values()] : []
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

    // Người dùng tự đổi model hoặc effort giữa các turn: tôn trọng lựa chọn đó tới khi có mục tiêu mới.
    // Engine tự đổi model (classic.PostModelSwitch với source auto: quá tải, giới hạn; hoặc resume) không phải
    // lựa chọn của người dùng: vẫn điều phối. Không có hook báo nguồn thì coi là người dùng đổi, như trước.
    const switched = local.lastSwitch
    local.lastSwitch = null
    if (local.lastSession && (local.lastSession.model !== model || local.lastSession.effort !== effort)) {
      const isEngine =
        local.lastSession.model !== model && switched !== null && (switched.source === 'auto' || switched.source === 'resume') && switched.toModel === model
      if (!isEngine) local.pinnedGoalId = brief.goalId
      logs.push({
        at,
        where: 'main',
        label: isEngine ? 'engine' : 'người dùng',
        family: familyOf(model) ?? 'opus',
        reason: isEngine
          ? `engine tự đổi model phiên sang ${model} (${switched?.source}); mod vẫn điều phối`
          : `người dùng đổi sang ${model}${effort ? `/${effort}` : ''}; tạm dừng tự điều phối tới mục tiêu mới`,
        isApplied: false,
      })
    }
    local.lastSession = { model, effort }
    if (local.pinnedGoalId === brief.goalId) return { route: null, stored: null, logs, notices }

    // Router chưa chọn (không đọc được prompt): không ép, mốc cache là model engine đang chạy.
    const wanted = wantedPick(brief, core.lift)
    if (wanted === null) return { route: null, stored: null, logs, notices }
    const decision = mainDecision({ core, brief, wanted, model, effort, at, context, window, turnsLeft: local.isGoalNew ? 2 : 1 })
    local.isGoalNew = false
    const capNote = wanted.notes.length > 0 ? ` (${wanted.notes.join('; ')})` : ''
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
      local.sessionFamily !== null &&
      current === 'auto' &&
      !decision.isHeld &&
      decision.route.family !== local.sessionFamily &&
      !local.sessionNoticed
    ) {
      local.sessionNoticed = true
      notices.push(`Focus Conductor chạy luồng chính bằng ${decision.route.family}, khác model của phiên (${local.sessionFamily}).`)
    }
    // Chế độ suggest chỉ đề xuất: route lưu là null để mốc cache và "model đã chạy" là model engine thật.
    return { route: decision.route, stored: current === 'auto' ? decision.route : null, logs, notices }
  }


  /** Agent engine báo đã khởi động mà mod không thấy ở agent.spawn. */
  function untrackedAgents(): string[] {
    return [...startedAgents].filter(([id]) => !spawnedIds.has(id)).map(([, type]) => type || 'agent')
  }

  return {
    options,
    local,
    agentCatalog,
    agentFailures,
    agentRoutes,
    agentTrackers,
    agents,
    blocked,
    blockedUntil,
    cacheTtlMs,
    contextWindows,
    decideTurn,
    decisionLog,
    decisionText,
    defaultWindows,
    expectedMain,
    expireBlocks,
    extraAgents,
    failures,
    isAgentRouterPaused,
    isRouterPaused,
    mainDecision,
    modelMap,
    noteAgentRouter,
    noteRouter,
    offered,
    pendingAgents,
    pendingFor,
    policy,
    ranText,
    rawPolicy,
    rawRouter,
    recognized,
    record,
    refit,
    rememberAgentRoute,
    remindSubagents,
    resetLocal,
    routerFallback,
    routerFamily,
    routerModel,
    semanticDrift,
    sessionModel,
    sessionPolicy,
    skipPhrases,
    spawnedIds,
    startedAgents,
    steppedEarly,
    strictDelegation,
    trackDelegations,
    ttl,
    untrackedAgents,
    wantedPick,
  }
}

export type Ctx = ReturnType<typeof createContext>
