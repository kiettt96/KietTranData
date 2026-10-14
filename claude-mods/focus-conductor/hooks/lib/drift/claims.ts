// Đối chiếu evidence của "verified" với dấu vết thật: tách evidence thành từ, tìm đầu cụm lệnh được nhắc, khớp nghiêm ngặt với lần chạy.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import { TAG } from './classify'
import { isCheckText } from './verify'
import type { CheckKind } from './verify'
import { covers } from './evidence'
import type { EvidenceEntry, EvidenceLog } from './evidence'
import { entryIdentities, identityKey, isEnvToken, normalizeArgv } from './identity'

/**
 * Từ đứng trước một lệnh kiểm tra mà đưa lệnh đó vào một cụm lớn hơn (wrapper, trình chạy gói, trình thông dịch, container,
 * ssh). CHỈ dùng để dò đầu cụm của claim trong evidence (`phraseStart`), không bao giờ tham gia danh tính: log không coi
 * `sudo npm test` là lệnh kiểm tra, nên cụm có từ này không khớp lần chạy nào. Ngoại lệ có chủ ý duy nhất là `timeout N`
 * (bị bỏ khi ghi lệnh): nó chỉ có thể làm lệnh lỗi, không thể tạo kết quả đạt giả.
 */
const CLAIM_PREFIXES = new Set([
  'sudo', 'doas', 'command', 'nohup', 'exec', 'time', 'env', 'nice', 'ionice', 'stdbuf', 'setsid', 'taskset', 'chrt', 'flock',
  'xargs', 'strace', 'unbuffer', 'cross-env', 'dotenv', 'bunx', 'pnpx', 'dlx', 'uvx', 'docker', 'podman', 'kubectl', 'ssh',
  'bash', 'sh', 'zsh', 'dash', 'python', 'python3', 'node', 'bun', 'deno', 'npm', 'pnpm', 'yarn', 'uv', 'poetry', 'pipx', 'bundle',
])
/** Token giống cờ (`-u`, `--package`): giá trị đi sau nó không phân biệt được với đối số, nên cả cụm là một tiền tố. */
const FLAG_LIKE = /^-{1,2}[a-z0-9]/
/** Token giống đường dẫn script: `./x`, `../x`, `/x`, `~/x`, hay đuôi file script. */
const SCRIPT_PATH = /^(?:\.\/|\.\.\/|\/|~\/)|\.(?:sh|bash|zsh|py|js|mjs|cjs)$/

/** Ranh giới trong evidence (dấu câu, ngoặc, nháy, toán tử shell): một lệnh được nhắc không bao giờ vắt qua ranh giới. */
const BOUNDARY = '\u0000'

/** Token đóng gói đối số có nháy: một token duy nhất khi có khoảng trắng, toán tử shell hay rỗng; nháy đơn giản được bỏ. */
function quotedToken(content: string): string {
  const value = content.replace(/\s+/g, ' ')
  return value === '' || /[\s<>|&;]/.test(value) ? `${TAG}${value}${TAG}` : value
}

/** Chỉ số dấu `)` đóng của `(` ở `open` (đếm lồng nhau), hoặc -1. */
function substitutionEnd(text: string, open: number): number {
  let depth = 0
  for (let j = open; j < text.length; j++) {
    if (text[j] === '(') depth += 1
    else if (text[j] === ')' && --depth === 0) return j
  }
  return -1
}

