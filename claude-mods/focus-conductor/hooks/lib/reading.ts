// Router đọc trọn prompt (0.8.7 L3): mọi model router đọc trọn prompt tới sức chứa của nó. Sức chứa là số nhỏ hơn giữa sức chứa theo cửa
// sổ ngữ cảnh của model (trừ lời dặn, các dòng ngữ cảnh và maxTokens của lượt đó) và sức chứa theo thời gian chờ tối đa (option
// routerMaxWait); không thấp hơn trần cũ 80.000 ký tự. Chỉ hai trường hợp còn cắt prompt: vượt sức chứa của model, hay vượt số ký tự đọc
// được trong thời gian chờ tối đa. Thông số theo họ model lấy từ lượt đo thật (VERIFICATION, mục 0.8.7).

import type { ModelFamily } from '../../types'
import { FAMILY_NAMES, FAMILY_TABLE } from './families'

/** Trần cũ (0.7.8 G8): prompt không quá bấy nhiêu ký tự thì request trùng 0.8.6; sức chứa tính ra thấp hơn thì dùng trần này. */
export const BASE_CHARS = 80_000
export const BASE_HEAD = 60_000
export const BASE_TAIL = 20_000

/** Thời gian chờ tối đa của lượt đọc trọn, option routerMaxWait tính bằng giây: mặc định 1.800 (bằng biên trên, để Fable đọc trọn khoảng 468.000 ký tự),
 * kẹp trong 120 tới 1.800. Mức giữ hook tệ nhất là 1,5 lần mức này (hạn chung của askRouter), tức 2.700 giây. */
export const ROUTER_MAX_WAIT_MS = 1_800_000
export const ROUTER_MAX_WAIT_MIN_MS = 120_000
export const ROUTER_MAX_WAIT_MAX_MS = 1_800_000
/** Lượt dự phòng (request cắt theo trần cũ) dùng trọn bấy nhiêu, không lấy phần còn lại của hạn chung. */
export const FALLBACK_TIMEOUT_MS = 120_000
/** maxTokens của lượt đọc trọn không thấp hơn bấy nhiêu (bằng maxTokens của prompt dài trước 0.8.7). */
export const FULL_MIN_TOKENS = 16_000

/**
 * Thông số đọc của một họ model: số ký tự trên một token vào (nhỏ nhất qua các lượt đo), số giây trên một ký tự (lớn nhất qua các lượt
 * đo chạy một mình), token ra lớn nhất đo được, và mức token ra tối đa engine báo cho họ đó.
 */
export type ReadParams = { charsPerToken: number; secPerChar: number; maxOut: number; engineMaxOut: number }

/**
 * Số đo thật [Đo trực tiếp, 13/11/2026, engine 2.1.323, `claude -p`, effort medium, chạy một mình; bảng từng lượt ở VERIFICATION, mục
 * 0.8.7]. Ký tự trên token: nhỏ nhất qua các lượt, làm tròn xuống 4 chữ số. Giây trên ký tự: lớn nhất qua các lượt, làm tròn lên. Fable:
 * 7 lượt, chậm nhất 615,6 s cho 240.000 ký tự (prompt lặp mẫu), token ra lớn nhất 91.084. Sonnet: 11 lượt, chậm nhất 35,8 s cho 240.000
 * ký tự (prompt nhiều đề mục), token ra lớn nhất 6.243. Mức token ra tối đa engine báo (`modelUsage.maxOutputTokens`) là 128.000 cho cả hai.
 * Từ 0.8.7 G1 các số này nằm trong bảng họ model (hooks/lib/families.ts); READ_PARAMS là các họ đã đo.
 */
export const READ_PARAMS: Readonly<Record<ModelFamily, ReadParams>> = Object.fromEntries(
  FAMILY_NAMES.flatMap(f => (FAMILY_TABLE[f].read !== null ? [[f, FAMILY_TABLE[f].read]] : [])),
) as Record<ModelFamily, ReadParams>

/** Họ đã đo (0.8.7 G1: những họ có thông số đọc trong bảng họ model). */
const MEASURED: readonly ModelFamily[] = FAMILY_NAMES.filter(f => FAMILY_TABLE[f].read !== null)

