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
    .filter(s => s.length >= 6)
}

function unique(list: string[], max: number): string[] {
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

function extractGoal(lines: string[]): string {
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i] ?? '')
    if (!GOAL_MARKER.test(fold(line))) continue
    const colon = line.indexOf(':')
    const rest = colon >= 0 ? line.slice(colon + 1).trim() : ''
    if (rest.length >= 6) return clip(rest, 200)
    for (let j = i + 1; j < lines.length; j++) {
      const next = clean(lines[j] ?? '')
      if (next.length >= 6 && !HEADING.test(lines[j] ?? '')) return clip(next, 200)
    }
  }
  const first = lines.map(clean).find(l => l.length >= 6) ?? clean(lines.join(' '))
  const sentence = first.split(/(?<=[.?])\s+/)[0] ?? first
  return clip(sentence, 200)
}

function extractSteps(lines: string[]): string[] {
  const numbered = lines.filter(l => NUMBERED.test(l)).map(clean)
  const source = numbered.length >= 2 ? numbered : lines.filter(l => ENUMERATED.test(l)).map(clean)
  return unique(source.filter(s => s.length >= 4).map(s => clip(s, 120)), 10)
}

function extractKeywords(folded: string): string[] {
  const counts = new Map<string, number>()
  for (const word of folded.match(/[a-z][a-z0-9_-]{3,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
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
  return unique(out, 12)
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

/**
 * Phân tích cục bộ. Với prompt tiếp nối (tiếp tục, sửa nhỏ...), giữ mục tiêu
 * và checklist của brief trước, chỉ gộp thêm ràng buộc mới.
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
  const isFollowUp = prev !== null && !isNewTask && (isContinue || isRefine || words < 12)

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
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
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

  const goal = typeof parsed.goal === 'string' && parsed.goal.trim() ? clip(parsed.goal.trim(), 200) : base.goal
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
    constraints: unique([...constraints, ...base.constraints], 10),
    quality: unique([...quality, ...base.quality], 8),
    tier,
    signals: [...base.signals, `model: ${modelTier ?? 'không rõ'}`],
    source: 'model',
    isFollowUp: isContinuation,
  }
}
