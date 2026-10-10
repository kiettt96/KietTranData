// focus-conductor: điểm vào của mod. File này nối hook với các module thuần
// trong lib/ và ui/. Theo quy tắc của engine, $ chỉ được dùng tại chỗ trong
// thân hook ($.noun.event(...), read($, ...), update($, ...)), nên mọi lệnh
// gọi $ nằm ở đây; lib/ và ui/ chỉ tính toán và dựng cây giao diện.
//
// Luồng một turn:
//   prompt.submit  router (một model Claude cố định) đọc prompt và quyết định điều phối:
//                  mục tiêu, việc, model + effort luồng chính, việc nào giao subagent với
//                  model + effort nào. Mod kiểm, kẹp theo chính sách, gắn bản đọc vào context.
//                  Router lỗi thì không đoán: turn chạy theo model của phiên.
//   turn.step      step đầu tiên của turn chốt model + effort router đã chọn cho luồng
//                  chính (giữ model cũ khi hạ cấp không bù được chi phí ghi lại cache).
//                  Subagent: ép model + effort đã điều phối ở mỗi request.
//   tool.call      Agent: việc đã phân dùng đúng lựa chọn của router; việc khác do router
//                  chấm khi giao. plan: checklist của Claude. Mọi tool: theo dõi lặp lỗi,
//                  vượt ngân sách, ngoài phạm vi, nhắc checkpoint.
//   classic.Stop   checklist còn mở thì yêu cầu hoàn thành hoặc giải thích.
//   turn.complete  cộng chi phí đo được vào sổ (luồng chính hoặc subagent theo agentId),
//                  hiệu chỉnh ước lượng, tổng kết cảnh báo cuối turn.
// Giao diện: band trên prompt, pane chi tiết, status line, lệnh /conductor.

import { atom, derive, read, update } from 'claude-code'
import type { ModelCompleteResult, ModelUsage, PromptOrigin, Register } from 'claude-code'

import type { Brief, Choice, Core, Effort, Lift, Mode, ModelFamily, Route, RouteEvent, Task, Tier, Volume, Warning } from '../types'
import { evidenceMatches, filePathOf, isExecuting, isMutation, isPlanFile, newEvidenceLog, newTracker, noteEvidence, observe, openSteps, summarize } from './lib/drift'
import type { EvidenceLog, TurnTracker } from './lib/drift'
import { DEFAULT_CONTEXT, DEFAULT_WINDOWS, applyPrices, fixedContextTokens, parsePrices, priceNote, turnCost } from './lib/cost'
import { addUsage, calibrate, countSpawn, formatUsd, ledgerLines, recordShape, shapeKey, shapeOutput } from './lib/ledger'
import { PLAN_TOOL_SPEC, applyPlan } from './lib/plan'
import type { PlanInput } from './lib/plan'
import { EFFORTS, decideMain, describePick, familyOf, liftPick, parseModelMap, parseWindows, resolveModelId, taskMatch } from './lib/route'
import type { SessionModel, SessionPolicy } from './lib/route'
import { DECISION_LIMIT, clipText, decisionLine, keptLines } from './lib/decisions'
import type { DecisionKind } from './lib/decisions'
import {
  agentRouterRequest,
  askRouter,
  bareBrief,
  briefOf,
  driftRequest,
  failureReason,
  fitPick,
  isSkippable,
  nextBrief,
  parseAgentRoute,
  parseDrift,
  parseRoute,
  rerouted,
  routerRequest,
  skipKey,
  taskRoute,
} from './lib/router'
import type { AgentRoute, Policy, RouterOutcome, RouterPlan } from './lib/router'
import * as S from './lib/state'
import type { View } from './lib/state'
import {
  DISCIPLINE,
  PLAN_TOOL_FULL,
  blockText,
  briefContext,
  driftContext,
  droppedPlanNotice,
  followUpContext,
  skippedContext,
  renderPlan,
  stopBlockReason,
  subagentReminder,
  unbackedNotice,
  unroutedContext,
} from './lib/text'
import { renderBand } from './ui/band'
import { langOf } from './ui/labels'
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
/** Router lỗi liên tiếp bấy nhiêu lần thì tạm bỏ qua router trong ROUTER_PAUSE prompt kế tiếp. */
const ROUTER_FAIL_LIMIT = 2
const ROUTER_PAUSE = 3
/** Số kết quả chấm subagent nhớ lại trong phiên (agent workflow lặp lại không hỏi router lần nữa). */
const AGENT_ROUTE_LIMIT = 50
/** Tool sửa file của luồng chính (dùng để nhắc giao việc đã phân). */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** strictDelegation "block": số lần tối đa từ chối luồng chính sửa file trong một mục tiêu. */
const BLOCK_EDITS = 2
/** Số lỗi tool trong một turn để nâng effort cho turn sau. */
const ERROR_BURST = 3

const COMMAND_HELP = [
  '/conductor             mở pane Focus Conductor',
  '/conductor status      tóm tắt mục tiêu, checklist, điều phối và chi phí',
  '/conductor mode X      X là auto, subagents, suggest hoặc off',
  '/conductor goal ...    đặt mục tiêu thủ công',
  '/conductor reroute     router đọc lại prompt gần nhất (kể cả khi router đang tạm ngừng)',
  '/conductor reset       xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn',
].join('\n')

