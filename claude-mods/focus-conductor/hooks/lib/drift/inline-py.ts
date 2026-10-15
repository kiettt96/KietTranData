// Python nội dòng (-c, heredoc): chỉ nhận là chỉ đọc khi chứng minh được bằng danh sách cho phép; mọi dạng không phân tích được là ghi.
// Hàm thuần, không gọi $. Chuỗi và chú thích được che trước khi quét token, giữ giá trị literal để đọc chế độ open và đối số execute.

import { isReadOnlySql } from './inline-sql'

const ALLOWED_MODULES = new Set([
  'json', 'csv', 're', 'math', 'statistics', 'collections', 'itertools', 'functools', 'datetime', 'decimal', 'fractions', 'sys',
  'textwrap', 'string', 'typing', 'pprint', 'unicodedata', 'operator', 'heapq', 'bisect', 'hashlib', 'sqlite3',
])
/** Tên cho phép thoát khỏi mọi kiểm tra: exec, eval, compile, nạp module động, truy cập thuộc tính bằng chuỗi, sys.modules, sqlite3 ghi. */
const BANNED = /\b(?:exec|eval|compile|importlib|getattr|setattr|delattr|globals|locals|vars|breakpoint|executemany|executescript|commit|backup|load_extension|enable_load_extension)\b|\bsys\s*\.\s*modules\b/
const MARK = '\u0001'
const PLACEHOLDER = new RegExp(`^\\s*${MARK}(\\d+)${MARK}\\s*$`)

type Literal = { value: string; isF: boolean }
type Stripped = { text: string; literals: Literal[] }

/** Che chuỗi bằng token giữ chỗ và bỏ chú thích `#`. Null khi chuỗi không đóng. */
function strip(code: string): Stripped | null {
  const literals: Literal[] = []
  let text = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i] ?? ''
    if (ch === '#') {
      while (i < code.length && code[i] !== '\n') i += 1
    } else if (ch === '"' || ch === "'") {
      const prefix = /(?:^|\W)([rRuUbBfF]{1,2})$/.exec(text)?.[1] ?? ''
      text = text.slice(0, text.length - prefix.length)
      const quote = code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
      let j = i + quote.length
      while (j < code.length && !code.startsWith(quote, j)) {
        if (code[j] === '\\') j += 1
        else if (quote.length === 1 && code[j] === '\n') return null
        j += 1
      }
      if (j >= code.length) return null
      literals.push({ value: code.slice(i + quote.length, j), isF: /f/i.test(prefix) })
      text += `${MARK}${literals.length - 1}${MARK}`
      i = j + quote.length
    } else {
      text += ch
      i += 1
    }
  }
  return { text: text.replace(/\\\r?\n/g, ' '), literals }
}

/** Biểu thức trong dấu {} của f-string (bỏ {{ và }}). Null khi ngoặc không cân. */
function fExpressions(value: string): string[] | null {
  const out: string[] = []
  let i = 0
  while (i < value.length) {
    const ch = value[i]
    if ((ch === '{' || ch === '}') && value[i + 1] === ch) i += 2
    else if (ch === '}') return null
    else if (ch === '{') {
      let depth = 1
      let j = i + 1
      while (j < value.length && depth > 0) {
        depth += value[j] === '{' ? 1 : value[j] === '}' ? -1 : 0
        j += 1
      }
      if (depth !== 0) return null
      out.push(value.slice(i + 1, j - 1))
      i = j
    } else i += 1
  }
  return out
}

/** Đối số cấp cao nhất của lệnh gọi mở ở `open` (vị trí dấu `(`). Null khi ngoặc không đóng. */
function callArgs(text: string, open: number): string[] | null {
  const args: string[] = []
  let depth = 0
  let from = open + 1
  for (let i = open; i < text.length; i++) {
    const ch = text[i] ?? ''
    if ('([{'.includes(ch)) depth += 1
    else if (')]}'.includes(ch)) {
      depth -= 1
      if (depth === 0) {
        const last = text.slice(from, i).trim()
        if (last !== '') args.push(last)
        return args
      }
    } else if (ch === ',' && depth === 1) {
      args.push(text.slice(from, i).trim())
      from = i + 1
    }
  }
  return null
}

