// Phân loại một lệnh Bash theo từng đoạn: lệnh kiểm tra, tác động ghi, file đích, mức che mã thoát.
// Chuyển từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi lúc tách; 0.5.5 truyền unmask vào isSelfFixing); hooks/lib/drift.ts là barrel.

import { TEST_SEGMENT, isCheckText, isCustomCheck, isSelfFixing, suffixCustomCheck } from './verify'
import type { CheckKind } from './verify'
import { homeTarget, normalizePath } from './scope'
export { applyHome, homeTarget } from './scope'
import { AWK_COMMAND, AWK_WRITE, isReadOnlyCommand, segmentIsReadOnly } from './readonly'
import { isReadOnlyInline } from './inline'

// ------------------------------------------------------------ đích ghi của lệnh Bash

/** Lệnh ghi lên mọi đối số đường dẫn. */
const WRITE_ALL = new Set(['rm', 'rmdir', 'touch', 'mkdir', 'truncate', 'shred', 'unlink'])
/** Lệnh ghi lên đối số cuối (đích). */
const WRITE_LAST = new Set(['cp', 'mv', 'install', 'ln', 'rsync'])
/** Lệnh đổi quyền: đối số đầu là quyền hoặc chủ sở hữu, còn lại là đường dẫn. */
const WRITE_AFTER_FIRST = new Set(['chmod', 'chown', 'chgrp'])
/** Lệnh con của git không ghi file trong cây làm việc (thao tác trên lịch sử hay remote). */
const GIT_NO_FILES = new Set(['add', 'commit', 'push', 'tag', 'branch', 'fetch', 'config', 'remote', 'notes', 'gc'])
// Tùy chọn git clone mà vai chỉ đọc được dùng (vòng 2 G2b); tùy chọn mang giá trị đi kèm giá trị ở đối số kế hoặc sau dấu bằng.
const CLONE_FLAGS = new Set(['--single-branch', '--no-tags', '--no-checkout', '--quiet', '-q'])
const CLONE_VALUE = new Set(['--depth', '--branch', '-b'])
function cloneDest(rest: string[], unmask: (token: string) => string): string | undefined {
  const positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = unmask(rest[i] ?? '')
    if (CLONE_VALUE.has(arg)) {
      if (i + 1 >= rest.length) return undefined
      i += 1
    } else if (/^--(?:depth|branch)=./.test(arg) || CLONE_FLAGS.has(arg)) continue
    else if (arg.startsWith('-')) return undefined
    else positional.push(rest[i] ?? '')
  }
  const dest = positional[1]
  return positional.length === 2 && dest !== undefined && /^[/$]/.test(unmask(dest)) ? dest : undefined
}
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
  /** Đoạn lệnh kiểm tra (không kèm các đoạn khác của câu lệnh), để hiển thị: bằng chứng gắn với đúng đoạn này. */
  segment: string
  /**
   * Danh tính của đoạn lệnh, đã nhận biết cú pháp: tiền tố biến môi trường, các token lệnh (token trong nháy có khoảng
   * trắng hay toán tử là một token duy nhất, bọc \u0001), rồi chuyển hướng đầu vào. Chuyển hướng đầu ra không thuộc
   * danh tính: lệnh không qua ống dựa vào mã thoát, lệnh qua ống mà có chuyển hướng đã là hidden.
   */
  argv: string[]
  /** Đoạn lệnh nguyên văn (kể cả chuyển hướng), để truy vết và giải thích. */
  raw: string
  trusted: boolean
  /**
   * visible: mã thoát của câu lệnh chính là của lệnh kiểm tra. filtered: lệnh kiểm tra đứng đầu, không chuyển hướng
   * nào ngoài 2>&1, nối ống duy nhất sang tail (chỉ số dòng) hoặc cat (không đối số), output chỉ đến từ nó. hidden: mã
   * thoát hay output bị lệnh khác che; không bao giờ tính là đạt. chained (0.8.0 A11): sau lệnh kiểm tra còn đoạn nối && khác đoạn chỉ in
   * hay đổi thư mục; mã thoát 0 là đạt như visible, mã thoát khác 0 không biết thuộc đoạn nào nên kết quả chưa rõ.
   */
  exit: 'visible' | 'filtered' | 'hidden' | 'chained'
  /** Bộ lọc khi exit là filtered: tail cắt output (chỉ còn phần cuối), head giữ phần đầu (0.7.5), cat giữ đủ. */
  filter?: 'tail' | 'cat' | 'head'
  /** Số dòng head giữ (0.7.5): output có ít dòng hơn thì head không cắt gì. */
  limit?: number
  /** Có `set -o pipefail` trước lệnh kiểm tra (0.7.5): mã thoát của ống là của lệnh kiểm tra khi nó lỗi. */
  pipefail?: true
  /** Đoạn lệnh với đường dẫn tương đối đã nối vào thư mục của `cd` đứng trước (0.7.5), khi chỉ dạng này khớp lệnh khai. */
  resolved?: string
}
/** Một tác động ghi: definite (chuyển hướng, lệnh ghi đã biết), possible (lệnh lạ, script, cấu trúc chưa hỗ trợ). */
export type WriteEffect = {
  kind: 'write'
  /** Tên lệnh của đoạn (bỏ thư mục, sau env và sudo); rỗng với chuyển hướng ghi. */
  name: string
  level: 'definite' | 'possible'
  /** File đích đọc được của chính đoạn lệnh này (để loại file kế hoạch); isUnknown: đoạn có đích không đọc được. */
  paths: string[]
  isUnknown: boolean
  /** Lệnh git chỉ đổi lịch sử hay cấu hình (GIT_NO_FILES), không có thay thế lệnh: không đổi file làm việc, `writeEffects` bỏ qua. */
  isHistory?: true
  /** Lệnh con git của tác động trên lịch sử (0.9.0 B14): add, commit, tag, push... */
  gitSub?: string
}
export type BashEffect = CheckEffect | WriteEffect

