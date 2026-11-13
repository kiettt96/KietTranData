// Bảng họ model (0.8.7 G1): nguồn duy nhất của thông tin theo họ model. Tên họ cũng là alias gửi engine. route.ts (FAMILIES, ID ghim),
// cost.ts (giá, cửa sổ), reading.ts (thông số đọc) và conductor.ts (họ làm được vai điều phối, thời gian chờ của vai đó) đọc từ đây.
// Thêm một dòng vào bảng là đủ để mọi nơi trong mã biết tới họ đó; các việc khác khi nạp một họ mới ghi ở DESIGN (mục 0.8.7 G1).
// Thuần: không gọi $, không import tệp nào khác của mod.

import type { ModelFamily } from '../../types'

export type FamilyPrice = { input: number; output: number; cacheRead: number }

/** Thông số đọc của một họ (0.8.7 L3): ký tự trên token, giây trên ký tự, token ra lớn nhất đo được, mức token ra tối đa engine báo. */
export type FamilyRead = { charsPerToken: number; secPerChar: number; maxOut: number; engineMaxOut: number }

/** Thời gian chờ của năm loại request router khi họ này làm vai điều phối (ms). */
export type ConductorTimeouts = { prompt: number; long: number; agent: number; drift: number; review: number }

export type FamilyInfo = {
  /** Thứ hạng, thấp tới cao: quyết định thứ tự nâng, hạ và so model. */
  rank: number
  /** ID ghim: bảng giá và cửa sổ kèm mod lập cho ID này; dùng khi engine không nhận alias hay phiên có tiền tố nhà cung cấp (0.8.7 M1). */
  pinnedId: string
  /** USD mỗi 1M token [Nguồn: trang giá 2026-10-13]. */
  price: FamilyPrice
  /** Cửa sổ ngữ cảnh của ID ghim (token) [Nguồn: trang giá 2026-10-13]. */
  window: number
  /** Thông số đọc đã đo; null là chưa đo (readParamsOf lấy giá trị thận trọng của các họ đã đo). */
  read: FamilyRead | null
  /** Thời gian chờ khi làm vai điều phối; null là họ không làm được vai điều phối (option conductor không nhận họ này). */
  conductor: ConductorTimeouts | null
}

/**
 * Thời gian chờ của Fable khi làm vai điều phối (0.8.4 C2): đo tuần tự trên engine 2.1.322 ngày 10/11/2026, 35 lượt [Đo trực tiếp];
 * 1,5 lần giá trị lớn nhất làm tròn lên bội số 5 giây đều không vượt giá trị này.
 */
const CONDUCTOR_TIMEOUTS: ConductorTimeouts = { prompt: 45_000, long: 120_000, agent: 20_000, drift: 20_000, review: 30_000 }

export const FAMILY_TABLE: Readonly<Record<ModelFamily, FamilyInfo>> = {
  haiku: { rank: 0, pinnedId: 'claude-haiku-5-5', price: { input: 0.1, output: 0.5, cacheRead: 0.01 }, window: 1_000_000, read: null, conductor: null },
  sonnet: {
    rank: 1,
    pinnedId: 'claude-sonnet-5-5',
    price: { input: 2, output: 10, cacheRead: 0.1 },
    window: 1_000_000,
    // [Đo trực tiếp, 13/11/2026, engine 2.1.323, 11 lượt; VERIFICATION mục 0.8.7]
    read: { charsPerToken: 1.5863, secPerChar: 0.0001491, maxOut: 6_243, engineMaxOut: 128_000 },
    conductor: null,
  },
  opus: {
    rank: 2,
    pinnedId: 'claude-opus-5-5',
    price: { input: 4, output: 20, cacheRead: 0.2 },
    window: 1_000_000,
    read: null,
    // Opus làm được vai điều phối (0.8.7 G1); thời gian chờ lấy bằng của Fable [Giả định: chưa đo opus ở vai này].
    conductor: CONDUCTOR_TIMEOUTS,
  },
  fable: {
    rank: 3,
    // Fable 5.2 (0.8.4): ID kiểm trên engine 2.1.322, có trong gói engine và gọi được qua claude -p [Đo trực tiếp, 10/11/2026].
    pinnedId: 'claude-fable-5-2',
    price: { input: 10, output: 50, cacheRead: 0.25 },
    window: 1_000_000,
    // [Đo trực tiếp, 13/11/2026, engine 2.1.323, 7 lượt; VERIFICATION mục 0.8.7]
    read: { charsPerToken: 1.5837, secPerChar: 0.0025649, maxOut: 91_084, engineMaxOut: 128_000 },
    conductor: CONDUCTOR_TIMEOUTS,
  },
}

/** Tên họ theo thứ hạng của bảng. */
export const FAMILY_NAMES: readonly ModelFamily[] = (Object.keys(FAMILY_TABLE) as ModelFamily[]).sort((a, b) => FAMILY_TABLE[a].rank - FAMILY_TABLE[b].rank)

/** Họ làm được vai điều phối, theo thứ hạng: các giá trị hợp lệ của option conductor ngoài off. */
export const CONDUCTOR_FAMILIES: readonly ModelFamily[] = FAMILY_NAMES.filter(f => FAMILY_TABLE[f].conductor !== null)

/** Họ điều phối mặc định khuyến nghị (option conductor vẫn mặc định off). */
export const DEFAULT_CONDUCTOR: ModelFamily = 'fable'

/** Tên họ để hiện ở đầu câu (Fable, Opus). */
export function familyLabel(family: ModelFamily): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}

/** Thời gian chờ vai điều phối của một họ; họ không làm được vai đó (hay chưa biết) thì của họ mặc định. */
export function conductorTimeouts(family: ModelFamily | null): ConductorTimeouts {
  return (family !== null ? FAMILY_TABLE[family].conductor : null) ?? (FAMILY_TABLE[DEFAULT_CONDUCTOR].conductor as ConductorTimeouts)
}
