// Lệnh Bash nội dòng chỉ đọc: sqlite3 và python/python3/python3.N với mã nằm ngay trong lệnh (-c, đối số SQL, heredoc).
// Script nằm trong tệp thì không thấy được nên vẫn là ghi có thể. Mặc định là ghi; hàm ở đây thuần, không gọi $.

import { isReadOnlySql } from './inline-sql'
import { isReadOnlyPython } from './inline-py'

export { isReadOnlySql, isReadOnlyPython }

/** Cờ định dạng đầu ra của sqlite3 (không giá trị đi kèm), và cờ nhận một giá trị. Cờ lạ (-init, -cmd...) là ghi. */
const SQLITE_FLAGS = new Set([
  '-readonly', '-batch', '-header', '-noheader', '-csv', '-column', '-json', '-line', '-list', '-markdown', '-table', '-box', '-html', '-tabs', '-bail', '-echo',
])
const SQLITE_VALUE_FLAGS = new Set(['-nullvalue', '-separator'])
const PYTHON_NAME = /^python(?:3(?:\.\d+)?)?$/

function isReadOnlySqlite(args: string[], heredocs: string[], unmask: (token: string) => string): boolean {
  const values = args.map(unmask)
  if (values.length === 1 && /^--?version$/.test(values[0] ?? '')) return heredocs.length === 0
  const statements: string[] = []
  let hasDatabase = false
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? ''
    if (value.startsWith('-')) {
      const flag = value.replace(/^--?/, '-')
      if (SQLITE_VALUE_FLAGS.has(flag) && i + 1 < values.length) i += 1
      else if (!SQLITE_FLAGS.has(flag)) return false
    } else if (!hasDatabase) hasDatabase = true
    else if (/[$\\]/.test(value)) return false
    else statements.push(value)
  }
  if (heredocs.length > 1) return false
  const sources = [...statements, ...heredocs]
  return sources.length > 0 && sources.every(isReadOnlySql)
}

function isReadOnlyPythonCall(args: string[], heredocs: string[], unmask: (token: string) => string): boolean {
  const values = args.map(unmask)
  if (values.length === 1 && /^(?:--version|-V|-VV)$/.test(values[0] ?? '')) return heredocs.length === 0
  let code: string | undefined
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? ''
    if (value === '-c' || value === '-') {
      // Sau mã (-c) hay stdin (-) chỉ còn đối số của chương trình: không phân tích được.
      const used = value === '-c' ? 2 : 1
      if (i + used < values.length || (value === '-c' && i + 1 >= values.length)) return false
      if (value === '-c') code = values[i + 1]
      break
    }
    if (!/^-[uBEsSIq]+$/.test(value)) return false
  }
  if (code !== undefined) return heredocs.length === 0 && !/[$\\]/.test(code) && isReadOnlyPython(code)
  return heredocs.length === 1 && isReadOnlyPython(heredocs[0] ?? '')
}

/**
 * Lệnh `name` với đối số `args` (token đã che chuỗi), thân heredoc của chính đoạn lệnh và `unmask` có chỉ đọc không:
 * true chỉ cho sqlite3 và python, python3, python3.N khi chứng minh được. Chuyển hướng, ống vào, `<` từ tệp, wrapper
 * (sudo, xargs) do nơi gọi loại trước.
 */
export function isReadOnlyInline(name: string, args: string[], heredocs: string[], unmask: (token: string) => string): boolean {
  if (name === 'sqlite3') return isReadOnlySqlite(args, heredocs, unmask)
  return PYTHON_NAME.test(name) && isReadOnlyPythonCall(args, heredocs, unmask)
}