/** Kết quả phân loại một lệnh Bash, dùng chung cho mọi hook: hiệu ứng theo thứ tự, file đích, cờ không xác định đích. */
/** `dir` (0.8.0 A1): thư mục làm việc sau lệnh khi lệnh có cd tới thư mục đọc được, tuyệt đối khi biết thư mục gốc. */
export type BashClass = { effects: BashEffect[]; paths: string[]; isUnknown: boolean; dir?: string }

type Operator = '' | '&&' | '||' | ';' | '|' | '|&' | '&'

/**
 * Một đoạn của câu lệnh: toán tử đứng trước, văn bản đã che, tiền tố biến môi trường, có chạy nền không (kết thúc bằng `&`), và
 * thân heredoc của chính đoạn này (null khi số dấu `<<H` không khớp số thân: không biết thân nào của đoạn nào).
 */
/** `opens`: số dấu `(` mở subshell đã bỏ ở đầu đoạn (kiểm độc lập vòng 1 lỗi 9). */
type Piece = { op: Operator; text: string; env: string[]; background: boolean; heredocs: string[] | null; opens: number }

/** Đánh dấu token có nháy là một đối số duy nhất (không bao giờ là toán tử); HEREDOC là stdin từ heredoc, nội dung không so được. */
export const TAG = '\u0001'
const HEREDOC = '\u0002heredoc'

/**
 * Che chuỗi trong nháy bằng token giữ chỗ và bỏ thân heredoc (giữ lại dấu `<<H` để biết đoạn đó đọc từ heredoc), để
 * dấu ngăn lệnh trong nháy hay trong heredoc không bị đọc nhầm. Trả thêm các thân heredoc theo thứ tự xuất hiện.
 */
function maskCommand(command: string): { masked: string; unmask: (token: string) => string; heredocs: string[] } {
  const heredocs: string[] = []
  const withoutHeredoc = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g, (_m, _q: string, _tag: string, rest: string, body: string) => {
    heredocs.push(body)
    return `<<H${rest}`
  })
  const quoted: string[] = []
  const masked = withoutHeredoc.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_m, a: string | undefined, b: string | undefined) => {
    quoted.push(a ?? b ?? '')
    return `\u0000${quoted.length - 1}\u0000`
  })
  const unmask = (token: string) => token.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => quoted[Number(i)] ?? '')
  return { masked, unmask, heredocs }
}

/**
 * Tiền tố timeout ở mọi dạng hợp lệ (0.8.0 A1): `timeout 600`, `timeout 10m`, `timeout 1.5h`, `timeout -k 5 600`, `timeout --signal=KILL 600`,
 * `timeout -s TERM 10m`; lệnh sau nó là lệnh thật.
 */
const TIMEOUT_PREFIX =
  /^timeout(?:\s+(?:-[ks]\s+\S+|--(?:signal|kill-after)=\S+|--preserve-status|--foreground|-v|--verbose))*\s+\d+(?:\.\d+)?[smhd]?\s+/