/** Ký tự kết thúc một từ khi đứng ở cuối (kể cả cụm nhiều ký tự): dấu câu, ngoặc đóng, nháy. */
const TERMINAL = /[:,;!?)\]}`'"”’“‘]/

/** Chỉ số nháy đóng cùng loại của nháy mở ở `from`: nháy đó phải đứng cuối từ. -1 nếu không có. */
function closingQuote(text: string, from: number): number {
  const quote = text[from]
  for (let j = from + 1; j < text.length; j++) {
    if (text[j] !== quote) continue
    const after = text[j + 1]
    if (after === undefined || /\s/.test(after) || TERMINAL.test(after)) return j
  }
  return -1
}

/**
 * Các từ của evidence, giữ nguyên chữ hoa thường. Dấu câu cuối từ, ngoặc, backtick, nháy bao ngoài và toán tử shell đứng
 * một mình (`|`, `||`, `&&`, `|&`, `&`) là ranh giới. Nháy ASCII mở giữa một mệnh đề đã có lệnh kiểm tra là một đối số
 * duy nhất, nội dung chuẩn hóa như phía lệnh đã chạy. Dấu chấm cuối từ chỉ là dấu chấm câu khi đứng một mình sau ký tự
 * khác `.` và `/`: `./...` giữ nguyên, `src/a.test.ts.` thành `src/a.test.ts`; `./....` giữ nguyên.
 */
function evidenceWords(text: string): string[] {
  const out: string[] = []
  let word = ''
  const lastIsBoundary = () => out.length === 0 || out[out.length - 1] === BOUNDARY
  const boundary = () => {
    if (!lastIsBoundary()) out.push(BOUNDARY)
  }
  const commit = () => {
    if (word === '') return
    if (/[^./]\.$/.test(word)) out.push(word.slice(0, -1), BOUNDARY)
    else out.push(word)
    word = ''
  }
  const clauseHasCheck = () => {
    const clause = out.slice(out.lastIndexOf(BOUNDARY) + 1)
    return clause.some((_, k) => isCheckText(clause.slice(k).join(' ').toLowerCase()))
  }
  let i = 0
  while (i < text.length) {
    const c = text[i] ?? ''
    if (/\s/.test(c)) {
      commit()
      i += 1
      continue
    }
    if (word === '' && (c === '|' || c === '&')) {
      let j = i
      while (text[j] === '|' || text[j] === '&') j += 1
      if (j >= text.length || /\s/.test(text[j] ?? '')) {
        boundary()
        i = j
        continue
      }
    }
    // Thay thế lệnh không được mô hình hóa: `$(...)` (kể cả lồng nhau) và `NAME=\`...\`` dính vào từ, nên từ không khớp lần chạy
    // nào và không bị dấu `)` hay backtick tách thành ranh giới (mất tiền tố biến môi trường).
    if ((c === '$' && text[i + 1] === '(') || (c === '`' && /^[A-Za-z_][A-Za-z0-9_]*=$/.test(word))) {
      const close = c === '`' ? text.indexOf('`', i + 1) : substitutionEnd(text, i + 1)
      if (close < 0) {
        word += c
        i += 1
        continue
      }
      word += text.slice(i, close + 1)
      i = close + 1
      continue
    }
    if (c === '`' || c === '“' || c === '”' || c === '‘' || c === '’') {
      commit()
      boundary()
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      // `NAME="giá trị"`: nháy sau dấu = thuộc cùng từ, giá trị chuẩn hóa như phía lệnh đã chạy (bỏ nháy; có khoảng trắng hay
      // toán tử thì thành token có nháy). Nháy không đóng hợp lệ vẫn dính vào từ, nên từ còn hình dạng biến môi trường.
      if (/^[A-Za-z_][A-Za-z0-9_]*=$/.test(word)) {
        const close = closingQuote(text, i)
        if (close < 0) {
          word += c
          i += 1
          continue
        }
        const inner = text.slice(i + 1, close).replace(/\s+/g, ' ')
        if (/[\s<>|&;]/.test(inner)) {
          out.push(`${TAG}${word}${inner}${TAG}`)
          word = ''
        } else word += inner
        i = close + 1
        continue
      }
      // Đầu mệnh đề thì mệnh đề còn rỗng nên clauseHasCheck sai: nháy bao ngoài đứng đầu mệnh đề không bao giờ thành token.
      if (word === '' && clauseHasCheck()) {
        const close = closingQuote(text, i)
        if (close > 0) {
          out.push(quotedToken(text.slice(i + 1, close)))
          i = close + 1
          continue
        }
      }
      commit()
      boundary()
      i += 1
      continue
    }
    if (word === '' && (c === '(' || c === '[' || c === '{')) {
      boundary()
      i += 1
      continue
    }
    if (TERMINAL.test(c)) {
      let j = i
      while (j < text.length && TERMINAL.test(text[j] ?? '')) j += 1
      if (j >= text.length || /\s/.test(text[j] ?? '')) {
        commit()
        boundary()
        i = j
        continue
      }
    }
    word += c
    i += 1
  }
  commit()
  return out
}

/**
 * Chuyển hướng ở mức token (token có nháy không bao giờ là toán tử): bỏ chuyển hướng đầu ra kèm đích (kết quả dựa vào mã
 * thoát), tách `<file` thành `<` `file` như phía lệnh đã chạy.
 */
function sanitizeTokens(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    // Token có nháy (bắt đầu bằng TAG) và HEREDOC không bao giờ khớp các mẫu dưới đây: chúng neo ở đầu token.
    if (/^(?:\d*|&)>>?$/.test(token)) {
      i += 1
      continue
    }
    if (/^(?:\d*|&)>>?\S/.test(token)) continue
    const input = /^(\d*)(<<<|<<|<)([^<].*)$/.exec(token)
    if (input !== null) {
      out.push(`${input[1]}${input[2]}`, input[3] ?? '')
      continue
    }
    out.push(token)
  }
  return out
}

/**
 * Số token evidence (tính từ `start`, đầu một cụm lệnh) mà một lần chạy chiếm, hoặc 0. Khớp NGHIÊM NGẶT: mọi token từ đó
 * đến ranh giới kế tiếp (hoặc hết evidence), sau khi chuẩn hóa như danh tính (theo trình chạy của lần chạy), phải bằng
 * đúng một cách viết của danh tính và được tiêu thụ hết. Không đoán từ đứng sau là kết quả hay đối số. Bắt đầu ở ranh giới
 * thì mệnh đề rỗng nên không khớp.
 */
