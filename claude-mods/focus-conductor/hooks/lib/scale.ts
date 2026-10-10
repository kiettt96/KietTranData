// Thang đo của việc: độ sâu, khối lượng, bản chất và quan hệ với mục tiêu trước.
// Router trả các nhãn này; code chỉ kiểm giá trị hợp lệ và suy ra tier.

import type { Depth, Kind, Relation, Tier, Volume } from '../../types'

export const DEPTHS: readonly Depth[] = ['none', 'light', 'substantial', 'hard']
export const VOLUMES: readonly Volume[] = ['small', 'medium', 'large']
export const KINDS: readonly Kind[] = ['answer', 'edit', 'investigate', 'mixed']
export const RELATIONS: readonly Relation[] = ['new', 'continue', 'refine', 'dissatisfied']
export const TIERS: readonly Tier[] = ['trivial', 'simple', 'moderate', 'complex', 'deep']

/** Tier cũ suy ra từ depth và volume: ngân sách tool call và nhãn hiển thị. */
export function tierOf(depth: Depth, volume: Volume): Tier {
  const table: Record<Depth, Record<Volume, Tier>> = {
    none: { small: 'trivial', medium: 'simple', large: 'simple' },
    light: { small: 'simple', medium: 'moderate', large: 'moderate' },
    substantial: { small: 'moderate', medium: 'complex', large: 'complex' },
    hard: { small: 'complex', medium: 'deep', large: 'deep' },
  }
  return table[depth][volume]
}

/** Dữ liệu cũ (0.1.x) chỉ có tier: đổi sang depth và volume tương đương. */
export function legacyOf(tier: Tier): { depth: Depth; volume: Volume } {
  switch (tier) {
    case 'trivial':
      return { depth: 'none', volume: 'small' }
    case 'simple':
      return { depth: 'light', volume: 'small' }
    case 'moderate':
      return { depth: 'light', volume: 'medium' }
    case 'complex':
      return { depth: 'substantial', volume: 'medium' }
    case 'deep':
      return { depth: 'hard', volume: 'large' }
  }
}
