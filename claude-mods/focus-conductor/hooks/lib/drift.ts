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
  /** Đúng khi mọi thay đổi của turn đã được kiểm tra lại (tập `pending` rỗng); mỗi thay đổi mới đặt lại false. */
  isVerified: boolean
  /**
   * Tác giả có thay đổi chưa được kiểm tra lại: "main" (luồng chính) hoặc id subagent. Kiểm tra đạt của luồng chính
   * xóa cả tập; kiểm tra đạt của subagent chỉ xóa phần của chính nó.
   */
  pending: Set<string>
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
}

export function newTracker(turnId: string): TurnTracker {
  return {
    turnId,
    toolCalls: 0,
    mutations: 0,
    mutationsSinceCheck: 0,
    isVerified: false,
    pending: new Set(),
    checks: 0,
    delegated: 0,
    unknownWrites: new Set(),
    rootWarned: false,
    planUpdates: 0,
    errors: 0,
    failures: new Map(),
    budgetLevel: 0,
    outOfScope: new Set(),
  }
}

/**
 * Ngữ cảnh để đo lệch: mục tiêu, phạm vi và ngân sách của luồng chính hoặc của một subagent. `root` là thư mục gốc
 * của phiên chốt cho mục tiêu (null hoặc thiếu: không xác định được, khi đó không khẳng định file nào trong phạm vi);
 * `cwd` là thư mục làm việc hiện tại, để nối đường dẫn tương đối của lệnh Bash.
 */
export type Focus = { goal: string; scopePaths: string[]; tier: Tier; root?: string | null; cwd?: string | null }

export type ToolObservation = {
  tool: string
  input: Record<string, unknown>
  isError: boolean
  isReadOnly: boolean
  /** Output của tool như model đọc (nếu có): để nhận ra lệnh kiểm tra báo lỗi mà mã thoát vẫn 0 (ví dụ qua `| tail`). */
  output?: string
}

// Dấu hiệu lỗi trong output của các trình chạy test, type-check, lint phổ biến. Chỉ áp cho lệnh kiểm tra.
const CHECK_FAILED = new RegExp(
  [
    '(?:^|\\n)\\s*#\\s*fail\\s+[1-9]', // TAP (node --test)
    '\\b[1-9]\\d*\\s+(?:failed|failing|fail|failures?)\\b', // jest, mocha, bun, vitest, pytest
    '\\bTests?:\\s+[1-9]\\d*\\s+failed', // jest
    '\\berror\\s+TS\\d+', // tsc
    '(?:^|\\n)FAILED\\b|=+\\s*FAILURES\\s*=+', // pytest
    '\\u2716\\s*[1-9]\\d*\\s+problems?', // eslint
    '\\bFound\\s+[1-9]\\d*\\s+errors?\\b', // tsc --pretty, mypy
    'test result:\\s*FAILED', // cargo
    '(?:^|\\n)(?:FAIL|--- FAIL)\\b', // go test, jest
  ].join('|'),
  'i',
)

