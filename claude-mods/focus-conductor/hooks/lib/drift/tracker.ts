// Theo dõi một turn của luồng chính: lặp lại lệnh lỗi, ngân sách bước, ngoài phạm vi, chuỗi thay đổi chưa kiểm tra; tổng kết cuối turn.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import type { Brief, Kind, PlanStep, Relation, Tier, WarningKind } from '../../../types'
import { TOOL_BUDGET } from '../route'
import { FILE_TOOLS, filePathOf, isPlanFile, str } from './tool'
import type { ToolObservation } from './tool'
import { classifyBash } from './classify'
import type { BashEffect } from './classify'
import { isMutation, writeEffects } from './effects'
import { checkEffectPassed, lacksSummary, outputFailed, rejectReason } from './output'
import type { RejectReason } from './output'
import { normalizePath, scopeStatus } from './scope'
import { isCheckTool, isCustomCheck, normalizePython } from './verify'
import { checkToolCommand, checkToolPassed } from './evidence'

/** Số thay đổi liên tiếp chưa kiểm tra trước khi nhắc checkpoint đầu tiên. */
export const CHECKPOINT_EVERY = 5
/** Mốc nhắc checkpoint trong một turn (0.7.4): 5, 10, 20, 40 rồi mỗi CHECKPOINT_CAP thay đổi; lệnh kiểm đạt đặt lại về đầu. */
const CHECKPOINT_STEPS = [CHECKPOINT_EVERY, 10, 20]
const CHECKPOINT_CAP = 40
/** Số lần cùng một lệnh lỗi trước khi coi là vòng lặp. */
export const LOOP_AFTER = 3
/**
 * Câu nhắc đường nâng ngay trong turn khi luồng chính kẹt (0.7.8 G6): luồng chính không đổi model giữa turn được (mất cache), còn
 * subagent thì được; router chấm subagent thấy mục "luồng chính kẹt" trong danh sách việc đã lỗi và chọn cao hơn một bậc.
 */
export const STUCK_HINT =
  'Nếu phần đang kẹt cần suy luận sâu hơn model đang chạy, giao phần đó cho subagent và để trống model; router của plugin sẽ chọn cao hơn một bậc vì phần này đã kẹt.'

const REJECT_TEXT: Record<RejectReason, string> = {
  failed: 'chưa đạt',
  'ran-nothing': 'không có phép kiểm nào chạy',
  untrusted: 'nằm trong lệnh có $( ), backtick, eval, sh -c hoặc đứng sau ||',
  hidden: 'bị lệnh đứng sau che mã thoát',
  pipe: 'chạy qua ống, mod không đọc được kết quả',
}
const REJECT_COMMAND_MAX = 60

/** Đoạn lệnh trong câu cho người dùng: cắt REJECT_COMMAND_MAX ký tự, quá thì kết bằng dấu ba chấm. */
function clipCommand(command: string): string {
  return command.length > REJECT_COMMAND_MAX ? `${command.slice(0, REJECT_COMMAND_MAX)}…` : command
}

/** Lệnh kiểm bị loại trong turn (0.7.7 X3): đoạn lệnh kiểm và lý do không được tính là đạt. */
export type RejectedCheck = { command: string; reason: RejectReason }
/** Số lệnh kiểm bị loại gần nhất giữ lại trong một turn. */
const REJECTED_KEEP = 5

