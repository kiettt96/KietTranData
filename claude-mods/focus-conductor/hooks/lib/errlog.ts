// Nhật ký lỗi của chính mod (0.7.9 L1): mỗi loại lỗi một mục, khóa gồm nhóm, nơi xảy ra và thông điệp đã chuẩn hóa. Hàm thuần ở đây
// không gọi `$`; phần đọc ghi file nằm ở hooks/context.ts. Nhật ký không bao giờ được chèn vào context của model.

/** Bốn nhóm lỗi của mod: hook ném lỗi, router lỗi, engine từ chối hay trả khác khai báo, trạng thái phải sửa kiểu. */
export type ErrorGroup = 'hook' | 'router' | 'engine' | 'state'

export type ErrorEntry = {
  key: string
  group: ErrorGroup
  where: string
  message: string
  firstSeen: string
  lastSeen: string
  firstVersion: string
  lastVersion: string
  count: number
  hint?: string
  regressed?: boolean
}

export type ErrorFile = { dropped: number; entries: ErrorEntry[] }

/** Một lỗi vừa gặp, trước khi gộp vào nhật ký. */
export type ErrorEvent = { group: ErrorGroup; where: string; message: string; hint?: string }

/** Mục trong sổ lỗi đã sửa (hooks/lib/fixed-errors.ts). */
export type FixedError = { key: string; fixedIn: string; note: string }

export const ERROR_CAP = 200
export const MESSAGE_MAX = 200
export const KEY_MESSAGE_MAX = 160
export const EMPTY_ERRORS: ErrorFile = { dropped: 0, entries: [] }
const GROUPS: ReadonlySet<string> = new Set(['hook', 'router', 'engine', 'state'])

/**
 * Chuẩn hóa thông điệp: đường dẫn tuyệt đối thành `<path>`, uuid và mã băm thành `<id>`, thời gian ISO thành `<time>`, số thành `<n>`,
 * gộp khoảng trắng, cắt MESSAGE_MAX ký tự. Đường dẫn thay trước để số trong đường dẫn không thành `<n>`.
 */