export const register: Register = (on, options) => {
  // Biến module: chỉ giữ thứ tạm thời của turn đang chạy; hot-reload làm
  // mất chúng mà không ảnh hưởng tính đúng (trạng thái bền nằm trong $.state).
  let tracker: TurnTracker = newTracker('')
  // Lệnh và file luồng chính đã chạy trong mục tiêu hiện tại: đối chiếu evidence khi Claude ghi "verified".
  let evidenceLog: EvidenceLog = newEvidenceLog(-1)
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
  // Log quyết định (JSONL) của phiên, nối tiếp file cũ nếu có.
  let decisions: string[] = []
  // Prompt gần nhất đã qua router, brief trước nó và số mục tiêu sau lượt đó (null khi chưa có): cho /conductor reroute.
  let lastPrompt: { text: string; prev: Brief | null; goalId: number | null } | null = null
  // Lần đổi model gần nhất của phiên (classic.PostModelSwitch): người dùng hay engine tự fallback.
  let lastSwitch: { source: string; toModel: string } | null = null
  // Agent engine báo đã khởi động (classic.SubagentStart), và agent đã đi qua agent.spawn của mod. Agent có trong
  // danh sách đầu mà không có trong danh sách sau là agent ngoài điều phối (untracked): mod không chấm, không ép, không đo.
  const startedAgents = new Map<string, string>()
  const spawnedIds = new Set<string>()
  const rawRouter = options['router']
  const routerModel = typeof rawRouter === 'string' && rawRouter.trim() !== '' ? rawRouter.trim() : 'sonnet'
  const routerFamily: ModelFamily = familyOf(routerModel) ?? 'sonnet'
  // Đếm prompt đã qua router; router lỗi liên tiếp thì tạm bỏ qua tới prompt `pausedUntil`.
  let promptCount = 0
  let routerTrouble = { failures: 0, pausedUntil: 0 }
  // Router chấm subagent có bộ đếm riêng (theo số lần chấm): lỗi ở đó không làm tạm ngừng router đọc prompt.
  let agentCalls = 0
  let agentTrouble = { failures: 0, pausedUntil: 0 }
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
  let lastWindow = DEFAULT_WINDOW
  // Việc đã ghi "giao subagent" của mục tiêu hiện tại mà chưa có Agent nào nhận.
  let delegation = { goalId: -1, pending: new Map<number, string>(), isNudged: false, isWarned: false, blocks: 0 }

  const lang = langOf(options['uiLanguage'])
  // Một lần đọc cho mọi thứ band, pane và status line cần.
  const view = derive(
    [coreState, modeState, bandHiddenState],
    (core, override, isBandHidden): View => ({
      core: S.normalizeCore(core),
      mode: S.modeOf(override, options),
      isBandHidden,
      lang,
    }),
  )
  const mode = derive([modeState], (override): Mode => S.modeOf(override, options))

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
    decisions.push(decisionLine(at, kind, data))
    if (decisions.length > DECISION_LIMIT) decisions = decisions.slice(-DECISION_LIMIT)
  }

  function decisionText(): string {
    return `${decisions.join('\n')}\n`
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
    return lastSession ? `${lastSession.model}/${lastSession.effort || 'mặc định'}` : null
  }

  function isRouterPaused(): boolean {
    return routerTrouble.pausedUntil > 0 && promptCount <= routerTrouble.pausedUntil
  }

  /** Ghi nhận một lần router trả lời được hay không; trả câu cảnh báo khi vừa tạm ngừng router. */
  function noteRouter(isOk: boolean): string | null {
    if (isOk) {
      routerTrouble.failures = 0
      return null
    }
    routerTrouble.failures += 1
    if (routerTrouble.failures < ROUTER_FAIL_LIMIT) return null
    routerTrouble = { failures: 0, pausedUntil: promptCount + ROUTER_PAUSE }
    return `Router (${routerModel}) lỗi ${ROUTER_FAIL_LIMIT} lần liên tiếp; tạm bỏ qua router trong ${ROUTER_PAUSE} prompt tới`
  }

  function isAgentRouterPaused(): boolean {
    return isRouterPaused() || (agentTrouble.pausedUntil > 0 && agentCalls <= agentTrouble.pausedUntil)
  }

  /** Như noteRouter, cho router chấm subagent; tạm ngừng tính theo số lần chấm. */
  function noteAgentRouter(isOk: boolean): string | null {
    if (isOk) {
      agentTrouble.failures = 0
      return null
    }
    agentTrouble.failures += 1
    if (agentTrouble.failures < ROUTER_FAIL_LIMIT) return null
    agentTrouble = { failures: 0, pausedUntil: agentCalls + ROUTER_PAUSE }
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
    tracker = newTracker('')
    evidenceLog = newEvidenceLog(-1)
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
    delegation = { goalId: -1, pending: new Map(), isNudged: false, isWarned: false, blocks: 0 }
    lastWindow = DEFAULT_WINDOW
    pendingAgents.clear()
    steppedEarly.clear()
    agentRoutes.clear()
    promptCount = 0
    routerTrouble = { failures: 0, pausedUntil: 0 }
    agentCalls = 0
    agentTrouble = { failures: 0, pausedUntil: 0 }
    lastPrompt = null
    lastSwitch = null
    startedAgents.clear()
    spawnedIds.clear()
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

  /**
   * Ghi lại các việc router ghi giao subagent để theo dõi. `isAdded`: việc thêm ở prompt tiếp nối
   * của cùng mục tiêu, nối vào phần đang chờ thay vì thay thế.
   */
  function trackDelegations(goalId: number, tasks: readonly Task[], isAdded = false): void {
    const keep = isAdded && delegation.goalId === goalId
    const pending = keep ? delegation.pending : new Map<number, string>()
    for (const task of tasks) {
      if (task.run === 'agent') pending.set(task.index, `${task.index} (${describePick(task.pick)})`)
    }
    delegation = keep ? delegation : { goalId, pending, isNudged: false, isWarned: false, blocks: 0 }
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

    // Người dùng tự đổi model hoặc effort giữa các turn: tôn trọng lựa chọn đó tới khi có mục tiêu mới.
    // Engine tự đổi model (classic.PostModelSwitch với source auto: quá tải, giới hạn; hoặc resume) không phải
    // lựa chọn của người dùng: vẫn điều phối. Không có hook báo nguồn thì coi là người dùng đổi, như trước.
    const switched = lastSwitch
    lastSwitch = null
    if (lastSession && (lastSession.model !== model || lastSession.effort !== effort)) {
      const isEngine =
        lastSession.model !== model && switched !== null && (switched.source === 'auto' || switched.source === 'resume') && switched.toModel === model
      if (!isEngine) pinnedGoalId = brief.goalId
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
    lastSession = { model, effort }
    if (pinnedGoalId === brief.goalId) return { route: null, stored: null, logs, notices }

    // Router chưa chọn (không đọc được prompt): không ép, mốc cache là model engine đang chạy.
    const wanted = wantedPick(brief, core.lift)
    if (wanted === null) return { route: null, stored: null, logs, notices }
    const decision = mainDecision({ core, brief, wanted, model, effort, at, context, window, turnsLeft: isGoalNew ? 2 : 1 })
    isGoalNew = false
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
      sessionFamily !== null &&
      current === 'auto' &&
      !decision.isHeld &&
      decision.route.family !== sessionFamily &&
      !sessionNoticed
    ) {
      sessionNoticed = true
      notices.push(`Focus Conductor chạy luồng chính bằng ${decision.route.family}, khác model của phiên (${sessionFamily}).`)
    }
    // Chế độ suggest chỉ đề xuất: route lưu là null để mốc cache và "model đã chạy" là model engine thật.
    return { route: decision.route, stored: current === 'auto' ? decision.route : null, logs, notices }
  }

  // ---------------------------------------------------------------- phiên

  on('session.start', async ($, e, next) => {
    // Log quyết định nối tiếp file cũ (giữ DECISION_LIMIT dòng cuối); file chưa có hoặc đọc lỗi thì bắt đầu mới.
    if (decisionLog) {
      const old = await $.fs.read(decisionLog).catch(() => '')
      decisions = typeof old === 'string' ? keptLines(old) : []
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

    promptCount += 1
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
      if (!isReuse) delegation = { goalId: -1, pending: new Map(), isNudged: false, isWarned: false, blocks: 0 }
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
      lastPrompt = { text, prev, goalId: kept?.goalId ?? null }
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
    lastPrompt = { text, prev, goalId: brief.goalId }
    if (isNewGoal) {
      isGoalNew = true
      pinnedGoalId = null
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
      // Step chạy trước khi agent.spawn kịp ghi điều phối: đánh dấu để không ép model về sau.
      if (agent === undefined && (current === 'auto' || current === 'subagents') && steppedEarly.size < 500) steppedEarly.add(e.agentId)
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
    if (current === 'off' || current === 'subagents') {
      sessionFamily = familyOf(e.model) ?? sessionFamily
      return yield* next(e)
    }

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

  // Agent khởi động mà không đi qua agent.spawn của mod: ghi để /conductor status báo là agent ngoài điều phối.
  // So khớp lúc đọc (không lúc khởi động), vì engine có thể báo khởi động trước khi agent.spawn của mod kịp ghi.
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)
    if (startedAgents.size < 1000) startedAgents.set(e.agent_id, e.agent_type)
    return result
  }).catch(($, e, next) => next(e))

  /** Agent engine báo đã khởi động mà mod không thấy ở agent.spawn. */
  function untrackedAgents(): string[] {
    return [...startedAgents].filter(([id]) => !spawnedIds.has(id)).map(([, type]) => type || 'agent')
  }

  // Nguồn của lần đổi model phiên: người dùng (/model, picker, SDK) hay engine tự đổi (auto, resume).
  // Step đầu của turn sau đọc nó để quyết định có tạm dừng tự điều phối hay không.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    lastSwitch = { source: e.source, toModel: e.to_model }
    record(await $.clock.now(), 'model-switch', { source: e.source, from: e.from_model, to: e.to_model, requested: e.requested_model })
    if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // Ghi nhận loại agent nào đang được mời dùng, để chỉ đổi sang Explore khi có.
  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (result.isOffered) offered.set(e.agent, e.description)
    else offered.delete(e.agent)
    return result
  }).catch(($, e, next) => next(e))

  // Subagent: việc đã phân dùng đúng lựa chọn của router; việc khác do router chấm khi giao
  // (kèm gợi ý model và loại agent Claude ghi, agent cha, các agent đã lỗi). Router lỗi thì giữ
  // lựa chọn của Claude. Mọi lựa chọn đều qua kiểm và kẹp theo chính sách.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.subagent_type === 'fork') return next(e)
    // Model Claude ghi không thuộc họ Claude (model riêng của người dùng): cho qua nguyên vẹn.
    const claimed = e.model !== undefined ? familyOf(e.model) : null
    if (e.model !== undefined && claimed === null) return next(e)

    const core = S.normalizeCore(await read($, coreState))
    const brief = core.brief
    const goalId = brief?.goalId ?? 0
    const rules = policy()
    // Lời gọi từ trong một subagent không khớp việc của luồng chính và không đụng phần giao còn chờ;
    // prompt đối chiếu không có việc thật để giao.
    const isNested = e.agentId !== undefined
    const parent = e.agentId !== undefined ? agents.get(e.agentId) : undefined
    const matched = !isNested && brief !== null && !brief.isReference ? taskMatch(brief.tasks, e.description) : {}
    let assigned = matched.task
    let route: AgentRoute | null = null
    let reason: string
    if (assigned !== undefined) {
      route = taskRoute(assigned, rules)
      reason = `việc ${assigned.index} đã phân trước${route.why ? `: ${route.why}` : ''}`
      if (e.model !== undefined && claimed !== route.pick.family) reason += `; Claude ghi ${e.model}, dùng ${route.pick.family} đã phân`
    } else if (isAgentRouterPaused()) {
      reason = 'router đang tạm ngừng; giữ lựa chọn của Claude'
    } else {
      const failed = agentFailures.filter(f => f.goalId === goalId).map(f => f.description)
      const key = `${e.description}\n${e.prompt}`
      // Giao lại việc đã lỗi: hỏi lại router (nó thấy danh sách lỗi và tự nâng), không dùng kết quả nhớ.
      const known = failed.includes(e.description) ? undefined : agentRoutes.get(key)
      if (known !== undefined) {
        route = refit(known)
        reason = `router (đã chấm trước): ${known.why}`
      } else {
        agentCalls += 1
        const request = agentRouterRequest({
          description: e.description,
          prompt: e.prompt,
          subagentType: e.subagent_type,
          requested: { ...(e.model !== undefined ? { model: e.model } : {}), ...(e.effort !== undefined ? { effort: String(e.effort) } : {}) },
          goal: brief?.goal ?? null,
          parent: parent !== undefined ? { description: parent.description, pick: parent.pick } : null,
          failed: failed.slice(-5),
          isWorkflow: false,
          policy: rules,
          model: routerModel,
          tasks: isNested || brief === null || brief.isReference ? [] : brief.tasks,
        })
        const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseAgentRoute(reply, rules))
        await update($, coreState, c =>
          outcome.usages.reduce((acc, usage) => S.withLedger(ledger => addUsage(ledger, 'analyzer', routerFamily, usage).ledger)(acc), c),
        )
        route = outcome.result
        const pauseText = noteAgentRouter(route !== null)
        if (route !== null) rememberAgentRoute(key, route)
        reason = route !== null ? `router: ${route.why}` : `router không chấm được (${outcome.reason}); giữ lựa chọn của Claude`
        if (pauseText !== null) {
          await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text: pauseText }))
          $.ui.toast(pauseText)
        }
      }
      // Router nhận ra lời gọi là một việc đã phân (dù description không ghi "Việc N"): dùng lựa chọn đã phân.
      const byRouter = isNested ? undefined : recognized(brief, route)
      if (byRouter !== undefined) {
        assigned = byRouter
        route = taskRoute(byRouter, rules)
        reason = `router nhận ra việc ${byRouter.index} đã phân${route.why ? `: ${route.why}` : ''}`
      }
    }
    if (assigned !== undefined && brief !== null && delegation.goalId === brief.goalId) delegation.pending.delete(assigned.index)
    if (assigned === undefined && matched.miss !== undefined) {
      record(await $.clock.now(), 'agent', { description: clipText(e.description), miss: matched.miss, routed: route !== null })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
    }

    const isApplied = route !== null && (current === 'auto' || current === 'subagents')
    const requested = EFFORTS.find(x => x === e.effort) ?? null
    // Họ model và effort thật sự gửi đi: lựa chọn của router khi áp dụng, nếu không thì của Claude.
    const sentFamily = isApplied && route !== null ? route.pick.family : claimed
    const sentEffort = isApplied && route !== null ? route.pick.effort : requested
    pendingAgents.set(e.tool_use_id, { route, reason, isApplied, description: e.description, sentFamily, sentEffort })
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
    if (!isApplied || route === null) return next(e)

    // Đổi loại agent chỉ khi Claude để general-purpose và engine đã mời loại router chọn.
    const isGeneral = e.subagent_type === undefined || e.subagent_type === 'general-purpose'
    const swap = isGeneral && route.agentType !== 'general-purpose' && offered.has(route.agentType)
    return next({
      ...e,
      model: route.pick.family,
      effort: route.pick.effort,
      ...(swap ? { subagent_type: route.agentType } : {}),
    })
  })

  // Ghi điều phối của subagent ngay khi nó khởi động (trước mọi await, để step đầu đã thấy), rồi ghi
  // nhật ký bằng model engine thực sự dùng, kèm chi phí ước tính. Model engine chạy khác model đã điều
  // phối (agent của Agent tool) thì ghi và cảnh báo. Agent của workflow không đi qua tool.call: router
  // chấm nó trước khi nó khởi động (trừ khi script đã chọn model), rồi mod ép ở từng bước.
  on('agent.spawn', async ($, e, next) => {
    const info = pendingAgents.get(e.tool_use_id)
    pendingAgents.delete(e.tool_use_id)
    const current = await read($, mode)
    const isModeApplied = current === 'auto' || current === 'subagents'
    const isWorkflow = e.workflow !== undefined
    const isScriptModel = isWorkflow && e.model !== undefined
    const core = S.normalizeCore(await read($, coreState))
    const goalId = core.brief?.goalId ?? 0
    const rules = policy()
    let workflowRoute: AgentRoute | null = null
    let workflowReason = ''
    if (info === undefined && isWorkflow && !isScriptModel && current !== 'off') {
      const key = `${e.description}\n${e.prompt}`
      // Việc vừa lỗi trong mục tiêu này thì router chấm lại (nó thấy danh sách lỗi và tự nâng).
      const failedHere = agentFailures.some(f => f.goalId === goalId && f.description === e.description)
      const known = failedHere ? undefined : agentRoutes.get(key)
      if (known !== undefined) {
        workflowRoute = refit(known)
        workflowReason = `router (đã chấm trước): ${known.why}`
      } else if (isAgentRouterPaused()) {
        workflowReason = 'router đang tạm ngừng'
      } else {
        agentCalls += 1
        const brief = core.brief
        const request = agentRouterRequest({
          description: e.description,
          prompt: e.prompt,
          subagentType: e.subagentType,
          requested: {},
          goal: brief?.goal ?? null,
          parent: null,
          failed: agentFailures.filter(f => f.goalId === goalId).map(f => f.description).slice(-5),
          isWorkflow: true,
          policy: rules,
          model: routerModel,
          tasks: brief === null || brief.isReference ? [] : brief.tasks,
        })
        const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseAgentRoute(reply, rules))
        await update($, coreState, c =>
          outcome.usages.reduce((acc, usage) => S.withLedger(ledger => addUsage(ledger, 'analyzer', routerFamily, usage).ledger)(acc), c),
        )
        workflowRoute = outcome.result
        const pauseText = noteAgentRouter(workflowRoute !== null)
        if (workflowRoute !== null) rememberAgentRoute(key, workflowRoute)
        workflowReason = workflowRoute !== null ? `router: ${workflowRoute.why}` : `router không chấm được (${outcome.reason})`
        if (pauseText !== null) {
          await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text: pauseText }))
          $.ui.toast(pauseText)
        }
        const byRouter = recognized(brief, workflowRoute)
        if (byRouter !== undefined) {
          workflowRoute = taskRoute(byRouter, rules)
          workflowReason = `router nhận ra việc ${byRouter.index} đã phân${workflowRoute.why ? `: ${workflowRoute.why}` : ''}`
          if (brief !== null && delegation.goalId === brief.goalId) delegation.pending.delete(byRouter.index)
        }
      }
    }

    const result = await next(e)
    if (result.deny !== undefined) return result
    const agentId = result.agentId
    const route = info?.route ?? workflowRoute
    const isMissed = agentId !== undefined && steppedEarly.has(agentId)
    const applied = (info !== undefined ? info.isApplied : workflowRoute !== null && isModeApplied) && !isMissed
    const engineFamily = familyOf(result.model)
    const family = engineFamily ?? info?.sentFamily ?? route?.pick.family ?? 'sonnet'
    // Ghi ngay, không await xen giữa: step đầu của agent phải thấy điều phối này.
    if (agentId !== undefined && (info !== undefined || workflowRoute !== null)) {
      agents.set(agentId, {
        description: info?.description ?? e.description,
        tier: route?.tier ?? core.brief?.tier ?? 'moderate',
        goalId,
        family,
        volume: route?.volume ?? 'small',
        shape: route !== null ? shapeKey(route.depth, route.volume, route.kind) : null,
        // Agent của Agent tool được ép về họ và effort đã gửi lúc spawn; agent workflow về lựa chọn của router.
        pick: {
          family: info?.sentFamily ?? route?.pick.family ?? family,
          effort: info?.sentEffort ?? route?.pick.effort ?? 'medium',
        },
        applied,
        enforceModel: info === undefined ? true : info.sentFamily !== null,
        warned: false,
        fallback: false,
      })
    }
    if (agentId !== undefined) {
      steppedEarly.delete(agentId)
      if (spawnedIds.size < 1000) spawnedIds.add(agentId)
    }

    const sent = info?.sentFamily ?? null
    const isMismatch = info !== undefined && sent !== null && engineFamily !== null && engineFamily !== sent
    const shortId = agentId?.slice(0, 6) ?? '?'
    const base = isMismatch
      ? `${info.reason}; engine chạy ${engineFamily} thay vì ${sent}`
      : info !== undefined
        ? info.reason
        : isWorkflow
          ? isScriptModel
            ? 'agent workflow, model do script chọn'
            : `agent workflow: ${workflowReason || 'không qua điều phối'}`
          : 'không qua điều phối'
    const reason = isMissed ? `${base}; bước đầu đã chạy trước khi mod kịp ghi, không ép` : base
    const at = await $.clock.now()
    const effort = info?.sentEffort ?? route?.pick.effort
    const estimate =
      route !== null
        ? turnCost(
            family,
            effort ?? route.pick.effort,
            route.volume,
            Math.ceil(e.prompt.length / 4),
            core.ledger.calib[family],
            shapeOutput(core.ledger, shapeKey(route.depth, route.volume, route.kind), effort ?? route.pick.effort),
          )
        : undefined
    const entry: RouteEvent = {
      at,
      where: 'agent',
      label: e.description || e.subagentType,
      family,
      ...(effort !== undefined && effort !== null ? { effort } : {}),
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
    if (input.action === 'restore') {
      // Khôi phục mục tiêu cũ đã lưu khi router xếp một prompt là mục tiêu mới.
      const index = typeof input.index === 'number' ? input.index : 1
      const outcome = S.restoreArchived(await read($, coreState), index)
      if ('error' in outcome) return { deny: outcome.error }
      await update($, coreState, () => outcome.core)
      const restored = outcome.restored.brief
      // Việc giao còn chờ của mục tiêu khôi phục: các việc ghi giao (Claude biết việc nào đã xong từ checklist).
      trackDelegations(restored.goalId, restored.isReference ? [] : restored.tasks)
      isGoalNew = true
      pinnedGoalId = null
      $.ui.status(S.statusOf(await read($, view)))
      const core = S.normalizeCore(await read($, coreState))
      return { result: `Đã khôi phục mục tiêu: ${restored.goal}\n${renderPlan(core.brief, core.plan)}` }
    }
    const outcome = applyPlan(S.normalizeCore(await read($, coreState)).plan, input)
    if (outcome.error !== undefined) return { deny: outcome.error }

    // "set" chốt lại mục tiêu và các bước: làm mới cả từ khóa của brief để
    // việc nhận diện prompt tiếp nối dựa trên mục tiêu mới, không phải mục tiêu cũ.
    const isSet = input.action === 'set'
    const titles = outcome.plan.map(step => step.title)
    const core = await update($, coreState, c => {
      const withPlan = S.withPlan(outcome.plan)(c)
      return isSet ? S.withRetarget(outcome.goal, titles, outcome.scope)(withPlan) : withPlan
    })
    tracker.planUpdates += 1
    // verified chỉ tính là đã kiểm tra khi evidence nhắc tới lệnh hay file đã thật sự chạy trong mục tiêu này.
    const isBacked =
      input.status === 'verified' && evidenceLog.goalId === core.brief?.goalId && evidenceMatches(String(input.evidence ?? ''), evidenceLog)
    if (isBacked) {
      tracker.isVerified = true
      tracker.mutationsSinceCheck = 0
    }
    const isUnbacked = input.status === 'verified' && !isBacked
    if (isUnbacked) {
      const text = `Bước ${String(input.step)} ghi verified nhưng evidence không nhắc lệnh hay file nào đã chạy trong mục tiêu này`
      await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'unverified', text }))
    }
    $.ui.status(S.statusOf(await read($, view)))
    return { result: isUnbacked ? `${renderPlan(core.brief, core.plan)}\n${unbackedNotice()}` : renderPlan(core.brief, core.plan) }
  }).catch(() => ({ deny: 'focus-conductor: lỗi nội bộ khi cập nhật checklist; tiếp tục làm việc không cần tool này.' }))

  // Mọi tool: luồng chính được nhắc (context của kết quả tool) và nâng cấp theo
  // bằng chứng cho turn sau; subagent chỉ được ghi nhật ký, không bị nhắc.
  // Lời nhắc đi kèm kết quả tool, không sửa system prompt, nên không ảnh hưởng cache.
  on('tool.call', async ($, e, next) => {
    // strictDelegation "block": luồng chính sửa file trong khi còn việc ghi giao subagent chưa giao thì bị từ chối,
    // tối đa BLOCK_EDITS lần mỗi mục tiêu (sau đó chỉ nhắc, kẻo kẹt khi không giao được).
    if (strictDelegation === 'block' && e.agentId === undefined && EDIT_TOOLS.has(e.tool)) {
      const current = await read($, mode)
      const brief = S.normalizeCore(await read($, coreState)).brief
      const waiting = current === 'auto' || current === 'subagents' ? pendingFor(brief) : []
      const path = filePathOf({ tool: e.tool, input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
      if (waiting.length > 0 && !isPlanFile(path) && delegation.blocks < BLOCK_EDITS) {
        delegation.blocks += 1
        return { deny: blockText(waiting, BLOCK_EDITS - delegation.blocks) }
      }
    }
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
      // remindSubagents: subagent cũng bị kiểm phạm vi file của mục tiêu và được nhắc (kèm việc được giao);
      // mặc định chỉ ghi cảnh báo lên pane, không nhắc.
      const scopePaths = remindSubagents ? (S.normalizeCore(await read($, coreState)).brief?.scopePaths ?? []) : []
      const findings = observe(agentTracker, observation, { goal: meta.description, scopePaths, tier: meta.tier }, [])
      const at = await $.clock.now()
      const warnings: Warning[] = []
      for (const finding of findings) {
        if (finding.kind === 'checkpoint') continue
        warnings.push({ at, kind: finding.kind, text: `Agent ${e.agentId.slice(0, 6)}: ${finding.text}` })
      }
      if (warnings.length > 0) await update($, coreState, S.withWarnings(...warnings))
      const top = remindSubagents ? findings.filter(f => f.kind !== 'checkpoint' && f.context).sort((x, y) => y.priority - x.priority)[0] : undefined
      if (top?.context === undefined) return result
      return { ...result, context: [...(result.context ?? []), subagentReminder(meta.description, top.context)] }
    }

    const core = S.normalizeCore(await read($, coreState))
    if (core.brief !== null) {
      if (evidenceLog.goalId !== core.brief.goalId) evidenceLog = newEvidenceLog(core.brief.goalId)
      if (!observation.isError) noteEvidence(evidenceLog, observation)
    }
    const findings = observe(tracker, observation, core.brief, core.plan)
    const isErrorBurst = tracker.errors === ERROR_BURST
    // Luồng chính bắt đầu tự sửa file trong khi còn việc đã ghi giao subagent: nhắc một lần.
    // Ghi file kế hoạch của plan mode không phải là làm một việc đã phân.
    const pending = pendingFor(core.brief)
    const planFile = isPlanFile(filePathOf(observation))
    // Mặc định nhắc một lần ở lần sửa file đầu tiên; strictDelegation remind/block nhắc ở mọi lần thay đổi (kể cả lệnh ghi file).
    const isStrict = strictDelegation !== 'off'
    const isChange = isStrict ? isMutation(observation) : EDIT_TOOLS.has(e.tool)
    const nudge =
      isChange && !planFile && !observation.isError && pending.length > 0 && (isStrict || !delegation.isNudged)
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

    // semanticDrift (người dùng tự bật): ở checkpoint, router đọc mục tiêu và các thay đổi gần đây để nhận ra lạc đề
    // theo nội dung, thứ mà theo dõi hành vi tool không thấy.
    let driftNote: string | null = null
    if (semanticDrift && core.brief !== null && findings.some(f => f.kind === 'checkpoint') && !isRouterPaused()) {
      const request = driftRequest({
        goal: core.brief.goal,
        steps: openSteps(core.plan).map(step => step.title),
        commands: evidenceLog.commands,
        paths: evidenceLog.paths,
        model: routerModel,
      })
      const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, parseDrift)
      const verdict = outcome.result
      const now = await $.clock.now()
      await update($, coreState, c => {
        const used = outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), c)
        return verdict !== null && !verdict.onTrack ? S.withWarnings({ at: now, kind: 'drift', text: `Router: có thể lạc đề (${verdict.why})` })(used) : used
      })
      record(now, 'drift', { onTrack: verdict?.onTrack ?? null, why: verdict?.why ?? outcome.reason, retried: outcome.retried })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      if (verdict !== null && !verdict.onTrack) driftNote = driftContext(core.brief.goal, verdict.why)
    }
    const top = findings.filter(f => f.context).sort((a, b) => b.priority - a.priority)[0]
    const extra = [...(top?.context ? [top.context] : []), ...(driftNote ? [driftNote] : [])]
    if (extra.length === 0) return withNudge(result)
    return withNudge({ ...result, context: [...(result.context ?? []), ...extra] })
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
      steppedEarly.delete(agentId)
      if (e.usage) {
        const family = familyOf(e.usage.model) ?? meta?.family ?? 'sonnet'
        const core = S.normalizeCore(await read($, coreState))
        const added = addUsage(core.ledger, 'agent', family, e.usage)
        // Chỉ agent router đã chấm mới có khối lượng thật để hiệu chỉnh; agent không có kết quả chấm thì bỏ qua.
        const effort = meta?.sentEffort ?? meta?.pick.effort ?? 'medium'
        const ledger =
          meta !== undefined && meta.shape !== null
            ? recordShape(calibrate(added.ledger, family, e.usage.output_tokens, meta.volume, effort), meta.shape, e.usage.output_tokens, effort)
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
      const brief = core.brief
      ledger =
        isApplied && brief
          ? recordShape(
              calibrate(added.ledger, family, e.usage.output_tokens, brief.volume, applied.effort),
              shapeKey(brief.depth, brief.volume, brief.kind),
              e.usage.output_tokens,
              applied.effort,
            )
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
      const before = S.normalizeCore(await read($, coreState))
      const prev = before.brief
      const rules = policy()
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng sau các lần lỗi.
      const request = routerRequest({ text: arg, prev, ran: null, policy: rules, model: routerModel, isForcedNew: true })
      const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseRoute(reply, rules))
      const plan = outcome.result
      if (plan !== null) routerTrouble = { failures: 0, pausedUntil: 0 }
      const now = await $.clock.now()
      const goalId = (prev?.goalId ?? 0) + 1
      // Mục tiêu đặt bằng lệnh luôn là mục tiêu mới; router lỗi thì đặt mục tiêu không có lựa chọn model.
      const brief: Brief = plan ? { ...briefOf(plan, arg, goalId, now), goal: plan.goal || arg.slice(0, 200) } : bareBrief(arg, goalId, now)
      const isApplied = (await read($, mode)) === 'auto'
      // Router lỗi: route cũ bỏ đi, không để status hiện một route mà lượt này không dùng.
      const core = await update($, coreState, c => {
        const adopted = S.adoptGoal(brief)(c)
        const withRoute = plan === null ? S.withRoute(null)(adopted) : adopted
        return outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), withRoute)
      })
      lastPrompt = null
      isGoalNew = true
      pinnedGoalId = null
      record(now, plan !== null ? 'route' : 'router-fail', { command: 'goal', prompt: clipText(arg), reason: outcome.reason, retried: outcome.retried })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      $.ui.status(S.statusOf(await read($, view)))
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      const dropped = openSteps(before.plan)
      const notice = dropped.length > 0 ? [droppedPlanNotice(dropped)] : []
      return {
        text:
          plan !== null
            ? `Đã đặt mục tiêu: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}).`
            : `Đã đặt mục tiêu: ${brief.goal}. Router không đọc được (${outcome.reason}); mod không chọn model cho mục tiêu này.`,
        context: [
          plan !== null
            ? `Người dùng đặt mục tiêu thủ công.\n${briefContext(brief, expected, isApplied)}`
            : `Người dùng đặt mục tiêu thủ công: ${brief.goal}\n${unroutedContext(outcome.reason)}`,
          ...notice,
        ],
      }
    }

    if (sub === 'reroute') {
      if ((await read($, mode)) === 'off') return { text: 'Focus Conductor đang tắt (mode off); bật lại bằng /conductor mode auto.' }
      const before = S.normalizeCore(await read($, coreState))
      const current = before.brief
      const last = lastPrompt
      if (last === null || (current?.goalId ?? null) !== last.goalId) {
        return { text: 'Không có prompt nào của mục tiêu hiện tại để router đọc lại. Đặt mục tiêu bằng /conductor goal kèm mô tả.' }
      }
      const rules = policy()
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng.
      const request = routerRequest({ text: last.text, prev: last.prev, ran: ranText(before), policy: rules, model: routerModel })
      const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseRoute(reply, rules))
      const now = await $.clock.now()
      const withUsage = (c: Core): Core =>
        outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), c)
      const plan = outcome.result
      if (plan === null) {
        await update($, coreState, withUsage)
        record(now, 'router-fail', { command: 'reroute', prompt: clipText(last.text), reason: outcome.reason, retried: outcome.retried })
        if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
        return { text: `Router không đọc được (${outcome.reason}); giữ điều phối hiện tại.` }
      }
      routerTrouble = { failures: 0, pausedUntil: 0 }
      const fresh = nextBrief(last.prev, plan, last.text, now)
      // Prompt gần nhất đã lập mục tiêu hiện tại (không phải tiếp nối mục tiêu trước nó).
      const wasNew = current !== null && current.goalId !== (last.prev?.goalId ?? null)
      const archivedPrev = last.prev ? before.archived.findIndex(a => a.brief.goalId === last.prev?.goalId) : -1
      let brief: Brief
      if (current === null || (fresh.isNewGoal && !wasNew)) {
        // Lần trước router lỗi nên prompt chưa lập mục tiêu; giờ router xếp là mục tiêu mới.
        brief = fresh.brief
        await update($, coreState, c => withUsage(S.adoptGoal(brief)(c)))
      } else if (fresh.isNewGoal) {
        brief = rerouted(current, fresh.brief)
        await update($, coreState, c => withUsage(S.withDecision(brief)(c)))
      } else if (wasNew && archivedPrev >= 0) {
        // Lần trước xếp nhầm là mục tiêu mới: khôi phục mục tiêu trước (checklist còn bước mở), áp phần đọc mới lên nó.
        const back = S.restoreArchived(before, archivedPrev + 1)
        const restored = 'error' in back ? null : back
        brief = { ...fresh.brief, goalId: restored?.restored.brief.goalId ?? current.goalId }
        await update($, coreState, c => withUsage(S.withDecision(brief)(restored ? restored.core : c)))
      } else {
        brief = { ...fresh.brief, goalId: current.goalId }
        await update($, coreState, c => withUsage(S.withDecision(brief)(c)))
      }
      lastPrompt = { ...last, goalId: brief.goalId }
      isGoalNew = true
      pinnedGoalId = null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      const core = S.normalizeCore(await read($, coreState))
      const isApplied = (await read($, mode)) === 'auto'
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      record(now, 'reroute', { prompt: clipText(last.text), relation: plan.relation, confidence: plan.confidence, retried: outcome.retried, main: brief.main, expected })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      $.ui.status(S.statusOf(await read($, view)))
      return {
        text: `Router đã đọc lại prompt gần nhất: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}).`,
        context: [`Người dùng yêu cầu router đọc lại prompt gần nhất.\n${briefContext(brief, expected, isApplied)}`],
      }
    }

    if (sub === 'status') {
      const { core, mode: current } = await read($, view)
      const usage = await $.session.usage().catch(() => null)
      const costLines = ledgerLines(core.ledger)
      if (core.sysTokens > 0) costLines.push(`Phần cố định của ngữ cảnh (system prompt, tools): ${Math.round(core.sysTokens / 1000)}k token, đo ở đầu phiên`)
      if (usage?.cost) costLines.push(`Chi phí cả phiên theo Claude Code (gồm cả phần trước khi mod bắt đầu ghi sổ): ${formatUsd(usage.cost.usd)}`)
      costLines.push(priceNote(await $.clock.now()))
      if (core.brief === null) return { text: [`Chế độ ${current}. Chưa có mục tiêu.`, ...costLines].join('\n') }
      const routeLine = core.route
        ? `${describePick(core.route)} (${core.route.reason})`
        : core.brief.main === null
          ? 'model của phiên (router chưa chọn)'
          : 'model của phiên'
      const blockedLine = blocked.size > 0 ? `\nModel tạm ngừng dùng: ${[...blocked].join(', ')}` : ''
      const judged = `Đánh giá của router: độ sâu ${core.brief.depth}, khối lượng ${core.brief.volume}, bản chất ${core.brief.kind}${core.brief.why ? ` (${core.brief.why})` : ''}`
      const agentLines = core.log
        .filter(entry => entry.where === 'agent')
        .slice(-5)
        .map(entry => {
          const cost = entry.usd !== undefined ? ` ${formatUsd(entry.usd)}${entry.measured ? '' : ' ước tính'}` : ''
          return `  ${entry.label}: ${entry.family}${entry.effort ? `/${entry.effort}` : ''}${cost} (${entry.reason})`
        })
      const untracked = untrackedAgents()
      const untrackedLine =
        untracked.length > 0 ? `\nAgent ngoài điều phối (untracked agent, mod không chấm, không ép, không đo): ${untracked.length} (${[...new Set(untracked)].join(', ')})` : ''
      const agentBlock = (agentLines.length > 0 ? `\nSubagent gần nhất:\n${agentLines.join('\n')}` : '') + untrackedLine
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
