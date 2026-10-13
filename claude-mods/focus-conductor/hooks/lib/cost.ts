// Chi phí theo token, thuần (không gọi $). Dùng để so sánh hai lựa chọn model
// trước khi đổi, và để quy đổi token đo được thành USD cho sổ chi phí.
//
// Giá Claude API theo bảng giá ngày PRICE_DATE (USD mỗi 1M token) [Nguồn: Anthropic, trang giá 2026-10-13]:
//   Haiku 5.5 $0.10 vào / $0.50 ra (prompt tới 100K token; trên 100K là $0.50 / $2.50); Sonnet 5.5 $2 / $10;
//   Opus 5.5 $4 / $20; Fable 5.1 $10 / $50.
//   Đọc cache (cache hit): Sonnet $0.10 (giảm từ $0.20 ngày 2026-10-07), Opus $0.20, Fable $0.25, Haiku $0.01
//   (prompt trên 100K token: $0.05).
//   Ghi cache = 1,25 × giá vào (bậc 5 phút) hoặc 2 × giá vào (bậc 1 giờ): option cacheWrite chọn hệ số, cặp với cacheTtlMinutes.
// Cửa sổ ngữ cảnh: cả bốn model 1M token [Nguồn: cùng trang giá]. Option prices và contextWindows ghi đè được.

import type { Effort, ModelFamily, Volume } from '../../types'

export type Price = { input: number; output: number; cacheRead: number }

/** Ngày của bảng giá kèm mod; /conductor status cảnh báo khi đã quá PRICE_STALE_DAYS ngày. */
export const PRICE_DATE = '2026-10-13'
export const PRICE_STALE_DAYS = 30

const BASE_PRICE: Record<ModelFamily, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheRead: 0.1 },
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  fable: { input: 10, output: 50, cacheRead: 0.25 },
}

/** Haiku 5.5 với prompt trên LONG_PROMPT token [Nguồn: trang giá 2026-10-13]. */
const LONG_PROMPT = 100_000
const HAIKU_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05 }

/** Bảng giá đang dùng: bảng kèm mod, ghi đè theo option prices khi mod nạp (applyPrices). */
export const PRICE: Record<ModelFamily, Price> = { ...BASE_PRICE }
let overridden: ModelFamily[] = []

/** Cửa sổ ngữ cảnh mặc định theo họ, cho model ID mặc định của mod [Nguồn: trang giá 2026-10-13]. */
export const DEFAULT_WINDOWS: Record<ModelFamily, number> = { haiku: 1_000_000, sonnet: 1_000_000, opus: 1_000_000, fable: 1_000_000 }

/** Bảng giá kèm mod (chưa chịu option prices), để dựng catalog cho golden-set và đối chiếu. */
export function bundledPrices(): Record<ModelFamily, Price> {
  return { haiku: { ...BASE_PRICE.haiku }, sonnet: { ...BASE_PRICE.sonnet }, opus: { ...BASE_PRICE.opus }, fable: { ...BASE_PRICE.fable } }
}

/**
 * Đọc option prices: "family=vào/ra" hoặc "family=vào/ra/đọc cache" (USD mỗi 1M token), phân tách bằng dấu phẩy.
 * Thiếu giá trị thứ ba thì đọc cache theo tỷ lệ của đúng họ đó trong bảng kèm mod (Sonnet và Opus 5% giá vào,
 * Fable 2,5%, Haiku 10%). Mục sai bị bỏ qua.
 */
export function parsePrices(raw: unknown): Partial<Record<ModelFamily, Price>> {
  const out: Partial<Record<ModelFamily, Price>> = {}
  if (typeof raw !== 'string') return out
  for (const item of raw.split(',')) {
    const match = item.trim().match(/^(haiku|sonnet|opus|fable)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)(?:\s*\/\s*([\d.]+))?$/i)
    if (!match) continue
    const family = match[1]!.toLowerCase() as ModelFamily
    const input = Number(match[2])
    const output = Number(match[3])
    const ratio = BASE_PRICE[family].cacheRead / BASE_PRICE[family].input
    const cacheRead = match[4] !== undefined ? Number(match[4]) : Number((input * ratio).toPrecision(12))
    if ([input, output, cacheRead].every(Number.isFinite)) out[family] = { input, output, cacheRead }
  }
  return out
}