export type TurnTracker = {
  turnId: string
  toolCalls: number
  mutations: number
  mutationsSinceCheck: number
  /** Đúng khi mọi thay đổi của turn đã được kiểm tra lại (tập `pending` rỗng); mỗi thay đổi mới đặt lại false. */
  isVerified: boolean
  /**
   * Tác giả có thay đổi chưa được kiểm tra lại: "main" (luồng chính) hoặc id subagent. Kiểm tra đạt của luồng chính
   * xóa cả tập; kiểm tra đạt của subagent chỉ xóa phần của chính nó.
   */
  pending: Set<string>
  /** Số thay đổi chưa được kiểm tra lại của từng tác giả trong `pending` (R8): câu cuối turn nêu số thay đổi của subagent. */
  pendingChanges: Map<string, number>
  /** Số lệnh kiểm tra đạt trong turn (để câu báo phân biệt "chưa kiểm tra lần nào" với "sửa sau lần kiểm tra cuối"). */
  checks: number
  /** Kết quả của lệnh kiểm gần nhất (0.7.9 X4a): đạt, hay lý do bị loại; null khi chưa có lệnh kiểm nào trong turn. */
  lastCheck: RejectReason | 'passed' | null
  /**
   * Tài liệu đã đọc lại (0.7.7 X6): từ lần kiểm đạt cuối của luồng chính (hay đầu turn), đích đã ghi và thứ tự lần ghi cuối (`docWrites`),
   * số lần ghi (`docChanges`), có lần ghi không đọc được đích (`docUnknown`); `reads` là thứ tự lần Read cuối của từng file; `seq` đếm
   * tool call của luồng chính và subagent cùng mục tiêu.
   */
  docWrites: Map<string, number>
  /** Tài liệu đã xóa bằng rm hay là nguồn của mv (0.7.9 X6a): không còn file để đọc lại, nên không cần đọc lại. */
  docRemoved: Set<string>
  docChanges: number
  docUnknown: boolean
  reads: Map<string, number>
  seq: number
  /** Lệnh kiểm bị loại trong turn, tối đa REJECTED_KEEP mục gần nhất, kể cả của subagent cùng mục tiêu (0.7.7 X3). */
  rejected: RejectedCheck[]
  /** Số lời gọi Agent thành công: turn chỉ giao subagent vẫn là turn đang thực thi mục tiêu. */
  delegated: number
  /** Lệnh ghi không xác định được file đích đã cảnh báo trong turn (mỗi lệnh khác nhau một lần). */
  unknownWrites: Set<string>
  /** Đã cảnh báo không xác định được phạm vi (không có thư mục gốc) trong turn này. */
  rootWarned: boolean
  /** Số lần Claude cập nhật checklist trong turn (turn đang thực thi kế hoạch). */
  planUpdates: number
  /** Số tool call lỗi trong turn (để nâng effort khi lỗi nhiều). */
  errors: number
  failures: Map<string, number>
  budgetLevel: number
  outOfScope: Set<string>
  /**
   * Số mốc checkpoint đã nhắc của bộ đếm hiện tại (0.7.5): nhắc khi số mốc đã qua lớn hơn số này, kể cả khi ghi của subagent
   * làm bộ đếm vượt mốc giữa hai lời gọi của luồng chính; lệnh kiểm đạt đặt lại về 0.
   */
  checkpointMark: number
}

export function newTracker(turnId: string): TurnTracker {
  return {
    turnId,
    toolCalls: 0,
    mutations: 0,
    mutationsSinceCheck: 0,
    isVerified: false,
    pending: new Set(),
    pendingChanges: new Map(),
    checks: 0,
    lastCheck: null,
    rejected: [],
    docWrites: new Map(),
    docRemoved: new Set(),
    docChanges: 0,
    docUnknown: false,
    reads: new Map(),
    seq: 0,
    delegated: 0,
    unknownWrites: new Set(),
    rootWarned: false,
    planUpdates: 0,
    errors: 0,
    failures: new Map(),
    budgetLevel: 0,
    outOfScope: new Set(),
    checkpointMark: 0,
  }
}

/**
 * Ngữ cảnh để đo lệch: mục tiêu, phạm vi và ngân sách của luồng chính hoặc của một subagent. `root` là thư mục gốc
 * của phiên chốt cho mục tiêu (null hoặc thiếu: không xác định được, khi đó không khẳng định file nào trong phạm vi);
 * `cwd` là thư mục làm việc hiện tại, để nối đường dẫn tương đối của lệnh Bash.
 */
export type Focus = {
  goal: string
  scopePaths: string[]
  tier: Tier
  root?: string | null
  cwd?: string | null
  /** Mục tiêu tối thiểu (router chưa đọc, tier chỉ là đoán): không cảnh báo ngân sách tool call (0.7.2). */
  isBare?: boolean
  /** Khóa lệnh ghi không rõ đích đã cảnh báo trong mục tiêu (0.7.5); vắng thì dùng tập của tracker (theo turn). */
  warnedWrites?: Set<string>
  /** Lời nhắc đã nói trong phiên (S5): mỗi khóa một lần, không đặt lại theo mục tiêu hay turn; vắng thì nhắc ở mỗi lần gặp. */
  hints?: Set<string>
}

/**
 * Lệnh kiểm riêng (checkCommands) qua ống không pipefail chạy xong, không có dấu hiệu lỗi, nhưng dòng không rỗng cuối cùng không phải dòng
 * tổng kết chặt nên không được tính là đạt (S5): nhắc một lần trong phiên dùng `set -o pipefail` trước lệnh. Khóa `pipe-summary` chỉ được
 * ghi vào `focus.hints` khi lời nhắc thật sự được chèn (T6), nên lần thua một phát hiện ưu tiên cao hơn không làm mất lời nhắc. null khi
 * không áp dụng.
 */
