// Chi phí theo token, thuần (không gọi $). Dùng để so sánh hai lựa chọn model
// trước khi đổi, và để quy đổi token đo được thành USD cho sổ chi phí.
//
// Giá Claude API ghi nhận 2026-10 (USD mỗi 1M token):
//   Haiku 5.5 $0.10 vào / $0.50 ra; Sonnet 5.5 $2 / $10; Opus 5.5 $4 / $20;
//   Fable 5.1 $10 / $50. Đọc cache: Sonnet và Opus $0.20, Fable $0.25.
//   Ghi cache = 1,25 × giá vào. Đọc cache của Haiku [Giả định: 10% giá vào].

import type { Effort, ModelFamily, Volume } from '../../types'

export type Price = { input: number; output: number; cacheRead: number }

export const PRICE: Record<ModelFamily, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  fable: { input: 10, output: 50, cacheRead: 0.25 },
}

/** Cửa sổ ngữ cảnh mặc định khi chưa đọc được từ phiên [Giả định]. */
export const DEFAULT_CONTEXT = 30_000
/** Phần cố định (system prompt và tools) trong ngữ cảnh [Giả định]. */
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
  const p = PRICE[family]
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_read_input_tokens * p.cacheRead +
      usage.cache_creation_input_tokens * p.input * 1.25) /
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
): number {
  const size = SIZE[volume]
  const price = PRICE[family]
  const output = expectedOutput(volume, effort) * calib
  return (
    (size.newInput * price.input + size.steps * context * price.cacheRead + output * price.output) / 1_000_000
  )
}

/**
 * Chi phí ghi lại cache khi đổi lựa chọn, tính cho một turn (USD).
 * Đổi model: toàn bộ ngữ cảnh được ghi lại theo giá vào của model mới, thay
 * cho việc đọc cache của model cũ. Chỉ đổi effort (cùng model): phần ngữ cảnh
 * ngoài system prompt được ghi lại.
 */
export function switchCost(
  from: { family: ModelFamily },
  to: { family: ModelFamily },
  context: number,
): number {
  if (from.family !== to.family) {
    return (context * (1.25 * PRICE[to.family].input - PRICE[from.family].cacheRead)) / 1_000_000
  }
  const reused = Math.max(0, context - SYSTEM_TOKENS)
  return (reused * (1.25 * PRICE[to.family].input - PRICE[to.family].cacheRead)) / 1_000_000
}

/**
 * Có nên đổi sang lựa chọn rẻ hơn không: lợi ích trong H turn còn lại phải
 * vượt chi phí ghi lại cache với hệ số an toàn. H là 2 cho mục tiêu mới (chi
 * phí được chia cho cả task), 1 cho tiếp nối.
 */
export function shouldDowngrade(args: { saving: number; rewrite: number; turnsLeft: number }): boolean {
  return args.turnsLeft * args.saving >= SAFETY * args.rewrite
}