/** Áp bảng giá cho lần nạp mod này: bảng kèm mod, rồi phần ghi đè. Gọi lại thì làm lại từ bảng kèm mod. */
export function applyPrices(overrides: Partial<Record<ModelFamily, Price>>): void {
  for (const family of Object.keys(BASE_PRICE) as ModelFamily[]) PRICE[family] = overrides[family] ?? BASE_PRICE[family]
  overridden = Object.keys(overrides) as ModelFamily[]
}

/** Một dòng về nguồn bảng giá cho /conductor status; kèm cảnh báo khi bảng kèm mod đã cũ. */
export function priceNote(now: number): string {
  const age = Math.floor((now - Date.parse(`${PRICE_DATE}T00:00:00Z`)) / 86_400_000)
  const base = `Bảng giá kèm mod ngày ${PRICE_DATE}${overridden.length > 0 ? `, ghi đè cho ${overridden.join(', ')}` : ''}`
  return age > PRICE_STALE_DAYS
    ? `${base}; đã ${age} ngày, giá có thể đã đổi: kiểm lại và ghi đè bằng option prices`
    : base
}

/** Hệ số ghi cache mặc định: bậc 1 giờ, 2 × giá vào. Bậc 5 phút là 1,25 [Nguồn: trang giá 2026-10-13]. */
export const CACHE_WRITE_DEFAULT = 2
const CACHE_WRITE_MIN = 1.25
/** Thời gian sống của cache (phút) mặc định, đi cặp với CACHE_WRITE_DEFAULT (bậc 1 giờ). */
export const DEFAULT_CACHE_TTL_MINUTES = 60
let cacheWrite = CACHE_WRITE_DEFAULT

/** Đọc option cacheWrite (số hoặc chuỗi số): kẹp trong 1,25 đến 2; thiếu hoặc sai thì dùng mặc định. */
export function parseCacheWrite(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  if (!Number.isFinite(value) || value <= 0) return CACHE_WRITE_DEFAULT
  return Math.min(CACHE_WRITE_DEFAULT, Math.max(CACHE_WRITE_MIN, value))
}

/** Áp hệ số ghi cache cho lần nạp mod này (usdOf và switchCost dùng chung). */
export function applyCacheWrite(factor: number): void {
  cacheWrite = parseCacheWrite(factor)
}

export function cacheWriteFactor(): number {
  return cacheWrite
}

/**
 * Một dòng về cặp bậc cache cho /conductor status. Hai option phải cùng một bậc: 5 phút đi với hệ số 1.25, 1 giờ đi với
 * hệ số 2. Lệch (ví dụ người dùng cũ còn TTL 5 đã lưu trong khi hệ số mặc định là 2) thì kèm cảnh báo.
 */
export function cacheNote(ttlMinutes: number): string {
  const note = `Ghi cache ${cacheWrite}× giá vào, cache nguội sau ${ttlMinutes} phút`
  const isLongTier = cacheWrite > CACHE_WRITE_MIN
  const isLongTtl = ttlMinutes > 5
  return isLongTier === isLongTtl
    ? note
    : `${note}. Hai option cacheWrite và cacheTtlMinutes không cùng một bậc cache (bậc 5 phút là 1.25 và 5, bậc 1 giờ là 2 và 60): đặt cho khớp bậc tài khoản đang dùng`
}

/** Giá áp cho một lượt: Haiku có giá cao hơn khi prompt dài (trừ khi người dùng đã ghi đè giá Haiku). */
function priceFor(family: ModelFamily, prompt: number): Price {
  return family === 'haiku' && prompt > LONG_PROMPT && !overridden.includes('haiku') ? HAIKU_LONG : PRICE[family]
}

/** Cửa sổ ngữ cảnh mặc định khi chưa đọc được từ phiên [Giả định]. */
export const DEFAULT_CONTEXT = 30_000
/** Phần cố định (system prompt và tools) trong ngữ cảnh khi chưa đo được từ phiên [Giả định]. */
export const SYSTEM_TOKENS = 20_000
/** Đổi model chỉ khi lợi ích lớn hơn chi phí hòa vốn nhân với hệ số này. */
export const SAFETY = 1.2

