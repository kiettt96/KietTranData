// Lựa chọn model và effort: kiểm theo chính sách, thích nghi lúc chạy, chi phí cache.
//
// Router (router.ts) quyết định model và effort cho luồng chính và từng việc. File này
// không đọc prompt; nó chỉ:
//   - áp chính sách: model của phiên (ceiling, fixed), họ model đang bị chặn;
//   - nâng theo bằng chứng lúc chạy (lặp lỗi, vượt ngân sách) trong cùng một prompt;
//   - giữ model luồng chính khi hạ cấp không bù được chi phí ghi lại cache (giá
//     Claude API 2026-10, xem cost.ts); nâng cấp luôn được phép;
//   - khớp lời gọi Agent với việc đã phân theo cấu trúc ("Việc N", mã mục).

import type { Choice, Effort, Kind, Lift, ModelFamily, Route, Task, Tier, Volume } from '../../types'
import { SAFETY, shouldDowngrade, switchCost, turnCost } from './cost'

export type { Choice }

export const FAMILIES: readonly ModelFamily[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Ngân sách tool call theo tier (tier suy ra từ depth và volume). */
export const TOOL_BUDGET: Record<Tier, number> = { trivial: 8, simple: 15, moderate: 30, complex: 60, deep: 100 }

/** Chính sách model của phiên: auto (mod chọn), ceiling (không vượt model phiên), fixed (giữ model phiên). */
export type SessionPolicy = 'auto' | 'ceiling' | 'fixed'

export type SessionModel = { family: ModelFamily; policy: SessionPolicy }

const DEFAULT_IDS: Record<ModelFamily, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

export function familyRank(family: ModelFamily): number {
  return FAMILIES.indexOf(family)
}

export function effortRank(effort: Effort): number {
  return EFFORTS.indexOf(effort)
}

/** Thứ hạng tổng hợp: model quyết định trước, effort phân định trong cùng model. */
export function pickRank(pick: Choice): number {
  return familyRank(pick.family) * 10 + effortRank(pick.effort)
}

export function familyOf(model: string): ModelFamily | null {
  const lower = model.toLowerCase()
  return FAMILIES.find(family => lower.includes(family)) ?? null
}

export function describePick(pick: Choice): string {
  return `${pick.family}/${pick.effort}`
}

/** Đọc cấu hình "opus=claude-opus-5-5,sonnet=..." thành bảng ghi đè. */
export function parseModelMap(raw: unknown): Partial<Record<ModelFamily, string>> {
  const out: Partial<Record<ModelFamily, string>> = {}
  if (typeof raw !== 'string') return out
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=').map(s => s.trim())
    const family = FAMILIES.find(f => f === key)
    if (family && value) out[family] = value
  }
  return out
}

/** Đọc cấu hình "opus=1000000,sonnet=200000" thành cửa sổ ngữ cảnh theo họ model. */
export function parseWindows(raw: unknown): Partial<Record<ModelFamily, number>> {
  const out: Partial<Record<ModelFamily, number>> = {}
  if (typeof raw !== 'string') return out
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=').map(s => s.trim())
    const family = FAMILIES.find(f => f === key)
    const tokens = Number(value)
    if (family && Number.isFinite(tokens) && tokens > 0) out[family] = tokens
  }
  return out
}

/**
 * Model ID cho một step của luồng chính. Cùng họ với model engine đang dùng
 * thì giữ nguyên ID của engine (giữ cả hậu tố và tiền tố nhà cung cấp); khác
 * họ thì lấy ID ghi đè, hoặc ID mặc định kèm tiền tố nhà cung cấp hiện tại
 * (ví dụ "us.anthropic." trên Bedrock).
 */
export function resolveModelId(
  family: ModelFamily,
  engineModel: string,
  map: Partial<Record<ModelFamily, string>>,
): string {
  if (familyOf(engineModel) === family) return engineModel
  const override = map[family]
  if (override) return override
  const at = engineModel.indexOf('claude-')
  const prefix = at > 0 ? engineModel.slice(0, at) : ''
  return `${prefix}${DEFAULT_IDS[family]}`
}

