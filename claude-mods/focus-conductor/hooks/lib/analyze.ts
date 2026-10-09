// Đọc prompt trước khi làm: bóc mục tiêu cuối, các bước, ràng buộc, tiêu chí
// chất lượng và chấm độ phức tạp. Hai tầng:
//   1. analyzeHeuristic: thuần cục bộ, tất định, không tốn token, luôn chạy.
//   2. analyzerRequest + mergeAnalysis: một lượt Haiku effort low trả JSON,
//      tinh chỉnh tầng 1; lỗi hoặc quá giờ thì giữ nguyên kết quả tầng 1.

import type { ModelCompleteRequest } from 'claude-code'

import type { Brief, Tier } from '../../types'

export const TIERS: readonly Tier[] = ['trivial', 'simple', 'moderate', 'complex', 'deep']

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier)
}

export function tierFromScore(score: number): Tier {
  if (score < 15) return 'trivial'
  if (score < 35) return 'simple'
  if (score < 55) return 'moderate'
  if (score < 75) return 'complex'
  return 'deep'
}

/** Bỏ dấu tiếng Việt và hạ chữ thường để so khớp từ khóa bằng \b ASCII. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

type Group = { label: string; weight: number; cap: number; pattern: RegExp }

// Từ khóa viết ở dạng đã bỏ dấu. Mỗi nhóm có trần điểm để một prompt dài
// lặp một từ nhiều lần không thổi phồng độ phức tạp.
const GROUPS: readonly Group[] = [
  {
    label: 'suy luận sâu',
    weight: 9,
    cap: 36,
    pattern:
      /\b(kien truc|architect\w*|thiet ke he thong|system design|refactor\w*|tai cau truc|migrat\w*|chuyen doi|security|bao mat|vulnerab\w*|concurren\w*|race condition|deadlock|performance|hieu nang|toi uu|optimi[sz]\w*|root cause|nguyen nhan goc|distributed|phan tan|algorithm\w*|thuat toan|chien luoc|strategy|trade-?offs?|danh doi|scalab\w*|debug\w*|flaky|intermittent|chung minh|proof|deep dive|end-to-end|suy luan|reasoning|orchestrat\w*|dieu phoi)\b/g,
  },
  {
    label: 'xây dựng',
    weight: 5,
    cap: 15,
    pattern:
      /\b(implement\w*|trien khai|build|xay dung|tao|create|viet|write|feature|tinh nang|plugin|mod|module|api|hooks?|integrat\w*|tich hop|tests?|kiem thu|ui|giao dien|component|schema|database|co so du lieu|pipeline|workflow|script)\b/g,
  },
  {
    label: 'phân tích',
    weight: 4,
    cap: 12,
    pattern:
      /\b(phan tich|analy[sz]\w*|danh gia|evaluat\w*|review|so sanh|compar\w*|giai thich|explain|research|nghien cuu|ke hoach|plan)\b/g,
  },
  {
    label: 'thao tác',
    weight: 3,
    cap: 6,
    pattern: /\b(them|sua|fix|update|cap nhat|xoa|delete|remove|doi|change|add)\b/g,
  },
]

const TRIVIAL =
  /\b(typo|loi chinh ta|rename|doi ten|format|liet ke|la gi|what is|cho xem|show me|git status|version|phien ban|xin chao|hello|cam on|thanks?)\b/g

const CONTINUE = /^(tiep tuc|tiep di|tiep|lam tiep|continue|go on|keep going|ok|oke|okay|duoc|dong y|yes|next)\b/
const REFINE =
  /^(sua|chinh|them|bo sung|also|and|now|gio|bay gio|con|nhung|but|fix|doi|thay|update|cap nhat|xoa|bo)\b/
const NEW_TASK = /\b(task moi|new task|viec khac|viec moi|chuyen sang|mot viec khac|nhiem vu moi)\b/
const RESTRICT = /\b(chi sua|chi thay doi|chi trong|only (edit|change|modify|touch)|just (edit|change)|khong sua file khac|khong dong vao)\b/

const CONSTRAINT =
  /\b(phai|khong duoc|khong dung|khong lam|khong sua|khong thay doi|khong them|chi|bat buoc|cam|tranh|giu nguyen|must|should|do not|don't|never|only|without|avoid|keep)\b/
const QUALITY =
  /\b(chat luong|sach|clean|comment|tests?|kiem tra|chinh xac|nhat quan|consistent|readable|de doc|hieu nang|performance|an toan|secure|hot-reload|chuan)\b/

const STOPWORDS = new Set(
  (
    'the and for with that this from into your have will should must about when then than them they what which ' +
    'cua cho nhung trong mot cac duoc khong nhu theo phai neu khi nay cung hoac voi tren duoi sau truoc nhat ' +
    'hien dung lam viec mod claude code hay hoat dong giup can co the tung buoc'
  ).split(' '),
)

const ENUMERATED = /^\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s+(.+)$/
const NUMBERED = /^\s*\d+[.)]\s+/
const HEADING = /^\s*(#{1,6}\s+|\*\*[^*]+\*\*\s*$)/
const GOAL_MARKER = /^(muc tieu|goal|objective|nhiem vu|task|yeu cau chinh)\b/

const PATH =
  /(?:^|[\s`'"(])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|json|md|ya?ml|toml|sql|css|scss|html|sh|ipynb|txt))(?=$|[\s`'"),:;])/g

// Câu dẫn/meta: người dùng nói về việc gửi, sửa hay thử chính prompt/mod,
// không phải yêu cầu của task ("tôi vừa sửa xong focus-conductor, giờ test lại
// giúp", "giúp tôi test", "prompt test này..."). Nhận diện theo ý bằng cách
// cộng điểm các tín hiệu thay vì khớp một cụm cứng, nên từ chen giữa không
// làm lọt câu. Mẫu viết ở dạng đã bỏ dấu, so trên câu đã fold.
type MetaSignal = { weight: number; pattern: RegExp }

const META_SIGNALS: readonly MetaSignal[] = [
  // Nhờ trợ lý chạy thử: "test lại giúp", "test cái này giúp", "giúp tôi test", "giờ test lại".
  { weight: 2, pattern: /\btest(\s+\S+){0,3}?\s+(giup|ho|dum)\b/ },
  { weight: 2, pattern: /\b(giup|nho)\s+((toi|minh|em|anh|tui)\s+)?(test|chay thu)\b/ },
  // "test lại" chỉ tính khi đứng cuối hoặc kèm lời nhờ, để "chạy test lại sau khi deploy" vẫn là yêu cầu.
  { weight: 2, pattern: /\b(gio|bay gio|roi|xong)\s+(test|chay thu)\b|\btest\s+lai\s*(giup|ho|dum|di|nhe|nha|[.?]|$)/ },
  // Gọi prompt là đồ thử: "prompt test", "prompt mẫu".
  { weight: 2, pattern: /\b(prompt|cau lenh)\s+(test|thu|mau|vi du)\b/ },
  // Tiếng Anh: "here is the prompt", "I'm testing the mod".
  {
    weight: 2,
    pattern:
      /\b(here is|here's|below is|the following (prompt|request)|i('m| am) (sending|pasting|testing)|test prompt|testing (the|this|my) (mod|plugin|prompt))\b/,
  },
  // Người dùng tự thuật việc vừa làm với công cụ: "tôi vừa sửa xong", "tôi gửi".
  { weight: 1, pattern: /\b(toi|minh|tui|anh|em)\s+(vua|da|moi)\s+(\S+\s+)?(sua|cai|cap nhat|update|chinh)\b|\b(sua|cai|cap nhat)\s+xong\b/ },
  { weight: 1, pattern: /\b(toi|minh|tui|anh|em)\s+((vua|da)\s+)?(gui|dan|paste|nhap)\b/ },
  // Nhắc tới chính công cụ hoặc prompt.
  { weight: 1, pattern: /\b(prompt|mods?|plugin|focus-conductor|conductor)\b/ },
]

/** Dấu hiệu câu đang đặt yêu cầu về test của task ("viết unit test", "có test đầy đủ"). */
const TEST_REQUIREMENT = /\b(unit test|viet (unit )?test|co test|test (case|phu))\b/