/**
 * Kích thước một turn ước lượng theo khối lượng [Giả định, hiệu chỉnh dần từ
 * số đo]. `steps` là số lần gọi model trong turn, `newInput` là token vào mới
 * (không cache), `output` là token ra ở effort medium.
 */
export const SIZE: Record<Volume, { steps: number; newInput: number; output: number }> = {
  small: { steps: 3, newInput: 5_000, output: 2_000 },
  medium: { steps: 10, newInput: 30_000, output: 8_000 },
  large: { steps: 30, newInput: 120_000, output: 30_000 },
}

/** Hệ số token ra theo effort so với medium. */
export const EFFORT_FACTOR: Record<Effort, number> = { low: 0.6, medium: 1, high: 1.5, xhigh: 2.2, max: 3 }

export type Tokens = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** USD của một lượt đã đo, theo đúng số token của API. */
export function usdOf(family: ModelFamily, usage: Tokens): number {
  const p = priceFor(family, usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens)
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_read_input_tokens * p.cacheRead +
      usage.cache_creation_input_tokens * p.input * cacheWrite) /
    1_000_000
  )
}

/** Token ra ước lượng cho một turn, trước hiệu chỉnh. */
export function expectedOutput(volume: Volume, effort: Effort): number {
  return SIZE[volume].output * EFFORT_FACTOR[effort]
}

/**
 * Chi phí ước lượng của một turn (USD): token vào mới, đọc cache phần ngữ cảnh
 * ở mỗi step, và token ra theo effort. `calib` hiệu chỉnh token ra theo số đo.
 */
export function turnCost(
  family: ModelFamily,
  effort: Effort,
  volume: Volume,
  context: number,
  calib: number = 1,
  /** Token ra đã đo cho đúng dạng việc này (histogram), thay cho giả định theo khối lượng. */
  measured: number | null = null,
): number {
  const size = SIZE[volume]
  const price = PRICE[family]
  const output = measured ?? expectedOutput(volume, effort) * calib
  return (
    (size.newInput * price.input + size.steps * context * price.cacheRead + output * price.output) / 1_000_000
  )
}

/**
 * Chi phí ghi lại cache khi đổi lựa chọn, tính cho một turn (USD).
 * Đổi model: toàn bộ ngữ cảnh được ghi lại theo giá vào của model mới nhân hệ số
 * ghi cache, thay cho việc đọc cache của model cũ. Chỉ đổi effort (cùng model): phần ngữ cảnh
 * ngoài system prompt được ghi lại.
 */
export function switchCost(
  from: { family: ModelFamily },
  to: { family: ModelFamily },
  context: number,
  sysTokens: number = SYSTEM_TOKENS,
): number {
  if (from.family !== to.family) {
    return (context * (cacheWrite * PRICE[to.family].input - PRICE[from.family].cacheRead)) / 1_000_000
  }
  const reused = Math.max(0, context - sysTokens)
  return (reused * (cacheWrite * PRICE[to.family].input - PRICE[to.family].cacheRead)) / 1_000_000
}

/**
 * Phần cố định của ngữ cảnh (system prompt, tools, bộ nhớ, agent) từ bảng phân tích
 * ngữ cảnh của engine: mọi hàng đang chiếm chỗ trừ hàng hội thoại. Không có hàng
 * hội thoại để trừ thì trả null (không đoán).
 */
export function fixedContextTokens(categories: readonly { name: string; tokens: number; kind: string }[] | undefined): number | null {
  if (!categories || categories.length === 0) return null
  const used = categories.filter(c => c.kind === 'used')
  const messages = used.filter(c => /message/i.test(c.name))
  if (messages.length === 0) return null
  const fixed = used.filter(c => !/message/i.test(c.name)).reduce((sum, c) => sum + c.tokens, 0)
  return fixed > 0 ? fixed : null
}

/**
 * Có nên đổi sang lựa chọn rẻ hơn không: lợi ích trong H turn còn lại phải
 * vượt chi phí ghi lại cache với hệ số an toàn. H là 2 cho mục tiêu mới (chi
 * phí được chia cho cả task), 1 cho tiếp nối.
 */
export function shouldDowngrade(args: { saving: number; rewrite: number; turnsLeft: number }): boolean {
  return args.turnsLeft * args.saving >= SAFETY * args.rewrite
}