/** Effort lên (by > 0, kẹp ở xhigh) hoặc xuống (by < 0). Max do người dùng chọn thì giữ nguyên khi lên. */
export function bumpEffort(effort: Effort, by: number): Effort {
  const cap = effortRank('xhigh')
  if (by > 0 && effortRank(effort) > cap) return effort
  const next = effortRank(effort) + by
  return EFFORTS[by > 0 ? Math.min(cap, next) : Math.max(0, next)] ?? effort
}

/**
 * Họ bị chặn (lỗi API) thì ưu tiên chất lượng: lên fable nếu được phép, nếu không thì xuống họ thấp hơn và tăng
 * effort một bậc. Mọi họ thay thế phải nằm trong chính sách của phiên: fixed thì giữ họ cố định (người dùng đã
 * chốt, không âm thầm đổi), ceiling thì không vượt trần, fable chỉ khi được phép. Không còn họ hợp lệ thì giữ nguyên.
 */
export function avoidBlocked(
  pick: Choice,
  blocked: ReadonlySet<ModelFamily>,
  ctx: { kind: Kind; allowFable: boolean; session?: SessionModel | null },
): Choice {
  if (!blocked.has(pick.family)) return pick
  const session = ctx.session ?? null
  if (session?.policy === 'fixed') return pick
  const isAllowed = (family: ModelFamily) =>
    !blocked.has(family) && (family !== 'fable' || ctx.allowFable) && applySession(family, session) === family
  if (pick.family === 'opus' && isAllowed('fable')) return { family: 'fable', effort: pick.effort }
  for (let rank = familyRank(pick.family) - 1; rank >= 0; rank--) {
    const family = FAMILIES[rank]
    if (!family || !isAllowed(family)) continue
    if (family === 'haiku' && (ctx.kind === 'edit' || ctx.kind === 'mixed')) continue
    return { family, effort: bumpEffort(pick.effort, 1) }
  }
  for (let rank = familyRank(pick.family) + 1; rank < FAMILIES.length; rank++) {
    const family = FAMILIES[rank]
    if (family && isAllowed(family)) return { family, effort: pick.effort }
  }
  return pick
}

/** Áp chính sách model của phiên lên một họ model: fixed giữ model phiên, ceiling không vượt model phiên. */
export function applySession(family: ModelFamily, session: SessionModel | null): ModelFamily {
  if (session === null || session.policy === 'auto') return family
  if (session.policy === 'fixed') return session.family
  return familyRank(family) > familyRank(session.family) ? session.family : family
}

/** Họ model cao hơn một bậc; opus chỉ lên fable khi được phép. */
function raiseFamily(family: ModelFamily, allowFable: boolean): ModelFamily {
  if (family === 'opus' && !allowFable) return 'opus'
  return FAMILIES[Math.min(FAMILIES.length - 1, familyRank(family) + 1)] ?? family
}

/**
 * Nâng lựa chọn của router theo bằng chứng lúc chạy trong cùng prompt: lặp lỗi nâng họ
 * model (mỗi bậc một họ), vượt ngân sách hoặc nhiều lỗi tool nâng effort.
 */
export function liftPick(pick: Choice, lift: Lift, allowFable: boolean): Choice {
  let family = pick.family
  for (let i = 0; i < lift.depth; i++) family = raiseFamily(family, allowFable)
  return { family, effort: bumpEffort(pick.effort, lift.effort) }
}

export type MainDecision = {
  /** Route áp cho turn này. */
  route: Route
  /** Có đổi so với route trước không. */
  isChanged: boolean
  /** Lựa chọn mong muốn bị giữ lại để bảo toàn cache. */
  isHeld: boolean
  wanted: Choice
  reason: string
}

/**
 * Quyết định model + effort của luồng chính cho một turn, theo chi phí token.
 * Nâng cấp luôn được phép. Hạ cấp chỉ khi lợi ích trong các turn còn lại vượt
 * chi phí ghi lại cache. Cache đã nguội hoặc vừa nén thì đổi không mất gì.
 */
