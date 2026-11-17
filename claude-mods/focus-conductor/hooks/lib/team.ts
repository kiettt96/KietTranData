// Đội hình theo cỡ việc do mod áp (0.9.0 C, thay C3 của router): router chỉ đọc prompt; mod quyết khi nào bật các bước đóng (kiểm, duyệt,
// sẵn sàng), chèn một đoạn dặn một lần mỗi mục tiêu và tính trạng thái từng bước đóng cho pane và cổng đóng mục tiêu. Hàm thuần.

import type { Brief, ClosingStep, PlanStep } from '../../types'
import { isSoftPath } from './drift/soft'
import { stepCheckOf } from './drift/stepcheck'
import { hasDeclaredCheckFor, isSelfFixing } from './drift/verify'
import { classifyBash } from './drift/classify'
import { isRoleTemp } from './drift/scope'
import type { EvidenceLog } from './drift/evidence'

/** Số file không nhẹ khác nhau được sửa thì bật đội hình dù router chấm độ sâu thấp (0.9.0 C1). Đặt một chỗ, ghi trong DESIGN. */
export const TEAM_FILES = 3
/** Trần ký tự của đoạn dặn bước đóng (0.9.0 C2). */
export const CLOSING_NOTE_CHARS = 300

/** Số file không nhẹ khác nhau trong sổ thay đổi (sổ đã bỏ tệp trạng thái và nơi ghi phụ của B1); tài liệu, ghi chú là nhẹ. */
export function hardFileCount(paths: readonly string[]): number {
  return new Set(paths.filter(path => !isSoftPath(path) && !isRoleTemp(path))).size
}

/** Shell nhận script qua -c hay qua stdin. */
const SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])
/** Lệnh bọc chạy lệnh khác, kèm các tùy chọn nhận giá trị (0.9.0, vòng sửa 2 sau kiểm độc lập lần hai). */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['nice', new Set(['-n'])],
  ['nohup', new Set<string>()],
  ['ionice', new Set(['-c', '-n'])],
  ['stdbuf', new Set<string>()],
  ['time', new Set<string>()],
  ['command', new Set<string>()],
  ['builtin', new Set<string>()],
  ['exec', new Set<string>()],
  ['sudo', new Set(['-u', '-g'])],
  ['doas', new Set(['-u'])],
  ['env', new Set(['-u'])],
  ['timeout', new Set(['-s', '-k'])],
  ['xargs', new Set(['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a'])],
])
/** API ghi file của mã nội tuyến (python -c, node -e, ...). */
const WRITE_API = /\b(?:open|write|writeFile|writeFileSync|appendFile|unlink|unlinkSync|remove|rename|rmtree|rmSync|rm|mkdir|copy|copyfile|move|truncate)\b|\bfs\.|\bshutil\.|\bos\.|\bPath\(/

/** Tách câu lệnh thành các đoạn theo toán tử ngoài nháy (; && || | & xuống dòng, ngoặc, backtick); đoạn sau một ống đơn ghi isPiped. */
function segmentsOf(command: string): Array<{ text: string; isPiped: boolean }> {
  const out: Array<{ text: string; isPiped: boolean }> = []
  let cur = ''
  let quote: string | null = null
  let piped = false
  const push = (nextPiped: boolean) => {
    if (cur.trim() !== '') out.push({ text: cur.trim(), isPiped: piped })
    cur = ''
    piped = nextPiped
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (quote !== null) {
      if (ch === '\\' && quote === '"') {
        cur += ch + (command[i + 1] ?? '')
        i += 1
      } else {
        if (ch === quote) quote = null
        cur += ch
      }
      continue
    }
    if (ch === '\\') {
      cur += ch + (command[i + 1] ?? '')
      i += 1
    } else if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
    } else if (ch === '|' && command[i + 1] !== '|' && command[i - 1] !== '|' && command[i + 1] !== '&') {
      push(true)
    } else if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '`') {
      push(false)
    } else {
      cur += ch
    }
  }
  push(false)
  return out
}

/** Tách một đoạn thành từ theo luật shell: bỏ nháy, giữ ký tự thoát. */
function wordsOf(text: string): string[] {
  const words: string[] = []
  let cur = ''
  let has = false
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ''
    if (quote !== null) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"') cur += text[(i += 1)] ?? ''
      else cur += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      has = true
    } else if (ch === '\\') {
      cur += text[(i += 1)] ?? ''
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur !== '') words.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
    }
  }
  if (has || cur !== '') words.push(cur)
  return words
}