/** Output của lệnh kiểm tra có dấu hiệu lỗi (dù mã thoát là 0). */
export function outputFailed(output: string | undefined): boolean {
  return output !== undefined && output !== '' && CHECK_FAILED.test(output)
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

/** Lệnh Bash có chạy một lệnh kiểm tra (theo phân loại giữ cú pháp, không tính chuỗi trong nháy). */
export function isVerification(observation: ToolObservation): boolean {
  return observation.tool === 'Bash' && classifyBash(str(observation.input['command'])).effects.some(e => e.kind === 'check')
}

export type CheckKind = 'test' | 'static'

/** Loại kiểm tra của một lệnh: test (chạy hành vi), static (type-check, lint, build, validate), hoặc null. */
export function checkKindOf(command: string): CheckKind | null {
  const checks = classifyBash(command).effects.filter((e): e is CheckEffect => e.kind === 'check')
  if (checks.length === 0) return null
  return checks.some(e => e.check === 'test') ? 'test' : 'static'
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
const AWK_COMMAND = /(?:^|[\s;&|(])[gmn]?awk\b/
// print/printf của awk kèm chuyển hướng hoặc ống, và system(): ghi file hoặc chạy lệnh khác.
const AWK_WRITE = /\bprintf?\b[^;}\n]*?(?:>|\|)|\bsystem\s*\(/

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
  // Script awk nằm trong nháy: print/printf chuyển hướng (>, >>) hay nối ống (|) là ghi file hoặc chạy lệnh khác.
  if (AWK_COMMAND.test(command) && AWK_WRITE.test(command)) return false
  const unquoted = command.replace(/"[^"]*"|'[^']*'/g, '""')
  const writes = unquoted.replace(/\d*>&\d+|&?\d*>>?\s*\/dev\/null/g, '')
  if (writes.includes('>')) return false
  return segments(unquoted).every(segmentIsReadOnly)
}

/**
 * Tool call có (hoặc có thể đã) ghi file. Bash theo phân loại chung `classifyBash`: ghi xác định (chuyển hướng, lệnh ghi
 * đã biết) luôn là thay đổi, kể cả khi engine báo chỉ đọc; ghi có thể (lệnh lạ, script) bị bỏ khi engine báo chỉ đọc.
 * Dùng chung cho kiểm tra trước khi chạy (strictDelegation block), theo dõi sau khi chạy, phạm vi và dấu vết.
 */
export function isMutation(observation: ToolObservation): boolean {
  if (FILE_TOOLS.has(observation.tool)) return !isPlanFile(filePathOf(observation))
  if (observation.tool !== 'Bash') return false
  return writeEffects(classifyBash(str(observation.input['command'])), observation.isReadOnly).length > 0
}

/**
 * Các hiệu ứng ghi còn tính được sau khi xét thông tin chỉ đọc của engine. Hiệu ứng chỉ ghi file kế hoạch
 * (`.claude/plans/*.md`, mọi đích đọc được và không có đích lạ) không phải thay đổi mã, như với Edit và Write.
 */
function writeEffects(classified: BashClass, isReadOnly: boolean): WriteEffect[] {
  return classified.effects.filter(
    (e): e is WriteEffect =>
      e.kind === 'write' && (e.level === 'definite' || !isReadOnly) && !(e.paths.length > 0 && !e.isUnknown && e.paths.every(isPlanFile)),
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

export type ScopeStatus = 'in' | 'out' | 'unknown'

/**
 * Vị trí của một đường dẫn so với phạm vi, neo theo thư mục gốc của phiên. Đường dẫn và phạm vi tương đối được nối
 * vào gốc (đường dẫn tương đối của lệnh Bash nối vào `cwd` nếu có); trong phạm vi chỉ khi bằng hoặc nằm dưới
 * `gốc/phạm vi`; phạm vi chỉ là tên file (có phần mở rộng, không có /) thì khớp theo tên file bên trong gốc; ngoài
 * gốc luôn là ngoài phạm vi. Không có gốc thì không khẳng định gì (unknown), không quay về khớp theo chuỗi.
 */
export function scopeStatus(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): ScopeStatus {
  if (scopePaths.length === 0 || path === '') return 'in'
  if (!root) return 'unknown'
  const base = normalizePath(root)
  const resolve = (p: string, from: string) => normalizePath(p.replace(/\\/g, '/').startsWith('/') ? p : `${from}/${p}`)
  const file = resolve(path, cwd ? resolve(cwd, base) : base)
  const isUnder = (dir: string) => file === dir || file.startsWith(`${dir}/`)
  if (!isUnder(base)) return 'out'
  const name = file.split('/').pop() ?? ''
  return scopePaths.some(scope => {
    const s = scope.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (s === '' || s === '.') return true
    if (!s.includes('/') && /\.[A-Za-z0-9]+$/.test(s)) return name === s
    return isUnder(resolve(s, base))
  })
    ? 'in'
    : 'out'
}

/** Đường dẫn chắc chắn nằm trong phạm vi (cần thư mục gốc; không có gốc thì không khẳng định). */
export function isInScope(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): boolean {
  return scopeStatus(path, scopePaths, root, cwd) === 'in'
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
 * Một lệnh kiểm tra trong lệnh Bash: loại, có chắc đã chạy (không sau ||, không trong cấu trúc chưa hỗ trợ), và mã
 * thoát của nó có bị che không (có ;, ||, | hay xuống dòng đứng sau: mã thoát cuối là của lệnh khác).
 */
export type CheckEffect = {
  kind: 'check'
  check: CheckKind
  /** Đoạn lệnh kiểm tra (không kèm các đoạn khác của câu lệnh): bằng chứng gắn với đúng đoạn này. */
  segment: string
  trusted: boolean
  /**
   * visible: mã thoát của câu lệnh chính là của lệnh kiểm tra. filtered: lệnh kiểm tra đứng đầu, không chuyển hướng
   * nào ngoài 2>&1, nối ống duy nhất sang tail (chỉ số dòng) hoặc cat (không đối số), output chỉ đến từ nó. hidden: mã
   * thoát hay output bị lệnh khác che; không bao giờ tính là đạt.
   */
  exit: 'visible' | 'filtered' | 'hidden'
  /** Bộ lọc khi exit là filtered: tail cắt output (chỉ còn phần cuối), cat giữ đủ. */
  filter?: 'tail' | 'cat'
}
/** Một tác động ghi: definite (chuyển hướng, lệnh ghi đã biết), possible (lệnh lạ, script, cấu trúc chưa hỗ trợ). */
export type WriteEffect = {
  kind: 'write'
  level: 'definite' | 'possible'
  /** File đích đọc được của chính đoạn lệnh này (để loại file kế hoạch); isUnknown: đoạn có đích không đọc được. */
  paths: string[]
  isUnknown: boolean
}
export type BashEffect = CheckEffect | WriteEffect

/** Kết quả phân loại một lệnh Bash, dùng chung cho mọi hook: hiệu ứng theo thứ tự, file đích, cờ không xác định đích. */
export type BashClass = { effects: BashEffect[]; paths: string[]; isUnknown: boolean }

type Operator = '' | '&&' | '||' | ';' | '|'

/**
 * Che chuỗi trong nháy bằng token giữ chỗ và bỏ thân heredoc (giữ lại dấu `<<H` để biết đoạn đó đọc từ heredoc), để
 * dấu ngăn lệnh trong nháy hay trong heredoc không bị đọc nhầm.
 */
function maskCommand(command: string): { masked: string; unmask: (token: string) => string } {
  const withoutHeredoc = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (_m, _q: string, _tag: string, rest: string) => `<<H${rest}`)
  const quoted: string[] = []
  const masked = withoutHeredoc.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_m, a: string | undefined, b: string | undefined) => {
    quoted.push(a ?? b ?? '')
    return `\u0000${quoted.length - 1}\u0000`
  })
  const unmask = (token: string) => token.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => quoted[Number(i)] ?? '')
  return { masked, unmask }
}

/** Tách lệnh đã che thành các đoạn, giữ toán tử đứng trước mỗi đoạn (&&, ||, ;, |; xuống dòng tính như ;). */
function pieces(masked: string): Array<{ op: Operator; text: string }> {
  const parts = masked.split(/(\|\||&&|;|\|(?!\|)|\n)/)
  const out: Array<{ op: Operator; text: string }> = []
  let op: Operator = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (i % 2 === 1) {
      op = part === '\n' ? ';' : (part as Operator)
      continue
    }
    const text = part
      .trim()
      .replace(/^[({]+\s*/, '')
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*(?:\s+|$))+/, '')
      .replace(/^timeout\s+\d+\s+/, '')
    if (text !== '') out.push({ op, text })
    else if (out.length === 0) op = ''
  }
  return out
}

/**
 * Bộ lọc chỉ đọc từ ống: `cat` không đối số, `tail` chỉ với số dòng dương. Còn lại (file, <, heredoc, tùy chọn khác,
 * token trong nháy kể cả rỗng) là null. `text` là đoạn lệnh đã che chuỗi trong nháy, nên token trong nháy là token giữ
 * chỗ, không bao giờ khớp.
 */
function pipeFilter(text: string): 'tail' | 'cat' | null {
  const [name, ...args] = text.trim().split(/\s+/)
  if (name === 'cat') return args.length === 0 ? 'cat' : null
  if (name !== 'tail') return null
  const count = /^[1-9]\d*$/
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-n' || arg === '--lines') {
      if (!count.test(args[i + 1] ?? '')) return null
      i += 1
    } else if (!/^(?:-n|-|--lines=)[1-9]\d*$/.test(arg)) return null
  }
  return 'tail'
}

/**
 * Mức che mã thoát của lệnh kiểm tra ở vị trí `index`, theo ngữ nghĩa shell. Lệnh sau nối bằng && (hoặc không có) thì
 * mã thoát của lệnh kiểm tra không bị che: visible. Ống chỉ giữ được mức filtered khi lệnh kiểm tra đứng đầu, không có
 * chuyển hướng nào ngoài 2>&1 (output phải đi hết vào ống), ống đó sang bộ lọc chỉ đọc từ ống (pipeFilter), và câu
 * lệnh kết thúc ở đó. Mọi trường hợp khác (;, ||, xuống dòng, ống sang lệnh khác) là hidden.
 */