export function decideMain(args: {
  current: Route | null
  wanted: Choice
  volume: Volume
  tier: Tier
  goalId: number
  /** Số token ngữ cảnh hiện tại. */
  context: number
  /** Cửa sổ ngữ cảnh của phiên (token). */
  window: number
  /** Số turn còn lại dự kiến: 2 cho mục tiêu mới, 1 cho tiếp nối. */
  turnsLeft: number
  /** Cache đã nguội hoặc vừa nén: đổi không mất chi phí ghi lại. */
  isFree: boolean
  calib: Record<ModelFamily, number>
  /** Phần cố định đo được của ngữ cảnh (system prompt và tools); thiếu thì dùng giả định. */
  sysTokens?: number
  /** Cửa sổ ngữ cảnh của model đích, nếu người dùng khai báo (contextWindows). */
  targetWindow?: number
}): MainDecision {
  const { current, wanted, volume, tier, goalId, context, window, turnsLeft, isFree, calib } = args
  const isSame = current !== null && current.family === wanted.family && current.effort === wanted.effort
  const fresh = (reason: string): MainDecision => ({
    route: { family: wanted.family, effort: wanted.effort, tier, goalId, reason },
    isChanged: !isSame,
    isHeld: false,
    wanted,
    reason,
  })

  if (current === null) return fresh('turn đầu tiên của phiên')
  if (isSame) return { ...fresh('giữ nguyên, đúng mức cần'), isChanged: false }
  // Model đích có cửa sổ nhỏ hơn ngữ cảnh hiện tại: không đổi, kể cả khi nâng cấp.
  if (current.family !== wanted.family && args.targetWindow !== undefined && context * SAFETY > args.targetWindow) {
    const reason = `giữ ${describePick(current)}: ngữ cảnh vượt cửa sổ của ${wanted.family}`
    return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
  }
  if (pickRank(wanted) > pickRank(current)) return fresh(`việc khó hơn, nâng cấp từ ${describePick(current)}`)
  if (current.family !== wanted.family && context * SAFETY > window) {
    const reason = `giữ ${describePick(current)}: ngữ cảnh gần đầy, chưa đổi sang ${describePick(wanted)}`
    return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
  }
  if (isFree) return fresh('cache đã nguội hoặc vừa nén, đổi không mất chi phí ghi lại')

  const rewrite = switchCost(current, wanted, context, args.sysTokens)
  const saving =
    turnCost(current.family, current.effort, volume, context, calib[current.family]) -
    turnCost(wanted.family, wanted.effort, volume, context, calib[wanted.family])
  if (saving > 0 && shouldDowngrade({ saving, rewrite, turnsLeft })) {
    return fresh(`hạ xuống ${describePick(wanted)}: tiết kiệm khoảng $${(saving * turnsLeft).toFixed(3)}, bù được chi phí ghi lại cache`)
  }
  const reason = `giữ ${describePick(current)}: hạ xuống ${describePick(wanted)} chưa đủ lợi, ghi lại cache khoảng $${rewrite.toFixed(3)}`
  return { route: { ...current, tier, goalId, reason }, isChanged: false, isHeld: true, wanted, reason }
}

/** Bỏ dấu tiếng Việt và hạ chữ thường. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Mã đầu dòng của một việc có mã ("K4.1", "2.3", "3." ), viết thường; rỗng nếu không có.
 * Số trần phải có dấu chấm, hai chấm hoặc ngoặc theo sau, để "3 file controller" không phải mã.
 */
function taskCode(text: string): string {
  return fold(text).match(/^\s*([a-z]{1,3}\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+(?=[.:)]))/)?.[1] ?? ''
}

/**
 * Mã bước của prompt có mã (0.7.5): "BƯỚC 7", "Bước 7", "Step 7" đứng đầu câu, trả số nguyên dạng chuỗi ("7");
 * rỗng nếu không có. So nguyên số, để BƯỚC 1 không khớp BƯỚC 10.
 */
