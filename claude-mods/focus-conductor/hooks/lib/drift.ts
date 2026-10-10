// Theo dõi tính nhất quán trong một turn của luồng chính: lặp lại lệnh lỗi,
// vượt ngân sách bước so với độ phức tạp, sửa file ngoài phạm vi được phép,
// và chuỗi thay đổi dài mà chưa tự kiểm tra. Hàm ở đây thuần, không gọi $,
// để test được và để register quyết định cách hiển thị.

import type { Brief, Kind, PlanStep, Relation, Tier, WarningKind } from '../../types'
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

// Lệnh kiểm tra chạy test (hành vi) chứ không chỉ kiểm tĩnh (type-check, lint, build, validate).
const TEST_SEGMENT = new RegExp(
  '^(?:' +
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:-\\S+\\s+)*(?:test|tests|verify)\\b|' +
    '(?:npx\\s+(?:-\\S+\\s+)*)?(?:pytest|jest|vitest|mocha)\\b|' +
    'node\\s+--test\\b|' +
    'python3?\\s+-m\\s+(?:pytest|unittest)\\b|' +
    'cargo\\s+test\\b|go\\s+test\\b|make\\s+test\\b|claude\\s+plugin\\s+test\\b|' +
    'dotnet\\s+test\\b|mvn\\s+(?:test|verify)\\b|gradle\\s+test\\b' +
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
  /** Đúng khi có lệnh kiểm tra đạt sau thay đổi cuối cùng của turn; mỗi thay đổi mới đặt lại false. */
  isVerified: boolean
  /** Số lệnh kiểm tra đạt trong turn (để câu báo phân biệt "chưa kiểm tra lần nào" với "sửa sau lần kiểm tra cuối"). */
  checks: number
  /** Số lời gọi Agent thành công: turn chỉ giao subagent vẫn là turn đang thực thi mục tiêu. */
  delegated: number
  /** Đã cảnh báo lệnh ghi không xác định được file đích trong turn này. */
  unknownWriteWarned: boolean
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
    checks: 0,
    delegated: 0,
    unknownWriteWarned: false,
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
  return observation.tool === 'Bash' && checkKindOf(str(observation.input['command'])) !== null
}

export type CheckKind = 'test' | 'static'

/** Loại kiểm tra của một lệnh: test (chạy hành vi), static (type-check, lint, build, validate), hoặc null. */
export function checkKindOf(command: string): CheckKind | null {
  const parts = segments(command).filter(part => VERIFY_SEGMENT.test(part))
  if (parts.length === 0) return null
  return parts.some(part => TEST_SEGMENT.test(part)) ? 'test' : 'static'
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

/** Chuẩn hóa đường dẫn: dấu \\ thành /, bỏ ./, gộp .. (không đụng hệ thống tệp). */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/')
  const isAbsolute = unified.startsWith('/')
  const out: string[] = []
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else if (part === '..' && isAbsolute) continue
    else out.push(part)
  }
  return `${isAbsolute ? '/' : ''}${out.join('/')}`
}

/** Đường dẫn nằm trong phạm vi khi khớp đuôi, nằm dưới một thư mục được nhắc, hoặc là đường dẫn tương đối bắt đầu bằng phạm vi. */
export function isInScope(path: string, scopePaths: readonly string[]): boolean {
  if (scopePaths.length === 0 || path === '') return true
  const normalized = normalizePath(path)
  return scopePaths.some(scope => {
    const s = normalizePath(scope)
    if (s === '') return true
    return normalized === s || normalized.startsWith(`${s}/`) || normalized.endsWith(`/${s}`) || normalized.includes(`/${s}/`)
  })
}

// ------------------------------------------------------------ đích ghi của lệnh Bash

/** Lệnh ghi lên mọi đối số đường dẫn. */
const WRITE_ALL = new Set(['rm', 'rmdir', 'touch', 'mkdir', 'truncate', 'shred', 'unlink'])
/** Lệnh ghi lên đối số cuối (đích). */
const WRITE_LAST = new Set(['cp', 'mv', 'install', 'ln', 'rsync'])
/** Lệnh đổi quyền: đối số đầu là quyền hoặc chủ sở hữu, còn lại là đường dẫn. */
const WRITE_AFTER_FIRST = new Set(['chmod', 'chown', 'chgrp'])
/** Lệnh con của git không ghi file trong cây làm việc (thao tác trên lịch sử hay remote). */
const GIT_NO_FILES = new Set(['add', 'commit', 'push', 'tag', 'branch', 'fetch', 'config', 'remote', 'notes', 'gc'])
/** Tùy chọn của sed nhận một giá trị đi kèm. */
const SED_VALUE_OPTIONS = new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length'])

export type WriteTargets = { paths: string[]; isUnknown: boolean }

