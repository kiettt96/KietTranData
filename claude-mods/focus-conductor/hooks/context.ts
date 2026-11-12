// Ngữ cảnh dùng chung của các hook: hằng số, tùy chọn đã đọc, trạng thái tạm (local) và các hàm thuần
// mà nhiều nhóm hook cùng dùng. Không gọi $: lệnh gọi $ nằm trong thân hook ở hooks/parts/.

import type { PluginOptions, PromptOrigin } from 'claude-code'
import type { Brief, Choice, Core, DelegationItem, DelegationState, Effort, Intent, Lift, Mode, ModelFamily, PlanStep, Route, RouteEvent, Task, Tier, Volume } from '../types'
import { applyCheckCommands, applyCheckTools, applyPassLines, applySkillPaths, applySoftPaths, newEvidenceLog, newTracker, parseCheckCommands, parseCheckTools, parsePassLines, parseSkillPaths, parseSoftPaths } from './lib/drift'
import type { EvidenceLog, PromptIntent, TurnTracker } from './lib/drift'
import { DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CONTEXT, DEFAULT_WINDOWS, applyCacheWrite, applyPrices, parseCacheWrite, parsePrices } from './lib/cost'
import { EFFORTS, decideMain, describePick, familyOf, hasTitleCode, liftPick, matchTask, parseModelMap, parseWindows } from './lib/route'
import type { SessionModel, SessionPolicy } from './lib/route'
import { DECISION_LIMIT, decisionLine } from './lib/decisions'
import type { DecisionKind } from './lib/decisions'
import { EMPTY_ERRORS, behaviorEntries, caught, noteBehavior, noteModError, errorFileText, errorLines, localIso, mergeEntry, mergeFiles, parseErrorFile, pruneFixed, setErrorSink } from './lib/errlog'
import type { ErrorEntry, ErrorEvent, ErrorFile } from './lib/errlog'
import { FIXED_ERRORS } from './lib/fixed-errors'
import { MOD_VERSION } from './lib/version'
import { MAX_FORKS, fitPick, skipKey } from './lib/router'
import { approvalModeOf, reviewRoundsOf } from './lib/approval'
import { conductorBlocker, conductorOf, fableModelId, isFableReady, isMainConducting } from './lib/conductor'
import { normalizeCore, restoreArchived, withDelegations } from './lib/state'
import type { ConductorBlocker, ConductorInputs } from './lib/conductor'
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
/** Ngưỡng nhắc đọc mặc định của vai điều phối (0.8.6 R3, option conductorReads). */
export const CONDUCTOR_READS = 20

/** strictDelegation "block": số lần mặc định từ chối luồng chính sửa file trong một mục tiêu (option blockLimit đổi được, 1 đến 10). */
export const BLOCK_EDITS = 2
export const BLOCK_LIMIT_MAX = 10
/** Số mục tiêu gần nhất giữ dấu vết thực thi (để khôi phục mục tiêu không mất lịch sử thay đổi và kiểm tra). */
export const EVIDENCE_GOALS = 4
/** Số lượt router gần nhất giữ thời gian chạy, cho /conductor status. */
export const ROUTER_TIMES = 50

/** Việc giao subagent của một mục tiêu theo trạng thái: nhãn hiển thị theo số việc. */
export type Delegation = {
  goalId: number
  pending: Map<number, string>
  running: Map<number, string>
  done: Map<number, string>
  failed: Map<number, string>
  isNudged: boolean
  isWarned: boolean
  blocks: number
  /** Việc lỗi đã được cảnh báo cuối turn (mỗi việc một lần). */
  failWarned: Set<number>
}

export function newDelegation(goalId = -1, pending = new Map<number, string>()): Delegation {
  return { goalId, pending, running: new Map(), done: new Map(), failed: new Map(), isNudged: false, isWarned: false, blocks: 0, failWarned: new Set() }
}
/** Số lỗi tool trong một turn để nâng effort cho turn sau. */
export const ERROR_BURST = 3

export const COMMAND_HELP = [
  '/conductor             mở pane Focus Conductor',
  '/conductor status      tóm tắt mục tiêu, checklist, điều phối và chi phí',
  '/conductor mode X      X là auto, subagents, suggest hoặc off',
  '/conductor goal ...    đặt mục tiêu thủ công',
  '/conductor reroute     router đọc lại prompt gần nhất (kể cả khi router đang tạm ngừng)',
  '/conductor reset       xóa mục tiêu, checklist, cảnh báo và danh sách model bị chặn',
  '/conductor approve     duyệt kế hoạch đang chờ (chỉ người gõ)',
  '/conductor solo        luồng chính đang điều phối được tự sửa file và tự chạy kiểm (chỉ người gõ); solo off để bỏ',
  '/conductor waive N lý do   miễn lệnh kiểm chưa đạt số N (hoặc ghi lệnh) cho mục tiêu này; waive undo N bỏ lệnh miễn',
  '/conductor errors      nhật ký lỗi của mod; errors clear xóa nhật ký',
].join('\n')