function matchLength(words: string[], start: number, entry: EvidenceEntry): number {
  const end = words.indexOf(BOUNDARY, start)
  const clause = sanitizeTokens(words.slice(start, end < 0 ? undefined : end))
  for (const { forms, runner } of entryIdentities(entry)) {
    const { prefix, words: normalized } = normalizeArgv(clause, runner)
    const evidence = [...prefix, ...normalized]
    if (forms.some(form => form.length > 0 && form.length === evidence.length && form.every((token, k) => evidence[k] === token))) {
      return (end < 0 ? words.length : end) - start
    }
  }
  return 0
}

/**
 * Đầu cụm lệnh của claim ở `from`. Từ đầu mệnh đề đến claim, token đầu tiên thuộc tiền tố (wrapper và trình chạy trong
 * `CLAIM_PREFIXES`, `npx`, gán biến môi trường kể cả có nháy, token giống cờ cùng giá trị đi sau nó) là đầu cụm: không lần
 * chạy nào bắt đầu ở đó nên claim là stale, và token con (`npm test` sau `sudo -u alice`) không thay được cả cụm. Một `--`
 * đứng sau từ đầu mệnh đề là dấu phân cách đối số: claim sau nó neo về chính dấu đó. `-`/`--` ở đầu mệnh đề là dấu đầu dòng. Nếu không có tiền tố, các token giống đường dẫn script
 * liền trước (`./run`, `run.sh`) cũng thuộc cụm. Token có nháy (bắt đầu bằng TAG) không bao giờ khớp cờ hay đường dẫn.
 */
function phraseStart(words: string[], lower: string[], from: number): number {
  let clauseStart = from
  while (clauseStart > 0 && lower[clauseStart - 1] !== BOUNDARY) clauseStart -= 1
  // Đối số sau `--` thuộc lệnh đứng trước nó: claim neo về chính dấu phân cách, dù trước đó có tiền tố nào.
  for (let j = clauseStart + 1; j < from; j++) if (lower[j] === '--') return j
  for (let j = clauseStart; j < from; j++) {
    const low = lower[j] ?? ''
    if (isEnvToken(words[j] ?? '') || CLAIM_PREFIXES.has(low) || low === 'npx' || FLAG_LIKE.test(low)) return j
  }
  // Một đường dẫn script liền trước đã đủ làm claim không khớp lần chạy nào (lần chạy không bắt đầu bằng đường dẫn).
  return SCRIPT_PATH.test(words[from - 1] ?? '') ? from - 1 : from
}

/** Các đầu cụm mà evidence nhắc một lệnh kiểm tra (dò trên bản chữ thường, cùng chỉ số token). */
function claimedChecks(words: string[]): number[] {
  const lower = words.map(word => word.toLowerCase())
  const starts = new Set<number>()
  for (let i = 0; i < lower.length; i++) {
    const end = lower.indexOf(BOUNDARY, i)
    if (!isCheckText(lower.slice(i, end < 0 ? undefined : end).join(' '))) continue
    // `python -m pytest`: module là con của cụm bắt đầu ở `python`, không phải claim riêng.
    if (i >= 2 && lower[i - 1] === '-m' && (lower[i - 2] === 'python' || lower[i - 2] === 'python3')) continue
    starts.add(phraseStart(words, lower, i))
  }
  return [...starts].sort((a, b) => a - b)
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
    words.map((_, start) => ({ entry, start, length: matchLength(words, start, entry) })).filter(span => span.length > 0),
  )
  const mentioned = [...new Set(spans.map(span => span.entry))]
  // Mỗi claim gắn với đầu cụm lệnh: chỉ một lần chạy kiểm tra khớp bắt đầu đúng tại đó mới là chỗ dựa.
  const unbacked = claimedChecks(words).find(at => !spans.some(span => span.entry.check !== null && span.start === at))
  if (unbacked !== undefined) {
    const end = words.indexOf(BOUNDARY, unbacked)
    const shown = words.slice(unbacked, end < 0 ? unbacked + 6 : Math.min(end, unbacked + 6)).join(' ').replaceAll(TAG, "'")
    return {
      level: 'stale',
      reason: `không tìm thấy lần chạy kiểm tra khớp chính xác với lệnh \`${shown}\` trong evidence; hãy xác nhận lệnh đã chạy, các tùy chọn và đối số khớp, và phân cách lệnh với kết quả bằng dấu \`:\` (ví dụ \`npm test: 12 pass\`)`,
    }
  }
  // Mỗi lệnh kiểm tra được nhắc tính theo lần chạy cuối của chính nó; mọi lệnh được nhắc phải đạt, sau thay đổi cuối.
  const latest = new Map<string, EvidenceEntry>()
  // Mọi lần chạy cùng danh tính đều khớp như nhau nên đều nằm trong `mentioned`; duyệt theo thứ tự log, lần cuối thắng.
  for (const entry of log.commands) if (entry.check !== null && mentioned.includes(entry)) latest.set(identityKey(entry), entry)
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