/**
 * File đích của một lệnh Bash có ghi: chuyển hướng ghi, tee, sed -i, cp/mv/install/ln (đối số cuối), rm, touch,
 * mkdir, truncate, chmod/chown, git checkout -- và git restore. Đường dẫn tương đối nối với thư mục của `cd` đứng
 * trước. Lệnh ghi mà không đọc được đích (script, trình cài gói, đường dẫn chứa biến) thì isUnknown.
 * Chỉ để giám sát phạm vi; không phải phân quyền hệ thống tệp.
 */
export function bashWriteTargets(command: string): WriteTargets {
  // Thân heredoc là dữ liệu, không phải lệnh: bỏ đi trước khi tách đoạn.
  const withoutHeredoc = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (_m, _q: string, _tag: string, rest: string) => rest)
  const quoted: string[] = []
  // Chuỗi trong nháy thành một token giữ chỗ: dấu > hay ; trong nháy không bị đọc nhầm là cú pháp shell.
  const masked = withoutHeredoc.replace(/"([^"]*)"|'([^']*)'/g, (_m, a: string | undefined, b: string | undefined) => {
    quoted.push(a ?? b ?? '')
    return `\u0000${quoted.length - 1}\u0000`
  })
  const unmask = (token: string) => token.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => quoted[Number(i)] ?? '')
  const paths: string[] = []
  let isUnknown = false
  let cwd = ''
  const add = (raw: string) => {
    const token = unmask(raw)
    if (token === '' || token === '-' || /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/.test(token)) return
    if (/[$`*?]/.test(token) || token.startsWith('~')) {
      isUnknown = true
      return
    }
    const path = normalizePath(token.startsWith('/') || cwd === '' ? token : `${cwd}/${token}`)
    if (!paths.includes(path)) paths.push(path)
  }

  for (const part of segments(masked)) {
    // Chuyển hướng ghi trong đoạn: >, >>, 1>, &>, bỏ qua >&N (gộp luồng).
    const redirect = /(?:^|[^<>&\d])(?:\d*|&)>>?(?!&)\s*([^\s<>;&|]+)/g
    for (const match of part.matchAll(redirect)) add(match[1] ?? '')
    const tokens = part
      .replace(/(?:\d*|&)>>?(?!&)\s*[^\s<>;&|]+/g, ' ')
      .replace(/\d*>&\d+/g, ' ')
      // Chuyển hướng đọc (<, <<<) không ghi file.
      .replace(/\d*<<?<?\s*[^\s<>;&|]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    let cmd = tokens[0]
    let args = tokens.slice(1)
    while ((cmd === 'sudo' || cmd === 'command' || cmd === 'nohup' || cmd === 'xargs') && args.length > 0) {
      cmd = args[0]
      args = args.slice(1)
    }
    if (cmd === undefined) continue
    const name = unmask(cmd)
    if (name === 'cd') {
      const dir = args[0] !== undefined ? unmask(args[0]) : ''
      if (dir === '' || /[$`~]/.test(dir) || dir === '-') cwd = '\u0000unknown'
      else cwd = cwd === '' || dir.startsWith('/') ? normalizePath(dir) : normalizePath(`${cwd}/${dir}`)
      continue
    }
    if (segmentIsReadOnly(unmask(part)) || VERIFY_SEGMENT.test(unmask(part))) continue
    const positional = args.filter(a => !unmask(a).startsWith('-'))
    if (name === 'tee') positional.forEach(add)
    else if (name === 'sed') {
      // sed -i: bỏ script (đối số đầu khi không có -e/-f), còn lại là file bị sửa.
      const files: string[] = []
      let hasScript = false
      for (let i = 0; i < args.length; i++) {
        const arg = unmask(args[i] ?? '')
        if (SED_VALUE_OPTIONS.has(arg)) {
          if (arg !== '-l' && arg !== '--line-length') hasScript = true
          i += 1
        } else if (!arg.startsWith('-')) files.push(args[i] ?? '')
      }
      ;(hasScript ? files : files.slice(1)).forEach(add)
    } else if (WRITE_ALL.has(name)) positional.forEach(add)
    else if (WRITE_LAST.has(name)) {
      const t = args.findIndex(a => unmask(a) === '-t' || unmask(a).startsWith('--target-directory'))
      const target = t >= 0 ? (unmask(args[t] ?? '').includes('=') ? (args[t] ?? '').split('=')[1] : args[t + 1]) : positional[positional.length - 1]
      if (target !== undefined) add(target)
      else isUnknown = true
    } else if (WRITE_AFTER_FIRST.has(name)) positional.slice(1).forEach(add)
    else if (name === 'git') {
      const sub = positional[0] !== undefined ? unmask(positional[0]) : ''
      if (GIT_NO_FILES.has(sub)) continue
      const dash = args.findIndex(a => unmask(a) === '--')
      if (sub === 'restore') positional.slice(1).forEach(add)
      else if ((sub === 'checkout' || sub === 'reset') && dash >= 0) args.slice(dash + 1).forEach(add)
      else isUnknown = true
    } else if (name !== '') isUnknown = true
  }
  if (cwd === '\u0000unknown') {
    // cd tới thư mục không đọc được: đường dẫn tương đối sau đó không đối chiếu được.
    return { paths: paths.filter(path => path.startsWith('/') && !path.includes('\u0000')), isUnknown: true }
  }
  return { paths, isUnknown }
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

  // Lần gọi này có làm tăng bộ đếm thay đổi không (để checkpoint chỉ báo đúng lúc đếm đủ bội số).
  let isCounted = false
  if (isVerification(observation) && !observation.isError) {
    tracker.mutationsSinceCheck = 0
    tracker.isVerified = true
    tracker.checks += 1
  } else if (isMutation(observation) && !observation.isError) {
    tracker.mutations += 1
    tracker.mutationsSinceCheck += 1
    // Thay đổi mới chưa được kiểm tra: lần kiểm tra trước không còn phủ trạng thái hiện tại.
    tracker.isVerified = false
    isCounted = true
  }
  if (observation.tool === 'Agent' && !observation.isError) tracker.delegated += 1

  if (focus === null) return findings

  // Lệnh Bash ghi file: đối chiếu từng file đích với phạm vi; không đọc được đích thì báo riêng.
  if (observation.tool === 'Bash' && focus.scopePaths.length > 0 && isMutation(observation)) {
    const command = str(observation.input['command'])
    const targets = bashWriteTargets(command)
    for (const target of targets.paths) {
      if (isPlanFile(target) || isInScope(target, focus.scopePaths) || tracker.outOfScope.has(target)) continue
      tracker.outOfScope.add(target)
      findings.push({
        kind: 'scope',
        priority: 3,
        text: `Lệnh Bash ghi ngoài phạm vi đã nêu: ${target}`,
        context:
          `[focus-conductor] Lệnh \`${command.slice(0, 160)}\` ghi vào ${target}, nằm ngoài phạm vi người dùng giới hạn (${focus.scopePaths.join(', ')}). ` +
          'Xác nhận thay đổi này là bắt buộc cho mục tiêu; nếu không, hoàn tác và quay lại phạm vi.',
      })
    }
    if (targets.isUnknown && !tracker.unknownWriteWarned) {
      tracker.unknownWriteWarned = true
      findings.push({
        kind: 'scope',
        priority: 2,
        text: `Lệnh ghi không xác định được file đích (phạm vi: ${focus.scopePaths.join(', ')}): ${command.slice(0, 80)}`,
        context:
          `[focus-conductor] Lệnh \`${command.slice(0, 160)}\` có thể ghi file nhưng mod không xác định được file đích, nên không đối chiếu được ` +
          `với phạm vi người dùng giới hạn (${focus.scopePaths.join(', ')}). Kiểm tra lệnh này chỉ ghi trong phạm vi; nếu ghi ra ngoài, ` +
          'xác nhận là bắt buộc cho mục tiêu hoặc hoàn tác.',
      })
    }
  }

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
      text:
        tracker.checks === 0
          ? `Turn có ${tracker.mutations} thay đổi nhưng không chạy bước kiểm tra nào`
          : `${tracker.mutationsSinceCheck} thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại`,
    })
  }
  const open = openSteps(plan)
  if (open.length > 0) {
    findings.push({ kind: 'open-steps', priority: 1, text: `Checklist còn ${open.length} bước mở` })
  }
  return findings
}