export function normalizeMessage(raw: string): string {
  return raw
    .replace(/(^|[\s"'`(=:,[])(?:\/[^\s"'`()[\],:]+|[A-Za-z]:\\[^\s"'`()[\],]+|~\/[^\s"'`()[\],:]+)/g, '$1<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/gi, '<id>')
    .replace(/\b(?:toolu|agent|session|req|msg|call)_[A-Za-z0-9]+/g, '<id>')
    .replace(/\d+(?:\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
}

/** Khóa loại lỗi: nhóm, nơi xảy ra, thông điệp đã chuẩn hóa cắt KEY_MESSAGE_MAX ký tự. */
export function errorKey(group: ErrorGroup, where: string, message: string): string {
  return `${group}|${where}|${normalizeMessage(message).slice(0, KEY_MESSAGE_MAX)}`
}

/** Thông điệp của một giá trị bị ném: Error lấy message, chuỗi giữ nguyên, còn lại theo String; không có gì thì "không rõ". */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : error === undefined || error === null ? '' : String(error)
  return text.trim() === '' ? 'không rõ' : text
}

/** Gộp một lỗi vào nhật ký: cùng khóa thì tăng count, cập nhật lastSeen và lastVersion; khóa mới thì thêm mục. Không đổi `file`. */
export function mergeEntry(file: ErrorFile, event: ErrorEvent, now: string, version: string): ErrorFile {
  const key = errorKey(event.group, event.where, event.message)
  const index = file.entries.findIndex(entry => entry.key === key)
  if (index >= 0) {
    const old = file.entries[index]!
    const entry: ErrorEntry = { ...old, count: old.count + 1, lastSeen: now, lastVersion: version }
    return { ...file, entries: file.entries.map((item, i) => (i === index ? entry : item)) }
  }
  const entry: ErrorEntry = {
    key,
    group: event.group,
    where: event.where,
    message: normalizeMessage(event.message),
    firstSeen: now,
    lastSeen: now,
    firstVersion: version,
    lastVersion: version,
    count: 1,
    ...(event.hint !== undefined ? { hint: event.hint } : {}),
  }
  return capEntries({ ...file, entries: [...file.entries, entry] })
}

/** Gặp lại một mục đã có (khi gộp hai bản nhật ký): cộng count, lấy lastSeen và lastVersion mới hơn. */
function combine(a: ErrorEntry, b: ErrorEntry): ErrorEntry {
  const later = b.lastSeen >= a.lastSeen ? b : a
  const earlier = b.firstSeen < a.firstSeen ? b : a
  return {
    ...a,
    count: a.count + b.count,
    firstSeen: earlier.firstSeen,
    firstVersion: earlier.firstVersion,
    lastSeen: later.lastSeen,
    lastVersion: later.lastVersion,
    ...(a.regressed === true || b.regressed === true ? { regressed: true } : {}),
  }
}

/** Gộp bản đệm vào bản trên đĩa theo khóa, rồi áp trần. */
export function mergeFiles(disk: ErrorFile, buffered: ErrorFile): ErrorFile {
  const entries = [...disk.entries]
  for (const entry of buffered.entries) {
    const index = entries.findIndex(item => item.key === entry.key)
    if (index >= 0) entries[index] = combine(entries[index]!, entry)
    else entries.push(entry)
  }
  return capEntries({ dropped: disk.dropped + buffered.dropped, entries })
}

/** Trần ERROR_CAP loại: bỏ các loại có lastSeen cũ nhất, cộng số loại đã bỏ vào `dropped`. */
export function capEntries(file: ErrorFile, cap = ERROR_CAP): ErrorFile {
  if (file.entries.length <= cap) return file
  const extra = file.entries.length - cap
  const oldest = new Set([...file.entries].sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : a.lastSeen > b.lastSeen ? 1 : 0)).slice(0, extra).map(entry => entry.key))
  return { dropped: file.dropped + extra, entries: file.entries.filter(entry => !oldest.has(entry.key)) }
}

/** So hai phiên bản dạng a.b.c theo từng số; phần thiếu là 0. */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(part => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * Tự xóa lỗi đã sửa lúc mở phiên: mục có khóa trong sổ, fixedIn không quá bản đang chạy, lastVersion trước fixedIn thì xóa; mục trong
 * sổ mà gặp lại từ fixedIn trở lên thì giữ, đặt regressed. Mục không có trong sổ luôn giữ.
 */
export function pruneFixed(file: ErrorFile, version: string, fixed: readonly FixedError[]): ErrorFile {
  const byKey = new Map(fixed.map(item => [item.key, item]))
  const entries: ErrorEntry[] = []
  for (const entry of file.entries) {
    const item = byKey.get(entry.key)
    if (item === undefined) {
      entries.push(entry)
      continue
    }
    if (compareVersion(entry.lastVersion, item.fixedIn) >= 0) entries.push({ ...entry, regressed: true })
    else if (compareVersion(item.fixedIn, version) > 0) entries.push(entry)
  }
  return { ...file, entries }
}

/** Đọc file nhật ký, bỏ qua mục hỏng; nội dung không phải JSON thì nhật ký rỗng. */
export function parseErrorFile(text: string): ErrorFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return EMPTY_ERRORS
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_ERRORS
  const record = raw as { dropped?: unknown; entries?: unknown }
  const dropped = typeof record.dropped === 'number' && Number.isFinite(record.dropped) && record.dropped >= 0 ? Math.floor(record.dropped) : 0
  const entries = Array.isArray(record.entries) ? record.entries.filter(isEntry) : []
  return { dropped, entries }
}

function isEntry(value: unknown): value is ErrorEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const strings = ['key', 'where', 'message', 'firstSeen', 'lastSeen', 'firstVersion', 'lastVersion']
  return strings.every(name => typeof v[name] === 'string') && GROUPS.has(String(v['group'])) && typeof v['count'] === 'number'
}