function exitOf(list: Array<{ op: Operator; text: string }>, index: number): Pick<CheckEffect, 'exit' | 'filter'> {
  const rest = list.slice(index + 1)
  if (rest.some(after => after.op === ';' || after.op === '||')) return { exit: 'hidden' }
  const next = rest[0]
  if (next === undefined || next.op === '&&') return { exit: 'visible' }
  if (next.op !== '|' || index !== 0 || rest.length !== 1) return { exit: 'hidden' }
  const isRedirected = /[<>]/.test((list[index]?.text ?? '').replace(/(?:^|\s)2>&1(?=\s|$)/g, ' '))
  const filter = pipeFilter(next.text)
  return !isRedirected && filter !== null ? { exit: 'filtered', filter } : { exit: 'hidden' }
}

// Cấu trúc chưa phân tích được: thay thế lệnh, eval, shell con với -c, system() của awk.
const UNSUPPORTED = /\$\(|`|(?:^|[\s;&|(])eval\b|(?:^|[\s;&|(])(?:ba|z|da)?sh\s+-c\b|\bsystem\s*\(/

/**
 * Phân loại một lệnh Bash theo từng đoạn, giữ thứ tự và toán tử: lệnh kiểm tra, tác động ghi, file đích. Kiểm tra chỉ
 * được tin khi chắc chắn đã chạy: đoạn đầu, hoặc sau && hay ;. Chuyển hướng ghi trên chính lệnh kiểm tra là tác
 * động ghi đứng trước kiểm tra. Cấu trúc chưa hỗ trợ thì thêm tác động ghi có thể và không tin kiểm tra nào.
 * Đường dẫn tương đối nối với thư mục của `cd` đứng trước. Chỉ để giám sát; không phải phân quyền hệ thống tệp.
 */
export function classifyBash(command: string): BashClass {
  const { masked, unmask } = maskCommand(command)
  const effects: BashEffect[] = []
  const paths: string[] = []
  let isUnknown = false
  let cwd = ''
  const add = (raw: string) => {
    const token = unmask(raw)
    if (token === '' || token === '-' || /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/.test(token)) return false
    if (/[$`*?]/.test(token) || token.startsWith('~')) {
      isUnknown = segUnknown = true
      return true
    }
    const path = normalizePath(token.startsWith('/') || cwd === '' ? token : `${cwd}/${token}`)
    if (!paths.includes(path)) paths.push(path)
    if (!segPaths.includes(path)) segPaths.push(path)
    return true
  }
  // Đích của đoạn đang xét: mỗi tác động ghi mang đích của chính đoạn đó.
  let segPaths: string[] = []
  let segUnknown = false
  const write = (level: WriteEffect['level']) => effects.push({ kind: 'write', level, paths: [...segPaths], isUnknown: segUnknown })
  const isUnsupported = UNSUPPORTED.test(command)

  const list = pieces(masked)
  for (let index = 0; index < list.length; index++) {
    const piece = list[index]
    if (piece === undefined) continue
    const part = piece.text
    segPaths = []
    segUnknown = false
    // Chuyển hướng ghi trong đoạn: >, >>, 1>, &>, bỏ qua >&N (gộp luồng) và /dev/null.
    let redirected = false
    for (const match of part.matchAll(/(?:^|[^<>&\d])(?:\d*|&)>>?(?!&)\s*([^\s<>;&|]+)/g)) {
      if (add(match[1] ?? '')) redirected = true
    }
    if (redirected) write('definite')
    const bare = part
      .replace(/(?:\d*|&)>>?(?!&)\s*[^\s<>;&|]+/g, ' ')
      .replace(/\d*>&\d+/g, ' ')
      // Chuyển hướng đọc (<, <<<) không ghi file.
      .replace(/\d*<<?<?\s*[^\s<>;&|]+/g, ' ')
      .trim()
    const tokens = bare.split(/\s+/).filter(Boolean)
    let cmd = tokens[0]
    let args = tokens.slice(1)
    while ((cmd === 'sudo' || cmd === 'command' || cmd === 'nohup' || cmd === 'xargs') && args.length > 0) {
      cmd = args[0]
      args = args.slice(1)
    }
    if (cmd === undefined) continue
    const name = unmask(cmd)
    const text = unmask(bare)
    if (name === 'cd') {
      const dir = args[0] !== undefined ? unmask(args[0]) : ''
      if (dir === '' || /[$`~]/.test(dir) || dir === '-') cwd = '\u0000unknown'
      else cwd = cwd === '' || dir.startsWith('/') ? normalizePath(dir) : normalizePath(`${cwd}/${dir}`)
      continue
    }
    if (VERIFY_SEGMENT.test(text)) {
      effects.push({
        kind: 'check',
        check: TEST_SEGMENT.test(text) ? 'test' : 'static',
        segment: text,
        trusted: !isUnsupported && (piece.op === '' || piece.op === '&&' || piece.op === ';'),
        ...exitOf(list, index),
      })
      continue
    }
    if (AWK_COMMAND.test(name) || /^[gmn]?awk$/.test(name)) {
      // Script awk ghi file qua print > "file" hay print | "lệnh": đích không đọc được.
      if (AWK_WRITE.test(unmask(part))) {
        isUnknown = segUnknown = true
        write('possible')
      }
      continue
    }
    if (segmentIsReadOnly(text)) continue
    const positional = args.filter(a => !unmask(a).startsWith('-'))
    if (name === 'tee') {
      positional.forEach(add)
      write('definite')
    } else if (name === 'sed') {
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
      write('definite')
    } else if (WRITE_ALL.has(name)) {
      positional.forEach(add)
      write('definite')
    } else if (WRITE_LAST.has(name)) {
      const t = args.findIndex(a => unmask(a) === '-t' || unmask(a).startsWith('--target-directory'))
      const target = t >= 0 ? (unmask(args[t] ?? '').includes('=') ? (args[t] ?? '').split('=')[1] : args[t + 1]) : positional[positional.length - 1]
      if (target !== undefined) add(target)
      else isUnknown = segUnknown = true
      write('definite')
    } else if (WRITE_AFTER_FIRST.has(name)) {
      positional.slice(1).forEach(add)
      write('definite')
    } else if (name === 'git') {
      const sub = positional[0] !== undefined ? unmask(positional[0]) : ''
      write('definite')
      if (GIT_NO_FILES.has(sub)) continue
      const dash = args.findIndex(a => unmask(a) === '--')
      if (sub === 'restore') positional.slice(1).forEach(add)
      else if ((sub === 'checkout' || sub === 'reset') && dash >= 0) args.slice(dash + 1).forEach(add)
      else isUnknown = segUnknown = true
    } else {
      // Lệnh lạ, trình cài gói, script: có thể ghi, không đọc được đích.
      isUnknown = segUnknown = true
      write('possible')
    }
  }
  if (isUnsupported) {
    isUnknown = segUnknown = true
    write('possible')
  }
  if (cwd === '\u0000unknown') {
    // cd tới thư mục không đọc được: đường dẫn tương đối sau đó không đối chiếu được.
    return { effects, paths: paths.filter(path => path.startsWith('/') && !path.includes('\u0000')), isUnknown: true }
  }
  return { effects, paths, isUnknown }
}

/** File đích của một lệnh Bash có ghi (xem classifyBash). */
export function bashWriteTargets(command: string): WriteTargets {
  const { paths, isUnknown } = classifyBash(command)
  return { paths, isUnknown }
}

/**
 * Khối tổng kết của các trình chạy khác (Node, Go, Cargo có parser riêng), theo output thật (tests/fixtures/runner-output.ts):
 * dòng đạt (số test đạt lớn hơn 0) phải là khối tổng kết CUỐI của output; sau nó chỉ được có dòng trống hoặc dòng phụ
 * của chính trình chạy đó (`trailer`). `requires`: dòng phụ bắt buộc phải có. Không nhận ra định dạng thì không xác nhận.
 */
type Summary = { pass: RegExp; trailer: RegExp[]; requires?: RegExp }
const SUMMARIES: Record<'jest' | 'vitest' | 'mocha' | 'bun' | 'pytest', Summary> = {
  // Jest: "Tests:       12 passed, 12 total", rồi Snapshots, Time, "Ran all test suites."
  jest: { pass: /^Tests:\s+(\d+) passed, \1 total$/, trailer: [/^Snapshots:\s+(?:\d+ passed, )?\d+ total$/, /^Time:\s+[\d.]+ m?s(?:, estimated [\d.]+ m?s)?$/, /^Ran all test suites\b[^\n]*\.$/] },
  // Vitest: "Tests  12 passed (12)", rồi Start at, Duration.
  vitest: { pass: /^Tests\s+(\d+) passed \(\1\)$/, trailer: [/^Start at\s+[\d:]+$/, /^Duration\s+[\d.]+m?s(?: \([^()\n]*\))?$/] },
  // Mocha: "12 passing (3ms)", rồi "1 pending".
  mocha: { pass: /^(\d+) passing \(\d+(?:ms|s|m)\)$/, trailer: [/^\d+ pending$/] },
  // Bun: "12 pass", rồi skip, todo, "0 fail" (bắt buộc), expect() calls, "Ran 12 tests across 1 file. [10.00ms]".
  bun: { pass: /^(\d+) pass$/, trailer: [/^\d+ (?:skip|todo)$/, /^0 fail$/, /^\d+ expect\(\) calls$/, /^Ran \d+ tests? across \d+ files?\. \[[\d.]+m?s\]$/], requires: /^0 fail$/ },
  // Pytest: "=== 12 passed in 0.5s ===" là dòng cuối.
  pytest: { pass: /^=+ (\d+) passed(?:, \d+ (?:skipped|deselected|xfailed|xpassed|warnings?))* in [\d.]+s(?: \([\d:]+\))? =+$/, trailer: [] },
}

/** Output kết thúc bằng khối tổng kết đạt của trình chạy `summary`. */
function summaryPass(output: string, { pass, trailer, requires }: Summary): boolean {
  const lines = output.split('\n').map(line => line.trim())
  const at = lines.findLastIndex(line => pass.test(line))
  if (at < 0 || !(Number(pass.exec(lines[at] ?? '')?.[1]) > 0)) return false
  const after = lines.slice(at + 1).filter(line => line !== '')
  return after.every(line => trailer.some(pattern => pattern.test(line))) && (requires === undefined || after.some(line => requires.test(line)))
}

/** Dấu hiệu lỗi: có bất kỳ dấu hiệu nào thì output không bao giờ là báo cáo đạt. FAILED phân biệt hoa thường ("0 failed" của cargo không phải lỗi). */
const COMPLETE_FAIL: RegExp[] = [
  /\b[1-9]\d*\s+(?:failed|failing|errors?)\b/i,
  /^\s*(?:#|\u2139)\s*fail\s+[1-9]/m, // Node (TAP, spec)
  /\bFAILED\b/,
  /^FAIL\b|--- FAIL|\[build failed\]/m, // go test
  /^\s*panic:/m, // go
  /^\s*error(?:\[E\d+\])?:/m, // cargo, rustc
  /^\s*Bail out!/m, // TAP
  /^\s*(?:Uncaught\s+)?(?:[A-Z]\w*)?Error(?:\s*\[[^\]\n]*\])?:/m, // JavaScript, Python: "Error:", "TypeError:", "AssertionError [ERR_X]:"
  /^\s*Traceback \(most recent call last\)/m, // Python
  /^\s*npm ERR!|\bELIFECYCLE\b|^\s*Command failed\b|\bexited with code [1-9]/m, // npm, trình chạy script
]

/** Bộ đếm trong tổng kết của node --test (TAP: "# tests 3", spec: "ℹ tests 3"), theo đúng thứ tự in. */
const NODE_COUNTER = /^\s*(?:#|\u2139)\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+(\d+(?:\.\d+)?)\s*$/
const NODE_FIELDS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'] as const

/**
 * Báo cáo của node --test (TAP hoặc spec). Khối tổng kết phải là một khối duy nhất, liền mạch, đủ tám dòng theo đúng
 * thứ tự (`tests` đến `duration_ms`), ở cột 0 và kết thúc output; không có dòng bộ đếm nào khác. TAP: ngay trước khối
 * là dòng plan `1..N` (N là số mục cấp ngoài cùng); output đầy đủ thì có `TAP version` và đúng N dòng `ok`/`not ok`
 * cấp ngoài cùng. Spec đầy đủ: số dòng kết quả (`✔`, `﹣`) trừ số suite bằng pass + skipped + todo. Đạt khi fail =
 * cancelled = 0, pass > 0, tests = pass + skipped + todo, không có test lỗi thực (`not ok`, kể cả `# TODO`; `✖`);
 * output bị cắt (tail) mà có todo thì không đạt.
 */
function nodePass(output: string, truncated: boolean): boolean {
  const lines = output.replace(/\s+$/, '').split('\n')
  const block = lines.slice(-NODE_FIELDS.length)
  const prefix = block[0]?.[0]
  if (block.length !== NODE_FIELDS.length || (prefix !== '#' && prefix !== '\u2139')) return false
  const counts = new Map<string, number>()
  for (const [i, line] of block.entries()) {
    const match = NODE_COUNTER.exec(line)
    if (match === null || line[0] !== prefix || match[1] !== NODE_FIELDS[i]) return false
    counts.set(match[1] ?? '', Number(match[2]))
  }
  const before = lines.slice(0, -NODE_FIELDS.length)
  if (before.some(line => NODE_COUNTER.test(line))) return false
  const [tests = 0, suites = 0, pass = 0, fail = 1, cancelled = 1, skipped = 0, todo = 0] = NODE_FIELDS.map(field => counts.get(field))
  if (fail !== 0 || cancelled !== 0 || pass <= 0 || tests !== pass + skipped + todo) return false
  if (/^\s*not ok\b/m.test(output) || output.includes('\u2716')) return false
  if (prefix === '#') {
    const plan = /^1\.\.([1-9]\d*)$/.exec(before[before.length - 1] ?? '')
    if (plan === null) return false
    if (!truncated && (!/^TAP version \d+$/m.test(output) || before.filter(line => /^ok \d+\b/.test(line)).length !== Number(plan[1]))) return false
  } else if (!truncated && before.filter(line => /^\s*[\u2714\ufe63]/.test(line)).length - suites !== pass + skipped + todo) {
    return false
  }
  return !(truncated && todo > 0)
}

/** Dòng gói của go test: đạt ("ok <gói> 0.01s", "(cached)", có thể kèm coverage) và không có file test. */
const GO_OK = /^ok\s+\S+\s+(?:\d+(?:\.\d+)?s|\(cached\))(?:\s+coverage:.*)?\s*$/
const GO_NO_TESTS = /^\?\s+\S+\s+\[no test files\]\s*$/

/** Báo cáo của go test: mọi dòng gói (ok, FAIL, ?) đúng dạng và có ít nhất một gói ok. */
function goPass(output: string): boolean {
  const lines = output.split('\n').filter(line => /^(?:ok|FAIL|\?)(?:\s|$)/.test(line))
  return lines.some(line => GO_OK.test(line)) && lines.every(line => GO_OK.test(line) || GO_NO_TESTS.test(line))
}

/**
 * Báo cáo của cargo test: mỗi binary và doctest đã chạy (dòng `Running`, `Doc-tests`) có đúng một dòng "test result:",
 * mọi dòng đó là ok, 0 failed, và có test đạt.
 */
function cargoPass(output: string): boolean {
  const results = output.match(/^test result:.*$/gm) ?? []
  const targets = output.match(/^\s+(?:Running|Doc-tests)\s/gm) ?? []
  if (results.length === 0 || results.length !== targets.length) return false
  const ok = results.map(line => /^test result: ok\. (\d+) passed; 0 failed;/.exec(line))
  return ok.every(match => match !== null) && ok.some(match => Number(match?.[1]) > 0)
}

/** Trình chạy test có parser báo cáo; script đóng gói (npm, make) và lệnh khác không có. */
export type Runner = 'node' | 'jest' | 'vitest' | 'mocha' | 'bun' | 'pytest' | 'go' | 'cargo'

/**
 * Trình chạy của một đoạn lệnh kiểm tra, theo chính lệnh (không theo output): `node --test`, `jest`, `vitest`, `mocha`,
 * `bun test`, `pytest` (cả `python -m pytest`), `go test`, `cargo test`. Script đóng gói (`npm test`, `npm run X`,
 * `pnpm`/`yarn`/`bun run X`, `make test`) không biết gọi trình chạy nào: null.
 */
export function runnerOf(segment: string): Runner | null {
  const tokens = segment.toLowerCase().trim().split(/\s+/).filter(Boolean)
  while (tokens.length > 0 && (WRAPPERS.has(tokens[0] ?? '') || (tokens[0] ?? '').startsWith('-'))) tokens.shift()
  const [name, sub, third] = tokens
  if (name === 'node') return tokens.includes('--test') ? 'node' : null
  if (name === 'jest' || name === 'vitest' || name === 'mocha' || name === 'pytest') return name
  if (name === 'bun') return sub === 'test' ? 'bun' : null
  if ((name === 'python' || name === 'python3') && sub === '-m' && third === 'pytest') return 'pytest'
  if (name === 'go') return sub === 'test' ? 'go' : null
  if (name === 'cargo') return sub === 'test' ? 'cargo' : null
  return null
}

/**
 * Output là báo cáo tổng kết đầy đủ của một lượt test đạt, theo parser của đúng trình chạy `runner` (lấy từ lệnh, không
 * đoán theo hình dạng output), không có dấu hiệu lỗi nào. `truncated`: output chỉ là phần cuối (qua tail); báo cáo Go
 * và Cargo in theo từng gói hay binary nên phần cuối không bao giờ đủ. Parser loại các ca mơ hồ và false positive đã
 * biết; không chứng minh được tính trung thực của một chương trình từ output của chính nó.
 */
export function completePass(output: string, runner: Runner, options: { truncated?: boolean } = {}): boolean {
  const truncated = options.truncated === true
  if (COMPLETE_FAIL.some(pattern => pattern.test(output))) return false
  if (runner === 'node') return nodePass(output, truncated)
  if (runner === 'go') return !truncated && goPass(output)
  if (runner === 'cargo') return !truncated && cargoPass(output)
  return summaryPass(output, SUMMARIES[runner])
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
    tracker.mutationsSinceCheck += 1
    tracker.pending.add(author)
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
    if (author === 'main') tracker.pending.clear()
    else tracker.pending.delete(author)
    if (tracker.pending.size === 0) {
      tracker.isVerified = true
      tracker.mutationsSinceCheck = 0
    }
  }
  return writes
}

/**
 * Một lệnh kiểm tra trong tool call có đạt không. Mã thoát bị che (ống, ;, || đứng sau) thì mã thoát 0 không nói gì
 * về lệnh kiểm tra: chỉ đạt khi output có dấu hiệu đạt rõ và không có dấu hiệu lỗi; không đủ thông tin thì chưa đạt.
 */
function checkEffectPassed(effect: CheckEffect, observation: ToolObservation): boolean {
  if (!effect.trusted || observation.isError || outputFailed(observation.output)) return false
  if (effect.exit === 'visible') return true
  if (effect.exit !== 'filtered' || observation.output === undefined) return false
  const runner = runnerOf(effect.segment)
  return runner !== null && completePass(observation.output, runner, { truncated: effect.filter === 'tail' })
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
  const before = tracker.mutationsSinceCheck
  const isCounted = trackVerification(tracker, observation) > 0 && tracker.mutationsSinceCheck > before
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
    const key = command.trim().slice(0, 300)
    if (classified?.isUnknown && !tracker.unknownWrites.has(key)) {
      // Mỗi lệnh ghi không xác định đích khác nhau được cảnh báo một lần.
      tracker.unknownWrites.add(key)
      findings.push({
        kind: 'scope',
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

  if (isCounted && Math.floor(tracker.mutationsSinceCheck / CHECKPOINT_EVERY) > Math.floor(before / CHECKPOINT_EVERY)) {
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

/**
 * Một lệnh Bash đã chạy trong mục tiêu: kết quả thật (ok: kiểm tra đạt, hoặc lệnh không lỗi khi không phải kiểm tra),
 * loại kiểm tra, thứ tự và tác giả ("main" hoặc id subagent).
 */
export type EvidenceEntry = { command: string; ok: boolean; check: CheckKind | null; seq: number; author: string }

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
  /** Các lần ghi theo thứ tự và tác giả, để biết lần kiểm tra của một subagent phủ thay đổi của ai. */
  writes: Array<{ seq: number; author: string }>
  paths: string[]
}

const EVIDENCE_COMMANDS = 100
const EVIDENCE_PATHS = 200
const EVIDENCE_WRITES = 300

export function newEvidenceLog(goalId: number): EvidenceLog {
  return { goalId, seq: 0, lastMutation: -1, mutations: 0, commands: [], writes: [], paths: [] }
}

/**
 * Ghi một tool call vào dấu vết của mục tiêu theo đúng thứ tự hiệu ứng: lệnh kiểm tra kèm kết quả thật, các lần ghi
 * (kể cả trong lệnh Bash lỗi), và đường dẫn file. `author` là "main" hoặc id subagent.
 */
export function noteEvidence(log: EvidenceLog, observation: ToolObservation, author = 'main'): void {
  const onWrite = () => {
    log.seq += 1
    log.lastMutation = log.seq
    log.mutations += 1
    log.writes.push({ seq: log.seq, author })
    if (log.writes.length > EVIDENCE_WRITES) log.writes.shift()
  }
  const command = str(observation.input['command']).trim()
  if (observation.tool === 'Bash' && command !== '') {
    const classified = classifyBash(command)
    const counted = new Set<BashEffect>(writeEffects(classified, observation.isReadOnly))
    let hasCheck = false
    for (const effect of classified.effects) {
      if (effect.kind === 'write') {
        if (counted.has(effect)) onWrite()
        continue
      }
      hasCheck = true
      log.seq += 1
      log.commands.push({ command: effect.segment.slice(0, 500), ok: checkEffectPassed(effect, observation), check: effect.check, seq: log.seq, author })
    }
    if (!hasCheck) {
      log.seq += 1
      log.commands.push({ command: command.slice(0, 500), ok: !observation.isError, check: null, seq: log.seq, author })
    }
    while (log.commands.length > EVIDENCE_COMMANDS) log.commands.shift()
  } else if (FILE_TOOLS.has(observation.tool) && !observation.isError && !isPlanFile(filePathOf(observation))) {
    onWrite()
  } else {
    log.seq += 1
  }
  if (observation.isError) return
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const path = str(observation.input[key]).trim()
    if (path === '' || log.paths.includes(path)) continue
    log.paths.push(path)
    if (log.paths.length > EVIDENCE_PATHS) log.paths.shift()
  }
}

/**
 * Lần kiểm tra này có phủ mọi thay đổi trước nó không: kiểm tra của luồng chính phủ tất cả; kiểm tra của subagent chỉ
 * phủ khi mọi thay đổi kể từ lần kiểm tra đạt gần nhất của luồng chính đều do chính subagent đó làm.
 */
function covers(entry: EvidenceEntry, log: EvidenceLog): boolean {
  if (entry.author === 'main') return true
  const lastMain = log.commands
    .filter(c => c.author === 'main' && c.check !== null && c.ok && c.seq < entry.seq)
    .reduce((max, c) => Math.max(max, c.seq), -1)
  return log.writes.every(w => w.seq <= lastMain || w.seq > entry.seq || w.author === entry.author)
}

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/** Tiền tố chỉ bỏ tên (không đổi lệnh được chạy). Với npx, cờ của chính npx vẫn là một phần danh tính. */
const WRAPPERS = new Set(['sudo', 'command', 'nohup', 'npx', 'exec', 'time'])
/** Cờ của npx về cài và giải quyết gói, chuẩn hóa alias thật: `-y` là `--yes`; `--no-install` là tên cũ của `--no`. */
const NPX_FLAGS: Record<string, string> = { '-y': '--yes', '--yes': '--yes', '--no': '--no', '--no-install': '--no' }

/** Tên executable đã biết: chỉ những tên này được hạ chữ thường (viết hoa đầu câu vẫn là cùng lệnh). */
const EXECUTABLES = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'node', 'tsc', 'pytest', 'jest', 'vitest', 'mocha', 'eslint', 'ruff', 'mypy', 'flake8',
  'pyright', 'biome', 'stylelint', 'python', 'python3', 'cargo', 'go', 'make', 'claude', 'dotnet', 'mvn', 'gradle',
])
/** Từ khóa lệnh con theo ngữ pháp từng executable: [vị trí tính từ tên lệnh, các từ khóa]. Tên script, target, đối số giữ chữ. */
const SUBCOMMANDS: Record<string, Array<[number, string[]]>> = {
  npm: [[1, ['run', 'run-script', 'test', 't']]],
  pnpm: [[1, ['run', 'run-script', 'test', 't']]],
  yarn: [[1, ['run', 'run-script', 'test', 't']]],
  bun: [[1, ['run', 'test']]],
  go: [[1, ['test', 'vet', 'build']]],
  cargo: [[1, ['test', 'check', 'clippy', 'build']]],
  claude: [[1, ['plugin']], [2, ['test', 'validate']]],
  dotnet: [[1, ['test', 'build']]],
  mvn: [[1, ['test', 'verify']]],
  gradle: [[1, ['test', 'check', 'build']]],
}
/** Module chạy qua `python -m`, ở vị trí 2. */
const PYTHON_MODULES = ['pytest', 'unittest', 'mypy', 'ruff']

/** Cờ nhận giá trị và chấp nhận cả `--cờ=giá-trị` lẫn `--cờ giá-trị`, theo từng trình chạy. Cờ khác giữ nguyên một token. */
const VALUE_FLAGS: Partial<Record<Runner, string[]>> = {
  node: ['--test-name-pattern', '--test-skip-pattern', '--test-reporter'],
  go: ['-run', '-skip', '-count'],
  pytest: ['-k', '-m', '--tb'],
  vitest: ['--reporter'],
  mocha: ['--reporter'],
}

/**
 * Tùy chọn chỉ đổi cách trình bày output, theo từng trình chạy, khớp tên chính xác: null là cờ không nhận giá trị,
 * 'value' là cờ nhận một giá trị. Mọi cờ khác (kể cả `--test`, `--`, `-run`, `-k`, `--test-name-pattern`, `-count`,
 * cờ lạ) là một phần danh tính lệnh.
 */
const PRESENTATION_FLAGS: Partial<Record<Runner, Record<string, 'value' | null>>> = {
  node: { '--test-reporter': 'value' },
  go: { '-v': null },
  pytest: { '-v': null, '-q': null, '--tb': 'value' },
  vitest: { '--reporter': 'value' },
  mocha: { '--reporter': 'value' },
  jest: { '--verbose': null },
}

/** Ranh giới trong evidence (dấu câu, ngoặc, nháy): một lệnh được nhắc không bao giờ vắt qua ranh giới. */
const BOUNDARY = '\u0000'

/** Bỏ wrapper ở đầu (không phân biệt hoa thường); cờ của npx được giữ lại, đã chuẩn hóa alias, làm tiền tố danh tính. */
function stripWrappers(tokens: string[], from = 0): { at: number; prefix: string[] } {
  let at = from
  const prefix: string[] = []
  while (at < tokens.length && WRAPPERS.has((tokens[at] ?? '').toLowerCase())) {
    const isNpx = (tokens[at] ?? '').toLowerCase() === 'npx'
    at += 1
    while (isNpx && Object.hasOwn(NPX_FLAGS, tokens[at] ?? '')) {
      prefix.push(NPX_FLAGS[tokens[at] ?? ''] ?? '')
      at += 1
    }
  }
  return { at, prefix }
}

/** Hạ chữ thường theo ngữ pháp: tên executable đã biết và từ khóa lệnh con ở đúng vị trí; mọi token khác giữ nguyên. */
function canonicalCase(tokens: string[]): string[] {
  const out = [...tokens]
  const name = (out[0] ?? '').toLowerCase()
  if (!EXECUTABLES.has(name)) return out
  out[0] = name
  const lowerAt = (index: number, keywords: string[]) => {
    const token = (out[index] ?? '').toLowerCase()
    if (keywords.includes(token)) out[index] = token
  }
  for (const [index, keywords] of SUBCOMMANDS[name] ?? []) lowerAt(index, keywords)
  if ((name === 'python' || name === 'python3') && out[1] === '-m') lowerAt(2, PYTHON_MODULES)
  return out
}

/**
 * Chuẩn hóa dãy token của một lệnh theo trình chạy: tách `--cờ=giá-trị` chỉ với cờ đã biết nhận giá trị, bỏ cờ trình
 * bày của đúng trình chạy đó (kèm giá trị). Sau `--` (và `-args` của go) mọi token giữ nguyên. Mỗi token ra kèm vị trí
 * token gốc. Đầu vào không chứa ranh giới (lệnh đã tách đoạn, hay một mệnh đề evidence).
 */
function normalizeTokens(tokens: string[], runner: Runner | null, from = 0): Array<{ token: string; raw: number }> {
  const values = runner === null ? [] : (VALUE_FLAGS[runner] ?? [])
  const flags = runner === null ? {} : (PRESENTATION_FLAGS[runner] ?? {})
  const split: Array<{ token: string; raw: number; pass: boolean }> = []
  let pass = false
  for (let raw = from; raw < tokens.length; raw++) {
    const token = tokens[raw] ?? ''
    const eq = token.indexOf('=')
    if (!pass && eq > 0 && values.includes(token.slice(0, eq))) {
      split.push({ token: token.slice(0, eq), raw, pass }, { token: token.slice(eq + 1), raw, pass })
      continue
    }
    split.push({ token, raw, pass })
    if (token === '--' || (runner === 'go' && token === '-args')) pass = true
  }
  const out: Array<{ token: string; raw: number }> = []
  for (let i = 0; i < split.length; i++) {
    const entry = split[i]
    if (entry === undefined) continue
    if (!entry.pass && Object.hasOwn(flags, entry.token)) {
      if (flags[entry.token] === null) continue
      const value = split[i + 1]
      if (value !== undefined && !value.pass) {
        i += 1
        continue
      }
    }
    out.push({ token: entry.token, raw: entry.raw })
  }
  return out
}

/** Danh tính của một đoạn lệnh: các cách viết tương đương (dãy token đã chuẩn hóa, kể cả tiền tố cờ npx) và trình chạy. */
function identityOf(segment: string): { forms: string[][]; runner: Runner | null } {
  const raw = segment.trim().split(/\s+/).filter(Boolean)
  const { at, prefix } = stripWrappers(raw)
  const tokens = canonicalCase(raw.slice(at))
  const runner = runnerOf(tokens.join(' '))
  const words = normalizeTokens(tokens, runner).map(entry => entry.token)
  const forms = ((): string[][] => {
    const [name, sub, ...rest] = words
    if (name === undefined) return []
    if (!PACKAGE_MANAGERS.has(name) || sub === undefined || sub.startsWith('-')) return [words]
    if (sub === 'run' || sub === 'run-script') {
      const [script, ...args] = rest
      if (script === undefined) return [[name, 'run']]
      const runForm = [name, 'run', script, ...args]
      return name === 'bun' || (name === 'npm' && script !== 'test') ? [runForm] : [runForm, [name, script, ...args]]
    }
    if (name === 'bun' || (name === 'npm' && sub !== 'test' && sub !== 't')) return [words]
    const script = sub === 't' ? 'test' : sub
    return [[name, 'run', script, ...rest], [name, script, ...rest]]
  })()
  return { forms: forms.map(form => [...prefix, ...form]), runner }
}

/**
 * Danh tính của một đoạn lệnh: các cách viết tương đương, mỗi cách là dãy token đã chuẩn hóa. So khớp nghiêm ngặt:
 * chỉ tên executable và từ khóa lệnh con được hạ chữ thường; đường dẫn, tên script, giá trị bộ lọc, đối số và tên cờ giữ
 * nguyên chữ. Mọi tùy chọn là một phần danh tính trừ cờ trình bày của đúng trình chạy; cờ của npx là tiền tố danh tính.
 * `npm test` và `npm run test` là một; `pnpm`/`yarn X` và `run X` là một.
 */
export function commandIdentity(segment: string): string[][] {
  return identityOf(segment).forms
}

/**
 * Các từ của evidence, giữ nguyên chữ hoa thường. Dấu câu tách mệnh đề (`:`, `,`, `;`, `!`, `?`, ngoặc, backtick, nháy
 * đơn, nháy kép, nháy chữ Việt, dấu chấm cuối câu) thành ranh giới. Dấu chấm cuối từ chỉ là dấu chấm câu khi đứng một
 * mình sau ký tự khác `.` và `/`: `./...` giữ nguyên, `src/a.test.ts.` thành `src/a.test.ts`; `./....` giữ nguyên.
 */
function evidenceWords(text: string): string[] {
  const out: string[] = []
  for (const piece of text.split(/\s+/)) {
    // Toán tử shell tách lệnh như trong `segments`; gộp luồng (`2>&1`) bị bỏ như khi ghi lệnh vào dấu vết.
    if (piece === '|' || piece === '||' || piece === '&&') {
      out.push(BOUNDARY)
      continue
    }
    if (/^\d*>&\d+$/.test(piece)) continue
    const lead = /^[(\[`'"“‘]+/.exec(piece)?.[0] ?? ''
    if (lead !== '') out.push(BOUNDARY)
    let word = piece.slice(lead.length)
    const trail = /[:,;!?)\]`'"”’]+$/.exec(word)?.[0] ?? ''
    word = word.slice(0, word.length - trail.length)
    let isEnd = trail !== ''
    if (/[^./]\.$/.test(word)) {
      word = word.slice(0, -1)
      isEnd = true
    }
    if (word !== '') out.push(word)
    if (isEnd) out.push(BOUNDARY)
  }
  return out
}

/**
 * Số token evidence (tính từ `start`) mà một lệnh chiếm khi được nhắc ở đó, hoặc 0. Khớp NGHIÊM NGẶT: sau khi bỏ wrapper
 * và chuẩn hóa như danh tính (theo trình chạy của lệnh), mọi token của evidence từ đó đến ranh giới kế tiếp (hoặc hết
 * evidence) phải bằng đúng một cách viết của danh tính và được tiêu thụ hết. Không đoán từ đứng sau là kết quả hay đối số.
 */
function matchLength(words: string[], start: number, command: string): number {
  if (words[start] === BOUNDARY) return 0
  const { at, prefix } = stripWrappers(words, start)
  const end = words.indexOf(BOUNDARY, at)
  const clause = canonicalCase(words.slice(at, end < 0 ? undefined : end))
  for (const part of segments(command)) {
    const { forms, runner } = identityOf(part)
    const normalized = [...prefix, ...normalizeTokens(clause, runner).map(entry => entry.token)]
    if (forms.some(form => form.length > 0 && form.length === normalized.length && form.every((token, i) => normalized[i] === token))) {
      return (end < 0 ? words.length : end) - start
    }
  }
  return 0
}

/** Các vị trí evidence nhắc một lệnh kiểm tra (dò trên bản chữ thường, cùng chỉ số token), bỏ qua wrapper. */
function claimedChecks(words: string[]): number[] {
  const lower = words.map(word => word.toLowerCase())
  const positions: number[] = []
  for (let i = 0; i < lower.length; i++) {
    const word = lower[i] ?? ''
    if (word === BOUNDARY || WRAPPERS.has(word)) continue
    const end = lower.indexOf(BOUNDARY, i)
    if (VERIFY_SEGMENT.test(lower.slice(i, end < 0 ? undefined : end).join(' '))) positions.push(i)
  }
  return positions
}

/** Khóa gom các lần chạy của cùng một lệnh: cách viết đầu của danh tính, theo từng đoạn. */
function identityKey(command: string): string {
  return segments(command).map(part => (commandIdentity(part)[0] ?? []).join(' ')).join(' && ')
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

/**
 * Đối chiếu evidence của "verified" với dấu vết thật của mục tiêu. Mọi chỗ evidence nhắc một lệnh kiểm tra phải ứng với
 * một lần chạy kiểm tra thật của đúng lệnh đó (khớp nghiêm ngặt); thiếu một lệnh là `stale`, không để lệnh đạt khác bù.
 * Mỗi lệnh được nhắc tính theo lần chạy cuối của chính nó và phải đạt sau thay đổi cuối. Không phân tích câu phủ định:
 * lệnh được nhắc mà chưa chạy thì bị từ chối dù câu nói "chưa chạy"; lệnh đã chạy đạt thì vẫn được tính.
 */
export function evidenceStrength(evidence: string, log: EvidenceLog): EvidenceStrength {
  const text = evidence.toLowerCase()
  const words = evidenceWords(evidence)
  const spans = log.commands.flatMap(entry =>
    words.map((_, start) => ({ entry, start, length: matchLength(words, start, entry.command) })).filter(span => span.length > 0),
  )
  const mentioned = [...new Set(spans.map(span => span.entry))]
  const unbacked = claimedChecks(words).find(
    at => !spans.some(span => span.entry.check !== null && span.start <= at && at < span.start + span.length),
  )
  if (unbacked !== undefined) {
    const end = words.indexOf(BOUNDARY, unbacked)
    const shown = words.slice(unbacked, end < 0 ? unbacked + 6 : Math.min(end, unbacked + 6)).join(' ')
    return {
      level: 'stale',
      reason: `không tìm thấy lần chạy kiểm tra khớp chính xác với lệnh \`${shown}\` trong evidence; hãy xác nhận lệnh đã chạy, các tùy chọn và đối số khớp, và phân cách lệnh với kết quả bằng dấu \`:\` (ví dụ \`npm test: 12 pass\`)`,
    }
  }
  // Mỗi lệnh kiểm tra được nhắc tính theo lần chạy cuối của chính nó; mọi lệnh được nhắc phải đạt, sau thay đổi cuối.
  const latest = new Map<string, EvidenceEntry>()
  // Mọi lần chạy cùng danh tính đều khớp như nhau nên đều nằm trong `mentioned`; duyệt theo thứ tự log, lần cuối thắng.
  for (const entry of log.commands) if (entry.check !== null && mentioned.includes(entry)) latest.set(identityKey(entry.command), entry)
  const checks = [...latest.values()]
  const isFresh = (entry: EvidenceEntry) => entry.ok && entry.seq > log.lastMutation && covers(entry, log)
  if (checks.length > 0 && checks.every(isFresh)) return { level: 'strong', check: checks.some(entry => entry.check === 'test') ? 'test' : 'static' }
  const last = checks.find(entry => !isFresh(entry))
  if (last !== undefined) {
    const shown = last.command.slice(0, 80)
    return {
      level: 'stale',
      reason: !last.ok
        ? `lệnh kiểm tra \`${shown}\` đã lỗi hoặc không xác nhận được là đạt`
        : last.seq < log.lastMutation
          ? `lệnh kiểm tra \`${shown}\` chạy trước thay đổi cuối cùng`
          : `lệnh kiểm tra \`${shown}\` do subagent chạy chỉ phủ thay đổi của chính nó; còn thay đổi khác chưa được kiểm tra lại`,
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