// ------------------------------------------------------------ đối chiếu evidence

/** Một lệnh Bash đã chạy trong mục tiêu: kết quả thật (ok theo mã thoát), loại kiểm tra và thứ tự. */
export type EvidenceEntry = { command: string; ok: boolean; check: CheckKind | null; seq: number }

/**
 * Dấu vết thực thi của một mục tiêu, để đối chiếu evidence khi Claude ghi "verified": các lệnh Bash (kể cả lệnh lỗi),
 * file đã đụng tới, số thay đổi và thứ tự của thay đổi cuối cùng.
 */
export type EvidenceLog = {
  goalId: number
  seq: number
  /** Thứ tự của thay đổi thành công cuối cùng; -1 khi mục tiêu chưa có thay đổi. */
  lastMutation: number
  mutations: number
  commands: EvidenceEntry[]
  paths: string[]
}

const EVIDENCE_COMMANDS = 100
const EVIDENCE_PATHS = 200

export function newEvidenceLog(goalId: number): EvidenceLog {
  return { goalId, seq: 0, lastMutation: -1, mutations: 0, commands: [], paths: [] }
}

/** Ghi một tool call vào dấu vết của mục tiêu: lệnh Bash kèm kết quả, thay đổi, và đường dẫn file. */
export function noteEvidence(log: EvidenceLog, observation: ToolObservation): void {
  log.seq += 1
  const command = str(observation.input['command']).trim()
  if (observation.tool === 'Bash' && command !== '') {
    log.commands.push({ command: command.slice(0, 500), ok: !observation.isError, check: checkKindOf(command), seq: log.seq })
    if (log.commands.length > EVIDENCE_COMMANDS) log.commands.shift()
  }
  if (observation.isError) return
  if (isMutation(observation)) {
    log.lastMutation = log.seq
    log.mutations += 1
  }
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const path = str(observation.input[key]).trim()
    if (path === '' || log.paths.includes(path)) continue
    log.paths.push(path)
    if (log.paths.length > EVIDENCE_PATHS) log.paths.shift()
  }
}

