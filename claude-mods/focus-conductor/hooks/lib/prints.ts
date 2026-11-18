// Dấu của các file đang được duyệt (0.9.0, C2 đổi cách làm): mod không chứng minh lệnh shell của vai chỉ đọc là không ghi, mà đo thay đổi
// thật của các file trong tập. Hàm thuần, cộng một hàm chụp dấu nhận fs truyền vào (`$` không đi qua import). Hook ở parts/agents.ts (chụp
// khi sinh), parts/consistency.ts (chụp khi hoàn tất, xét lại ở cổng đóng).

import { hashCwd } from './checkpoint'
import { isSoftPath } from './drift/soft'
import { isRoleTemp, isSidePath } from './drift/scope'
import type { SideLists } from './drift/scope'

/** Trần số file của tập dấu; vượt thì lấy các file đổi gần nhất. */
export const PRINT_FILES = 300
/** File không quá ngần này byte thì dấu có thêm mã băm nội dung. */
export const HASH_BYTES = 256 * 1024
/** Thư mục phụ thuộc và sản phẩm build: không vào tập dấu. */
const DEP_DIRS = /(?:^|\/)(?:node_modules|dist|build|\.git)(?:\/|$)/

/** Dấu của một file: kích thước, thời điểm sửa, mã băm nội dung khi file nhỏ; hay file không còn đọc được. */
export type FilePrint = { size: number; mtimeMs: number; hash?: string } | { missing: true }
/** Dấu của cả tập, theo đường dẫn. */
export type PrintSet = Record<string, FilePrint>
/** Phần fs mà hàm chụp dấu cần. */
export type PrintFs = { stat: (path: string) => Promise<{ size: number; mtimeMs: number; kind?: string }>; read: (path: string) => Promise<string> }

/**
 * Tập file của dấu: file không nhẹ trong sổ file đã đổi, không gồm tệp trạng thái, nơi ghi phụ, thư mục tạm, thư mục phụ thuộc và sản phẩm
 * build. Sổ theo thứ tự đổi; trùng thì giữ lần đổi cuối; quá PRINT_FILES thì lấy các file đổi gần nhất (isCapped).
 */
export function printTargets(changed: readonly string[], lists: SideLists | null | undefined): { files: string[]; isCapped: boolean } {
  const order: string[] = []
  for (const path of changed) {
    if (path === '' || isSoftPath(path) || isRoleTemp(path) || DEP_DIRS.test(path) || isSidePath(path, lists ?? null)) continue
    const at = order.indexOf(path)
    if (at >= 0) order.splice(at, 1)
    order.push(path)
  }
  return order.length > PRINT_FILES ? { files: order.slice(-PRINT_FILES), isCapped: true } : { files: order, isCapped: false }
}

/** Lỗi fs báo file không có (ENOENT, ENOTDIR): file đã xóa. Lỗi khác là fs không đo được. */
const isMissingError = (error: unknown) => /\b(?:ENOENT|ENOTDIR)\b/.test(String((error as { message?: unknown })?.message ?? error))

/**
 * Chụp dấu của tập file. Trả null khi fs không đo được (engine không có fs hay lỗi khác ENOENT): khi đó mod chạy theo sổ thay đổi. File không
 * còn hay không phải file thường thì là `missing`.
 */
export async function takePrints(fs: PrintFs, files: readonly string[], root: string | null = null, previous: PrintSet = {}): Promise<PrintSet | null> {
  const out: PrintSet = {}
  // Sổ thay đổi giữ đường dẫn tương đối theo thư mục gốc: stat theo dạng tuyệt đối khi biết thư mục gốc.
  const at = (path: string) => (root !== null && root !== '' && !path.startsWith('/') ? `${root.replace(/\/+$/, '')}/${path}` : path)
  for (const path of files) {
    let stat: { size: number; mtimeMs: number; kind?: string }
    try {
      stat = await fs.stat(at(path))
    } catch (error) {
      if (!isMissingError(error)) return null
      out[path] = { missing: true }
      continue
    }
    if (stat.kind !== undefined && stat.kind !== 'file') {
      out[path] = { missing: true }
      continue
    }
    let hash: string | undefined
    // Dùng lại mã băm đã lưu khi kích thước và thời điểm sửa không đổi so với lần chụp trước (bổ sung 18/11 mục 4).
    const before = previous[path]
    if (before !== undefined && !('missing' in before) && before.hash !== undefined && before.size === stat.size && before.mtimeMs === stat.mtimeMs) hash = before.hash
    else if (stat.size <= HASH_BYTES) {
      try {
        const text = await fs.read(at(path))
        hash = `${hashCwd(text)}:${text.length}`
      } catch (error) {
        if (!isMissingError(error)) return null
        out[path] = { missing: true }
        continue
      }
    }
    out[path] = { size: stat.size, mtimeMs: stat.mtimeMs, ...(hash !== undefined ? { hash } : {}) }
  }
  return out
}

