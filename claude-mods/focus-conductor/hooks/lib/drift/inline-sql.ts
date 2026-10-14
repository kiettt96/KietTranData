// SQL nội dòng của sqlite3: chỉ nhận là chỉ đọc khi chứng minh được bằng danh sách cho phép; mọi dạng không phân tích được là ghi.
// Hàm thuần, không gọi $. Mô hình đe dọa là sai sót thông thường của model, không phải đối thủ cố né.

/** PRAGMA dạng đọc. Dạng gán (=) hay pragma trạng thái (journal_mode, user_version...) không nằm ở đây nên là ghi. */
const READ_PRAGMAS = new Set([
  'integrity_check', 'quick_check', 'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'foreign_key_check', 'database_list',
])
/** Lệnh chấm của shell sqlite3 chỉ đọc hoặc chỉ đổi cách hiển thị. */
const READ_DOT_COMMANDS = new Set(['schema', 'tables', 'indexes', 'databases', 'headers', 'mode', 'timer', 'width', 'show', 'dump'])
/** Hàm của shell sqlite3 có tác dụng phụ trên hệ thống tệp hay tiến trình. */
const SIDE_EFFECT_FUNCTIONS = /\b(?:writefile|edit|load_extension|readfile|fsdir|lsmode)\b/
const WRITE_WORDS = /\b(?:insert|update|delete|replace)\b/

type Item = { dot: boolean; text: string }

/**
 * Tách đầu vào của sqlite3 thành lệnh chấm (đứng đầu dòng, không có câu dở dang) và câu SQL cách nhau bởi `;` ngoài chuỗi.
 * Chú thích bị bỏ, nội dung chuỗi và tên trong nháy bị rỗng hóa để từ khóa trong chuỗi không bị tính. Null khi chuỗi hay
 * chú thích không đóng.
 */
function splitInput(input: string): Item[] | null {
  const items: Item[] = []
  let current = ''
  let lineStart = true
  let i = 0
  while (i < input.length) {
    const ch = input[i] ?? ''
    if (lineStart && ch === '.' && current.trim() === '') {
      const end = input.indexOf('\n', i)
      const stop = end < 0 ? input.length : end
      items.push({ dot: true, text: input.slice(i, stop).trim() })
      i = stop
      continue
    }
    if (ch === '\n') lineStart = true
    else if (ch !== ' ' && ch !== '\t' && ch !== '\r') lineStart = false
    if (ch === '-' && input[i + 1] === '-') {
      const end = input.indexOf('\n', i)
      current += ' '
      i = end < 0 ? input.length : end
    } else if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      if (end < 0) return null
      current += ' '
      i = end + 2
    } else if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      let j = i + 1
      for (;;) {
        const k = input.indexOf(close, j)
        if (k < 0) return null
        if (close !== ']' && input[k + 1] === close) j = k + 2
        else {
          j = k + 1
          break
        }
      }
      current += `${ch === '[' ? '"' : ch}${ch === '[' ? '"' : ch}`
      i = j
    } else if (ch === ';') {
      if (current.trim() !== '') items.push({ dot: false, text: current.trim() })
      current = ''
      i += 1
    } else {
      current += ch
      i += 1
    }
  }
  if (current.trim() !== '') items.push({ dot: false, text: current.trim() })
  return items
}

/** Câu SELECT thuần (kể cả sau EXPLAIN [QUERY PLAN] hay WITH): không hàm có tác dụng phụ, WITH không có câu ghi nào. */
function isSelect(statement: string): boolean {
  const body = statement.replace(/^explain(?: query plan)?\s+/, '')
  if (SIDE_EFFECT_FUNCTIONS.test(body)) return false
  if (/^select\b/.test(body)) return true
  return /^with\s/.test(body) && /\bselect\b/.test(body) && !WRITE_WORDS.test(body)
}

function isReadStatement(text: string): boolean {
  const statement = text.toLowerCase().replace(/\s+/g, ' ')
  const pragma = /^pragma\s+(?:\w+\s*\.\s*)?(\w+)(.*)$/.exec(statement)
  if (pragma !== null) return READ_PRAGMAS.has(pragma[1] ?? '') && !(pragma[2] ?? '').includes('=')
  return isSelect(statement)
}

function isReadDot(text: string): boolean {
  const name = /^\.(\w+)(?:\s|$)/.exec(text)?.[1]
  return name !== undefined && READ_DOT_COMMANDS.has(name)
}

/** SQL (hay lệnh chấm) của sqlite3 có chỉ đọc không. Rỗng, không đóng chuỗi, từ khóa lạ: là ghi. */
export function isReadOnlySql(sql: string): boolean {
  const items = splitInput(sql)
  if (items === null || items.length === 0) return false
  return items.every(item => (item.dot ? isReadDot(item.text) : isReadStatement(item.text)))
}