function literalOf(arg: string | undefined, literals: Literal[]): Literal | null {
  const index = arg === undefined ? undefined : PLACEHOLDER.exec(arg)?.[1]
  const found = index === undefined ? undefined : literals[Number(index)]
  return found === undefined || found.isF ? null : found
}

/** Mọi import thuộc danh sách cho phép, và không có `import` nào ngoài hai dạng nhận ra được. */
function importsAllowed(text: string): boolean {
  let seen = 0
  const roots: string[] = []
  for (const m of text.matchAll(/(?:^|[;\n:])\s*import\s+([^;\n]+)/g)) {
    seen += 1
    for (const item of (m[1] ?? '').split(',')) roots.push((item.trim().split(/\s+as\s+/)[0] ?? '').split('.')[0] ?? '')
  }
  for (const m of text.matchAll(/(?:^|[;\n:])\s*from\s+([\w.]+)\s+import\b/g)) {
    seen += 1
    roots.push((m[1] ?? '').split('.')[0] ?? '')
  }
  return seen === (text.match(/\bimport\b/g) ?? []).length && roots.every(root => ALLOWED_MODULES.has(root))
}

/** Mọi `open` là lệnh gọi trực tiếp với chế độ đọc: không chế độ, hoặc literal chỉ gồm r, b, t, U. */
function opensReadOnly(text: string, literals: Literal[]): boolean {
  for (const m of text.matchAll(/(\.\s*)?\bopen\b(\s*\()?/g)) {
    if (m[1] !== undefined || m[2] === undefined) return false
    const args = callArgs(text, m.index + m[0].length - 1)
    if (args === null || args.some(a => a.startsWith('*'))) return false
    const isKeyword = (a: string) => /^\w+\s*=(?!=)/.test(a)
    const mode = args.find(a => /^mode\s*=(?!=)/.test(a))?.replace(/^mode\s*=\s*/, '') ?? args.filter(a => !isKeyword(a))[1]
    if (mode === undefined) continue
    const literal = literalOf(mode, literals)
    if (literal === null || !/^[rbtU]+$/.test(literal.value)) return false
  }
  return true
}

/** Mọi `.execute(` có đối số đầu là chuỗi literal chỉ đọc (không f-string, không nối, không biến, không escape). */
function executesReadOnly(text: string, literals: Literal[]): boolean {
  for (const m of text.matchAll(/\.\s*execute\b(\s*\()?/g)) {
    if (m[1] === undefined) return false
    const literal = literalOf(callArgs(text, m.index + m[0].length - 1)?.[0], literals)
    if (literal === null || literal.value.includes('\\') || !isReadOnlySql(literal.value)) return false
  }
  return true
}

function scan(code: string, depth: number): boolean {
  const stripped = strip(code)
  if (stripped === null || depth > 3) return false
  const { text, literals } = stripped
  const opens = (text.match(/[([{]/g) ?? []).length
  if (opens !== (text.match(/[)\]}]/g) ?? []).length) return false
  if (/__/.test(text.replace(/\b__(?:name|main)__\b/g, '')) || BANNED.test(text)) return false
  if (!importsAllowed(text) || !opensReadOnly(text, literals) || !executesReadOnly(text, literals)) return false
  for (const m of text.matchAll(/\.\s*(?:write|writelines|truncate)\b/g)) {
    if (!/\bsys\s*\.\s*(?:stdout|stderr)\s*$/.test(text.slice(0, m.index))) return false
  }
  for (const literal of literals.filter(l => l.isF)) {
    const expressions = fExpressions(literal.value)
    if (expressions === null || !expressions.every(e => scan(e, depth + 1))) return false
  }
  return true
}

/** Mã Python nội dòng có chỉ đọc không (xem đầu tệp). Rỗng, cú pháp lỗi, import lạ, ghi tệp, SQL ghi: là ghi. */
export function isReadOnlyPython(code: string): boolean {
  return code.trim() !== '' && scan(code, 0)
}