/** Phép gán biến đứng đầu lệnh, nối bằng ; hay && (0.8.0 A1): giá trị không chứa nháy, $, backtick hay toán tử. */
const LEADING_ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)=([^\s;&|$`"'()<>]+)\s*(?:;|&&)\s*/

/**
 * Giải biến gán ngay trong lệnh (0.8.0 A1): `T=/a/tools; python3 $T/x.py`, `"$T/x.py"`, `${T}/x.py`. Chỉ biến gán ở đầu chính lệnh này
 * (shell của Bash không giữ biến giữa các lần gọi); không thay trong nháy đơn. Không có phép gán thì giữ nguyên lệnh.
 */
function expandAssignments(command: string): string {
  const vars = new Map<string, string>()
  let head = ''
  let rest = command
  for (let match = LEADING_ASSIGNMENT.exec(rest); match !== null; match = LEADING_ASSIGNMENT.exec(rest)) {
    vars.set(match[1] ?? '', match[2] ?? '')
    head += match[0]
    rest = rest.slice(match[0].length)
  }
  if (vars.size === 0) return command
  let out = ''
  let isSingle = false
  for (let at = 0; at < rest.length; at++) {
    const ch = rest[at] ?? ''
    if (ch === "'") isSingle = !isSingle
    else if (ch === '$' && !isSingle) {
      const ref = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(rest.slice(at))
      const value = vars.get(ref?.[1] ?? ref?.[2] ?? '')
      if (ref !== null && value !== undefined) {
        out += value
        at += ref[0].length - 1
        continue
      }
    }
    out += ch
  }
  return head + out
}

/**
 * Tách lệnh đã che thành các đoạn, giữ toán tử đứng trước mỗi đoạn (&&, ||, ;, |, |&, &; xuống dòng tính như ;). `&` đơn
 * (không phải `&&`, `&>`, `>&`, `N>&M`) chạy cả danh sách &&/|| đứng trước nó ở nền: mã thoát không thuộc về các đoạn đó.
 * Mọi đoạn đứng trước `&` đều được đánh dấu: đoạn thuộc danh sách trước đó đã nền sẵn, đoạn trước `;` đã là hidden (exitOf).
 */
function pieces(masked: string, heredocs: string[]): Piece[] {
  const parts = masked.split(/(\|\||&&|\|&|;|\|(?!\|)|\n|(?<![>&|])&(?![>&]))/)
  const out: Piece[] = []
  const matched = (masked.match(/<<H/g) ?? []).length === heredocs.length
  let used = 0
  let op: Operator = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (i % 2 === 1) {
      if (part === '&') for (const before of out) before.background = true
      op = part === '\n' ? ';' : (part as Operator)
      continue
    }
    const lead = /^[({\s]+/.exec(part.trim())?.[0] ?? ''
    let text = part.trim().slice(lead.length)
    const assignments = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*(?:\s+|$))+/.exec(text)?.[0] ?? ''
    // Biến môi trường đứng đầu đổi cách lệnh chạy (TEST_FILTER=smoke npm test): giữ lại làm một phần danh tính.
    text = text.slice(assignments.length).replace(TIMEOUT_PREFIX, '')
    if (text !== '') {
      const count = (text.match(/<<H/g) ?? []).length
      out.push({ op, text, env: assignments.trim().split(/\s+/).filter(Boolean), background: false, heredocs: matched ? heredocs.slice(used, used + count) : null, opens: (lead.match(/\(/g) ?? []).length })
      used += count
    }
    else if (out.length === 0) op = ''
  }
  return out
}

/**
 * Bộ lọc chỉ đọc từ ống: `cat` không đối số, `tail` và `head` (0.7.5) chỉ với số dòng dương. Còn lại (file, <, heredoc,
 * tùy chọn khác, token trong nháy kể cả rỗng) là null. `text` là đoạn lệnh đã che chuỗi trong nháy, nên token trong nháy
 * là token giữ chỗ, không bao giờ khớp. `limit` là số dòng head giữ (mặc định 10 như head).
 */
function pipeFilter(text: string): { filter: 'tail' | 'cat' | 'head'; limit?: number } | null {
  const [name, ...args] = text.trim().split(/\s+/)
  if (name === 'cat') return args.length === 0 ? { filter: 'cat' } : null
  if (name !== 'tail' && name !== 'head') return null
  const count = /^[1-9]\d*$/
  let limit = 10
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '-n' || arg === '--lines') {
      if (!count.test(args[i + 1] ?? '')) return null
      limit = Number(args[i + 1])
      i += 1
    } else if (/^(?:-n|-|--lines=)[1-9]\d*$/.test(arg)) limit = Number(arg.replace(/^\D+/, ''))
    else return null
  }
  return name === 'head' ? { filter: 'head', limit } : { filter: 'tail' }
}

/** Đoạn chỉ đổi trạng thái shell, không có output, không ghi file (0.7.5): `cd <dir>`, `set <tùy chọn>`. */
function isNeutral(piece: Piece): boolean {
  return !piece.background && /^(?:cd|set)(?:\s|$)/.test(piece.text)
}

/** Đoạn đứng sau lệnh kiểm mà không đổi mã thoát (0.8.0 A11): cd, set, pwd, true, hay echo, printf không chuyển hướng. */
function isTrailingNeutral(piece: Piece): boolean {
  if (isNeutral(piece)) return true
  return !piece.background && /^(?:echo|printf|pwd|true|:)(?:\s|$)/.test(piece.text) && !/[<>]/.test(piece.text)
}

/**
 * Mức che mã thoát của lệnh kiểm tra ở vị trí `index`, theo ngữ nghĩa shell. Lệnh sau nối bằng && (hoặc không có) thì
 * mã thoát của lệnh kiểm tra không bị che: visible. Ống chỉ giữ được mức filtered khi lệnh kiểm tra đứng đầu, không có
 * chuyển hướng nào ngoài 2>&1 (output phải đi hết vào ống), ống đó sang bộ lọc chỉ đọc từ ống (pipeFilter), và câu
 * lệnh kết thúc ở đó. Mọi trường hợp khác (;, ||, xuống dòng, ống sang lệnh khác) là hidden.
 */
function exitOf(list: Piece[], index: number): Pick<CheckEffect, 'exit' | 'filter' | 'limit'> {
  const rest = list.slice(index + 1)
  if (rest.some(after => after.op === ';' || after.op === '||')) return { exit: 'hidden' }
  const next = rest[0]
  if (next === undefined) return { exit: 'visible' }
  // Sau lệnh kiểm còn đoạn nối && (0.8.0 A11): chỉ đoạn in hay đổi thư mục thì mã thoát vẫn là của lệnh kiểm; đoạn khác thì chained.
  if (next.op === '&&') return rest.every(isTrailingNeutral) ? { exit: 'visible' } : { exit: 'chained' }
  // Lệnh kiểm tra đứng đầu, hoặc chỉ sau các đoạn cd/set nối bằng && hay ; (0.7.5): output vẫn chỉ đến từ nó.
  const isLead = list.slice(0, index).every(isNeutral) && list.slice(1, index + 1).every(p => p.op === '&&' || p.op === ';')
  if (next.op !== '|' || !isLead || rest.length !== 1) return { exit: 'hidden' }
  const isRedirected = /[<>]/.test((list[index]?.text ?? '').replace(/(?:^|\s)2>&1(?=\s|$)/g, ' '))
  const filter = pipeFilter(next.text)
  return !isRedirected && filter !== null ? { exit: 'filtered', ...filter } : { exit: 'hidden' }
}

/** Token trông như đường dẫn tương đối (có `/` hoặc phần mở rộng), không phải cờ: nối được vào thư mục của cd. */
const RELATIVE_PATH = /^(?![-/~$])(?:[^\s]*\/[^\s]*|[^\s]+\.[A-Za-z0-9]+)$/

/** Đoạn lệnh với đường dẫn tương đối nối vào `cwd` (0.7.5); null khi không có gì để nối. */
function resolvedText(text: string, cwd: string): string | null {
  const tokens = text.trim().split(/\s+/)
  let isChanged = false
  const out = tokens.map(token => {
    if (!RELATIVE_PATH.test(token)) return token
    isChanged = true
    return normalizePath(`${cwd}/${token}`)
  })
  return isChanged ? out.join(' ') : null
}

// Thư mục hệ thống mà tên lệnh bỏ phần thư mục (/usr/bin/python3 là python3), và trình thông dịch bỏ thư mục ở đâu cũng được
// (venv, pyenv). Binary ở thư mục khác giữ tên đầy đủ: /abs/tools/cat không phải cat (vòng sửa 2 của 0.7.5).
const SYSTEM_DIRS = new Set(['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/sbin', '/sbin'])
const INTERPRETER_NAME = /^(?:python(?:3(?:\.\d+)?)?|sqlite3)$/

/** Tên lệnh: bỏ phần thư mục khi lệnh nằm ở thư mục hệ thống hay là python, sqlite3; còn lại giữ nguyên (0.7.5). */
function commandName(token: string): string {
  const slash = token.lastIndexOf('/')
  const name = token.slice(slash + 1)
  return SYSTEM_DIRS.has(token.slice(0, slash)) || INTERPRETER_NAME.test(name) ? name : token
}

/**
 * Token của lệnh thật sau `env`: bỏ phép gán biến (FOO=1), cờ không giá trị (-i, -, --ignore-environment) và `-u TÊN`.
 * Cờ lạ (-S, -C...) đổi cách chạy lệnh: không bỏ, trả rỗng để đoạn lệnh vẫn là env (lệnh lạ, ghi có thể).
 */
function afterEnv(args: string[], unmask: (token: string) => string): string[] {
  let at = 0
  while (at < args.length) {
    const arg = unmask(args[at] ?? '')
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg) || arg === '-i' || arg === '-' || arg === '--ignore-environment') at += 1
    else if (arg === '-u' || arg === '--unset') at += 2
    else if (arg.startsWith('-')) return []
    else break
  }
  return args.slice(at)
}

// Cấu trúc chưa phân tích được: thay thế lệnh, process substitution <( và >(, eval, shell con với -c, system() của awk.
const UNSUPPORTED = /\$\(|`|[<>]\(|(?:^|[\s;&|(])eval\b|(?:^|[\s;&|(])(?:ba|z|da)?sh\s+-c\b|\bsystem\s*\(/

/**
 * Phân loại một lệnh Bash theo từng đoạn, giữ thứ tự và toán tử: lệnh kiểm tra, tác động ghi, file đích. Kiểm tra chỉ
 * được tin khi chắc chắn đã chạy: đoạn đầu, hoặc sau && hay ;. Chuyển hướng ghi trên chính lệnh kiểm tra là tác
 * động ghi đứng trước kiểm tra. Cấu trúc chưa hỗ trợ thì thêm tác động ghi có thể và không tin kiểm tra nào.
 * Đường dẫn tương đối nối với thư mục của `cd` đứng trước. Chỉ để giám sát; không phải phân quyền hệ thống tệp.
 */
/**
 * Khối shell nhận thân từ heredoc (0.9.0 B8): `bash <<'TAG'`, `sh <<TAG`, `zsh <<-"TAG"`, có thể kèm cờ (như `-e`, `-eu`), và không có gì
 * sau dòng kết thúc. Trả cờ errexit (cờ có `e` hay thân có dòng `set -e...`) và thân đã đổi thành chuỗi lệnh tách được; null khi không phải
 * dạng này hay thân có cấu trúc chưa tách được (heredoc lồng, eval, khối if, for, while, case, hàm, nối dòng bằng `\`, thay thế lệnh không
 * chỉ đọc). Dòng gán bằng thay thế lệnh chỉ đọc (`X="$(git rev-parse --show-toplevel)"`) là phép gán, bị bỏ.
 */
const SHELL_HEREDOC = /^\s*(?:\/(?:usr\/)?bin\/)?(bash|sh|zsh)((?:\s+-[A-Za-z]+)*)\s*<<(-?)\s*(['"]?)(\w+)\4[ \t]*\n([\s\S]*?)\n[ \t]*\5[ \t]*\n?\s*$/
const BODY_BLOCKED = /<<|(?:^|[\s;&|(])(?:eval|if|then|elif|else|fi|for|while|until|do|done|case|esac|function|select)(?=[\s;&|)]|$)|\\$|[{}]\s*$|^\s*\w+\s*\(\s*\)/m
const SUBST_ASSIGNMENT = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"\$\(([^()`]*)\)"|\$\(([^()`]*)\))\s*$/

function shellHeredoc(command: string): { errexit: boolean; body: string } | null {
  const match = SHELL_HEREDOC.exec(command)
  if (match === null) return null
  const flags = (match[2] ?? '').trim()
  const lines = (match[6] ?? '').split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
  const kept: string[] = []
  for (const line of lines) {
    const sub = SUBST_ASSIGNMENT.exec(line)
    if (sub !== null) {
      // Gán bằng thay thế lệnh: chỉ bỏ được khi lệnh bên trong là lệnh chỉ đọc; không thì cả khối là possible.
      if (!isReadOnlyCommand(sub[1] ?? sub[2] ?? '')) return null
      continue
    }
    kept.push(line)
  }
  const body = kept.join('\n')
  if (body === '' || BODY_BLOCKED.test(body)) return null
  const errexit = /-[A-Za-z]*e/.test(flags)
  // errexit theo thứ tự câu lệnh (vòng 2 M7): cờ -e của shell bật từ đầu khối; các dòng `set -e`, `set +e` trong thân để nguyên, nên bộ phân
  // loại tính trạng thái ở đúng chỗ của từng lệnh như với một dòng lệnh. Dòng lỗi dưới errexit dừng cả khối.
  return { errexit, body: errexit ? `set -e\n${body}` : body }
}

/** Thay thế tiến trình một tầng (0.9.0 B9): `<(lệnh)` mà lệnh bên trong không có ngoặc, `$` hay backtick. */
const PROCESS_SUBST = /<\(([^()`$]*)\)/g
/** Chỗ đứng của `<(...)` sau khi tách: đường dẫn kiểu /dev/fd mà phân loại bỏ qua như /dev/stdout. */
const SUBST_PLACEHOLDER = '/dev/fd/63'

export function classifyBash(input: string, base = ''): BashClass {
  // Khối shell nhận thân từ heredoc (0.9.0 B8): phân loại thân như chuỗi lệnh của chính lời gọi.
  const heredoc = shellHeredoc(input)
  if (heredoc !== null) return classifyBash(heredoc.body, base)
  // Thay thế tiến trình (0.9.0 B9): lệnh bên trong được phân loại riêng, chỉ lấy tác động ghi (mã thoát của nó không hiện ra ngoài); lệnh
  // ngoài phân loại với một đường dẫn giữ chỗ. Còn `<(` (lồng nhau) hay có `>(` thì giữ cách của 0.8.9.
  if (input.includes('<(')) {
    const inner: string[] = []
    const outer = input.replace(PROCESS_SUBST, (_m, body: string) => {
      inner.push(body)
      return SUBST_PLACEHOLDER
    })
    if (inner.length > 0 && !outer.includes('<(')) {
      const outside = classifyBash(outer, base)
      const effects = [...outside.effects]
      const paths = [...outside.paths]
      let isUnknown = outside.isUnknown
      for (const body of inner) {
        const sub = classifyBash(body, base)
        // Lệnh bên trong chạy song song, ngoài tầm theo dõi của mã thoát: tác động ghi của nó giữ mức và đích, nhưng là đích không chắc
        // (isUnknown), như cách 0.7.5 R3 đối xử với thay thế tiến trình ở tạm dừng cứng.
        for (const effect of sub.effects) {
          if (effect.kind !== 'write') continue
          effects.push({ ...effect, isUnknown: true })
          isUnknown = true
        }
        for (const path of sub.paths) if (!paths.includes(path)) paths.push(path)
        if (sub.isUnknown) isUnknown = true
      }
      return { effects, paths, isUnknown, ...(outside.dir !== undefined ? { dir: outside.dir } : {}) }
    }
  }
  // base (0.8.0 A1): thư mục làm việc từ các lần Bash trước, chỉ dùng để giải lệnh khai có đường dẫn tương đối.
  const command = expandAssignments(input)
  const { masked, unmask, heredocs } = maskCommand(command)
  const effects: BashEffect[] = []
  const paths: string[] = []
  let isUnknown = false
  let cwd = ''
  let pipefail = false
  // errexit đang bật ở chỗ của từng đoạn (vòng 2 M7): `set -e` và dạng gộp cờ bật, `set +e` tắt.
  let errexit = false
  const add = (raw: string) => {
    const token = unmask(raw)
    if (token === '' || token === '-' || /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/.test(token)) return false
    const underHome = homeTarget(token)
    if (underHome !== null) {
      if (!paths.includes(underHome)) paths.push(underHome)
      if (!segPaths.includes(underHome)) segPaths.push(underHome)
      return true
    }
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
  let segName = ''
  const write = (level: WriteEffect['level']) => effects.push({ kind: 'write', name: segName, level, paths: [...segPaths], isUnknown: segUnknown })
  const isUnsupported = UNSUPPORTED.test(command)

  const list = pieces(masked, heredocs)
  // Độ sâu subshell trước mỗi đoạn (kiểm độc lập vòng 1 lỗi 9): `set` trong `( ... )` không đổi tùy chọn của shell ngoài.
  let depth = 0
  for (let index = 0; index < list.length; index++) {
    const piece = list[index]
    if (piece === undefined) continue
    const part = piece.text
    const isSubshell = depth > 0 || piece.opens > 0
    depth = Math.max(0, depth + piece.opens + (part.match(/(?<![$<>])\(/g) ?? []).length - (part.match(/\)/g) ?? []).length)
    segPaths = []
    segUnknown = false
    segName = ''
    // Chuyển hướng ghi trong đoạn: >, >>, 1>, &>, bỏ qua >&N (gộp luồng) và /dev/null.
    let redirected = false
    for (const match of part.matchAll(/(?:^|[^<>&\d])(?:\d*|&)>>?(?!&)\s*([^\s<>;&|]+)/g)) {
      if (add(match[1] ?? '')) redirected = true
    }
    if (redirected) write('definite')
    const withoutOutputs = part.replace(/(?:\d*|&)>>?(?!&)\s*[^\s<>;&|]+/g, ' ').replace(/\d*>&\d+/g, ' ')
    // Chuyển hướng đọc (<, <<<) không ghi file, nhưng đổi dữ liệu lệnh nhận: giữ làm một phần danh tính.
    const inputs = [...withoutOutputs.matchAll(/(\d*)(<<<|<<|<)\s*([^\s<>;&|]+)/g)]
    const bare = withoutOutputs.replace(/\d*<<?<?\s*[^\s<>;&|]+/g, ' ').trim()
    const tokens = bare.split(/\s+/).filter(Boolean)
    let cmd = tokens[0]
    let args = tokens.slice(1)
    const wrappers: string[] = []
    while ((cmd === 'sudo' || cmd === 'command' || cmd === 'nohup' || cmd === 'xargs') && args.length > 0) {
      wrappers.push(cmd)
      cmd = args[0]
      args = args.slice(1)
    }
    // Tiền tố env (kể cả /usr/bin/env, có hay không có biến): xét lệnh thật đứng sau (0.7.5).
    if (cmd !== undefined && commandName(unmask(cmd)) === 'env') {
      const real = afterEnv(args, unmask)
      if (real.length > 0) {
        cmd = real[0]
        args = real.slice(1)
      }
    }
    if (cmd === undefined) continue
    // Tên lệnh lấy tên cuối, bỏ thư mục, chỉ cho thư mục hệ thống và python, sqlite3 (/usr/bin/python3 là python3, /bin/ls là ls).
    const name = commandName(unmask(cmd))
    segName = name
    const text = unmask(bare)
    // Bản đoạn lệnh theo lệnh thật (bỏ env, tên lệnh bỏ thư mục), để xét chỉ đọc; danh tính của lệnh kiểm vẫn là `text`.
    const plain = unmask([...wrappers, name, ...args].join(' '))
    // Token trong nháy có khoảng trắng hay toán tử là một đối số duy nhất; nháy đơn giản được bỏ ('smoke' là smoke).
    const argToken = (token: string): string => {
      const value = unmask(token)
      return token.includes('\u0000') && (value === '' || /[\s<>|&;]/.test(value)) ? `${TAG}${value.replace(/\s+/g, ' ')}${TAG}` : value
    }
    if (name === 'cd') {
      const dir = args[0] !== undefined ? unmask(args[0]) : ''
      if (dir === '' || /[$`~]/.test(dir) || dir === '-') cwd = '\u0000unknown'
      else cwd = cwd === '' || dir.startsWith('/') ? normalizePath(dir) : normalizePath(`${cwd}/${dir}`)
      continue
    }
    if (name === 'set') {
      // set chỉ đổi tùy chọn của shell, không ghi file (0.7.5); -o pipefail (cả -euo pipefail) làm mã thoát của ống là của
      // lệnh kiểm tra khi nó lỗi, +o pipefail tắt lại. Đối số sau `--` là tham số vị trí, không phải tùy chọn (vòng 2 L3).
      const all = args.map(unmask)
      // `set - <đối số>` như `set -- <đối số>` (vòng 2 M7): phần sau là tham số vị trí.
      const end = all.findIndex(v => v === '--' || v === '-')
      const values = end >= 0 ? all.slice(0, end) : all
      const flag = values[values.indexOf('pipefail') - 1] ?? ''
      // Chỉ bật khi `set` chắc chạy ở shell ngoài: không chạy nền, không trong subshell, không sau `||` hay `&&` (kiểm độc lập vòng 1 lỗi 9).
      const runsOuter = !piece.background && !isSubshell && (piece.op === '' || piece.op === ';')
      if (runsOuter && /^-[a-zA-Z]*o$/.test(flag)) pipefail = true
      else if (/^\+[a-zA-Z]*o$/.test(flag)) pipefail = false
      if (!piece.background) {
        for (let k = 0; k < values.length; k++) {
          const v = values[k] ?? ''
          if (/^-[a-zA-Z]*e[a-zA-Z]*$/.test(v) || (/^-[a-zA-Z]*o$/.test(v) && values[k + 1] === 'errexit')) errexit = errexit || runsOuter
          else if (/^\+[a-zA-Z]*e[a-zA-Z]*$/.test(v) || (/^\+[a-zA-Z]*o$/.test(v) && values[k + 1] === 'errexit')) errexit = false
        }
      }
      continue
    }
    // Lệnh khai (checkCommands) chạy sau cd với đường dẫn tương đối: so dạng đã nối thư mục với lệnh khai (0.7.5).
    // Thư mục để giải: thư mục của cd trong lệnh, không có thì thư mục từ lần Bash trước (0.8.0 A1); cd tương đối nối vào thư mục đó.
    const dir = cwd === '' ? base : cwd.startsWith('/') || base === '' ? cwd : normalizePath(`${base}/${cwd}`)
    const isDeclared = isCustomCheck(text)
    let resolved = dir !== '' && !dir.includes('\u0000') && !isDeclared ? resolvedText(text, dir) : null
    let isResolvedCustom = resolved !== null && isCustomCheck(resolved)
    // Vẫn chưa khớp và lệnh không tự cd tới thư mục khác: tên script khớp đuôi với đúng một lệnh khai python (0.8.0 A1).
    const suffix = cwd === '' && !isDeclared && !isResolvedCustom ? suffixCustomCheck(text) : null
    if (suffix !== null) {
      resolved = suffix
      isResolvedCustom = true
    }
    // Lệnh vừa kiểm vừa sửa file (--fix, --write...) không phải lệnh kiểm tra: rơi xuống nhánh ghi bên dưới.
    if ((isCheckText(text) || isResolvedCustom) && !isSelfFixing(bare.split(/\s+/), unmask)) {
      // Dưới errexit (vòng 2 M7), lệnh kiểm lỗi dừng cả dòng, nên `;` sau nó như `&&`.
      const exitList = errexit ? list.map((p, k) => (k > index && p.op === ';' ? { ...p, op: '&&' as const } : p)) : list
      const piped = piece.background ? { exit: 'hidden' as const } : exitOf(exitList, index)
      // Có pipefail đứng trước và ống đi thẳng vào `tee <tệp>` hay `grep <mẫu>` rồi hết câu lệnh (vòng 2 G3): mã thoát của cả ống mang lỗi
      // của lệnh kiểm, nên tính theo mã thoát đó như lệnh không che. Không có pipefail thì giữ hidden như trước.
      const after = list[index + 1]
      const isLeadCheck = list.slice(0, index).every(isNeutral) && list.slice(1, index + 1).every(p => p.op === '&&' || p.op === ';')
      const isPipefailTeeGrep = pipefail && piped.exit === 'hidden' && isLeadCheck && after !== undefined && after.op === '|' && list.length === index + 2 && !/[<>]/.test(part.replace(/(?:^|\s)2>&1(?=\s|$)/g, ' ')) && /^(?:tee(?:\s+(?:-a|--append))?\s+[^\s-]\S*|grep(?:\s+-[cEFi]+)*\s+[^\s-]\S*)$/.test(after.text.trim())
      const exit = isPipefailTeeGrep ? { exit: 'visible' as const } : piped
      effects.push({
        kind: 'check',
        check: TEST_SEGMENT.test(text) || isCustomCheck(text) || isResolvedCustom ? 'test' : 'static',
        segment: text,
        argv: [
          ...piece.env.map(argToken),
          ...bare.split(/\s+/).filter(Boolean).map(argToken),
          ...inputs.flatMap(m => [`${m[1]}${m[2]}`, m[2] === '<<' && m[3] === 'H' ? HEREDOC : argToken(m[3] ?? '')]),
        ],
        raw: unmask([...piece.env, part.trim()].join(' ')),
        trusted: !isUnsupported && (piece.op === '' || piece.op === '&&' || piece.op === ';' || piece.op === '&'),
        ...exit,
        ...(pipefail && (exit.exit === 'filtered' || isPipefailTeeGrep) ? { pipefail: true as const } : {}),
        ...(isResolvedCustom && resolved !== null ? { resolved } : {}),
      })
      continue
    }
    if (AWK_COMMAND.test(name) || /^[gmn]?awk$/.test(name)) {
      // Script awk ghi file qua print > "file" hay print | "lệnh", hay -i inplace (0.9.0): đích không đọc được.
      if (AWK_WRITE.test(unmask(part)) || args.some((a, i) => unmask(a) === '--inplace' || unmask(a) === '-iinplace' || (unmask(a) === '-i' && unmask(args[i + 1] ?? '') === 'inplace'))) {
        isUnknown = segUnknown = true
        write('possible')
      }
      continue
    }
    // `file -C` ghi tệp magic đã biên dịch, `rg --pre <lệnh>` chạy lệnh bất kỳ (vòng 2 M12): ghi mức definite, đích chưa đọc được.
    if ((name === 'file' && args.some(a => /^-[A-Za-z]*C[A-Za-z]*$/.test(unmask(a)) || unmask(a) === '--compile')) || (name === 'rg' && args.some(a => unmask(a) === '--pre' || unmask(a).startsWith('--pre=')))) {
      isUnknown = segUnknown = true
      write('definite')
      continue
    }
    if (segmentIsReadOnly(plain)) continue
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
      // mv xóa nguồn: nguồn cũng là đích ghi (vòng sửa 2 của 0.7.5).
      if (name === 'mv') positional.forEach(add)
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
      // git clone <nguồn> <đích> (vòng 2 G2, G2b): chỉ nhận khi clone đứng ngay sau git, mọi tùy chọn thuộc CLONE_OPTIONS, đúng hai đối số vị
      // trí và đích (đối số cuối) là đường dẫn tuyệt đối hay bắt đầu bằng biến; đích đó là đường dẫn ghi của đoạn. Dạng khác là đích chưa đọc
      // được như trước.
      const dest = sub === 'clone' && unmask(args[0] ?? '') === 'clone' ? cloneDest(args.slice(1), unmask) : undefined
      const isCloneTo = dest !== undefined && add(dest)
      write('definite')
      if (isCloneTo) continue
      if (GIT_NO_FILES.has(sub)) {
        if (!isUnsupported) Object.assign(effects[effects.length - 1] as WriteEffect, { isHistory: true as const, gitSub: sub })
        continue
      }
      const dash = args.findIndex(a => unmask(a) === '--')
      if (sub === 'restore') positional.slice(1).forEach(add)
      else if ((sub === 'checkout' || sub === 'reset') && dash >= 0) args.slice(dash + 1).forEach(add)
      else isUnknown = segUnknown = true
    } else if (piece.heredocs !== null && piece.op !== '|' && piece.op !== '|&' && wrappers.length === 0 && inputs.every(m => m[2] === '<<' && m[3] === 'H') && isReadOnlyInline(name, args, piece.heredocs, unmask)) {
      // sqlite3 và python với mã nội dòng chỉ đọc (E): không ống vào, không bọc sudo/xargs, không đọc từ tệp, mỗi đoạn dùng thân heredoc của nó.
      continue
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
  const dir = cwd === '' ? undefined : cwd.startsWith('/') ? cwd : base !== '' ? normalizePath(`${base}/${cwd}`) : undefined
  return { effects, paths, isUnknown, ...(dir !== undefined ? { dir } : {}) }
}

/** File đích của một lệnh Bash có ghi (xem classifyBash). */
export function bashWriteTargets(command: string): WriteTargets {
  const { paths, isUnknown } = classifyBash(command)
  return { paths, isUnknown }
}