/** Nội dung file nhật ký: `dropped` ở đầu, rồi các mục. */
export function errorFileText(file: ErrorFile): string {
  return `${JSON.stringify({ dropped: file.dropped, entries: file.entries }, null, 2)}\n`
}

// ------------------------------------------------------------------ bộ nhận lỗi

/** Nơi nhận lỗi của mod: hooks/context.ts đặt khi tạo ngữ cảnh (mỗi lần nạp mod), các hook gọi qua noteModError. */
type Sink = (event: ErrorEvent) => void
let sink: Sink | null = null

export function setErrorSink(next: Sink | null): void {
  sink = next
}

/** Báo một lỗi của mod; mọi lỗi của chính bộ nhận bị nuốt để không làm hỏng hook đang chạy. */
export function noteModError(event: ErrorEvent): void {
  try {
    sink?.(event)
  } catch {
    // Bộ ghi không được làm hỏng hook đang chạy.
  }
}

/** Lỗi của một hook, lấy từ `next.error` (HookFailure: kind, message) của handler `.catch`. */
export function noteHookError(where: string, failure: { readonly kind: string; readonly message?: string } | undefined): void {
  if (NO_IMPLEMENTATION.test(failure?.message ?? '')) return
  noteModError({ group: 'hook', where, message: failure?.message ?? failure?.kind ?? 'không rõ' })
}

/** Đọc file hay khóa chưa có: kết quả bình thường của lần chạy đầu, không phải lỗi của mod. */
const MISSING = /ENOENT|no such file|not found|does not exist|không tồn tại/i
const MAY_MISS = /^(?:fs\.read|fs\.stat|store\.get)\b/
/** Engine không có cài đặt cho lời gọi trên bề mặt này (kit test báo "no implementation for <op>"): mod đã có nhánh thay thế, không ghi. */
const NO_IMPLEMENTATION = /^no implementation for /i

/**
 * Handler `.catch` của một lời gọi bị từ chối: ghi lỗi (mặc định nhóm engine) rồi trả `value` như handler cũ. Đọc file chưa có không ghi.
 */
export function caught<T>(where: string, value: T, group: ErrorGroup = 'engine'): (error: unknown) => T {
  return error => {
    const message = messageOf(error)
    if (NO_IMPLEMENTATION.test(message)) return value
    if (!(MAY_MISS.test(where) && MISSING.test(message))) noteModError({ group, where, message })
    return value
  }
}

/** Các trường có mặt mà sai kiểu so với bản mặc định (0.7.9 L1 nhóm state): null của bản mặc định nhận mọi kiểu. */
export function mistypedFields(raw: unknown, template: Record<string, unknown>): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const kind = (value: unknown) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)
  const out: string[] = []
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || !(name in template)) continue
    const want = kind(template[name])
    if (want === 'null' || value === null) continue
    if (kind(value) !== want) out.push(name)
  }
  return out
}

/** Giờ ISO theo múi giờ của máy, kèm độ lệch (ví dụ 2026-11-05T15:20:00+07:00). */
export function localIso(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

/** Dòng của `/conductor errors`: tối đa `limit` loại, mới nhất trước. */
export function errorLines(file: ErrorFile, limit = 20): string[] {
  const sorted = [...file.entries].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0)).slice(0, limit)
  return sorted.map(
    entry => `${entry.group} · ${entry.where} · ${entry.message} · ${entry.count} lần · ${entry.lastSeen}${entry.regressed === true ? ' · gặp lại sau bản sửa' : ''}`,
  )
}

/** Báo từng trường sai kiểu của trạng thái đã lưu (nhóm state; nơi là hàm chuẩn hóa sẽ phải sửa trường đó). */
export function noteMistyped(where: string, raw: unknown, template: object): void {
  for (const name of mistypedFields(raw, template as Record<string, unknown>)) noteModError({ group: 'state', where, message: `trường ${name} sai kiểu` })
}