/** Họ chưa đo (haiku, opus, model ID riêng): giá trị thận trọng nhất giữa các họ đã đo cho từng thông số [Giả định]. */
export function readParamsOf(family: ModelFamily): ReadParams {
  const own = FAMILY_TABLE[family].read
  if (own !== null) return own
  const all = MEASURED.map(f => READ_PARAMS[f])
  return {
    charsPerToken: Math.min(...all.map(p => p.charsPerToken)),
    secPerChar: Math.max(...all.map(p => p.secPerChar)),
    maxOut: Math.max(...all.map(p => p.maxOut)),
    engineMaxOut: Math.min(...all.map(p => p.engineMaxOut)),
  }
}

/** Option routerMaxWait (giây) thành mili giây, kẹp về biên; thiếu hay sai thì mặc định. */
export function routerMaxWaitOf(value: unknown): number {
  const seconds = Number(value)
  if (value === undefined || value === null || value === '' || !Number.isFinite(seconds)) return ROUTER_MAX_WAIT_MS
  return Math.min(ROUTER_MAX_WAIT_MAX_MS, Math.max(ROUTER_MAX_WAIT_MIN_MS, Math.round(seconds * 1000)))
}

/** Họ model, cửa sổ ngữ cảnh (token) và thời gian chờ tối đa của lượt router đọc prompt. */
export type Reading = { family: ModelFamily; window: number; maxWaitMs: number }

/** Kế hoạch đọc một prompt: sức chứa, phần đầu và phần cuối khi cắt, giới hạn đã quyết định sức chứa, và thông số của lượt đọc trọn. */
export type ReadPlan = {
  capacity: number
  head: number
  tail: number
  limit: 'window' | 'time'
  /** Lượt đọc trọn: prompt dài hơn trần cũ và sức chứa lớn hơn trần cũ. */
  isFull: boolean
  maxTokens: number
  timeoutMs: number
}

const roundUp = (value: number, step: number) => Math.ceil(value / step) * step

/** maxTokens của lượt đọc trọn: 1,5 lần token ra lớn nhất đo được, làm tròn lên bội số 5.000, trong khoảng FULL_MIN_TOKENS tới mức engine báo. */
export function fullMaxTokens(params: ReadParams): number {
  return Math.min(params.engineMaxOut, Math.max(FULL_MIN_TOKENS, roundUp(params.maxOut * 1.5, 5_000)))
}

/** Trần maxTokens của lượt hỏi lại vì câu trả lời của lượt đọc trọn bị cắt: 1,5 lần maxTokens của lượt đó, không cao hơn mức engine báo. */
export function fullRetryTokens(maxTokens: number, params: ReadParams): number {
  return Math.min(params.engineMaxOut, Math.round(maxTokens * 1.5))
}

/** Kế hoạch đọc prompt dài `textLength` ký tự; `fixedChars` là số ký tự của lời dặn và các dòng ngữ cảnh của request. */
export function readPlan(reading: Reading, textLength: number, fixedChars: number): ReadPlan {
  const params = readParamsOf(reading.family)
  const maxTokens = fullMaxTokens(params)
  const byWindow = Math.floor((reading.window - maxTokens) * params.charsPerToken) - fixedChars
  const byTime = Math.floor(reading.maxWaitMs / 1000 / 1.5 / params.secPerChar)
  const limit = byWindow <= byTime ? 'window' : 'time'
  const capacity = Math.max(BASE_CHARS, Math.min(byWindow, byTime))
  const head = capacity === BASE_CHARS ? BASE_HEAD : Math.round(capacity * 0.75)
  const isFull = textLength > BASE_CHARS && capacity > BASE_CHARS
  const sent = Math.min(textLength, capacity)
  const timeoutMs = Math.min(reading.maxWaitMs, Math.max(120_000, roundUp(1.5 * params.secPerChar * sent * 1000, 5_000)))
  return { capacity, head, tail: capacity - head, limit, isFull, maxTokens, timeoutMs }
}