/**
 * Câu người dùng nói về việc gửi, sửa hay thử chính prompt/mod, không phải
 * yêu cầu task. Phần trong ngoặc kép bị bỏ trước khi chấm, để một yêu cầu
 * trích ví dụ câu meta (như prompt này) không bị loại nhầm.
 */
export function isMeta(sentence: string): boolean {
  const folded = fold(sentence)
    .replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, ' ')
    .trim()
  let score = 0
  for (const signal of META_SIGNALS) if (signal.pattern.test(folded)) score += signal.weight
  if (TEST_REQUIREMENT.test(folded)) score -= 2
  return score >= 2
}

/** Gỡ ký hiệu markdown để một dòng đọc được như câu bình thường. */
function clean(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|[a-z][.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.;?])\s+/)
    .map(clean)
    .filter(s => s.length >= 6 && !isMeta(s))
}

/** Giữ mục đầu tiên của mỗi giá trị trùng y hệt (sau khi bỏ dấu); dùng cho đường dẫn. */
function uniqueExact(list: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const key = fold(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

const FILLER = new Set('va la cua cho cac nhung mot thi ma de the an and or to of in on for with be is are'.split(' '))

function tokens(text: string): Set<string> {
  return new Set((fold(text).match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 2 && !FILLER.has(t)))
}

/**
 * Hai câu cùng ý: trùng phần lớn từ (Jaccard từ 0,7), hoặc câu ngắn hơn (từ 3
 * từ trở lên) gần như nằm trọn trong câu dài hơn, như khi Haiku rút gọn hay
 * cắt cụt câu gốc của người dùng.
 */
export function isSameIdea(a: string, b: string): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return fold(a).trim() === fold(b).trim()
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared += 1
  const jaccard = shared / (ta.size + tb.size - shared)
  const smaller = Math.min(ta.size, tb.size)
  return jaccard >= 0.7 || (smaller >= 3 && shared / smaller >= 0.8)
}

/**
 * Bỏ mục cùng ý với một mục đứng trước; thứ tự đầu vào quyết định bản nào
 * được giữ, nên câu gốc của người dùng phải đặt trước.
 */
function unique(list: string[], max: number): string[] {
  const out: string[] = []
  for (const item of list) {
    if (out.some(kept => isSameIdea(kept, item))) continue
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

function extractGoal(lines: string[]): string {
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i] ?? '')
    if (isMeta(line) || !GOAL_MARKER.test(fold(line))) continue
    const colon = line.indexOf(':')
    const rest = colon >= 0 ? line.slice(colon + 1).trim() : ''
    if (rest.length >= 6) return clip(rest, 200)
    for (let j = i + 1; j < lines.length; j++) {
      const next = clean(lines[j] ?? '')
      if (next.length >= 6 && !HEADING.test(lines[j] ?? '') && !isMeta(next)) return clip(next, 200)
    }
  }
  const first = lines.map(clean).find(l => l.length >= 6 && !isMeta(l)) ?? clean(lines.join(' '))
  const sentence = first.split(/(?<=[.?])\s+/)[0] ?? first
  return clip(sentence, 200)
}