export function stepCode(text: string): string {
  const found = fold(text).match(/^[\s#*>-]*(?:buoc|step)\s*#?\s*(\d+)\b/)?.[1]
  return found === undefined ? '' : String(Number(found))
}

/**
 * Tiêu đề (của việc hay của bước checklist) có mã để khớp với nhau (0.7.5): mã mục (K4.1), "BƯỚC N" hay "Việc N" đứng đầu.
 * Tiêu đề không mã chỉ khớp được theo ý, mà mod không đoán.
 */
export function hasTitleCode(text: string): boolean {
  return taskCode(text) !== '' || stepCode(text) !== '' || /^\s*(?:viec|task)\s*#?\s*\d+\b/.test(fold(text))
}

/** Ngưỡng ghi log "gần giống" theo tên việc (hệ số Dice trên từ có nghĩa). Chỉ để ghi log, không dùng để khớp. */
const TITLE_NEAR = 0.5
const FILLER = new Set(['va', 'cho', 'cac', 'trong', 'mot', 'nhung', 'cua', 'voi', 'the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'a', 'an'])

/** Từ có nghĩa của một câu (bỏ dấu, viết thường), bỏ tiền tố "Việc N:" và mã mục. */
function words(text: string): Set<string> {
  const body = fold(text).replace(/^\s*(?:(?:viec|task|buoc|step)\s*#?\s*\d+\s*[:.)-]?|[a-z]{1,3}\d+(?:\.\d+)*\s*[:.)-]?)\s*/, '')
  return new Set(body.split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !FILLER.has(w)))
}

function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0
  for (const w of a) if (b.has(w)) shared += 1
  return a.size + b.size === 0 ? 0 : (2 * shared) / (a.size + b.size)
}

export type TaskMatch = {
  task?: Task
  /** Lời gọi không khớp mà có dấu hiệu nhắm một việc đã phân: lý do, chỉ để ghi log và chỉnh dần. */
  miss?: string
}

/**
 * Việc đã phân mà một lời gọi Agent đang làm, chỉ theo cấu trúc: description mở đầu bằng "Việc N" (hoặc
 * "Task N", "Task #N"; N là số thứ tự của việc), hoặc cùng mã mục với tên việc (so nguyên mã, để K4.1 không khớp
 * K4.10), hoặc cùng mã bước "BƯỚC N" với tên việc (0.7.5; prompt không có mã bước thì "Bước N" không khớp vì dễ
 * trùng số bước của checklist). Không đoán theo ý: lời gọi không khớp được router chấm, và router
 * nhận ra nó thuộc việc nào nếu có. Không khớp mà có dấu hiệu nhắm một việc thì trả lý do để ghi log.
 */
export function taskMatch(tasks: readonly Task[], description: string): TaskMatch {
  if (tasks.length === 0) return {}
  const folded = fold(description)
  const numbered = folded.match(/^\s*(?:viec|task)\s*#?\s*(\d+)\b/)
  if (numbered) {
    const hit = tasks.find(t => t.index === Number(numbered[1]))
    if (hit) return { task: hit }
  }
  const code = taskCode(description)
  const coded = code ? tasks.find(t => taskCode(t.title) === code) : undefined
  if (coded) return { task: coded }
  if (numbered) return { miss: `không có việc ${numbered[1]}` }
  // Prompt có mã bước (0.7.5): description mở đầu bằng đúng mã bước của một việc thì khớp việc đó.
  const stepped = stepCode(description)
  const steppedTask = stepped ? tasks.find(t => stepCode(t.title) === stepped) : undefined
  if (steppedTask) return { task: steppedTask }
  if (stepped && tasks.some(t => stepCode(t.title) !== '')) return { miss: `không có việc mang mã "Bước ${stepped}"` }
  const step = folded.match(/^\s*(?:buoc|step)\s*#?\s*(\d+)\b/)
  if (step) return { miss: `"Bước ${step[1]}" là số bước của checklist, không phải số việc` }
  const asked = words(description)
  const near = tasks.map(t => ({ task: t, score: dice(words(t.title), asked) })).sort((x, y) => y.score - x.score)[0]
  return near && near.score >= TITLE_NEAR ? { miss: `tên gần giống việc ${near.task.index} (độ trùng ${near.score.toFixed(2)})` } : {}
}

/** Gập chữ để so mã: bỏ dấu, đ thành d, viết thường. */
function foldCode(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

/** Mã trong một câu: số sau BƯỚC, Step, Việc, Task (dạng "buoc7") và mã mục như "k4.2"; so theo chữ bỏ dấu, viết thường. */
export function codesIn(text: string): Set<string> {
  const folded = foldCode(text)
  const codes = new Set<string>()
  for (const m of folded.matchAll(/\b(buoc|step|viec|task)\s*#?\s*(\d+)\b/g)) codes.add(`${m[1] === 'step' ? 'buoc' : m[1] === 'task' ? 'viec' : m[1]}${Number(m[2])}`)
  for (const m of folded.matchAll(/\b([a-z]{1,3}\d+(?:\.\d+)*)\b/g)) codes.add(m[1] ?? '')
  return codes
}

/**
 * Khóa nhớ kết quả router chấm subagent (0.7.5): description bỏ chữ số (số lô, mã lô) và viết thường, loại agent, model và
 * effort Claude ghi; không gồm prompt. "Lọc tin lô 1" và "Lọc tin lô 2" dùng chung một lần chấm. `known` (R11): các mã có trong brief
 * hay checklist (briefCodes); mã ngắn như b12, l3, utf8, s3 chỉ được giữ trong khóa khi nằm trong tập này, còn lại coi như số lô.
 */
export function agentMemoKey(description: string, agentType: string | undefined, model: string | undefined, effort: string | undefined, known: ReadonlySet<string> = new Set()): string {
  // Giữ mã bước và mã việc ("BƯỚC 3", "Việc 2") và mã mục có trong brief ("K4.10"): hai bước khác nhau không dùng chung kết quả; số lô
  // và mã không có trong brief thành #.
  const shape = fold(description)
    .replace(/\b((?:buoc|step|viec|task)\s*#?\s*)(\d+)\b|\b([a-z]{1,3}\d+(?:\.\d+)*)\b|\d+/g, (_all, label: string | undefined, num: string | undefined, code: string | undefined) =>
      label !== undefined ? `${label}${num}` : code === undefined ? '#' : known.has(code) ? code : code.replace(/\d+(?:\.\d+)*/, '#'),
    )
    .replace(/\s+/g, ' ')
    .trim()
  return [shape, agentType ?? '', model ?? '', effort ?? ''].join('\n')
}

const RULE_FAMILY = /(?<![\p{L}\p{N}])(haiku|sonnet|opus|fable)(?![\p{L}\p{N}])/iu
/** Cụm "mô hình của phiên" (hay "session model") trong một ràng buộc. */
const SESSION_PHRASE = '(?:mô hình|model|mo hinh) (?:của|cua) (?:phiên|phien)|session model'
const MODEL_MENTION = `(?:haiku|sonnet|opus|fable|${SESSION_PHRASE})`
/**
 * Chữ phủ định đứng trước tên model (hay "mô hình của phiên") trong phạm vi 3 từ ("Không dùng haiku", "tránh haiku"): vế đó không phải
 * quy định model cho loại việc (H2, vòng sửa 2). Chữ phủ định ở chỗ khác ("tránh lỗi định dạng") không làm mất quy định (R6).
 */
const RULE_NEGATION = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:không|khong|đừng|cấm|chẳng|chớ|tránh|avoid|never|not|no|don't)(?![\\p{L}\\p{N}])(?:\\s+[^\\s,;，；]+){0,3}?\\s+${MODEL_MENTION}(?![\\p{L}\\p{N}])`,
  'iu',
)
/** Cắt một vế tại mỗi lần nêu model: mỗi model gắn với loại việc đứng ngay trước nó. */
const MENTION_GLOBAL = new RegExp(`(?<![\\p{L}\\p{N}])${MODEL_MENTION}(?![\\p{L}\\p{N}])`, 'giu')
/** Dấu hiệu ngoại lệ: "trừ", "ngoại trừ", "trừ khi", "except", "unless"; "khấu trừ", "cộng trừ" không phải ngoại lệ. */
const RULE_EXCEPT = /(?<![\p{L}\p{N}])(?<!(?:khấu|cộng|phép|bù)\s)(?:ngoại trừ|ngoai tru|trừ khi|tru khi|trừ|except(?: for| when)?|unless)(?![\p{L}\p{N}])/iu
const EXCEPT_THEN = /(?<![\p{L}\p{N}])(?:thì|thi|then|để)(?![\p{L}\p{N}])/iu
const EXCEPT_STOP = new Set(['khi', 'neu', 'if', 'when', 'for', 'la', 'is', 'are', 'it', 'this', 'that', 'the', 'an', 'a', 'cho', 'cac', 'viec', 'voi'])
/** Từ đứng giữa loại việc và model trong một quy định ("Việc lọc tin chạy sonnet"): cắt vế tại đó để lấy loại việc. */
const RULE_CUT = /(?<![\p{L}\p{N}])(?:chạy|dùng|bằng|phải|luôn|với|haiku|sonnet|opus|fable|mô hình|model)(?![\p{L}\p{N}])/iu
/** Vế viết hoàn toàn không dấu: nhận cả "chay", "dung", "bang"... làm từ cắt (vế có dấu thì "dung" là "nội dung", không cắt). */
const RULE_CUT_ASCII = /(?<![a-z0-9])(?:chay|dung|bang|phai|luon|voi|mo hinh)(?![a-z0-9])/i
/** Nhãn đầu description không phải loại việc: "BƯỚC 3:", "Việc 4:", "K4.10". */
const LEADING_LABEL = /^\s*(?:(?:viec|task|buoc|step)\s*#?\s*\d+|[a-z]{1,3}\d+(?:\.\d+)*)\s*[:.)-]?\s*/

/** Các từ (bỏ dấu, viết thường) của một cụm; rỗng nếu không còn gì. */
function phraseWords(text: string): string[] {
  return fold(text).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
}

/** Loại việc của một vế: phần trước từ cắt, tách theo "/", "và", "hoặc"; bỏ "việc", "bước", "các" đứng đầu. */
function kindsOf(part: string): string[][] {
  const low = part.toLowerCase().normalize('NFC')
  const hasMarks = /[^\x00-\x7f]/.test(low)
  const cut = low.search(RULE_CUT)
  const ascii = hasMarks ? -1 : low.search(RULE_CUT_ASCII)
  const at = [cut, ascii].filter(n => n >= 0).sort((a, b) => a - b)[0]
  const head = at === undefined ? low : low.slice(0, at)
  return head
    .split(/\s*\/\s*|\s+(?:và|va|hoặc|hoac)\s+/u)
    .map(kind => phraseWords(kind.replace(/^\s*(?:các\s+|cac\s+)?(?:việc|viec|bước|buoc|tác vụ|tac vu|task)\s+/u, '')))
    .filter(words => words.join(' ').length >= 3)
}

/** Một cặp "loại việc, model" của ràng buộc (R6). */
type Clause = {
  /** Đoạn chữ của cặp, từ sau nhau cắt trước đó đến chỗ nêu model. */
  text: string
  /** Họ model nêu tên, hay 'session' cho "mô hình của phiên". */
  family: ModelFamily | 'session'
  /** Các loại việc của cặp, gồm cả loại việc đứng trước chưa nêu model ("đọc, giải thích dùng model của phiên"). */
  kinds: string[][]
  /**
   * Từ khóa của các vế ngoại lệ ("trừ khi tin pháp lý": tin, pháp, lý; vế ghi đè "Riêng tin pháp lý ..." của S3); việc có đủ các từ của
   * một trong các vế này không bị chốt.
   */
  excepts: string[][]
}

/**
 * Vế ghi đè mở đầu bằng "riêng", "đặc biệt", "nhưng", "còn" (không phải "còn lại") hay "for ... only" (S3, vòng rà soát 4): là ngoại lệ
 * của các cặp đứng trước trong cùng ràng buộc. Nhóm 1 là phần giữa "for" và "only".
 */
const RULE_OVERRIDE = /^\s*(?:riêng|rieng|đặc biệt|dac biet|nhưng|nhung|còn(?!\s+lại)|for\s+(.+?)\s+only)(?![\p{L}\p{N}])/iu
/** Từ nối đứng ngay trước model thứ hai ("sonnet hoặc opus"): hai model là lựa chọn, không phải quy định (S3). */
const MODEL_CHOICE = /^\s*(?:hoặc|hoac|hay|or)\s*$/iu

/** Từ khóa của vế ngoại lệ: phần đầu vế đến từ cắt, "thì" hay dấu phẩy, bỏ từ nối. */
function exceptionWords(text: string): string[] {
  const cuts = [text.search(RULE_CUT), text.search(EXCEPT_THEN), text.search(/[,，]/)].filter(n => n >= 0)
  const head = cuts.length > 0 ? text.slice(0, Math.min(...cuts)) : text
  return phraseWords(head).filter(word => !EXCEPT_STOP.has(word))
}

/**
 * Tách một ràng buộc thành các cặp (R6): vế theo ".", ":", ";" và xuống dòng (dấu chấm chỉ tách khi theo sau là khoảng trắng hay hết
 * chuỗi, để "0.5" và "a.ts" không bị tách), rồi theo dấu phẩy, rồi theo mỗi lần nêu model. Loại việc của cặp là phần chữ trước từ
 * cắt; vế không nêu model ("đọc" trong "đọc, giải thích dùng model của phiên") dùng model của cặp kế tiếp. Vế phủ định bị bỏ. Vế có
 * dấu hiệu ngoại lệ chỉ lấy cặp ở phần không phải ngoại lệ và ghi từ khóa của ngoại lệ vào mỗi cặp.
 */
function ruleClauses(rule: string): Clause[] {
  const clauses: Clause[] = []
  for (const raw of rule.normalize('NFC').split(/[;；\n]|\.(?=\s|$)/u)) {
    let segment = raw
    let phrase: string[] = []
    const marker = RULE_EXCEPT.exec(segment)
    if (marker !== null) {
      // Vế ngoại lệ dừng ở dấu phẩy đầu tiên; phần sau dấu phẩy, và phần trước dấu hiệu, là các cặp khác.
      const before = segment.slice(0, marker.index)
      const after = segment.slice(marker.index + marker[0].length)
      const comma = after.search(/[,，]/)
      phrase = exceptionWords(comma < 0 ? after : after.slice(0, comma))
      segment = comma < 0 ? before : `${before},${after.slice(comma + 1)}`
    }
    const first = clauses.length
    let pending: string[][] = []
    for (const raw of segment.split(/[,，]/)) {
      // Vế ghi đè (S3): từ khóa của nó là ngoại lệ của mọi cặp đứng trước; phần còn lại của vế đọc như vế thường.
      let part = raw
      const override = RULE_OVERRIDE.exec(part)
      if (override !== null) {
        const rest = part.slice(override[0].length)
        const words = exceptionWords(override[1] ?? rest)
        if (words.length > 0) for (const clause of clauses) clause.excepts.push(words)
        part = rest
      }
      let last = 0
      const pieces: { text: string; mention: string | null }[] = []
      for (const match of part.matchAll(MENTION_GLOBAL)) {
        const end = (match.index ?? 0) + match[0].length
        pieces.push({ text: part.slice(last, end), mention: match[0] })
        last = end
      }
      if (last < part.length) pieces.push({ text: part.slice(last), mention: null })
      for (const piece of pieces) {
        // Nhãn trước dấu hai chấm ("Quy định: lọc tin dùng sonnet") bỏ đi khi phần sau tự có loại việc.
        const colon = piece.text.indexOf(':')
        const text = colon >= 0 && kindsOf(piece.text.slice(colon + 1)).length > 0 ? piece.text.slice(colon + 1) : piece.text
        if (piece.mention === null) {
          pending = [...pending, ...kindsOf(text)]
          continue
        }
        if (RULE_NEGATION.test(text)) {
          pending = []
          continue
        }
        // "sonnet hoặc opus" (S3): hai model là lựa chọn, cặp trước trong cùng vế (cả qua dấu phẩy) bị bỏ và không chốt model nào.
        if (MODEL_CHOICE.test(text.slice(0, text.length - piece.mention.length)) && clauses.length > first) {
          clauses.pop()
          pending = []
          continue
        }
        const family = RULE_FAMILY.exec(piece.mention)?.[1]?.toLowerCase() as ModelFamily | undefined
        clauses.push({ text, family: family ?? 'session', kinds: [...pending, ...kindsOf(text)], excepts: [] })
        pending = []
      }
    }
    if (phrase.length > 0) for (const clause of clauses.slice(first)) clause.excepts.push(phrase)
  }
  return clauses
}

/**
 * Họ model mà ràng buộc của brief quy định cho loại việc của một lời gọi Agent (0.7.5): ràng buộc tách thành các cặp (ruleClauses),
 * mỗi cặp nêu một họ model (hay "mô hình của phiên", khi biết model của phiên) cho loại việc đứng trước nó ("Việc lọc tin chạy
 * sonnet": "lọc tin"). Loại việc phải là các từ trọn vẹn ở đầu description, sau nhãn "BƯỚC N:" hay "Việc N:". Vế phủ định bị bỏ
 * (H2). Description có đủ từ khóa của vế ngoại lệ ("trừ khi tin pháp lý") không bị chốt, để router chấm (R6). Không có thì null.
 */
export function ruleFamily(constraints: readonly string[], description: string, session: ModelFamily | null): ModelFamily | null {
  const asked = phraseWords(fold(description).replace(LEADING_LABEL, ''))
  // Description còn nguyên nhãn (T1): ngoại lệ nêu mã bước ("Riêng BƯỚC 3") so trên đây, các từ trọn vẹn và liền nhau.
  const full = phraseWords(fold(description))
  const startsWith = (kind: string[]) => kind.length > 0 && kind.every((word, i) => asked[i] === word)
  const isExcepted = (words: string[]) =>
    words.every(word => asked.includes(word)) || full.some((_, at) => words.every((word, i) => full[at + i] === word))
  for (const rule of constraints) {
    for (const clause of ruleClauses(rule)) {
      const family = clause.family === 'session' ? session : clause.family
      if (family === null || !clause.kinds.some(startsWith)) continue
      if (clause.excepts.some(isExcepted)) continue
      return family
    }
  }
  return null
}

/** Loại việc "bắt tất cả": luồng chính hay mọi việc khác, nghĩa là cả luồng chính chịu quy định model đó. */
const CATCH_ALL = /(?<![\p{L}\p{N}])(?:luồng chính|luong chinh|main(?: thread)?|mọi việc|moi viec|tất cả|tat ca|các việc (?:khác|còn lại)|việc (?:khác|còn lại)|còn lại|con lai|everything|all (?:other )?(?:work|tasks)|the rest)(?![\p{L}\p{N}])/iu

/**
 * Loại việc luồng chính tự làm (R4): đọc, giải thích, đúc kết, tổng hợp, tóm tắt, viết, sửa, và cụm tiếng Anh reading, synthesis, summary,
 * explain, write cùng các dạng của chúng (S9); không dấu, so với từ đầu của loại việc.
 */
const MAIN_KINDS = [
  'doc', 'giai thich', 'duc ket', 'tong hop', 'tom tat', 'viet', 'sua',
  // Tiếng Anh (S9).
  'read', 'reading', 'synthesis', 'synthesize', 'summary', 'summarize', 'explain', 'explanation', 'write', 'writing',
]

/**
 * Sàn main theo model của phiên (0.7.5, vòng sửa 2 và R4): một ràng buộc của brief nêu "mô hình của phiên" (hay "session model") cho
 * luồng chính, cho mọi việc không nêu model khác, hay cho loại việc mà luồng chính tự làm (đọc, giải thích, đúc kết, tổng hợp, viết,
 * sửa) thì luồng chính không được thấp hơn model của phiên. Trả họ của phiên, hay null khi không có quy định như vậy hoặc chưa biết
 * model của phiên (không tự nâng). Quy định cho loại việc của subagent ("lọc tin dùng model của phiên") và quy định có chữ phủ định
 * không tính.
 */
export function sessionFloor(constraints: readonly string[], session: ModelFamily | null): ModelFamily | null {
  const mainKind = (kind: string[]) => MAIN_KINDS.some(verb => kind.join(' ') === verb || kind.join(' ').startsWith(`${verb} `))
  for (const rule of constraints) {
    for (const clause of ruleClauses(rule)) {
      if (clause.family === 'session' && (CATCH_ALL.test(clause.text) || clause.kinds.some(mainKind))) return session
    }
  }
  return null
}

export function matchTask(tasks: readonly Task[], description: string): Task | undefined {
  return taskMatch(tasks, description).task
}