/** Evidence nhắc tới lệnh này: vài từ đầu của một đoạn lệnh (có hoặc không kèm tùy chọn), hoặc một đối số dạng đường dẫn. */
function mentionsCommand(text: string, command: string): boolean {
  for (const part of segments(command)) {
    const tokens = part.toLowerCase().split(/\s+/).filter(Boolean)
    const words = tokens.filter(t => !t.startsWith('-'))
    const keys = [tokens.slice(0, 3).join(' '), words.slice(0, 2).join(' '), ...words.slice(1).filter(w => w.length >= 6 && /[\\/.]/.test(w))]
    if (keys.some(key => key.length >= 4 && text.includes(key))) return true
  }
  return false
}

export type EvidenceLevel = 'strong' | 'stale' | 'weak' | 'none'

export type EvidenceStrength = {
  /**
   * strong: nhắc một lệnh kiểm tra chạy thành công sau thay đổi cuối; stale: chỉ nhắc lệnh kiểm tra đã lỗi hoặc chạy
   * trước thay đổi cuối; weak: chỉ nhắc lệnh khác hoặc file đã đụng tới; none: không nhắc gì đã chạy.
   */
  level: EvidenceLevel
  /** Loại kiểm tra của bằng chứng strong: có test, hay chỉ kiểm tĩnh. */
  check?: CheckKind
  /** Lý do khi chưa đủ (để nói với Claude và người dùng). */
  reason?: string
}

/** Đối chiếu evidence của "verified" với dấu vết thật của mục tiêu. */
export function evidenceStrength(evidence: string, log: EvidenceLog): EvidenceStrength {
  const text = evidence.toLowerCase()
  const mentioned = log.commands.filter(entry => mentionsCommand(text, entry.command))
  const fresh = mentioned.filter(entry => entry.check !== null && entry.ok && entry.seq > log.lastMutation)
  if (fresh.length > 0) return { level: 'strong', check: fresh.some(entry => entry.check === 'test') ? 'test' : 'static' }
  const checks = mentioned.filter(entry => entry.check !== null)
  const last = checks[checks.length - 1]
  if (last !== undefined) {
    const shown = last.command.slice(0, 80)
    return {
      level: 'stale',
      reason: !last.ok ? `lệnh kiểm tra \`${shown}\` đã lỗi` : `lệnh kiểm tra \`${shown}\` chạy trước thay đổi cuối cùng`,
    }
  }
  const touched = log.paths.some(path => {
    const lower = path.toLowerCase()
    const name = lower.split(/[\\/]/).pop() ?? ''
    return text.includes(lower) || (name.length >= 4 && text.includes(name))
  })
  if (mentioned.length > 0 || touched) return { level: 'weak', reason: 'evidence chỉ nhắc lệnh hay file khác, không nhắc lệnh kiểm tra nào chạy sau thay đổi cuối' }
  return { level: 'none', reason: 'evidence không nhắc lệnh hay file nào đã chạy trong mục tiêu này' }
}

/** Evidence có nhắc tới bất kỳ lệnh hay file nào đã chạy trong mục tiêu (kiểm mềm, giữ cho tương thích). */
export function evidenceMatches(evidence: string, log: EvidenceLog): boolean {
  return evidenceStrength(evidence, log).level !== 'none'
}

/**
 * "verified" chỉ được nhận khi bằng chứng mạnh, hoặc khi mục tiêu chưa có thay đổi nào (việc điều tra, chỉ đọc)
 * và evidence nhắc ít nhất một lệnh hay file đã đụng tới. Còn lại bước được lưu là done.
 */
export function acceptsVerified(strength: EvidenceStrength, log: EvidenceLog): boolean {
  return strength.level === 'strong' || (log.mutations === 0 && strength.level === 'weak')
}
