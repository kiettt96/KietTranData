// Theo dõi tính nhất quán trong một turn của luồng chính: lặp lại lệnh lỗi,
// vượt ngân sách bước so với độ phức tạp, sửa file ngoài phạm vi được phép,
// và chuỗi thay đổi dài mà chưa tự kiểm tra. Hàm ở đây thuần, không gọi $,
// để test được và để register quyết định cách hiển thị.

import type { Brief, PlanStep, Tier, WarningKind } from '../../types'
import { TOOL_BUDGET } from './route'

const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
// Lệnh kiểm tra thật sự: bắt đầu một đoạn lệnh bằng một trình chạy test, lint,
// type-check hay build. Không khớp theo chữ rời ("test", "check") ở giữa lệnh,
// kẻo `ls tests/`, `cat test.txt` hay `echo check` bị tính là kiểm tra.
const VERIFY_SEGMENT = new RegExp(
  '^(?:' +
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:-\\S+\\s+)*(?:test|tests|lint|typecheck|type-check|build|check|validate|verify)\\b|' +
    '(?:npx\\s+(?:-\\S+\\s+)*)?(?:tsc|pytest|jest|vitest|mocha|eslint|ruff|mypy|flake8|pyright|biome|stylelint)\\b|' +
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
        // Tiền tố gán biến (FOO=1 npm test), hoặc cả đoạn chỉ là phép gán (D=/đường/dẫn): bỏ đi, không phải lệnh.
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*(?:\s+|$))+/, '')
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
  /** Số tool call lỗi trong turn (để nâng effort khi lỗi nhiều). */
  errors: number
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
    errors: 0,
    failures: new Map(),
    budgetLevel: 0,
    outOfScope: new Set(),
  }
}

/** Ngữ cảnh để đo lệch: mục tiêu, phạm vi và ngân sách của luồng chính hoặc của một subagent. */
export type Focus = { goal: string; scopePaths: string[]; tier: Tier }

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

// File kế hoạch của plan mode (~/.claude/plans/*.md): ghi vào đó là lập kế hoạch, không phải sửa mã.
const PLAN_FILE = /(?:^|[\\/])\.claude[\\/]plans[\\/][^\\/]+\.md$/

export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path)
}