/** Khoảng cách tối thiểu giữa hai lượt kiểm lạc đề (0.7.5, option driftIntervalMinutes): mặc định 10 phút, kẹp 5 đến 120. */
export function driftIntervalMs(raw: unknown): number {
  const minutes = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(120, Math.max(5, raw)) : 10
  return minutes * 60_000
}

export function createContext(options: PluginOptions) {
  // Trạng thái tạm của turn và phiên: hot-reload làm mất chúng mà không ảnh hưởng tính đúng
  // (trạng thái bền nằm trong $.state).
  const local = {
    tracker: newTracker('') as TurnTracker,
    /** Lệnh (kèm kết quả) và file đã chạy trong mục tiêu hiện tại: đối chiếu evidence khi Claude ghi "verified". */
    evidenceLog: newEvidenceLog(-1) as EvidenceLog,
    /** Dấu vết của vài mục tiêu gần nhất, để khôi phục mục tiêu không mất lịch sử thay đổi và kiểm tra. */
    evidenceLogs: new Map<number, EvidenceLog>(),
    /** Cách router đọc prompt gần nhất (quan hệ với mục tiêu, bản chất việc): để Stop phân biệt hỏi đáp với thực thi. */
    promptIntent: null as PromptIntent,
    /** Ý của tin nhắn cuối router đã đọc (0.8.2 N1), cho /conductor status; null khi router chưa đọc được. */
    lastIntent: null as Intent | null,
    /** Thư mục gốc của phiên chốt cho từng mục tiêu có giới hạn phạm vi (null: engine không trả được). */
    roots: new Map<number, string | null>(),
    /** Thời gian chạy (ms) của các lượt router gần nhất. */
    routerTimes: [] as number[],
    turnRoute: { turnId: '', route: null } as { turnId: string; route: Route | null },
    /**
     * Tin chen ngang có việc run: main cần model cao hơn luồng chính đang chạy (0.7.8 G9), chờ engine báo tin đi đường nào: chèn vào
     * turn đang chạy (attachment queued_command) thì chuyển các việc đó sang subagent; turn mới bắt đầu thì bỏ.
     */
    pendingInterject: null as { goalId: number; lift: Array<{ index: number; family: string; effort: string }> } | null,
    /** Câu báo việc đã chuyển sang subagent, gắn vào kết quả tool kế tiếp của luồng chính (0.7.8 G9). */
    interjectNote: null as string | null,
    turnContext: 0,
    isGoalNew: false,
    lastSession: null as { model: string; effort: string } | null,
    sessionFamily: null as ModelFamily | null,
    sessionNoticed: false,
    /** Đã cảnh báo chính sách model của phiên chặn Fable điều phối (0.8.4 C1), một lần mỗi phiên. */
    conductorSessionNoticed: false,
    pinnedGoalId: null as number | null,
    turnCount: 0,
    /** Turn hiện tại vừa có phát hiện làm tăng nâng cấp (vòng lặp, chuỗi lỗi, vượt ngân sách): chưa giảm ở cuối turn. */
    liftRaised: false,
    /** Mốc (đồng hồ engine) của lượt kiểm lạc đề gần nhất; null là chưa có. */
    lastDriftAt: null as number | null,
    /** Phát hiện của turn trước (vòng lặp, chuỗi lỗi, vượt ngân sách, lệch mục tiêu): gửi kèm router ở prompt tiếp nối rồi xóa. */
    observed: [] as string[],
    /** Log quyết định (JSONL) của phiên, nối tiếp file cũ nếu có. */
    decisions: [] as string[],
    /** Prompt gần nhất đã qua router, brief trước nó và số mục tiêu sau lượt đó: cho /conductor reroute. */
    /** Số lần verify-reject theo mục tiêu và bước (0.8.0 A9): lần đầu không ghi nhật ký lỗi, từ lần hai thì ghi. */
    verifyRejects: new Map<string, number>(),
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
    delegation: newDelegation(),
    /**
     * Giữ mục tiêu qua lần nén (0.7.4): `pending` là lời nhắc sau nén còn chờ gắn vào tool call kế tiếp của luồng chính;
     * `lastContext` là context luồng chính đo được lần trước, hay context sau lần nén qua hook (0.7.5, tokensAfter; 0 khi
     * chưa đo hay engine không ghi), để đường dự phòng không nhắc trùng. `skipNext` (vòng sửa 2): lần đo kế tiếp sau lần nén qua
     * hook có thể còn là số cũ nên bị bỏ qua đúng một lần.
     */
    compaction: { pending: false, lastContext: 0, skipNext: false },
    /** Turn luồng chính đã nhận câu báo hạn mức mềm (0.7.5): Stop của turn đó không chặn vì checklist còn mở. */
    noticeTurn: null as string | null,
    /** Lệnh kiểm nối && đã được đề nghị chạy riêng trong turn này (0.8.0 A11), theo chữ ký lệnh. */
    chainedNoted: new Set<string>(),
    /** Subagent đã khởi động mà chưa trả về (0.8.0 A5): còn mở thì hoãn cảnh báo chưa kiểm cuối turn và cổng Y6. */
    liveAgents: new Set<string>(),
    /** Tracker của turn đã hoãn cảnh báo chưa kiểm vì còn subagent chạy (0.8.0 A5); tính lại khi subagent cuối trả về hay ở Stop đầu tiên không còn subagent. */
    deferred: [] as TurnTracker[],
    /** Câu báo mục W4 do subagent tạo (0.8.0 A12), chờ gắn vào kết quả tool kế tiếp của luồng chính. */
    agentRetryNotes: [] as string[],
    /** Thư mục gốc của phiên đọc một lần (0.8.0 A1), mặc định cho thư mục làm việc của Bash; undefined là chưa đọc, null là engine không trả. */
    sessionRoot: undefined as string | null | undefined,
    /** Khóa lệnh ghi không rõ đích đã cảnh báo, theo mục tiêu (0.7.5): không cảnh báo lại ở mỗi turn. */
    unknownWrites: { goalId: -1, keys: new Set<string>() },
    /** Lời nhắc đã nói trong phiên (S5): không đặt lại theo mục tiêu hay turn. */
    sessionHints: new Set<string>(),
    /** Prompt (đầy đủ, chỉ trong bộ nhớ) đã lập mục tiêu hiện tại (0.7.5): /conductor reroute đọc lại prompt này, không phải prompt tiếp nối ngắn. */
    goalPrompt: null as { text: string; prev: Brief | null; goalId: number } | null,
    /** Vừa /clear khi có điểm dừng mở (0.7.5): prompt kế tiếp không tự chèn khối ĐIỂM DỪNG, chỉ gợi ý /conductor resume. */
    noAutoResume: false,
    /** Mốc hết hạn xác nhận của /conductor errors clear (0.7.9 L1): gõ lại trong 10 giây thì mới xóa. */
    errorsClearArmedUntil: 0,
    /**
     * Lời gọi Agent của phiên con đang chạy (0.7.9 F1), theo tool_use_id: agent.spawn có fork true cùng tool_use_id đánh dấu `spawned`.
     * Lời gọi lỗi mà chưa có spawn nào là engine từ chối phiên con; đã spawn rồi mới lỗi là lỗi của phần đó.
     */
    forkCalls: new Map<string, { spawned: boolean; task?: number; part?: string }>(),
    /** Subagent thử skill đang chạy (0.8.2 N3): agentId tới tool_use_id của lời gọi Agent, ghi ở agent.spawn. */
    skillTrials: new Map<string, string>(),
    /** Lần thử skill đã tính (0.8.2 N3): tool_use_id tới mốc trialAt trước đó, để kết quả tool Agent lỗi trả lại mốc cũ. */
    trialCounted: new Map<string, number>(),
    /** Đã báo engine từ chối phiên con trong phiên (0.7.9 F1): câu chuyển về luồng chính và dòng fork-off chỉ một lần. */
    forkRefused: false,
    /** Việc đã chèn câu gom ("goalId:việc", 0.7.9 F1): hai kết quả tool song song không chèn hai lần; Core.forks.merged giữ qua hot reload. */
    forkMerging: new Set<string>(),
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
    /** Số việc đã phân mà lời gọi này nhận (nếu khớp). */
    taskIndex?: number
    /** Lời gọi có trường isolation của tool Agent (0.8.6 R2): subagent chạy ngoài thư mục làm việc của luồng chính. */
    isolated?: boolean
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
    /** Số việc đã phân mà agent này làm (nếu khớp), để ghi xong hay lỗi. */
    taskIndex?: number
    /**
     * Chạy chung thư mục làm việc với luồng chính (0.8.6 R2): true khi lời gọi Agent không có trường isolation; vắng khi không biết
     * (agent workflow, phiên con), khi đó lần kiểm của nó không là lần kiểm dùng chung.
     */
    sharesDir?: boolean
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
  // Tách việc lớn thành phiên con (0.7.9 F1): option forks mặc định tắt; maxForks từ 0 đến 6, mặc định 3. Tắt hay 0 thì maxForks là 0.
  const maxForks = forksOf(options)
  // Bật mặc định từ 0.7.0 (tắt khi đặt false); tự tắt gần ngưỡng hạn mức và tối đa một lượt mỗi 10 phút.
  const semanticDrift = options['semanticDrift'] !== false
  // Duyệt kế hoạch trước khi sửa file (0.8.2 N2): planApproval auto (mặc định) hay off; planReviewRounds kẹp 1 đến 3, mặc định 2.
  const planApproval = approvalModeOf(options)
  const planReviewRounds = reviewRoundsOf(options)
  const driftEveryMs = driftIntervalMs(options['driftIntervalMinutes'])
  // Pane chi tiết tự mở ở mỗi mục tiêu mới (0.7.2); đặt false để tắt.
  const autoPane = options['autoPane'] !== false
  const decisionLog = typeof options['decisionLog'] === 'string' ? options['decisionLog'].trim() : ''
  // Nhật ký lỗi của mod (0.7.9 L1): mặc định .focus-conductor/errors.json dưới thư mục gốc của phiên; "off" là tắt.
  const errorLog = errorLogPath(options['errorLog'])
  // Lỗi đã gặp mà chưa ghi ra file, mỗi lỗi kèm giờ gặp; ghi ở turn.complete, session.start và session.end.
  const errorBuffer: { event: ErrorEvent; at: string }[] = []
  setErrorSink(errorLog === '' ? null : event => {
    errorBuffer.push({ event, at: localIso(Date.now()) })
    if (errorBuffer.length > ERROR_BUFFER_MAX) errorBuffer.shift()
  })
  // Ngưỡng nhắc đọc của vai điều phối (0.8.6 R3): số nguyên không âm, mặc định 20; 0 là tắt.
  const rawConductorReads = Number(options['conductorReads'] ?? CONDUCTOR_READS)
  const conductorReads = Number.isInteger(rawConductorReads) && rawConductorReads >= 0 ? rawConductorReads : CONDUCTOR_READS
  const rawBlockLimit = Number(options['blockLimit'])
  const blockLimit = Number.isInteger(rawBlockLimit) && rawBlockLimit >= 1 ? Math.min(BLOCK_LIMIT_MAX, rawBlockLimit) : BLOCK_EDITS
  const extraAgents = String(options['agentTypes'] ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
  // Agent engine báo đã khởi động (classic.SubagentStart), và agent đã đi qua agent.spawn của mod. Agent có trong
  // danh sách đầu mà không có trong danh sách sau là agent ngoài điều phối (untracked): mod không chấm, không ép, không đo.
  const startedAgents = new Map<string, string>()
  const spawnedIds = new Set<string>()
  // Lời gọi Agent đã sinh subagent (0.8.6 R6), theo tool_use_id: lời gọi bị từ chối hay lỗi mà không có trong đây mới bật cờ miễn.
  const spawnedCalls = new Set<string>()
  const rawRouter = options['router']
  const routerModel = typeof rawRouter === 'string' && rawRouter.trim() !== '' ? rawRouter.trim() : 'sonnet'
  const routerFamily: ModelFamily = familyOf(routerModel) ?? 'sonnet'
  const modelMap = parseModelMap(options['modelMap'])
  const rawPolicy = options['sessionModel']
  const sessionPolicy: SessionPolicy = rawPolicy === 'ceiling' || rawPolicy === 'fixed' ? rawPolicy : 'auto'
  const ttl = Number(options['cacheTtlMinutes'])
  const cacheTtlMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_MINUTES) * 60_000
  // Cửa sổ mặc định chỉ áp cho họ dùng model ID mặc định của mod (modelMap đổi ID thì người dùng khai cửa sổ của ID đó).
  const defaultWindows = Object.fromEntries(
    Object.entries(DEFAULT_WINDOWS).filter(([family]) => modelMap[family as ModelFamily] === undefined),
  ) as Partial<Record<ModelFamily, number>>
  const contextWindows = { ...defaultWindows, ...parseWindows(options['contextWindows']) }
  applyPrices(parsePrices(options['prices']))
  applyCacheWrite(parseCacheWrite(options['cacheWrite']))
  applyCheckCommands(parseCheckCommands(options['checkCommands']))
  applyCheckTools(parseCheckTools(options['checkTools']))
  applyPassLines(parsePassLines(options['passLines']))
  applySoftPaths(parseSoftPaths(options['softPaths']))
  // File skill (0.8.2 N3): tiền tố khai ở option skillPaths.
  applySkillPaths(parseSkillPaths(options['skillPaths']))

  /** Option conductor (0.8.4): off như 0.8.3, fable là Fable điều phối. */
  const conductorOption = conductorOf(options)

  /** Đầu vào của các định nghĩa Fable điều phối (hooks/lib/conductor.ts) ở thời điểm hiện tại. */
  function conductorInputs(core: Core, mode: Mode, headless = false): ConductorInputs {
    // Prompt hiện tại đến lúc router Fable còn tạm ngừng (0.8.4 C6, V1; 0.8.5 K10: cờ nằm trong Core.fable nên sống qua nạp lại mod).
    const fable = normalizeCore(core).fable
    return { option: conductorOption, mode, headless, blocked, pauseLeft: fable.pauseLeft + (fable.promptPaused ? 1 : 0), sessionPolicy, sessionFamily: local.sessionFamily }
  }

  /** Luồng chính đang giữ vai điều phối cho mục tiêu hiện tại (0.8.5 D1, 0.8.6): option conductor là fable và isMainConducting. */
  function isConducting(core: Core, mode: Mode): boolean {
    return conductorOption === 'fable' && isMainConducting(conductorInputs(core, mode), normalizeCore(core).brief)
  }

  /** Nguyên nhân luồng chính không điều phối bằng Fable lúc này; null là điều phối khả dụng. */
  function conductorState(core: Core, mode: Mode, headless = false): ConductorBlocker | null {
    return conductorBlocker(conductorInputs(core, mode, headless))
  }

  /**
   * Model của lượt router (0.8.4 C2): Fable sẵn sàng thì ID Fable (modelMap.fable, ID phiên họ fable, ID mặc định), không thì option
   * router. `family` là họ của model đã gọi, cho sổ chi phí; `isFable` đặt thời gian chờ và effort của lượt đọc lại.
   */
  function routerTarget(core: Core, mode: Mode, headless = false): { model: string; family: ModelFamily; isFable: boolean } {
    if (isFableReady(conductorInputs(core, mode, headless))) return { model: fableModelId(modelMap, local.lastSession?.model ?? null), family: 'fable', isFable: true }
    return { model: routerModel, family: routerFamily, isFable: false }
  }

  /** Chính sách áp lên mọi lựa chọn của router: allowFable, model của phiên, họ đang bị chặn, loại agent dùng được. */
  function policy(): Policy {
    return { allowFable: options['allowFable'] === true, blocked, session: sessionModel(), agents: agentCatalog() }
  }

  /**
   * Chính sách cho lượt router đọc prompt (0.7.9 F1): policy() kèm số phần tối đa của việc tách; engine đã từ chối phiên con trong
   * phiên (lưu trong Core nên giữ qua hot reload) thì 0.
   */
  function routePolicy(core: Core, root: string | null = null): Policy {
    return { ...policy(), forks: core.forks.off === 'engine' || local.forkRefused ? 0 : maxForks, root }
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
   * Ghi log quyết định ra file (option decisionLog); không làm gì khi chưa bật, lỗi ghi bị bỏ qua. `write` do hook truyền vào
   * (`(path, text) => $.fs.write(path, text)`) vì engine không cho `$` đi qua một import.
   */
  async function flushDecisions(write: (path: string, text: string) => Promise<unknown>): Promise<void> {
    if (decisionLog) await write(decisionLog, decisionText()).catch(caught('fs.write decisionLog', undefined))
  }

  /** Đường dẫn file nhật ký lỗi: tuyệt đối giữ nguyên, tương đối ghép với thư mục gốc của phiên (không có thì để engine nối với cwd). */
  async function errorFilePath(io: ErrorIO): Promise<string> {
    if (errorLog.startsWith('/')) return errorLog
    const root = await io.root().catch(() => null)
    return root ? `${root.replace(/\/+$/, '')}/${errorLog}` : errorLog
  }

  /** Đọc nhật ký trên đĩa; file chưa có, đọc lỗi hay hỏng thì nhật ký rỗng. */
  async function readErrors(io: ErrorIO, path: string): Promise<ErrorFile> {
    const text = await io.read(path).catch(() => '')
    return typeof text === 'string' && text !== '' ? parseErrorFile(text) : EMPTY_ERRORS
  }

  /** Gộp các lỗi trong bộ đệm vào file. Mọi lỗi của chính bộ ghi bị nuốt và không được ghi lại vào nhật ký. */
  async function flushErrors(io: ErrorIO): Promise<void> {
    if (errorLog === '' || errorBuffer.length === 0) return
    const pending = errorBuffer.splice(0)
    try {
      const path = await errorFilePath(io)
      let file = await readErrors(io, path)
      for (const { event, at } of pending) file = mergeEntry(file, event, at, MOD_VERSION)
      await io.write(path, errorFileText(file))
    } catch {
      // Bộ ghi không được làm hỏng hook đang chạy, cũng không tự ghi lỗi của nó.
    }
  }

  /** Lúc mở phiên hay nạp lại: tự xóa lỗi đã sửa theo sổ fixed-errors, gộp lỗi trong bộ đệm, ghi lại khi có thay đổi. */
  async function openErrors(io: ErrorIO): Promise<void> {
    if (errorLog === '') return
    try {
      const path = await errorFilePath(io)
      const disk = await readErrors(io, path)
      const pruned = pruneFixed(disk, MOD_VERSION, FIXED_ERRORS)
      const changed = JSON.stringify(pruned) !== JSON.stringify(disk)
      if (changed) await io.write(path, errorFileText(pruned))
    } catch {
      // Như flushErrors.
    }
    await flushErrors(io)
  }

  /** Dòng của /conductor errors (đã ghi bộ đệm trước). Null khi nhật ký tắt. */
  async function errorReport(io: ErrorIO): Promise<{ lines: string[]; behavior: ErrorEntry[]; dropped: number; total: number } | null> {
    if (errorLog === '') return null
    await flushErrors(io)
    const file = await readErrors(io, await errorFilePath(io).catch(() => errorLog))
    const behavior = behaviorEntries(file)
    return { lines: errorLines(file), behavior, dropped: file.dropped, total: file.entries.length - file.entries.filter(entry => entry.group === 'behavior').length }
  }

  /** Xóa toàn bộ nhật ký (/conductor errors clear sau xác nhận). */
  async function clearErrors(io: ErrorIO): Promise<boolean> {
    if (errorLog === '') return false
    errorBuffer.length = 0
    try {
      await io.write(await errorFilePath(io), errorFileText(EMPTY_ERRORS))
      return true
    } catch {
      return false
    }
  }

  /** Lỗi của router theo failure (0.7.9 L1): chỉ ghi loại lỗi (hết giờ, lỗi API, sai định dạng, vượt token), không ghi prompt. */
  function noteRouterFailure(where: 'prompt' | 'agent' | 'drift' | 'review', failure: string | null): void {
    if (failure === null || failure === 'paused') return
    noteModError({ group: 'router', where, message: failure })
    // Sự cố hành vi (0.8.0 A9): khóa theo loại lỗi, không theo nơi gọi.
    noteBehavior('router-fail', failure)
  }

  /**
   * Model luồng chính mong muốn: lựa chọn của router, nâng theo bằng chứng lúc chạy, rồi kiểm lại
   * theo chính sách hiện tại (model của phiên chỉ biết từ step đầu; họ bị chặn có thể đã đổi).
   * Null khi router chưa chọn (mod không ép). Luồng chính điều phối (0.8.4 C3, cần core và chế độ): fable/medium kèm ghi chú
   * "điều phối", không nâng theo bằng chứng, không kẹp theo allowFable; brief.main vẫn giữ lựa chọn của router cho lúc Fable hết sẵn sàng.
   */
  function wantedPick(brief: Brief, lift: Lift, core?: Core, mode?: Mode): (Choice & { notes: string[]; isConducting?: true }) | null {
    if (core !== undefined && mode !== undefined && isMainConducting(conductorInputs(core, mode), brief)) return { family: 'fable', effort: 'medium', notes: ['điều phối'], isConducting: true }
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
    // Số việc đã phân chỉ đúng với lời gọi đã được chấm: kết quả nhớ không mang nó sang lời gọi khác.
    const { taskIndex: _taskIndex, ...shared } = route
    agentRoutes.set(key, shared)
    const oldest = agentRoutes.keys().next().value
    if (agentRoutes.size > AGENT_ROUTE_LIMIT && oldest !== undefined) agentRoutes.delete(oldest)
  }

  /** Xóa phần trạng thái cục bộ (không thuộc $.state). */
  function resetLocal(): void {
    local.tracker = newTracker('')
    local.evidenceLog = newEvidenceLog(-1)
    local.evidenceLogs.clear()
    local.roots.clear()
    local.promptIntent = null
    local.routerTimes = []
    local.turnRoute = { turnId: '', route: null }
    local.pendingInterject = null
    local.interjectNote = null
    local.forkCalls.clear()
    local.forkMerging.clear()
    local.turnContext = 0
    local.compaction = { pending: false, lastContext: 0, skipNext: false }
    local.noticeTurn = null
    local.unknownWrites = { goalId: -1, keys: new Set() }
    local.sessionHints.clear()
    local.goalPrompt = null
    local.noAutoResume = false
    local.isGoalNew = false
    local.lastSession = null
    local.sessionFamily = null
    local.sessionNoticed = false
    local.conductorSessionNoticed = false
    local.pinnedGoalId = null
    blocked.clear()
    failures.clear()
    blockedUntil.clear()
    local.turnCount = 0
    local.liftRaised = false
    local.lastDriftAt = null
    local.observed = []
    agents.clear()
    agentTrackers.clear()
    agentFailures.length = 0
    local.delegation = newDelegation()
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
    spawnedCalls.clear()
    local.liveAgents.clear()
    local.deferred = []
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
   * Đường dự phòng của lời nhắc sau nén (0.7.4): context luồng chính đo được giảm dưới COMPACTION_DROP so với mốc trước thì coi
   * như đã nén. Lần nén qua hook đặt mốc là context sau nén (noteCompacted), nên lần đo sau nó không nhắc trùng.
   */
  function noteContext(tokens: number): void {
    const c = local.compaction
    // Lần đo đầu sau lần nén qua hook có thể còn là số trước nén: bỏ qua đúng một lần, không làm mốc, không so.
    if (c.skipNext) {
      c.skipNext = false
      return
    }
    if (c.lastContext > 0 && tokens < COMPACTION_DROP * c.lastContext) c.pending = true
    c.lastContext = tokens
  }

  /**
   * Lần nén thật qua hook session.compact (0.7.5, gia cố): đặt lời nhắc sau nén và lấy context sau nén (tokensAfter) làm mốc
   * cho đường dự phòng; engine không ghi tokensAfter thì mốc là 0 (lần đo kế tiếp chỉ đặt mốc, không nhắc).
   */
  function noteCompacted(tokensAfter: number | undefined): void {
    local.compaction.pending = true
    local.compaction.lastContext = tokensAfter ?? 0
    local.compaction.skipNext = true
  }

  /** Cache đã nguội (quá TTL), hoặc ngữ cảnh vừa bị nén: đổi model không mất chi phí ghi lại. */
  function isCacheFree(core: Core, at: number, context: number): boolean {
    return core.lastTurnAt === 0 || at - core.lastTurnAt > cacheTtlMs || (core.lastContext > 0 && context < COMPACTION_DROP * core.lastContext)
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
    const isFree = isCacheFree(core, at, context)
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
    local.delegation = keep ? local.delegation : newDelegation(goalId, pending)
  }

  /**
   * Danh sách việc giao còn chờ của mục tiêu này, rỗng nếu không có. Có checklist (0.7.5): việc có bước trong checklist (khớp
   * theo "Việc N" hay mã như khi giao) chỉ còn chờ khi một bước của nó đang làm hoặc là bước mở kế tiếp; bước đã done,
   * verified hay skipped thì không còn chờ. Việc không có bước nào thì như cũ.
   */
  function pendingFor(brief: Brief | null, plan: readonly PlanStep[] = []): string[] {
    if (!brief || local.delegation.goalId !== brief.goalId) return []
    const next = plan.find(step => step.status === 'doing') ?? plan.find(step => step.status === 'todo')
    const isCoded = plan.some(step => hasTitleCode(step.title))
    return [...local.delegation.pending.entries()]
      .filter(([index]) => {
        const own = plan.filter(step => matchTask(brief.tasks, step.title)?.index === index)
        if (own.length > 0) return own.some(step => step.status === 'doing' || step === next)
        // Việc có mã mà chưa có checklist, hoặc tiêu đề các bước không mang mã nào: chưa xác định được bước của nó nên không
        // coi là đang chờ (vòng sửa 2 của 0.7.5). Việc không mã, hay checklist có mã mà chưa có bước của việc đó, như cũ.
        const task = brief.tasks.find(t => t.index === index)
        return !(task !== undefined && hasTitleCode(task.title) && !isCoded)
      })
      .map(([, label]) => label)
  }

  /** Việc giao subagent đã lỗi mà chưa giao lại, của mục tiêu này. */
  function failedFor(brief: Brief | null): string[] {
    return brief && local.delegation.goalId === brief.goalId ? [...local.delegation.failed.values()] : []
  }

  /** Chuyển một việc đã phân sang trạng thái mới (chờ, đang chạy, xong, lỗi) trong mục tiêu goalId. */
  function moveDelegation(goalId: number, index: number, state: DelegationState): void {
    const d = local.delegation
    if (d.goalId !== goalId) return
    const maps = { pending: d.pending, running: d.running, done: d.done, failed: d.failed }
    const label = d.pending.get(index) ?? d.running.get(index) ?? d.failed.get(index) ?? d.done.get(index)
    if (label === undefined) return
    for (const map of Object.values(maps)) map.delete(index)
    maps[state].set(index, label)
    if (state !== 'failed') d.failWarned.delete(index)
  }

  /** Trạng thái các việc giao subagent của brief, để ghi vào $.state cho pane và status. */
  function delegationItems(brief: Brief | null): DelegationItem[] {
    if (brief === null || brief.isReference || local.delegation.goalId !== brief.goalId) return []
    const d = local.delegation
    return brief.tasks
      .filter(task => task.run === 'agent')
      .map(task => ({
        index: task.index,
        title: task.title,
        state: d.running.has(task.index) ? 'running' : d.done.has(task.index) ? 'done' : d.failed.has(task.index) ? 'failed' : 'pending',
      }))
  }

  /** Dấu vết thực thi của một mục tiêu (giữ EVIDENCE_GOALS mục tiêu gần nhất). */
  function evidenceFor(goalId: number): EvidenceLog {
    if (local.evidenceLog.goalId === goalId) return local.evidenceLog
    const kept = local.evidenceLogs.get(goalId) ?? newEvidenceLog(goalId)
    local.evidenceLogs.delete(goalId)
    local.evidenceLogs.set(goalId, kept)
    while (local.evidenceLogs.size > EVIDENCE_GOALS) {
      const oldest = local.evidenceLogs.keys().next().value
      if (oldest === undefined) break
      local.evidenceLogs.delete(oldest)
    }
    local.evidenceLog = kept
    return kept
  }

  /** Mục tiêu được khôi phục mang số mục tiêu mới: chuyển dấu vết thực thi của nó sang số mới. */
  function carryEvidence(from: number, to: number): void {
    const log = local.evidenceLog.goalId === from ? local.evidenceLog : local.evidenceLogs.get(from)
    if (log === undefined) return
    local.evidenceLogs.delete(from)
    const moved: EvidenceLog = { ...log, goalId: to }
    local.evidenceLogs.set(to, moved)
    if (local.evidenceLog.goalId === from) local.evidenceLog = moved
  }

  /**
   * Khôi phục mục tiêu đã lưu thứ `index` (0.8.4 A2: dùng chung cho plan action restore và tin bảo chạy tiếp): restoreArchived, mang dấu vết
   * thực thi sang số mới, theo dõi việc giao còn chờ. Trả Core mới để tệp gọi tự ghi (engine không cho truyền `$` qua import).
   */
  function restoreGoal(c: Core, index: number): { core: Core; brief: Brief } | { error: string } {
    const stored = normalizeCore(c).archived[index - 1]
    const outcome = restoreArchived(c, index)
    if ('error' in outcome) return { error: outcome.error }
    // Mục tiêu khôi phục mang số mới: giữ lịch sử thay đổi và kiểm tra của nó cho việc đối chiếu evidence.
    if (stored !== undefined) carryEvidence(stored.brief.goalId, outcome.restored.brief.goalId)
    const restored = outcome.restored.brief
    // Việc giao còn chờ của mục tiêu khôi phục: các việc ghi giao (Claude biết việc nào đã xong từ checklist).
    trackDelegations(restored.goalId, restored.isReference ? [] : restored.tasks)
    local.isGoalNew = true
    local.pinnedGoalId = null
    return { core: withDelegations(restored.goalId, delegationItems(restored))(outcome.core), brief: restored }
  }

  /** Ghi thời gian một lượt router (ms). */
  function noteRouterTime(ms: number): void {
    local.routerTimes.push(Math.max(0, ms))
    if (local.routerTimes.length > ROUTER_TIMES) local.routerTimes.shift()
  }

  /** Dòng độ trễ router cho /conductor status; null khi chưa có lượt nào. */
  function routerTimeLine(): string | null {
    const times = local.routerTimes
    if (times.length === 0) return null
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    return `Độ trễ router: trung bình ${(avg / 1000).toFixed(1)} s qua ${times.length} lượt, chậm nhất ${(Math.max(...times) / 1000).toFixed(1)} s (routerSkip giảm số lượt khi bật)`
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
    const wanted = wantedPick(brief, core.lift, core, current)
    if (wanted === null) return { route: null, stored: null, logs, notices }
    // Bằng chứng lẽ ra nâng luồng chính khi đang điều phối (0.8.4 C3): không đổi model hay effort; ghi conductor-hold một lần mỗi mức nâng
    // mới trong một mục tiêu (khóa trong Core.fable.holdKey).
    const holdKey = wanted.isConducting === true && (core.lift.depth > 0 || core.lift.effort > 0) ? `${brief.goalId}:${core.lift.depth}:${core.lift.effort}` : null
    const fableHold = holdKey !== null && normalizeCore(core).fable.holdKey !== holdKey ? holdKey : null
    if (fableHold !== null) record(at, 'conductor-hold', { goalId: brief.goalId, depth: core.lift.depth, effort: core.lift.effort, main: 'fable/medium' })
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
    // Fable điều phối (0.8.4 C1): sessionModel ceiling hay fixed với phiên không phải Fable thì chính sách của người dùng thắng; báo một lần.
    if (conductorOption === 'fable' && local.sessionFamily !== null && !local.conductorSessionNoticed && conductorState(core, current) === 'session') {
      local.conductorSessionNoticed = true
      notices.push(`Fable điều phối không áp cho luồng chính: sessionModel ${sessionPolicy} giữ model của phiên (${local.sessionFamily}). Đổi model phiên sang Fable hay đặt sessionModel về auto.`)
    }
    // Chế độ suggest chỉ đề xuất: route lưu là null để mốc cache và "model đã chạy" là model engine thật.
    return { route: decision.route, stored: current === 'auto' ? decision.route : null, logs, notices, ...(fableHold !== null ? { fableHold } : {}) }
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
    blockLimit,
    conductorReads,
    blocked,
    blockedUntil,
    cacheTtlMs,
    carryEvidence,
    contextWindows,
    decideTurn,
    isCacheFree,
    noteContext,
    noteCompacted,
    decisionLog,
    decisionText,
    flushDecisions,
    errorLog,
    flushErrors,
    openErrors,
    errorReport,
    clearErrors,
    noteRouterFailure,
    defaultWindows,
    delegationItems,
    evidenceFor,
    expectedMain,
    expireBlocks,
    extraAgents,
    failedFor,
    failures,
    isAgentRouterPaused,
    isRouterPaused,
    mainDecision,
    maxForks,
    modelMap,
    moveDelegation,
    noteAgentRouter,
    noteRouter,
    noteRouterTime,
    offered,
    pendingAgents,
    pendingFor,
    planApproval,
    planReviewRounds,
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
    routePolicy,
    routerFallback,
    routerFamily,
    routerModel,
    conductorOption,
    conductorInputs,
    conductorState,
    isConducting,
    routerTarget,
    routerTimeLine,
    semanticDrift,
    driftEveryMs,
    autoPane,
    sessionModel,
    sessionPolicy,
    skipPhrases,
    spawnedIds,
    spawnedCalls,
    startedAgents,
    steppedEarly,
    strictDelegation,
    trackDelegations,
    restoreGoal,
    ttl,
    untrackedAgents,
    wantedPick,
  }
}

export type Ctx = ReturnType<typeof createContext>

/** Đọc, ghi file và thư mục gốc cho nhật ký lỗi: hook truyền vào (`$.fs.read`, `$.fs.write`, `$.session.root`) vì `$` không đi qua import. */
export type ErrorIO = {
  read: (path: string) => Promise<unknown>
  write: (path: string, text: string) => Promise<unknown>
  root: () => Promise<string | null>
}

/** Số lỗi tối đa giữ trong bộ đệm giữa hai lần ghi. */
const ERROR_BUFFER_MAX = 400
export const DEFAULT_ERROR_LOG = '.focus-conductor/errors.json'

/** Số phần tối đa của việc tách (0.7.9 F1): option forks phải là true; maxForks số nguyên 0 đến 6, vắng hay sai là 3. Tắt thì 0. */
export function forksOf(options: PluginOptions): number {
  if (options['forks'] !== true) return 0
  const given = options['maxForks']
  const raw = given === undefined || given === null || given === '' ? DEFAULT_FORKS : Number(given)
  return Number.isInteger(raw) ? Math.min(MAX_FORKS, Math.max(0, raw)) : DEFAULT_FORKS
}

/** maxForks mặc định (0.7.9 F1). */
export const DEFAULT_FORKS = 3

/** Option errorLog: chuỗi rỗng hay không phải chuỗi là mặc định, "off" là tắt (trả chuỗi rỗng). */
export function errorLogPath(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value.toLowerCase() === 'off') return ''
  return value === '' ? DEFAULT_ERROR_LOG : value
}
