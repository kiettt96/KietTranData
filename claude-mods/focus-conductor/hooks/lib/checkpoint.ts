// Điểm dừng bền của bảo vệ hạn mức (0.6.0): dựng, kẹp kích thước, khóa theo thư mục làm việc, chọn bản ghi bỏ đi.
// Hàm thuần, không gọi $. Không bao giờ chứa output của tool, nội dung file, biến môi trường hay token: chỉ tên tool,
// đường dẫn và đầu vào đã cắt ngắn.

import type { Brief, CheckpointBrief, DelegationItem, PlanStep, QuotaCheckpoint, QuotaReason } from '../../types'

/** Tiền tố khóa trong $.store; phần sau là băm của thư mục làm việc ($.store dùng chung mọi dự án). */
export const STORE_PREFIX = 'checkpoint:'
/** Số điểm dừng tối đa trong kho (mọi thư mục cộng lại). */
export const CHECKPOINT_LIMIT = 5
/** Kích thước tối đa của một bản ghi sau khi tuần tự hóa (ký tự JSON). */
export const CHECKPOINT_BYTES = 64 * 1024
export const NOTE_MAX = 600
export const RECENT_MAX = 5
export const RECENT_LINE_MAX = 120
export const FILES_MAX = 50

/** Băm FNV-1a 32 bit, 8 chữ số hex; không phụ thuộc crypto. */
export function hashCwd(cwd: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < cwd.length; i++) {
    hash ^= cwd.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function storeKey(cwd: string): string {
  return `${STORE_PREFIX}${hashCwd(cwd)}`
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Một dòng của năm tool call cuối: tool, đối tượng rút gọn, đánh dấu lỗi; tối đa 120 ký tự. */
export function recentLine(tool: string, target: string, isError: boolean): string {
  const tail = isError ? ' (lỗi)' : ''
  return `${clip(`${tool}${target ? ` ${target}` : ''}`, RECENT_LINE_MAX - tail.length)}${tail}`
}

function briefOf(brief: Brief | null): CheckpointBrief {
  if (brief === null) return { goal: '', constraints: [], quality: [], scopePaths: [], tasks: [], kind: 'mixed' }
  return {
    goal: brief.goal,
    constraints: [...brief.constraints],
    quality: [...brief.quality],
    scopePaths: [...brief.scopePaths],
    tasks: brief.tasks.map(t => ({ index: t.index, title: t.title, run: t.run, ...(t.agentType ? { agentType: t.agentType } : {}), pick: t.pick })),
    kind: brief.kind,
  }
}

export type CheckpointInput = {
  id: string
  now: number
  cwd: string
  reason: QuotaReason[]
  brief: Brief | null
  plan: readonly PlanStep[]
  delegations: readonly DelegationItem[]
  recent: readonly string[]
  files: ReadonlyArray<{ path: string; mtimeMs: number; size: number }>
  denied: { tool: string; input: string } | null
}

/** Điểm dừng mới (trạng thái open, chưa có note): giai đoạn một, mod tự ghi khi vào vùng dừng. */
export function buildCheckpoint(input: CheckpointInput): QuotaCheckpoint {
  return clampCheckpoint({
    version: 1,
    id: input.id,
    createdAt: input.now,
    cwd: input.cwd,
    status: 'open',
    reason: input.reason.map(r => ({ ...r })),
    brief: briefOf(input.brief),
    plan: input.plan.map(s => ({ ...s })),
    doing: input.plan.filter(s => s.status === 'doing').map(s => s.id),
    note: '',
    denied: input.denied,
    recent: input.recent.slice(-RECENT_MAX).map(line => clip(line, RECENT_LINE_MAX)),
    files: input.files.slice(-FILES_MAX).map(f => ({ ...f })),
    delegations: input.delegations.map(d => ({ ...d })),
  })
}

/** Giai đoạn hai: câu Claude ghi về bước kế tiếp, kẹp NOTE_MAX ký tự. */
export function withNote(cp: QuotaCheckpoint, note: string): QuotaCheckpoint {
  return clampCheckpoint({ ...cp, note: note.trim().slice(0, NOTE_MAX) })
}

/** Bản ghi vượt CHECKPOINT_BYTES thì cắt recent, rồi files, rồi note, theo thứ tự đó, tới khi vừa. */
export function clampCheckpoint(cp: QuotaCheckpoint): QuotaCheckpoint {
  const size = (c: QuotaCheckpoint) => JSON.stringify(c).length
  let out = cp
  if (size(out) <= CHECKPOINT_BYTES) return out
  out = { ...out, recent: [] }
  while (size(out) > CHECKPOINT_BYTES && out.files.length > 0) out = { ...out, files: out.files.slice(1) }
  while (size(out) > CHECKPOINT_BYTES && out.note.length > 0) out = { ...out, note: out.note.slice(0, Math.floor(out.note.length / 2)) }
  return out
}

/**
 * Khóa cần xóa để kho còn tối đa CHECKPOINT_LIMIT điểm dừng: consumed cũ nhất trước, rồi open (hay resuming) cũ nhất;
 * không bao giờ xóa `keep` (bản vừa ghi).
 */
export function pruneKeys(entries: ReadonlyArray<{ key: string; status: QuotaCheckpoint['status']; createdAt: number }>, keep: string): string[] {
  const extra = entries.length - CHECKPOINT_LIMIT
  if (extra <= 0) return []
  const byAge = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt
  const candidates = [
    ...entries.filter(e => e.status === 'consumed' && e.key !== keep).sort(byAge),
    ...entries.filter(e => e.status !== 'consumed' && e.key !== keep).sort(byAge),
  ]
  return candidates.slice(0, extra).map(e => e.key)
}

/** /conductor resume force khi không cửa sổ nào có mốc làm mới: ép tiếp trong bấy nhiêu ms. */
export const FORCE_FALLBACK_MS = 4 * 3_600_000

/** File có thay đổi sau lúc dừng: mtime hay size khác, hoặc không còn (stat null hay vắng). */
export function changedFiles(
  files: ReadonlyArray<{ path: string; mtimeMs: number; size: number }>,
  stats: ReadonlyMap<string, { mtimeMs: number; size: number } | null>,
): string[] {
  return files.filter(f => {
    const now = stats.get(f.path)
    return now === undefined || now === null || now.mtimeMs !== f.mtimeMs || now.size !== f.size
  }).map(f => f.path)
}

/** Mốc hết ép tiếp: mốc làm mới sớm nhất (còn trong tương lai) của các cửa sổ đang dừng, không có thì bốn giờ sau. */
export function forceUntil(reasons: readonly QuotaReason[], now: number): number {
  const resets = reasons.map(r => (r.resetsAt !== undefined ? Date.parse(r.resetsAt) : Number.NaN)).filter(t => Number.isFinite(t) && t > now)
  return resets.length > 0 ? Math.min(...resets) : now + FORCE_FALLBACK_MS
}

/** Dựng lại Brief đủ trường từ điểm dừng (phiên mới): không có lựa chọn model của router (mod không ép tới prompt sau). */
export function briefFromCheckpoint(cp: QuotaCheckpoint, now: number): Brief {
  const tasks = cp.brief.tasks.map(t => ({
    index: t.index,
    title: t.title,
    run: t.run,
    ...(t.agentType ? { agentType: t.agentType } : {}),
    pick: t.pick,
    depth: 'substantial' as const,
    volume: 'medium' as const,
    kind: 'edit' as const,
    why: 'khôi phục từ điểm dừng',
  }))
  return {
    goalId: 0,
    goal: cp.brief.goal || 'Tiếp tục từ điểm dừng',
    steps: cp.plan.map(s => s.title),
    tasks,
    constraints: [...cp.brief.constraints],
    quality: [...cp.brief.quality],
    depth: 'substantial',
    volume: 'medium',
    kind: cp.brief.kind,
    tier: 'complex',
    main: null,
    why: 'khôi phục từ điểm dừng',
    relation: 'continue',
    source: 'none',
    isFollowUp: true,
    isReference: false,
    scopePaths: [...cp.brief.scopePaths],
    prompt: '',
    at: now,
  }
}

/** Ghi một tool call vào năm tool call cuối (chỉ luồng chính). */
export function pushRecent(recent: readonly string[], line: string): string[] {
  return [...recent, line].slice(-RECENT_MAX)
}

/** Ghi các file vừa thấy bị sửa trong mục tiêu goalId; đổi mục tiêu thì bắt đầu lại. Tối đa FILES_MAX, mới nhất sau cùng. */
export function addTouched(touched: { goalId: number; paths: readonly string[] }, goalId: number, paths: readonly string[]): { goalId: number; paths: string[] } {
  const kept = touched.goalId === goalId ? touched.paths.filter(p => !paths.includes(p)) : []
  return { goalId, paths: [...kept, ...paths].slice(-FILES_MAX) }
}