function pipeSummaryHint(observation: ToolObservation, focus: Focus): Finding | null {
  if (observation.tool !== 'Bash' || observation.isError || observation.output === undefined || outputFailed(observation.output)) return null
  if (focus.hints?.has('pipe-summary')) return null
  for (const effect of classifyBash(str(observation.input['command'])).effects) {
    if (effect.kind !== 'check' || !effect.trusted || effect.exit !== 'filtered' || effect.pipefail === true) continue
    if (!isCustomCheck(effect.segment) && !(effect.resolved !== undefined && isCustomCheck(effect.resolved))) continue
    if (!lacksSummary(observation.output)) continue
    return {
      kind: 'unverified',
      priority: 1,
      hint: 'pipe-summary',
      text: 'Lệnh kiểm qua ống không có dòng tổng kết ở cuối nên chưa tính là đạt',
      context:
        '[focus-conductor] Lệnh kiểm riêng này chạy qua ống (| tail, | head) không có `set -o pipefail`, và dòng cuối của output không phải một dòng tổng kết ' +
        '(OK, PASS, ĐẠT, KẾT QUẢ: ĐẠT), nên mod không tính là đạt. Đặt `set -o pipefail;` trước lệnh kiểm. ' +
        'Không sửa script kiểm nếu người dùng không yêu cầu. Khi lệnh kiểm in kết quả lỗi: có pipefail thì lệnh thoát khác 0 và mod tính là ' +
        'chưa đạt; không có pipefail thì mod chỉ nhận ra lỗi qua dấu hiệu lỗi trong output. Lời nhắc này chỉ nói một lần trong phiên.',
    }
  }
  return null
}

/** Lý do bị loại vì hình dạng lệnh (0.7.7 X2): chạy lại riêng lệnh kiểm thì mod đọc được kết quả. */
const SHAPE_REASONS = new Set<RejectReason>(['pipe', 'hidden', 'untrusted'])
const SHAPE_COMMAND_MAX = 80

/**
 * Lệnh kiểm chạy xong không lỗi nhưng bị loại vì hình dạng (qua ống, che mã thoát, thay thế lệnh) (0.7.7 X2): nhắc một lần trong phiên chạy
 * lại riêng lệnh kiểm. Như `pipeSummaryHint`, khóa `check-shape` chỉ được ghi khi lời nhắc thật sự được chèn. null khi không áp dụng.
 */
function checkShapeHint(observation: ToolObservation, focus: Focus): Finding | null {
  if (observation.tool !== 'Bash' || observation.isError || outputFailed(observation.output)) return null
  if (focus.hints?.has('check-shape')) return null
  for (const effect of classifyBash(str(observation.input['command'])).effects) {
    if (effect.kind !== 'check') continue
    const reason = rejectReason(effect, observation)
    if (reason === null || !SHAPE_REASONS.has(reason)) continue
    const command = effect.segment.length > SHAPE_COMMAND_MAX ? `${effect.segment.slice(0, SHAPE_COMMAND_MAX)}…` : effect.segment
    return {
      kind: 'unverified',
      priority: 1,
      hint: 'check-shape',
      text: `Lệnh kiểm "${clipCommand(effect.segment)}" ${REJECT_TEXT[reason]}, chưa tính là đạt`,
      context:
        `[focus-conductor] Lệnh kiểm "${command}" ${REJECT_TEXT[reason]}, nên chưa tính là đạt. Chạy lại riêng lệnh kiểm: không qua ống, ` +
        'không có ; hay || đứng sau, không $( ); có thể dùng cờ rút gọn như -q, --silent. Không sửa script kiểm khi người dùng không yêu cầu. ' +
        'Lời nhắc này chỉ nói một lần trong phiên.',
    }
  }
  return null
}

/**
 * Khóa của cảnh báo lệnh ghi không rõ đích (0.7.5): mỗi đoạn lệnh là tên trình chạy (bỏ thư mục, bỏ cờ python không giá trị)
 * cộng đường dẫn script (đối số đầu không phải cờ), bỏ các tham số còn lại; đoạn cd, set bỏ qua. `ghi.py --lo 1` và
 * `ghi.py --lo 2` là một khóa.
 */