function extractSteps(lines: string[]): string[] {
  const numbered = lines.filter(l => NUMBERED.test(l)).map(clean)
  const source = numbered.length >= 2 ? numbered : lines.filter(l => ENUMERATED.test(l)).map(clean)
  return unique(source.filter(s => s.length >= 4 && !isMeta(s)).map(s => clip(s, 120)), 10)
}

/** Từ nội dung (đã bỏ dấu, từ 4 ký tự, không phải stopword). */
function contentWords(folded: string): string[] {
  return (folded.match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter(word => !STOPWORDS.has(word))
}

function extractKeywords(folded: string): string[] {
  const counts = new Map<string, number>()
  for (const word of contentWords(folded)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)
}

function extractPaths(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(PATH)) {
    const path = match[1]
    if (path && !/https?:|www\./.test(path)) out.push(path)
  }
  return uniqueExact(out, 12)
}

/**
 * Chấm điểm phức tạp 0..100 kèm tín hiệu giải thích. `isDelegated` dùng cho
 * prompt giao việc subagent: điểm độ dài và số mục liệt kê bị giảm một nửa.
 */
export function scoreComplexity(
  text: string,
  options: { isDelegated?: boolean } = {},
): { score: number; signals: string[] } {
  const folded = fold(text)
  const lines = text.split('\n')
  const words = text.split(/\s+/).filter(Boolean).length
  const shape = options.isDelegated ? 0.5 : 1
  const signals: string[] = []
  let score = 20

  const lengthBonus = words < 6 ? -6 : words < 15 ? 0 : words < 40 ? 6 : words < 120 ? 14 : words < 300 ? 22 : 30
  score += Math.round(lengthBonus * shape)
  signals.push(`${words} từ`)

  const items = lines.filter(l => ENUMERATED.test(l)).length
  if (items > 0) {
    score += Math.round(Math.min(items * 3, 24) * shape)
    signals.push(`${items} mục liệt kê`)
  }
  const headings = lines.filter(l => HEADING.test(l)).length
  if (headings > 0) score += Math.min(headings * 2, 8)
  const fences = Math.floor(countMatches(text, /```/g) / 2)
  if (fences > 0) score += Math.min(fences * 4, 8)
  const paths = extractPaths(text).length
  if (paths > 0) score += Math.min(paths * 2, 10)

  for (const group of GROUPS) {
    const hits = countMatches(folded, group.pattern)
    if (hits === 0) continue
    score += Math.min(hits * group.weight, group.cap)
    signals.push(`${group.label} x${hits}`)
  }

  if (words < 40) {
    const trivial = countMatches(folded, TRIVIAL)
    if (trivial > 0) {
      score -= 8
      signals.push('dấu hiệu việc vặt')
    }
  }

  const isShortQuestion = words < 25 && /\?\s*$/.test(text.trim())
  if (isShortQuestion && score >= 35) {
    score = 34
    signals.push('câu hỏi ngắn')
  }

  return { score: Math.max(0, Math.min(100, score)), signals }
}

// Từ quá chung để nói lên chủ đề (động từ thao tác, âm tiết phổ biến): bỏ
// qua khi đo độ liên quan, nếu không "viết hàm X" sẽ dính vào mọi task có "viết".
const GENERIC = new Set(
  (
    'viet them xoa giup dung bang file code test tests thuc gian chinh kiem viec hien cach phan tiep loi ' +
    'write create update make change function fix add remove'
  ).split(' '),
)

/**
 * Prompt mới có cùng chủ đề với mục tiêu trước không: so từ nội dung của nó
 * với từ khóa, mục tiêu, các bước và đường dẫn của brief trước. Prompt không
 * có từ nội dung nào ("làm đi", "sửa lỗi đó") được coi là liên quan.
 */
export function isRelated(text: string, prev: Brief): boolean {
  const words = new Set(contentWords(fold(text)).filter(word => !GENERIC.has(word)))
  if (words.size === 0) return true
  const vocabulary = new Set([
    ...prev.keywords,
    ...contentWords(fold([prev.goal, ...prev.steps, ...prev.scopePaths].join(' '))),
  ])
  const shared = [...words].filter(word => vocabulary.has(word)).length
  return shared >= 2 || (shared >= 1 && shared / words.size >= 0.2)
}

/**
 * Phân tích cục bộ. Với prompt tiếp nối (tiếp tục, sửa nhỏ cùng chủ đề...),
 * giữ mục tiêu và checklist của brief trước, chỉ gộp thêm ràng buộc mới.
 */
export function analyzeHeuristic(text: string, prev: Brief | null, now: number): Brief {
  const trimmed = text.trim()
  const folded = fold(trimmed)
  const lines = trimmed.split('\n')
  const words = trimmed.split(/\s+/).filter(Boolean).length
  const { score, signals } = scoreComplexity(trimmed)
  const ownTier = tierFromScore(score)

  const constraints = unique(
    sentences(trimmed)
      .filter(s => CONSTRAINT.test(fold(s)))
      .map(s => clip(s, 140)),
    8,
  )
  const quality = unique(
    sentences(trimmed)
      .filter(s => QUALITY.test(fold(s)))
      .map(s => clip(s, 140)),
    6,
  )
  const scopePaths = RESTRICT.test(folded) ? extractPaths(trimmed) : []

  const isNewTask = NEW_TASK.test(folded)
  const isContinue = CONTINUE.test(folded)
  const isRefine = REFINE.test(folded) && words < 60
  // "Sửa...", "thêm..." hay câu ngắn chỉ là tiếp nối khi cùng chủ đề với mục
  // tiêu trước; khác chủ đề thì là task mới dù mở đầu giống một lời tinh chỉnh.
  const isFollowUp =
    prev !== null && !isNewTask && (isContinue || ((isRefine || words < 12) && isRelated(trimmed, prev)))

  if (prev !== null && isFollowUp) {
    const tier = isContinue ? prev.tier : ownTier
    return {
      ...prev,
      constraints: unique([...prev.constraints, ...constraints], 10),
      quality: unique([...prev.quality, ...quality], 8),
      scopePaths: scopePaths.length > 0 ? scopePaths : prev.scopePaths,
      tier,
      score: isContinue ? prev.score : score,
      signals: isContinue ? [...prev.signals.slice(0, 4), 'tiếp nối'] : [...signals, 'tinh chỉnh'],
      source: 'heuristic',
      isFollowUp: true,
      prompt: clip(trimmed, 600),
      at: now,
    }
  }

  return {
    goalId: (prev?.goalId ?? 0) + 1,
    goal: extractGoal(lines),
    steps: extractSteps(lines),
    constraints,
    quality,
    tier: ownTier,
    score,
    signals,
    source: 'heuristic',
    isFollowUp: false,
    keywords: extractKeywords(folded),
    scopePaths,
    prompt: clip(trimmed, 600),
    at: now,
  }
}

const ANALYZER_SYSTEM = `You read a user's request to a coding agent BEFORE any work starts and extract what the agent must keep in mind.
Reply with ONE JSON object and nothing else:
{"goal": string, "steps": string[], "constraints": string[], "quality": string[], "tier": "trivial"|"simple"|"moderate"|"complex"|"deep", "isNewGoal": boolean}
- goal: the end result the user wants, one sentence.
- steps: 2-10 ordered, concrete steps that reach the goal; [] for a one-step task.
- constraints: hard rules (must / must not / only / format / scope), quoted closely.
- quality: the acceptance criteria the result is judged by.
- tier: trivial = one-liner or lookup; simple = small local change or short answer; moderate = several files or careful explanation; complex = multi-part feature, debugging or design with trade-offs; deep = architecture, cross-cutting refactor, security or research needing long reasoning.
- isNewGoal: false when the request continues or refines the previous goal given below.
Ignore meta sentences in which the user talks about the request itself or about testing a tool or mod ("I'm sending a test prompt", "please test this"): they are never goals, steps, constraints or quality criteria.
Write every string in the same language as the request. Keep each string under 140 characters.`

type ModelAnalysis = {
  goal?: unknown
  steps?: unknown
  constraints?: unknown
  quality?: unknown
  tier?: unknown
  isNewGoal?: unknown
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && !isMeta(s))
    .map(s => clip(s.trim(), 140))
    .slice(0, max)
}

function parseJson(text: string): ModelAnalysis | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof value === 'object' && value !== null ? (value as ModelAnalysis) : null
  } catch {
    return null
  }
}

/**
 * Request cho lượt Haiku phân tích prompt. Hook tự gọi $.model.complete với
 * request này (mod không truyền $ vào hàm phụ trợ).
 */
export function analyzerRequest(text: string, prev: Brief | null): ModelCompleteRequest {
  const previous = prev ? `Previous goal: ${prev.goal}` : 'Previous goal: none'
  return {
    model: 'haiku',
    system: ANALYZER_SYSTEM,
    prompt: `${previous}\n\n<request>\n${text.slice(0, 12000)}\n</request>`,
    maxTokens: 900,
    effort: 'low',
    timeoutMs: 8000,
  }
}

/**
 * Gộp câu trả lời JSON của Haiku vào brief heuristic. Tier của model bị kẹp
 * trong biên ±1 quanh tier heuristic để một lần chấm lệch không đẩy cả turn
 * sang model sai. Câu trả lời không đọc được thì giữ nguyên brief heuristic.
 */
export function mergeAnalysis(base: Brief, prev: Brief | null, reply: string): Brief {
  const parsed = parseJson(reply)
  if (!parsed) return base

  const goal =
    typeof parsed.goal === 'string' && parsed.goal.trim() && !isMeta(parsed.goal)
      ? clip(parsed.goal.trim(), 200)
      : base.goal
  const steps = strings(parsed.steps, 10)
  const constraints = strings(parsed.constraints, 8)
  const quality = strings(parsed.quality, 6)
  const modelTier = TIERS.find(t => t === parsed.tier)
  const baseRank = tierRank(base.tier)
  const tier = modelTier
    ? (TIERS[Math.max(baseRank - 1, Math.min(baseRank + 1, tierRank(modelTier)))] ?? base.tier)
    : base.tier

  // Model cho rằng đây vẫn là mục tiêu cũ: giữ goalId để không reset checklist.
  const isContinuation = prev !== null && parsed.isNewGoal === false
  return {
    ...base,
    goalId: isContinuation ? prev.goalId : base.goalId,
    goal: isContinuation ? prev.goal : goal,
    steps: isContinuation ? prev.steps : steps.length > 0 ? steps : base.steps,
    // Câu gốc của người dùng đứng trước: khi trùng ý, bản Haiku diễn đạt lại bị bỏ.
    constraints: unique([...base.constraints, ...constraints], 10),
    quality: unique([...base.quality, ...quality], 8),
    tier,
    signals: [...base.signals, `model: ${modelTier ?? 'không rõ'}`],
    source: 'model',
    isFollowUp: isContinuation,
  }
}