/** Hai dấu của một file khác nhau: kích thước khác; thời điểm sửa khác mà mã băm khác hay thiếu mã băm; một bên không còn. */
export function isPrintChanged(before: FilePrint | undefined, after: FilePrint | undefined): boolean {
  const gone = (print: FilePrint | undefined) => print === undefined || 'missing' in print
  if (gone(before) || gone(after)) return gone(before) !== gone(after)
  const a = before as { size: number; mtimeMs: number; hash?: string }
  const b = after as { size: number; mtimeMs: number; hash?: string }
  if (a.size !== b.size) return true
  if (a.mtimeMs === b.mtimeMs) return false
  return a.hash === undefined || b.hash === undefined || a.hash !== b.hash
}

/** File của `before` có dấu khác ở `after`, theo thứ tự của `before`. */
export function changedPrints(before: PrintSet, after: PrintSet): string[] {
  return Object.keys(before).filter(path => isPrintChanged(before[path], after[path]))
}

/** Tên file ngắn cho lý do chặn: phần sau dấu / cuối, tối đa `limit` tên. */
export function printNames(paths: readonly string[], limit = 3): string {
  return paths.slice(0, limit).map(path => path.split('/').pop() ?? path).join(', ')
}

/**
 * Dấu đã chụp của các lượt duyệt trong một mục tiêu: lúc sinh và lúc hoàn tất, theo agentId; null là fs không đo được. `stale`: lượt cổng
 * đã thấy hết hiệu lực vì dấu đổi (bổ sung 18/11 mục 3), để pane và band tính bước đóng như cổng.
 */
export type ReviewPrints = { goalId: number; spawn: Record<string, PrintSet | null>; done: Record<string, PrintSet | null>; stale: string[]; spawnSeq: Record<string, number> }
export const EMPTY_REVIEW_PRINTS: ReviewPrints = { goalId: -1, spawn: {}, done: {}, stale: [], spawnSeq: {} }
/** Số lượt giữ dấu mỗi mục tiêu. */
const PRINT_AGENTS = 40

/** Trạng thái cũ hay hỏng thành dạng dùng được (mặc định cho trạng thái của bản trước). */
export function normalizeReviewPrints(value: unknown): ReviewPrints {
  const raw = (value ?? {}) as Partial<ReviewPrints>
  const map = (v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PrintSet | null>) : {})
  return { goalId: typeof raw.goalId === 'number' ? raw.goalId : -1, spawn: map(raw.spawn), done: map(raw.done), stale: Array.isArray(raw.stale) ? raw.stale.filter((id): id is string => typeof id === 'string').slice(-PRINT_AGENTS) : [], spawnSeq: raw.spawnSeq !== null && typeof raw.spawnSeq === 'object' && !Array.isArray(raw.spawnSeq) ? (raw.spawnSeq as Record<string, number>) : {} }
}

/** Ghi dấu của một lượt; đổi mục tiêu thì bắt đầu lại; quá PRINT_AGENTS thì bỏ lượt cũ nhất. */
export function withPrint(state: ReviewPrints, goalId: number, at: 'spawn' | 'done', agentId: string, prints: PrintSet | null): ReviewPrints {
  const base = state.goalId === goalId ? state : { goalId, spawn: {}, done: {}, stale: [], spawnSeq: {} }
  const next = { ...base[at], [agentId]: prints }
  const keys = Object.keys(next)
  for (const key of keys.slice(0, Math.max(0, keys.length - PRINT_AGENTS))) delete next[key]
  return { ...base, [at]: next }
}

/** Ghi các lượt đã hết hiệu lực theo dấu (bổ sung 18/11 mục 3). */
export function withStale(state: ReviewPrints, goalId: number, agentIds: Iterable<string>): ReviewPrints {
  const base = state.goalId === goalId ? state : { goalId, spawn: {}, done: {}, stale: [], spawnSeq: {} }
  const stale = [...base.stale]
  for (const id of agentIds) if (!stale.includes(id)) stale.push(id)
  return { ...base, stale: stale.slice(-PRINT_AGENTS) }
}

/** Dấu gần nhất đã biết của mỗi file trong mục tiêu (lúc hoàn tất ưu tiên hơn lúc sinh), để dùng lại mã băm. */
export function latestPrints(state: ReviewPrints, goalId: number): PrintSet {
  const out: PrintSet = {}
  if (state.goalId !== goalId) return out
  for (const set of [...Object.values(state.spawn), ...Object.values(state.done)]) if (set !== null) Object.assign(out, set)
  return out
}

/** Mốc của sổ lúc sinh một lượt (vòng sửa 1 sau kiểm độc lập): thay đổi sau mốc này làm lượt đó không sạch. */
export function withSpawnSeq(state: ReviewPrints, goalId: number, agentId: string, seq: number): ReviewPrints {
  const base = state.goalId === goalId ? state : { goalId, spawn: {}, done: {}, stale: [], spawnSeq: {} }
  const next = { ...base.spawnSeq, [agentId]: seq }
  const keys = Object.keys(next)
  for (const key of keys.slice(0, Math.max(0, keys.length - PRINT_AGENTS))) delete next[key]
  return { ...base, spawnSeq: next }
}