export function unknownWriteKey(command: string): string {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map(part => {
      const [head, ...rest] = normalizePython(part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').split(/\s+/).filter(Boolean))
      if (head === undefined || head === 'cd' || head === 'set') return ''
      const name = head.slice(head.lastIndexOf('/') + 1)
      const script = rest.find(token => !token.startsWith('-'))
      return script !== undefined ? `${name} ${script}` : name
    })
    .filter(Boolean)
    .join(' && ')
    .slice(0, 300)
}


/** Một phát hiện: `text` cho người dùng, `context` cho model (nếu cần nhắc). */
export type Finding = {
  kind: WarningKind | 'checkpoint'
  text: string
  context?: string
  /** Ưu tiên khi nhiều phát hiện trùng một tool result: số lớn thắng. */
  priority: number
  /** Khóa lời nhắc một lần trong phiên (T6): hook ghi khóa vào `focus.hints` chỉ khi phát hiện này được chèn vào kết quả tool. */
  hint?: string
  /** Cảnh báo chưa kiểm ở mức nhẹ (0.7.7 X6): chỉ ghi tài liệu và đã đọc lại; không toast, không vào band. */
  isSoft?: true
  /** Nguyên nhân của cảnh báo chưa kiểm cuối turn (0.7.7 X4): nhánh câu, lý do và đoạn lệnh bị loại, không gồm số thay đổi. */
  cause?: string
}

/** Số mốc checkpoint đã qua khi có `count` thay đổi liên tiếp chưa kiểm. */
function checkpointsPassed(count: number): number {
  return CHECKPOINT_STEPS.filter(step => count >= step).length + Math.floor(count / CHECKPOINT_CAP)
}

/** Bộ đếm thay đổi chưa kiểm đi từ `before` tới `after` có vượt qua một mốc checkpoint không (0.7.4). */
export function isCheckpointDue(before: number, after: number): boolean {
  return checkpointsPassed(after) > checkpointsPassed(before)
}

function signature(observation: ToolObservation): string {
  const key = observation.tool === 'Bash' ? str(observation.input['command']) : JSON.stringify(observation.input)
  return `${observation.tool}:${key.slice(0, 300)}`
}

/**
 * Áp các hiệu ứng của một tool call lên trạng thái kiểm tra của tracker, theo đúng thứ tự trong lệnh. `author` là
 * tác giả của tool call ("main" hoặc id subagent). Ghi được tính cả khi lệnh Bash lỗi (có thể đã ghi một phần); kiểm
 * tra chỉ đạt khi được tin, lệnh không lỗi, output không báo lỗi, và (khi bị nối ống) output có dấu hiệu đạt rõ.
 * Trả số lần ghi đã đếm.
 */
export function trackVerification(tracker: TurnTracker, observation: ToolObservation, author = 'main', cwd: string | null = null): number {
  let writes = 0
  tracker.seq += 1
  const seq = tracker.seq
  // Đích của Edit, Write, Read: tuyệt đối, hoặc nối với thư mục làm việc; không có thì giữ dạng chuẩn hóa (cùng cách cho ghi và đọc).
  const fileTarget = (path: string) => (path.startsWith('/') || !cwd ? normalizePath(path) : normalizePath(`${cwd}/${path}`))
  const onWrite = () => {
    tracker.docChanges += 1
    tracker.mutations += 1
    // Nhịp nhắc checkpoint là của luồng chính: ghi của subagent làm luồng chính chưa được kiểm chứng (pending) nhưng không tiến nhịp.
    if (author === 'main') tracker.mutationsSinceCheck += 1
    tracker.pending.add(author)
    tracker.pendingChanges.set(author, (tracker.pendingChanges.get(author) ?? 0) + 1)
    tracker.isVerified = false
    writes += 1
  }
  if (FILE_TOOLS.has(observation.tool)) {
    // Edit, Write, NotebookEdit lỗi thì không ghi file.
    if (!observation.isError && !isPlanFile(filePathOf(observation))) {
      onWrite()
      tracker.docWrites.set(fileTarget(filePathOf(observation)), seq)
    }
    return writes
  }
  const onReject = (command: string, reason: RejectReason) => {
    tracker.rejected.push({ command, reason })
    tracker.lastCheck = reason
    if (tracker.rejected.length > REJECTED_KEEP) tracker.rejected.shift()
  }
  const onPass = () => {
    tracker.checks += 1
    tracker.lastCheck = 'passed'
    if (author === 'main') {
      tracker.pending.clear()
      tracker.docWrites.clear()
      tracker.docRemoved.clear()
      tracker.docChanges = 0
      tracker.docUnknown = false
    } else {
      tracker.pending.delete(author)
      tracker.pendingChanges.delete(author)
    }
    if (tracker.pending.size === 0) markVerified(tracker)
  }
  // Tool MCP khai trong checkTools (0.7.9 Y4): một lần kiểm như lệnh test Bash; lỗi thì là lệnh kiểm bị loại.
  if (isCheckTool(observation.tool)) {
    if (checkToolPassed(observation)) onPass()
    else onReject(checkToolCommand(observation.tool, observation.input), observation.isError ? 'failed' : 'ran-nothing')
    return writes
  }
  if (observation.tool === 'Read' && !observation.isError) {
    const path = str(observation.input['file_path'])
    if (path !== '' && isWholeRead(observation)) tracker.reads.set(fileTarget(path), seq)
    return writes
  }
  if (observation.tool !== 'Bash') return writes
  const classified = classifyBash(str(observation.input['command']))
  const counted = new Set<BashEffect>(writeEffects(classified, observation.isReadOnly))
  for (const effect of classified.effects) {
    if (effect.kind === 'write') {
      if (!counted.has(effect)) continue
      onWrite()
      // Đích đọc được của lệnh Bash; đường dẫn tương đối nối với thư mục làm việc như khi kiểm phạm vi, không nối được là đích lạ.
      // mkdir chỉ tạo thư mục, không đổi nội dung nào cần đọc lại (0.7.9 X6a).
      if (effect.name === 'mkdir') continue
      if (effect.isUnknown || effect.paths.length === 0) tracker.docUnknown = true
      const targets: string[] = []
      for (const path of effect.paths) {
        if (path.startsWith('/')) targets.push(normalizePath(path))
        else if (cwd) targets.push(normalizePath(`${cwd}/${path}`))
        else tracker.docUnknown = true
      }
      // rm tài liệu và nguồn tài liệu của mv không còn file để đọc lại; đích của mv thì phải đọc lại như file vừa ghi (0.7.9 X6a).
      const removed = effect.name === 'rm' ? targets : effect.name === 'mv' ? targets.slice(0, -1) : []
      for (const path of targets) {
        if (removed.includes(path) && DOC_FILE.test(path)) {
          tracker.docWrites.delete(path)
          tracker.docRemoved.add(path)
        } else tracker.docWrites.set(path, seq)
      }
      continue
    }
    const reason = rejectReason(effect, observation)
    if (reason !== null) {
      onReject(effect.segment, reason)
      continue
    }
    onPass()
  }
  return writes
}

/** Luồng chính đã được kiểm chứng: bộ đếm thay đổi chưa kiểm và mốc checkpoint đã nhắc cùng về 0 (vòng sửa 2 của 0.7.5). */
export function markVerified(tracker: TurnTracker): void {
  tracker.isVerified = true
  tracker.pendingChanges.clear()
  tracker.mutationsSinceCheck = 0
  tracker.checkpointMark = 0
}

/** Cách router đọc prompt của turn: quan hệ với mục tiêu đang mở và bản chất việc; null khi router không đọc được. */
export type PromptIntent = { relation: Relation; kind: Kind } | null

/**
 * Turn đang thực thi mục tiêu (khác turn chỉ hỏi đáp): có thay đổi, cập nhật checklist, giao subagent, hoặc có
 * tool call cho một prompt tiếp nối mục tiêu mà không phải việc chỉ trả lời. Câu hỏi độc lập (router xếp là
 * mục tiêu mới hay việc chỉ trả lời) và turn không gọi tool nào thì không bị checklist chặn.
 */
export function isExecuting(tracker: TurnTracker, intent: PromptIntent = null): boolean {
  if (tracker.mutations > 0 || tracker.planUpdates > 0 || tracker.delegated > 0) return true
  return intent !== null && intent.relation !== 'new' && intent.kind !== 'answer' && tracker.toolCalls > 0
}

export type TurnRole = 'qa' | 'executing'

export function turnRole(tracker: TurnTracker, intent: PromptIntent = null): TurnRole {
  return isExecuting(tracker, intent) ? 'executing' : 'qa'
}

export function openSteps(plan: readonly PlanStep[]): PlanStep[] {
  return plan.filter(step => step.status === 'todo' || step.status === 'doing')
}

/** Mục tiêu đã hoàn tất theo checklist: không còn bước todo hay doing. */
export function isGoalDone(plan: readonly PlanStep[]): boolean {
  return openSteps(plan).length === 0
}

function goalLine(focus: Focus, plan: readonly PlanStep[]): string {
  const open = openSteps(plan)
    .slice(0, 3)
    .map(step => `${step.id}. ${step.title}`)
    .join('; ')
  return `Mục tiêu: ${focus.goal}${open ? ` | Bước còn mở: ${open}` : ''}`
}

/**
 * Ghi nhận một tool call đã chạy xong và trả về các phát hiện. Tracker bị
 * thay đổi tại chỗ (đếm), các phát hiện để register quyết định hiển thị.
 */
export function observe(
  tracker: TurnTracker,
  observation: ToolObservation,
  focus: Focus | null,
  plan: readonly PlanStep[],
): Finding[] {
  const findings: Finding[] = []
  tracker.toolCalls += 1

  if (observation.isError) {
    tracker.errors += 1
    const sig = signature(observation)
    const count = (tracker.failures.get(sig) ?? 0) + 1
    tracker.failures.set(sig, count)
    if (count === LOOP_AFTER) {
      findings.push({
        kind: 'loop',
        priority: 4,
        text: `${observation.tool} lỗi ${count} lần với cùng đầu vào: có dấu hiệu lặp`,
        context:
          `[focus-conductor] Lệnh này đã lỗi ${count} lần với cùng đầu vào. Dừng thử lại; ` +
          `đọc kỹ thông báo lỗi, xác định nguyên nhân gốc, rồi đổi cách tiếp cận hoặc hỏi người dùng. ${STUCK_HINT}`,
      })
    }
  }

  const writes = trackVerification(tracker, observation, 'main', focus?.cwd ?? null)
  // Đếm lỗi lặp (0.7.5): chính lệnh đó chạy đạt thì đặt lại đếm của nó; có ghi file sau lần lỗi trước thì đặt lại mọi đếm
  // (đã sửa gì đó trước khi thử lại, không phải lặp nguyên trạng).
  if (!observation.isError) {
    tracker.failures.delete(signature(observation))
    if (writes > 0) tracker.failures.clear()
  }
  if (observation.tool === 'Agent' && !observation.isError) tracker.delegated += 1

  if (focus === null) return findings

  // Lệnh kiểm riêng qua ống không pipefail mà dòng cuối không phải dòng tổng kết (S5): nhắc một lần trong phiên.
  const hint = pipeSummaryHint(observation, focus) ?? checkShapeHint(observation, focus)
  if (hint !== null) findings.push(hint)

  // Phạm vi: file của Edit/Write và file đích của lệnh Bash có ghi (kể cả lệnh lỗi, vì có thể đã ghi một phần).
  if (focus.scopePaths.length > 0 && isMutation(observation)) {
    const isBash = observation.tool === 'Bash'
    const command = str(observation.input['command'])
    const classified = isBash ? classifyBash(command) : null
    const targets = classified ? classified.paths : [filePathOf(observation)].filter(path => path !== '')
    const scopes = focus.scopePaths.join(', ')
    for (const target of targets) {
      if (isPlanFile(target)) continue
      const status = scopeStatus(target, focus.scopePaths, focus.root, isBash ? focus.cwd : null)
      if (status === 'in') continue
      if (status === 'unknown') {
        // Không có thư mục gốc: không khẳng định file nằm trong phạm vi, báo một lần mỗi turn.
        if (tracker.rootWarned) continue
        tracker.rootWarned = true
        findings.push({
          kind: 'scope',
          priority: 3,
          text: `Không xác định được phạm vi (thiếu thư mục gốc của phiên): ${target}`,
          context:
            `[focus-conductor] Không xác định được phạm vi của ${target}: mod không lấy được thư mục gốc của phiên nên không đối chiếu ` +
            `được với phạm vi người dùng giới hạn (${scopes}). Tự kiểm tra các file đã sửa chỉ nằm trong phạm vi đó.`,
        })
        continue
      }
      if (tracker.outOfScope.has(target)) continue
      tracker.outOfScope.add(target)
      findings.push(
        isBash
          ? {
              kind: 'scope',
              priority: 3,
              text: `Lệnh Bash ghi ngoài phạm vi đã nêu: ${target}`,
              context:
                `[focus-conductor] Lệnh \`${command.slice(0, 160)}\` ghi vào ${target}, nằm ngoài phạm vi người dùng giới hạn (${scopes}). ` +
                'Xác nhận thay đổi này là bắt buộc cho mục tiêu; nếu không, hoàn tác và quay lại phạm vi.',
            }
          : {
              kind: 'scope',
              priority: 3,
              text: `Sửa ngoài phạm vi đã nêu: ${target}`,
              context:
                `[focus-conductor] ${target} nằm ngoài phạm vi người dùng giới hạn (${scopes}). ` +
                'Xác nhận thay đổi này là bắt buộc cho mục tiêu; nếu không, hoàn tác và quay lại phạm vi.',
            },
      )
    }
    // Mỗi script ghi không xác định đích được cảnh báo một lần mỗi mục tiêu (0.7.5): khóa bỏ tham số; mức vàng, không toast.
    const key = unknownWriteKey(command)
    const warned = focus.warnedWrites ?? tracker.unknownWrites
    if (classified?.isUnknown && !warned.has(key)) {
      warned.add(key)
      findings.push({
        kind: 'scope-unknown',
        priority: 2,
        text: `Lệnh ghi không xác định được file đích (phạm vi: ${scopes}): ${command.slice(0, 80)}`,
        context:
          `[focus-conductor] Lệnh \`${command.slice(0, 160)}\` có thể ghi file nhưng mod không xác định được file đích, nên không đối chiếu được ` +
          `với phạm vi người dùng giới hạn (${scopes}). Kiểm tra lệnh này chỉ ghi trong phạm vi; nếu ghi ra ngoài, ` +
          'xác nhận là bắt buộc cho mục tiêu hoặc hoàn tác.',
      })
    }
  }

  const budget = TOOL_BUDGET[focus.tier]
  const level = focus.isBare === true ? 0 : tracker.toolCalls >= budget * 2 ? 2 : tracker.toolCalls >= budget ? 1 : 0
  if (level > tracker.budgetLevel) {
    tracker.budgetLevel = level
    findings.push({
      kind: 'budget',
      priority: 2,
      text: `Đã ${tracker.toolCalls} tool call, vượt mức dự kiến ${budget} cho việc ${focus.tier}`,
      context:
        `[focus-conductor] Turn này đã dùng ${tracker.toolCalls} tool call, vượt mức dự kiến cho việc ${focus.tier}. ` +
        `${goalLine(focus, plan)}. Tự hỏi: bước đang làm có phục vụ trực tiếp mục tiêu không? ` +
        'Nếu đang lan man, quay về bước còn mở gần nhất.',
    })
  }

  // Theo mốc đã nhắc (0.7.5): một lệnh ghi nhiều file làm bộ đếm vượt mốc thì vẫn nhắc ở lệnh đó, và mốc đã nhắc không nhắc lại.
  // Chỉ ghi của luồng chính tiến bộ đếm (vòng sửa 2, M8); ghi của subagent không tiến nhịp.
  const passed = checkpointsPassed(tracker.mutationsSinceCheck)
  if (passed > tracker.checkpointMark) {
    tracker.checkpointMark = passed
    findings.push({
      kind: 'checkpoint',
      priority: 1,
      text: `${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa kiểm tra`,
      context:
        `[focus-conductor] Checkpoint: ${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa được kiểm tra. ` +
        `${goalLine(focus, plan)}. Trước khi sửa tiếp, kiểm lại phần vừa làm theo cách người dùng quy định ` +
        '(đọc lại, chạy lệnh kiểm có sẵn); không tạo bộ kiểm mới nếu người dùng không yêu cầu; rồi cập nhật checklist.',
    })
  }

  return findings
}

/**
 * Câu báo còn thay đổi chưa kiểm tra lại sau lần kiểm tra cuối (R8): thay đổi của luồng chính và của subagent nêu riêng, để khi
 * chỉ còn thay đổi của subagent câu không báo "0 thay đổi".
 */
function unverifiedText(tracker: TurnTracker): string {
  let sub = 0
  for (const [author, count] of tracker.pendingChanges) if (author !== 'main') sub += count
  if (sub === 0) return `${tracker.mutationsSinceCheck} thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại`
  if (tracker.mutationsSinceCheck === 0) return `${sub} thay đổi của subagent sau lần kiểm tra cuối chưa được kiểm tra lại`
  return `${tracker.mutationsSinceCheck} thay đổi của luồng chính và ${sub} thay đổi của subagent sau lần kiểm tra cuối chưa được kiểm tra lại`
}


/**
 * Câu cuối turn khi không có lệnh kiểm nào được tính (0.7.7 X3): nêu lệnh kiểm bị loại gần nhất và lý do; không có thì nêu script kiểm đã chạy
 * mà chưa khai (gợi ý đầu tiên; câu không nêu tên option vì toast gợi ý của 0.7.3 đã nêu); không có gì thì giữ câu cũ.
 */
function noCheckText(tracker: TurnTracker, suggestions: readonly string[]): string {
  const base = `Turn có ${tracker.mutations} thay đổi nhưng không chạy bước kiểm tra nào`
  const branch = noCheckBranch(tracker, suggestions)
  if (branch === null) return base
  return 'rejected' in branch
    ? `${base} được tính: "${clipCommand(branch.rejected.command)}" ${REJECT_TEXT[branch.rejected.reason]}`
    : `${base} được tính: script kiểm "${branch.hint}" chưa được khai là lệnh kiểm`
}

/** Nhánh của câu khi không có lệnh kiểm nào được tính (0.7.7): lệnh kiểm bị loại gần nhất, không có thì gợi ý script kiểm đầu tiên. */
function noCheckBranch(tracker: TurnTracker, suggestions: readonly string[]): { rejected: RejectedCheck } | { hint: string } | null {
  const last = tracker.rejected.at(-1)
  if (last !== undefined) return { rejected: last }
  const hint = suggestions[0]
  return hint !== undefined ? { hint } : null
}

/**
 * Khóa nguyên nhân của cảnh báo chưa kiểm (0.7.7 X4), cùng nhánh với câu: sau lần kiểm cuối, kèm kết quả của lệnh kiểm gần nhất (0.7.9 X4a); có lệnh bị loại (lý do, đoạn lệnh); có gợi ý
 * script kiểm chưa khai; không có lệnh kiểm. Không gồm số thay đổi.
 */
function causeOf(tracker: TurnTracker, suggestions: readonly string[]): string {
  if (tracker.checks > 0) return `after-check:${tracker.lastCheck ?? 'passed'}`
  const branch = noCheckBranch(tracker, suggestions)
  if (branch === null) return 'no-check'
  return 'rejected' in branch ? `rejected:${branch.rejected.reason}:${branch.rejected.command}` : `hint:${branch.hint}`
}

/** Đuôi tài liệu của cảnh báo nhẹ (0.7.7 X6), không phân biệt hoa thường. */
const DOC_FILE = /\.(?:md|markdown|txt)$/i

/**
 * Read đọc trọn file (0.7.9 X6a): không có offset quá dòng 1, và không có limit hoặc output ngắn hơn limit (file ngắn hơn đoạn đã
 * đọc). Không biết output thì không tính.
 */
function isWholeRead(observation: ToolObservation): boolean {
  const offset = Number(observation.input['offset'] ?? 1)
  if (Number.isFinite(offset) && offset > 1) return false
  const limit = observation.input['limit']
  if (limit === undefined || limit === null) return true
  if (observation.output === undefined) return false
  return observation.output.replace(/\n+$/, '').split('\n').length < Number(limit)
}

/**
 * Turn (từ lần kiểm đạt cuối của luồng chính) chỉ ghi tài liệu và đã Read lại từng file sau lần ghi cuối (0.7.7 X6): mọi lần ghi có đích đọc
 * được, mọi đích là tài liệu, mỗi đích có một Read sau lần ghi cuối. Đọc lại là bằng chứng yếu: chỉ hạ mức hiển thị, không đổi isVerified.
 */
export function isSoftDocs(tracker: TurnTracker): boolean {
  if (tracker.docChanges === 0 || tracker.docUnknown || (tracker.docWrites.size === 0 && tracker.docRemoved.size === 0)) return false
  return [...tracker.docWrites].every(([path, wrote]) => DOC_FILE.test(path) && (tracker.reads.get(path) ?? 0) > wrote)
}

/** Phát hiện ở cuối turn: còn thay đổi chưa kiểm tra, checklist còn mở. `suggestions`: script kiểm đã chạy mà chưa khai (suggestCheckCommands). */
export function summarize(tracker: TurnTracker, brief: Brief | null, plan: readonly PlanStep[], suggestions: readonly string[] = []): Finding[] {
  const findings: Finding[] = []
  if (brief === null) return findings
  if (tracker.mutations > 0 && !tracker.isVerified && brief.tier !== 'trivial' && isSoftDocs(tracker)) {
    findings.push({
      kind: 'unverified',
      priority: 1,
      isSoft: true,
      text: `Turn có ${tracker.docChanges} thay đổi tài liệu, đã đọc lại sau lần ghi cuối, chưa có lệnh kiểm`,
      cause: 'soft-docs',
    })
  } else if (tracker.mutations > 0 && !tracker.isVerified && brief.tier !== 'trivial') {
    findings.push({
      kind: 'unverified',
      priority: 1,
      text: tracker.checks === 0 ? noCheckText(tracker, suggestions) : unverifiedText(tracker),
      cause: causeOf(tracker, suggestions),
    })
  }
  const open = openSteps(plan)
  if (open.length > 0) {
    findings.push({ kind: 'open-steps', priority: 1, text: `Checklist còn ${open.length} bước mở` })
  }
  return findings
}
