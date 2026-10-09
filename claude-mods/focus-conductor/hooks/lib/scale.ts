// Thang đo của việc: độ sâu, khối lượng, bản chất và quan hệ với mục tiêu trước.
// Thuần; tách riêng để analyze, route và state cùng dùng mà không import vòng.

import type { Depth, Kind, Relation, Tier, Volume } from '../../types'

export const DEPTHS: readonly Depth[] = ['none', 'light', 'substantial', 'hard']
export const VOLUMES: readonly Volume[] = ['small', 'medium', 'large']
export const KINDS: readonly Kind[] = ['answer', 'edit', 'investigate', 'mixed']
export const RELATIONS: readonly Relation[] = ['new', 'continue', 'refine', 'dissatisfied']
export const TIERS: readonly Tier[] = ['trivial', 'simple', 'moderate', 'complex', 'deep']

export function depthRank(depth: Depth): number {
  return DEPTHS.indexOf(depth)
}

export function volumeRank(volume: Volume): number {
  return VOLUMES.indexOf(volume)
}

export function maxDepth(a: Depth, b: Depth): Depth {
  return depthRank(a) >= depthRank(b) ? a : b
}

export function maxVolume(a: Volume, b: Volume): Volume {
  return volumeRank(a) >= volumeRank(b) ? a : b
}

/** Dịch độ sâu lên hoặc xuống, kẹp trong thang. */
export function stepDepth(depth: Depth, by: number): Depth {
  const at = Math.min(DEPTHS.length - 1, Math.max(0, depthRank(depth) + by))
  return DEPTHS[at] ?? depth
}

/**
 * Độ sâu của một prompt tiếp nối: tiếp tục giữ nguyên; tinh chỉnh không thấp
 * hơn một bậc so với trước; báo chưa đạt thì tăng một bậc.
 */
export function carryDepth(own: Depth, prev: Depth, relation: Relation): Depth {
  if (relation === 'continue') return prev
  if (relation === 'dissatisfied') return stepDepth(prev, 1)
  if (relation === 'refine') return maxDepth(own, stepDepth(prev, -1))
  return own
}

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
