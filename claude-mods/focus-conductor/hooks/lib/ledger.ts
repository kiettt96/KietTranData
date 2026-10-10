// Sổ chi phí của phiên: cộng token đo được (usage của turn.complete và của
// lượt router) theo ba nhóm luồng chính, subagent và router (khóa 'analyzer'), theo phiên
// và theo mục tiêu. Thuần, không gọi $.

import type { Bucket, Effort, Group, Ledger, ModelFamily, Volume } from '../../types'
import { EFFORT_FACTOR, SIZE, type Tokens, usdOf } from './cost'

export const GROUPS: readonly Group[] = ['main', 'agent', 'analyzer']
const CALIB_MIN = 0.5
const CALIB_MAX = 2

export function emptyBucket(): Bucket {
  return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }
}

function emptyBuckets(): Record<Group, Bucket> {
  return { main: emptyBucket(), agent: emptyBucket(), analyzer: emptyBucket() }
}

export function emptyLedger(goalId = 0): Ledger {
  return {
    session: emptyBuckets(),
    goal: { goalId, buckets: emptyBuckets(), spawned: 0, fanoutWarned: false },
    calib: { haiku: 1, sonnet: 1, opus: 1, fable: 1 },
    samples: 0,
  }
}

function addTo(bucket: Bucket, usage: Tokens, usd: number): Bucket {
  return {
    calls: bucket.calls + 1,
    input: bucket.input + usage.input_tokens,
    output: bucket.output + usage.output_tokens,
    cacheRead: bucket.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: bucket.cacheWrite + usage.cache_creation_input_tokens,
    usd: bucket.usd + usd,
  }
}

/** Cộng một lượt đã đo vào nhóm, cả phiên lẫn mục tiêu. Trả về USD của lượt đó. */
export function addUsage(
  ledger: Ledger,
  group: Group,
  family: ModelFamily,
  usage: Tokens,
): { ledger: Ledger; usd: number } {
  const usd = usdOf(family, usage)
  const session = { ...ledger.session, [group]: addTo(ledger.session[group], usage, usd) }
  const buckets = { ...ledger.goal.buckets, [group]: addTo(ledger.goal.buckets[group], usage, usd) }
  return { ledger: { ...ledger, session, goal: { ...ledger.goal, buckets } }, usd }
}

/** Tổng USD của phiên theo sổ (ước lượng cộng đo được), để so với số của engine. */
export function sessionUsd(ledger: Ledger): number {
  return GROUPS.reduce((sum, group) => sum + ledger.session[group].usd, 0)
}

/** Ghi nhận một subagent đã được giao trong mục tiêu hiện tại. */
export function countSpawn(ledger: Ledger): Ledger {
  return { ...ledger, goal: { ...ledger.goal, spawned: ledger.goal.spawned + 1 } }
}

/**
 * Hiệu chỉnh hệ số ước lượng của một họ model theo token ra đo được so với
 * token ra ước lượng. Trung bình trượt: giữ 80% hệ số cũ, nhận 20% số mới,
 * kẹp trong khoảng 0,5 đến 2 lần giả định.
 */
export function calibrate(
  ledger: Ledger,
  family: ModelFamily,
  measuredOutput: number,
  volume: Volume,
  effort: Effort,
): Ledger {
  const expected = SIZE[volume].output * EFFORT_FACTOR[effort]
  if (measuredOutput <= 0 || expected <= 0) return ledger
  const ratio = measuredOutput / expected
  const previous = ledger.calib[family]
  const next = Math.min(CALIB_MAX, Math.max(CALIB_MIN, 0.8 * previous + 0.2 * ratio))
  return { ...ledger, calib: { ...ledger.calib, [family]: next }, samples: ledger.samples + 1 }
}

/** Mục tiêu mới: xóa các nhóm của mục tiêu cũ, giữ tổng phiên và hệ số hiệu chỉnh. */
export function nextGoal(ledger: Ledger, goalId: number): Ledger {
  return { ...ledger, goal: { goalId, buckets: emptyBuckets(), spawned: 0, fanoutWarned: false } }
}

/** Reset hoàn toàn (/conductor reset, /clear), giữ hệ số hiệu chỉnh đã học. */
export function resetLedger(ledger: Ledger): Ledger {
  return { ...emptyLedger(0), calib: ledger.calib, samples: ledger.samples }
}

/** USD có độ chính xác vừa đủ để đọc: dưới một xu hiển thị bốn chữ số thập phân. */
export function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`
}

/** Các dòng tóm tắt chi phí cho pane và /conductor status. */
export function ledgerLines(ledger: Ledger): string[] {
  const { main, agent, analyzer } = ledger.session
  const goalUsd = GROUPS.reduce((sum, group) => sum + ledger.goal.buckets[group].usd, 0)
  const lines = [
    `Phiên: ${formatUsd(sessionUsd(ledger))} (luồng chính ${formatUsd(main.usd)} trong ${main.calls} lượt; subagent ${formatUsd(agent.usd)} trong ${agent.calls} lượt; router ${formatUsd(analyzer.usd)} trong ${analyzer.calls} lượt)`,
    `Mục tiêu này: ${formatUsd(goalUsd)}, ${ledger.goal.spawned} subagent đã giao`,
  ]
  if (ledger.samples > 0) {
    const calib = (['haiku', 'sonnet', 'opus', 'fable'] as const).map(f => `${f} ×${ledger.calib[f].toFixed(2)}`)
    lines.push(`Hiệu chỉnh ước lượng theo ${ledger.samples} lần đo: ${calib.join(', ')}`)
  }
  return lines
}
