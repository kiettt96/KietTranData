// Theo dõi một turn của luồng chính: lặp lại lệnh lỗi, ngân sách bước, ngoài phạm vi, chuỗi thay đổi chưa kiểm tra; tổng kết cuối turn.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import type { Brief, Kind, PlanStep, Relation, Tier, WarningKind } from '../../../types'
import { TOOL_BUDGET } from '../route'
import { FILE_TOOLS, filePathOf, isPlanFile, str } from './tool'
import type { ToolObservation } from './tool'
import { classifyBash } from './classify'
import type { BashEffect } from './classify'
import { isMutation, writeEffects } from './effects'
import { checkEffectPassed } from './output'
import { scopeStatus } from './scope'
import { normalizePython } from './verify'

/** Số thay đổi liên tiếp chưa kiểm tra trước khi nhắc checkpoint đầu tiên. */
export const CHECKPOINT_EVERY = 5
/** Mốc nhắc checkpoint trong một turn (0.7.4): 5, 10, 20, 40 rồi mỗi CHECKPOINT_CAP thay đổi; lệnh kiểm đạt đặt lại về đầu. */
const CHECKPOINT_STEPS = [CHECKPOINT_EVERY, 10, 20]
const CHECKPOINT_CAP = 40
/** Số lần cùng một lệnh lỗi trước khi coi là vòng lặp. */
export const LOOP_AFTER = 3

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
export function trackVerification(tracker: TurnTracker, observation: ToolObservation, author = 'main'): number {
  let writes = 0
  const onWrite = () => {
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
    if (!observation.isError && !isPlanFile(filePathOf(observation))) onWrite()
    return writes
  }
  if (observation.tool !== 'Bash') return writes
  const classified = classifyBash(str(observation.input['command']))
  const counted = new Set<BashEffect>(writeEffects(classified, observation.isReadOnly))
  for (const effect of classified.effects) {
    if (effect.kind === 'write') {
      if (counted.has(effect)) onWrite()
      continue
    }
    if (!checkEffectPassed(effect, observation)) continue
    tracker.checks += 1
    if (author === 'main') {
      tracker.pending.clear()
    } else {
      tracker.pending.delete(author)
      tracker.pendingChanges.delete(author)
    }
    if (tracker.pending.size === 0) markVerified(tracker)
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
          'đọc kỹ thông báo lỗi, xác định nguyên nhân gốc, rồi đổi cách tiếp cận hoặc hỏi người dùng.',
      })
    }
  }

  const writes = trackVerification(tracker, observation)
  // Đếm lỗi lặp (0.7.5): chính lệnh đó chạy đạt thì đặt lại đếm của nó; có ghi file sau lần lỗi trước thì đặt lại mọi đếm
  // (đã sửa gì đó trước khi thử lại, không phải lặp nguyên trạng).
  if (!observation.isError) {
    tracker.failures.delete(signature(observation))
    if (writes > 0) tracker.failures.clear()
  }
  if (observation.tool === 'Agent' && !observation.isError) tracker.delegated += 1

  if (focus === null) return findings

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

/** Phát hiện ở cuối turn: còn thay đổi chưa kiểm tra, checklist còn mở. */
export function summarize(tracker: TurnTracker, brief: Brief | null, plan: readonly PlanStep[]): Finding[] {
  const findings: Finding[] = []
  if (brief === null) return findings
  if (tracker.mutations > 0 && !tracker.isVerified && brief.tier !== 'trivial') {
    findings.push({
      kind: 'unverified',
      priority: 1,
      text:
        tracker.checks === 0
          ? `Turn có ${tracker.mutations} thay đổi nhưng không chạy bước kiểm tra nào`
          : unverifiedText(tracker),
    })
  }
  const open = openSteps(plan)
  if (open.length > 0) {
    findings.push({ kind: 'open-steps', priority: 1, text: `Checklist còn ${open.length} bước mở` })
  }
  return findings
}
