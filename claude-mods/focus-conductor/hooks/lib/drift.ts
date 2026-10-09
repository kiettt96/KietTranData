// Theo dõi tính nhất quán trong một turn của luồng chính: lặp lại lệnh lỗi,
// vượt ngân sách bước so với độ phức tạp, sửa file ngoài phạm vi được phép,
// và chuỗi thay đổi dài mà chưa tự kiểm tra. Hàm ở đây thuần, không gọi $,
// để test được và để register quyết định cách hiển thị.

import type { Brief, PlanStep, WarningKind } from '../../types'
import { POLICY } from './route'

const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
// Lệnh kiểm tra thật sự: bắt đầu một đoạn lệnh bằng một trình chạy test, lint,
// type-check hay build. Không khớp theo chữ rời ("test", "check") ở giữa lệnh,
// kẻo `ls tests/`, `cat test.txt` hay `echo check` bị tính là kiểm tra.
const VERIFY_SEGMENT = new RegExp(
  '^(?:' +
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:-\\S+\\s+)*(?:test|tests|lint|typecheck|type-check|build|check|validate|verify)\\b|' +
    '(?:npx\\s+)?(?:tsc|pytest|jest|vitest|mocha|eslint|ruff|mypy|flake8|pyright|biome|stylelint)\\b|' +
    'node\\s+--test\\b|' +
    'python3?\\s+-m\\s+(?:pytest|unittest|mypy|ruff)\\b|' +
    'cargo\\s+(?:test|check|clippy|build)\\b|' +
    'go\\s+(?:test|vet|build)\\b|' +
    'make\\s+(?:test|check|lint|build)\\b|' +
    'claude\\s+plugin\\s+(?:test|validate)\\b|' +
    'dotnet\\s+(?:test|build)\\b|' +
    'mvn\\s+(?:test|verify)\\b|' +
    'gradle\\s+(?:test|check|build)\\b' +
    ')',
)