// Lệnh chỉ đọc, theo tên lệnh đầu mỗi đoạn. `find`, `sed`, `sort` và `git` có đối số ghi riêng (xem dưới).
const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'tree', 'pwd', 'which', 'stat',
  'diff', 'sort', 'uniq', 'cut', 'jq', 'echo', 'printf', 'cd', 'awk', 'sed', 'tr', 'basename', 'dirname',
  'realpath', 'readlink', 'file', 'du', 'df', 'date', 'true', 'false', 'test', '[', 'column', 'nl', 'less',
  'more', 'type', 'uname', 'id', 'whoami', 'sleep',
])
const READ_ONLY_GIT = new Set([
  'status', 'log', 'diff', 'show', 'ls-files', 'ls-remote', 'rev-parse', 'blame', 'fetch', 'describe',
  'shortlog', 'cat-file',
])
const FIND_WRITE = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/
// Lệnh w/W/e của sed (đứng đầu hoặc sau dấu ngăn, chữ số địa chỉ, dấu / hay $) và flag w của s///.
const SED_WRITE = /(?:^|[;{}\s\d$/'"])(?:w|W|e)\s+\S|\/[gpIi0-9]*[wW]\s+\S/

function segmentIsReadOnly(part: string): boolean {
  const tokens = part.trim().split(/\s+/).filter(Boolean)
  const cmd = tokens[0]
  if (cmd === undefined) return true
  const args = tokens.slice(1)
  if (cmd === 'git') {
    // Bỏ các tùy chọn đứng trước lệnh con (git -C dir status, git -c k=v log).
    let i = 0
    while (i < args.length && args[i]?.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i] ?? '') ? 2 : 1
    const sub = args[i]
    return sub === undefined || READ_ONLY_GIT.has(sub)
  }
  // printenv chỉ in biến môi trường; env cũng vậy khi không kèm lệnh (env FOO=1 make thì chạy make).
  if (cmd === 'printenv') return true
  if (cmd === 'env') return args.every(a => a.startsWith('-'))
  if (!READ_ONLY_COMMANDS.has(cmd)) return false
  if (cmd === 'find') return !args.some(a => FIND_WRITE.test(a))
  // sed -i ghi file; lệnh w, flag s///w và lệnh e của sed ghi file hoặc chạy lệnh khác. sort -o ghi file.
  if (cmd === 'sed') return !args.some(a => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place') || SED_WRITE.test(a))
  if (cmd === 'sort') return !args.some(a => /^-o/.test(a) || a.startsWith('--output'))
  return true
}

/**
 * Lệnh Bash chỉ đọc: mọi đoạn là lệnh chỉ đọc, không có chuyển hướng ghi (trừ /dev/null và
 * 2>&1), không có thay thế lệnh $( ) hay backtick. Chuỗi trong nháy được bỏ trước khi kiểm.
 */
export function isReadOnlyCommand(command: string): boolean {
  // Thay thế lệnh và system() của awk có thể chạy lệnh khác; kiểm trên lệnh gốc, trước khi bỏ chuỗi trong nháy.
  if (/\$\(|`|\bsystem\s*\(/.test(command)) return false
  // Script sed nằm trong nháy: kiểm trên lệnh gốc. Có thể báo nhầm một pattern chứa "w e"; chấp nhận, vì an toàn hơn.
  if (/\bsed\b/.test(command) && SED_WRITE.test(command)) return false
  const unquoted = command.replace(/"[^"]*"|'[^']*'/g, '""')
  const writes = unquoted.replace(/\d*>&\d+|&?\d*>>?\s*\/dev\/null/g, '')
  if (writes.includes('>')) return false
  return segments(unquoted).every(segmentIsReadOnly)
}

export function isMutation(observation: ToolObservation): boolean {
  if (FILE_TOOLS.has(observation.tool)) return !isPlanFile(filePathOf(observation))
  return (
    observation.tool === 'Bash' &&
    !observation.isReadOnly &&
    !isVerification(observation) &&
    !isReadOnlyCommand(str(observation.input['command']))
  )
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

  // Lần gọi này có làm tăng bộ đếm thay đổi không (để checkpoint chỉ báo đúng lúc đếm đủ bội số).
  let isCounted = false
  if (isVerification(observation) && !observation.isError) {
    tracker.mutationsSinceCheck = 0
    tracker.isVerified = true
  } else if (isMutation(observation) && !observation.isError) {
    tracker.mutations += 1
    tracker.mutationsSinceCheck += 1
    isCounted = true
  }

  if (focus === null) return findings

  const path = filePathOf(observation)
  if (
    FILE_TOOLS.has(observation.tool) &&
    !isPlanFile(path) &&
    !isInScope(path, focus.scopePaths) &&
    !tracker.outOfScope.has(path)
  ) {
    tracker.outOfScope.add(path)
    findings.push({
      kind: 'scope',
      priority: 3,
      text: `Sửa ngoài phạm vi đã nêu: ${path}`,
      context:
        `[focus-conductor] ${path} nằm ngoài phạm vi người dùng giới hạn (${focus.scopePaths.join(', ')}). ` +
        'Xác nhận thay đổi này là bắt buộc cho mục tiêu; nếu không, hoàn tác và quay lại phạm vi.',
    })
  }

  const budget = TOOL_BUDGET[focus.tier]
  const level = tracker.toolCalls >= budget * 2 ? 2 : tracker.toolCalls >= budget ? 1 : 0
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

  if (isCounted && tracker.mutationsSinceCheck % CHECKPOINT_EVERY === 0) {
    findings.push({
      kind: 'checkpoint',
      priority: 1,
      text: `${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa kiểm tra`,
      context:
        `[focus-conductor] Checkpoint: ${tracker.mutationsSinceCheck} thay đổi liên tiếp chưa được kiểm tra. ` +
        `${goalLine(focus, plan)}. Trước khi sửa tiếp, kiểm tra lại phần vừa làm ` +
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

// ------------------------------------------------------------ đối chiếu evidence

/** Lệnh và file đã thấy trong mục tiêu hiện tại (luồng chính), để đối chiếu evidence khi Claude ghi "verified". */
export type EvidenceLog = { goalId: number; commands: string[]; paths: string[] }

const EVIDENCE_COMMANDS = 100
const EVIDENCE_PATHS = 200

export function newEvidenceLog(goalId: number): EvidenceLog {
  return { goalId, commands: [], paths: [] }
}

/** Ghi lệnh Bash và đường dẫn file của một tool call vào dấu vết của mục tiêu. */
export function noteEvidence(log: EvidenceLog, observation: ToolObservation): void {
  const command = str(observation.input['command']).trim()
  if (observation.tool === 'Bash' && command !== '') {
    log.commands.push(command.slice(0, 500))
    if (log.commands.length > EVIDENCE_COMMANDS) log.commands.shift()
  }
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const path = str(observation.input[key]).trim()
    if (path === '' || log.paths.includes(path)) continue
    log.paths.push(path)
    if (log.paths.length > EVIDENCE_PATHS) log.paths.shift()
  }
}

/**
 * Evidence có nhắc tới một lệnh đã chạy (vài từ đầu của một đoạn lệnh, như "claude plugin test" hay "npm test")
 * hoặc một file đã đụng tới (đường dẫn hoặc tên file) trong mục tiêu. Kiểm mềm: chỉ để cảnh báo, không chặn.
 */
export function evidenceMatches(evidence: string, log: EvidenceLog): boolean {
  const text = evidence.toLowerCase()
  for (const command of log.commands) {
    for (const part of segments(command)) {
      const tokens = part.toLowerCase().split(/\s+/).filter(Boolean)
      const words = tokens.filter(t => !t.startsWith('-'))
      // Vài từ đầu của lệnh (có hoặc không kèm tùy chọn), hoặc một đối số dạng đường dẫn của lệnh.
      const keys = [tokens.slice(0, 3).join(' '), words.slice(0, 2).join(' '), ...words.slice(1).filter(w => w.length >= 6 && /[\\/.]/.test(w))]
      if (keys.some(key => key.length >= 4 && text.includes(key))) return true
    }
  }
  return log.paths.some(path => {
    const lower = path.toLowerCase()
    const name = lower.split(/[\\/]/).pop() ?? ''
    return text.includes(lower) || (name.length >= 4 && text.includes(name))
  })
}