/** Bỏ phép gán biến đầu đoạn và các lệnh bọc (cùng tùy chọn, giá trị của chúng) để còn lại lệnh thật. */
function unwrap(words: readonly string[]): string[] {
  let rest = [...words]
  for (;;) {
    while (rest.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0] ?? '')) rest = rest.slice(1)
    const name = (rest[0] ?? '').split('/').pop() ?? ''
    const valued = WRAPPERS.get(name)
    if (valued === undefined) return rest
    rest = rest.slice(1)
    while (rest.length > 0 && (rest[0] ?? '').startsWith('-')) rest = valued.has(rest[0] ?? '') ? rest.slice(2) : rest.slice(1)
    if (name === 'timeout' && rest.length > 0) rest = rest.slice(1)
  }
}

const isTempPath = (path: string) => isRoleTemp(path)
/** Đích ghi đã biết: rỗng là chưa biết (tính là ghi); có đích thì chỉ ghi khi có đích ngoài thư mục tạm. */
const writesTo = (paths: readonly string[]) => paths.length === 0 || paths.some(path => !isTempPath(path))
const nonOptions = (args: readonly string[]) => args.filter(arg => !arg.startsWith('-'))

/** Lệnh của một đoạn có ghi file ngoài thư mục tạm theo tên lệnh và tham số (0.9.0, vòng sửa 2 sau kiểm độc lập lần hai). */
function commandWrites(name: string, args: readonly string[], cwd: string | null): boolean {
  if (SHELLS.has(name)) {
    const at = args.findIndex(arg => /^-[a-zA-Z]*c$/.test(arg))
    return at >= 0 && isBashWrite(args[at + 1] ?? '', cwd)
  }
  if (name === 'eval') return isBashWrite(args.join(' '), cwd)
  if (name === 'black' || name === 'isort' || name === 'rustfmt') return !args.some(arg => arg === '--check' || arg === '--diff' || arg === '--check-only')
  if (name === 'autopep8') return args.some(arg => arg === '-i' || arg === '--in-place')
  if (name === 'gofmt' || name === 'shfmt') return args.some(arg => /^-[a-z]*w$/.test(arg))
  if (name === 'clang-format') return args.includes('-i')
  if (name === 'cargo') return args[0] === 'fmt' && !args.includes('--check')
  if (name === 'go') return args[0] === 'fmt'
  if (name === 'patch') return true
  if (name === 'curl' || name === 'wget') {
    const at = args.findIndex(arg => arg === '-o' || arg === '--output' || (name === 'wget' && arg === '-O'))
    const joined = args.find(arg => arg.startsWith('--output=') || arg.startsWith('--output-document='))
    const target = at >= 0 ? args[at + 1] : joined?.slice(joined.indexOf('=') + 1)
    if (target !== undefined) return target !== '-' && writesTo([target])
    return name === 'wget' || args.includes('-O') || args.includes('--remote-name')
  }
  if (name === 'find') {
    if (!args.some(arg => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg))) return false
    const root = args.find(arg => !arg.startsWith('-'))
    return root === undefined || writesTo([root])
  }
  if (name === 'awk' || name === 'gawk') {
    const isInPlace = args.some((arg, i) => arg === '--inplace' || arg === '-iinplace' || (arg === '-i' && args[i + 1] === 'inplace'))
    return isInPlace && writesTo(nonOptions(args).filter(arg => arg !== 'inplace').slice(1))
  }
  if (name === 'dd') {
    const of = args.find(arg => arg.startsWith('of='))
    return of !== undefined && writesTo([of.slice(3)])
  }
  if (name === 'truncate') return writesTo(nonOptions(args))
  if (name === 'perl' && args.some(arg => /^-[a-zA-Z]*i/.test(arg))) {
    const code = args.findIndex(arg => /^-[a-zA-Z]*e$/.test(arg))
    return writesTo(nonOptions(args.filter((_, i) => i !== code + 1 || code < 0)))
  }
  const inline =
    /^python(?:[23](?:\.\d+)?)?$/.test(name) ? args.findIndex(arg => /^-[a-zA-Z]*c$/.test(arg))
    : name === 'node' || name === 'deno' ? args.findIndex(arg => ['-e', '--eval', '-p', '--print'].includes(arg))
    : name === 'bun' ? args.findIndex(arg => arg === '-e' || arg === '--eval')
    : name === 'ruby' || name === 'perl' ? args.findIndex(arg => /^-[a-zA-Z]*e$/.test(arg))
    : -1
  if (inline >= 0) {
    const code = args[inline + 1] ?? ''
    if (!WRITE_API.test(code)) return false
    const paths = [...code.matchAll(/(['"])(.*?)\1/g)].map(m => m[2] ?? '').filter(text => text.includes('/'))
    return writesTo(paths)
  }
  return false
}

/**
 * Lệnh Bash ghi file ngoài thư mục tạm (0.9.0 C2, D1, hai vòng sửa sau kiểm độc lập): xét từng đoạn của câu lệnh (tách theo toán tử ngoài
 * nháy, ngoặc, backtick), sau khi bỏ phép gán và lệnh bọc (nice, sudo, env, timeout, xargs...). Một đoạn là ghi khi: bộ phân loại thấy tác
 * động ghi mức definite ngoài thư mục tạm hay đích chưa xác định, hoặc thao tác git trên lịch sử; tên lệnh và tham số là lệnh ghi đã biết
 * (formatter sửa tại chỗ, curl -o, perl -pi, find -delete, patch, mã nội tuyến có API ghi), đích trong thư mục tạm thì không tính; lệnh tự
 * sửa (--fix, --write); shell lồng (-c, eval) có đoạn ghi; hay shell đọc script từ ống. Chạy script (bash x.sh, bash -c 'source ...') không tính.
 */
export function isBashWrite(command: string, cwd: string | null = null): boolean {
  for (const segment of segmentsOf(command)) {
    const words = unwrap(wordsOf(segment.text))
    if (words.length === 0) continue
    const name = (words[0] ?? '').split('/').pop() ?? ''
    const args = words.slice(1)
    if (segment.isPiped && SHELLS.has(name) && !args.some(arg => /^-[a-zA-Z]*c$/.test(arg))) return true
    if (commandWrites(name, args, cwd)) return true
    if (isSelfFixing(words)) return true
    const raw = wordsOf(segment.text)
    const texts = words.length === raw.length ? [segment.text] : [segment.text, words.map(word => (/[\s'"]/.test(word) ? `'${word.replace(/'/g, "'\\''")}'` : word)).join(' ')]
    for (const text of texts) {
      const effects = classifyBash(text, cwd ?? undefined).effects
      if (effects.some(effect => effect.kind === 'write' && effect.level === 'definite' && (effect.isHistory === true || effect.isUnknown || effect.paths.length === 0 || effect.paths.some(path => !isRoleTemp(path))))) return true
    }
  }
  return false
}


/**
 * Điều kiện bật đội hình (0.9.0 C1): option closingReview là auto, mục tiêu loại edit hay mixed, không phải prompt đối chiếu; và router chấm
 * substantial hay hard, hoặc đã có từ TEAM_FILES file không nhẹ khác nhau được sửa. Trả lý do bật hay null.
 */
export function teamCause(closingReview: unknown, brief: Brief | null, changedPaths: readonly string[]): 'depth' | 'files' | null {
  if (brief === null || closingReview === 'off' || brief.isReference) return null
  if (brief.kind !== 'edit' && brief.kind !== 'mixed') return null
  if (brief.depth === 'substantial' || brief.depth === 'hard') return 'depth'
  return hardFileCount(changedPaths) >= TEAM_FILES ? 'files' : null
}

/** Mục tiêu chỉ sửa tài liệu: phạm vi router đọc được, hay sổ thay đổi khi chưa có phạm vi, đều là đường dẫn nhẹ (và không rỗng). */
export function isDocsOnly(brief: Brief, changedPaths: readonly string[]): boolean {
  const paths = brief.scopePaths.length > 0 ? brief.scopePaths : changedPaths
  return paths.length > 0 && paths.every(isSoftPath)
}

/**
 * Có lệnh kiểm biết được (0.9.0 C2): check của một bước có lệnh (trong backtick hay trước " => "), lệnh khai trong checkCommands phủ file
 * đã sửa, hay một lần chạy trình test mod nhận ra trong dấu vết của mục tiêu.
 */
export function hasKnownCheck(plan: readonly PlanStep[], changedPaths: readonly string[], log: EvidenceLog | null): boolean {
  if (plan.some(step => /`[^`]+`| => /.test(step.check ?? '') && stepCheckOf(step.check) !== null)) return true
  if (hasDeclaredCheckFor(changedPaths)) return true
  return log !== null && log.commands.some(c => c.check === 'test')
}

/** Đoạn dặn bước đóng (0.9.0 C2), không quá CLOSING_NOTE_CHARS ký tự: thứ tự, tiền tố phải dùng, các từ kết luận. */
export function closingNote(opts: { hasCheck: boolean; isHard: boolean; isDocs: boolean }): string {
  const steps = [
    ...(opts.hasCheck ? ['Agent "Kiểm: <lệnh>" chạy lệnh kiểm'] : []),
    `"Duyệt: <phạm vi>" rà độc lập, không sửa file${opts.isDocs ? ', gồm đối chiếu số liệu, mẫu, chính tả' : ''}`,
    ...(opts.isHard ? ['"Sẵn sàng: <mục tiêu>" đánh giá sẵn sàng'] : []),
  ]
  const words = opts.isHard ? 'ĐẠT hay CHƯA ĐẠT; SẴN SÀNG hay CHƯA SẴN SÀNG' : 'ĐẠT hay CHƯA ĐẠT'
  return `[focus-conductor] Trước khi kết thúc, theo thứ tự: ${steps.join('; rồi ')}. Câu trả lời mở đầu bằng ${words}.`.slice(0, CLOSING_NOTE_CHARS)
}

/** Một kết luận đã nhận, đủ để tính trạng thái bước đóng. */
/** isReview: kết luận được tính cho bước duyệt và sẵn sàng (0.9.0 C6): không phải lượt kiểm, không phải từ của bước kiểm, model từ sonnet. */
export type ClosingVerdict = { verdict: 'pass' | 'fail' | 'ready' | 'not-ready' | null; isClean: boolean; isReview: boolean; seq: number }

/**
 * Trạng thái các bước đóng (0.9.0 C3): kiểm (khi có lệnh kiểm biết được), duyệt, và sẵn sàng với mục tiêu hard. Kiểm đạt khi có lần kiểm
 * đạt sau thay đổi không nhẹ cuối; duyệt đạt khi có kết luận đạt của subagent không ghi file sau thay đổi đó, chưa đạt khi kết luận gần
 * nhất là chưa đạt; sẵn sàng tương tự, sau lần duyệt đạt.
 */
export function closingSteps(opts: { hasCheck: boolean; isHard: boolean; checked: boolean; checkFailed: boolean; lastHard: number; verdicts: readonly ClosingVerdict[] }): ClosingStep[] {
  const fresh = opts.verdicts.filter(v => v.isClean && v.isReview && v.seq > opts.lastHard)
  const reviews = fresh.filter(v => v.verdict === 'pass' || v.verdict === 'fail')
  const lastReview = reviews[reviews.length - 1]
  const reviewSeq = reviews.filter(v => v.verdict === 'pass').reduce((max, v) => Math.max(max, v.seq), -1)
  const readies = fresh.filter(v => (v.verdict === 'ready' || v.verdict === 'not-ready') && v.seq >= reviewSeq)
  const lastReady = readies[readies.length - 1]
  const steps: ClosingStep[] = []
  if (opts.hasCheck) steps.push({ name: 'check', state: opts.checked ? 'pass' : opts.checkFailed ? 'fail' : 'wait' })
  steps.push({ name: 'review', state: lastReview?.verdict === 'pass' ? 'pass' : lastReview?.verdict === 'fail' ? 'fail' : 'wait' })
  if (opts.isHard) steps.push({ name: 'design', state: reviewSeq < 0 || lastReady === undefined ? 'wait' : lastReady.verdict === 'ready' ? 'pass' : 'fail' })
  return steps
}

/**
 * Tiền tố description theo vai (0.9.0 B2), xét tiền tố dài trước, không phân biệt hoa thường. Tiền tố chỉ quyết vai và model của lời gọi;
 * kết luận của subagent được nhận theo câu trả lời, có tiền tố hay không (0.9.0 D1).
 */
export const ROLE_PREFIXES: ReadonlyArray<readonly [string, 'review' | 'audit' | 'design']> = (
  [
    ['Kiểm độc lập: ', 'review'],
    ['Independent check: ', 'review'],
    ['Duyệt: ', 'review'],
    ['Review: ', 'review'],
    ['Kiểm: ', 'audit'],
    ['Audit: ', 'audit'],
    ['Sẵn sàng: ', 'design'],
    ['Readiness: ', 'design'],
  ] as const
).slice().sort((a, b) => b[0].length - a[0].length)

/** Vai theo tiền tố description (0.9.0 B2), hay undefined. */
export function prefixRole(description: string): 'review' | 'audit' | 'design' | undefined {
  const head = description.normalize('NFC').trimStart().toLowerCase()
  return ROLE_PREFIXES.find(([prefix]) => head.startsWith(prefix.normalize('NFC').toLowerCase()))?.[1]
}