/** Tách lệnh nối bằng &&, ||, ;, | hoặc xuống dòng, bỏ ngoặc, biến môi trường và timeout ở đầu mỗi đoạn. */
function segments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|\n])\s*/)
    .map(part =>
      part
        .trim()
        .replace(/^[({]+\s*/, '')
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
        .replace(/^timeout\s+\d+\s+/, ''),
    )
}

/** Số thay đổi liên tiếp chưa kiểm tra trước khi nhắc một checkpoint. */
export const CHECKPOINT_EVERY = 5
/** Số lần cùng một lệnh lỗi trước khi coi là vòng lặp. */
export const LOOP_AFTER = 3

export type TurnTracker = {
  turnId: string
  toolCalls: number
  mutations: number
  mutationsSinceCheck: number
  isVerified: boolean
  /** Số lần Claude cập nhật checklist trong turn (turn đang thực thi kế hoạch). */
  planUpdates: number
  failures: Map<string, number>
  budgetLevel: number
  outOfScope: Set<string>
}

export function newTracker(turnId: string): TurnTracker {
  return {
    turnId,
    toolCalls: 0,
    mutations: 0,
    mutationsSinceCheck: 0,
    isVerified: false,
    planUpdates: 0,
    failures: new Map(),
    budgetLevel: 0,
    outOfScope: new Set(),
  }
}

export type ToolObservation = {
  tool: string
  input: Record<string, unknown>
  isError: boolean
  isReadOnly: boolean
}

/** Một phát hiện: `text` cho người dùng, `context` cho model (nếu cần nhắc). */
export type Finding = {
  kind: WarningKind | 'checkpoint'
  text: string
  context?: string
  /** Ưu tiên khi nhiều phát hiện trùng một tool result: số lớn thắng. */
  priority: number
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function filePathOf(observation: ToolObservation): string {
  return str(observation.input['file_path']) || str(observation.input['notebook_path'])
}

function signature(observation: ToolObservation): string {
  const key = observation.tool === 'Bash' ? str(observation.input['command']) : JSON.stringify(observation.input)
  return `${observation.tool}:${key.slice(0, 300)}`
}

export function isVerification(observation: ToolObservation): boolean {
  return observation.tool === 'Bash' && segments(str(observation.input['command'])).some(part => VERIFY_SEGMENT.test(part))
}

export function isMutation(observation: ToolObservation): boolean {
  if (FILE_TOOLS.has(observation.tool)) return true
  return observation.tool === 'Bash' && !observation.isReadOnly && !isVerification(observation)
}

/** Đường dẫn nằm trong phạm vi khi khớp đuôi hoặc nằm dưới một thư mục được nhắc. */
export function isInScope(path: string, scopePaths: readonly string[]): boolean {
  if (scopePaths.length === 0 || path === '') return true
  const normalized = path.replace(/\\/g, '/')
  return scopePaths.some(scope => {
    const s = scope.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    return normalized.endsWith(`/${s}`) || normalized === s || normalized.includes(`/${s}/`)
  })
}

/** Turn có đang thực thi (thay đổi hoặc cập nhật checklist) hay chỉ hỏi đáp. */
export function isExecuting(tracker: TurnTracker): boolean {
  return tracker.mutations > 0 || tracker.planUpdates > 0
}

export function openSteps(plan: readonly PlanStep[]): PlanStep[] {
  return plan.filter(step => step.status === 'todo' || step.status === 'doing')
}

function goalLine(brief: Brief, plan: readonly PlanStep[]): string {
  const open = openSteps(plan)
    .slice(0, 3)
    .map(step => `${step.id}. ${step.title}`)
    .join('; ')
  return `Mục tiêu: ${brief.goal}${open ? ` | Bước còn mở: ${open}` : ''}`
}

/**
 * Ghi nhận một tool call đã chạy xong và trả về các phát hiện. Tracker bị
 * thay đổi tại chỗ (đếm), các phát hiện để register quyết định hiển thị.
 */
export function observe(
  tracker: TurnTracker,
  observation: ToolObservation,
  brief: Brief | null,
  plan: readonly PlanStep[],
): Finding[] {
  const findings: Finding[] = []
  tracker.toolCalls += 1

  if (observation.isError) {
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

  if (isVerification(observation) && !observation.isError) {
    tracker.mutationsSinceCheck = 0
    tracker.isVerified = true
  } else if (isMutation(observation) && !observation.isError) {
    tracker.mutations += 1
    tracker.mutationsSinceCheck += 1
  }

  if (brief === null) return findings

  const path = filePathOf(observation)
  if (FILE_TOOLS.has(observation.tool) && !isInScope(path, brief.scopePaths) && !tracker.outOfScope.has(path)) {
    tracker.outOfScope.add(path)
    findings.push({
      kind: 'scope',
      priority: 3,
      text: `Sửa ngoài phạm vi đã nêu: ${path}`,
      context:
        `[focus-conductor] ${path} nằm ngoài phạm vi người dùng giới hạn (${brief.scopePaths.join(', ')}). ` +
        'Xác nhận thay đổi này là bắt buộc cho mục tiêu; nếu không, hoàn tác và quay lại phạm vi.',
    })
  }

  const budget = POLICY[brief.tier].toolBudget
  const level = tracker.toolCalls >= budget * 2 ? 2 : tracker.toolCalls >= budget ? 1 : 0
  if (level > tracker.budgetLevel) {
    tracker.budgetLevel = level
    findings.push({
      kind: 'budget',
      priority: 2,
      text: `Đã ${tracker.toolCalls} tool call, vượt mức dự kiến ${budget} cho việc ${brief.tier}`,
      context:
        `[focus-conductor] Turn này đã dùng ${tracker.toolCalls} tool call, vượt mức dự kiến cho việc ${brief.tier}. ` +
        `${goalLine(brief, plan)}. Tự hỏi: bước đang làm có phục vụ trực tiếp mục tiêu không? ` +
        'Nếu đang lan man, quay về bước còn mở gần nhất.',
    })
  }

  if (tracker.mutationsSinceCheck > 0 && tracker.mutationsSinceCheck % CHECKPOINT_EVERY === 0) {
    findings.push({
      kind: 'checkpoint',
      priority: 1,
      text: `${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa kiểm tra`,
      context:
        `[focus-conductor] Checkpoint: ${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa được kiểm tra. ` +
        `${goalLine(brief, plan)}. Trước khi sửa tiếp, kiểm tra lại phần vừa làm ` +
        '(chạy test, type-check hoặc đọc lại diff) và cập nhật checklist.',
    })
  }

  return findings
}

/** Phát hiện ở cuối turn: còn thay đổi chưa kiểm tra, checklist còn mở. */
export function summarize(tracker: TurnTracker, brief: Brief | null, plan: readonly PlanStep[]): Finding[] {
  const findings: Finding[] = []
  if (brief === null) return findings
  if (tracker.mutations > 0 && !tracker.isVerified && brief.tier !== 'trivial') {
    findings.push({
      kind: 'unverified',
      priority: 1,
      text: `Turn có ${tracker.mutations} thay đổi nhưng không chạy bước kiểm tra nào`,
    })
  }
  const open = openSteps(plan)
  if (open.length > 0) {
    findings.push({ kind: 'open-steps', priority: 1, text: `Checklist còn ${open.length} bước mở` })
  }
  return findings
}
