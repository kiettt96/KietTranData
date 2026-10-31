// Sổ chi phí của phiên: cộng token đo được (usage của turn.complete và của
// lượt router) theo ba nhóm luồng chính, subagent và router (khóa 'analyzer'), theo phiên
// và theo mục tiêu. Thuần, không gọi $.

import type { Bucket, Depth, Effort, Group, Kind, Ledger, ModelFamily, RouteEvent, Volume } from '../../types'
import { EFFORT_FACTOR, SIZE, SYSTEM_TOKENS, type Tokens, usdOf } from './cost'

export const GROUPS: readonly Group[] = ['main', 'agent', 'analyzer']
const CALIB_MIN = 0.5
const CALIB_MAX = 2
/** Số lần đo tối thiểu của một dạng việc trước khi dùng nó để ước lượng; số lần đo tối đa tính trung bình. */
export const SHAPE_MIN = 3
const SHAPE_WINDOW = 50

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

/**
 * Cộng một lượt đã đo vào nhóm, cả phiên lẫn mục tiêu. Trả về USD của lượt đó. Lượt luồng chính và subagent còn được tính
 * vào cơ sở so với chạy thuần (xem Baseline); lượt router thì không, vì chạy thuần không có router.
 */
export function addUsage(
  ledger: Ledger,
  group: Group,
  family: ModelFamily,
  usage: Tokens,
): { ledger: Ledger; usd: number } {
  const usd = usdOf(family, usage)
  const session = { ...ledger.session, [group]: addTo(ledger.session[group], usage, usd) }
  const buckets = { ...ledger.goal.buckets, [group]: addTo(ledger.goal.buckets[group], usage, usd) }
  const baseline = accrue(ledger, group, usage, usd)
  return { ledger: { ...ledger, session, goal: { ...ledger.goal, buckets }, ...(baseline !== undefined ? { baseline } : {}) }, usd }
}

/** Cộng một lượt vào cơ sở so với chạy thuần: cùng số token ở giá model phiên, phần ghi cache đổi-model về giá đọc. */
function accrue(ledger: Ledger, group: Group, usage: Tokens, usd: number): Ledger['baseline'] {
  const base = ledger.baseline
  if (base === undefined || base.family === null || group === 'analyzer') return base
  // Chặn trên bằng số token ghi thực của lượt: đổi qua lại trong TTL thì cache họ cũ còn sống, số ghi thực nhỏ hơn ngữ cảnh.
  // Phần ghi mới của chính lượt này (không do đổi model) không tách được nên cũng bị coi là đọc: lợi ích ước tính thiên về thấp.
  const shifted = group === 'main' ? Math.min(base.rewrite, usage.cache_creation_input_tokens) : 0
  const pure = usdOf(base.family, {
    ...usage,
    cache_read_input_tokens: usage.cache_read_input_tokens + shifted,
    cache_creation_input_tokens: usage.cache_creation_input_tokens - shifted,
  })
  return {
    ...base,
    rewrite: group === 'main' ? 0 : base.rewrite,
    pure: { session: base.pure.session + pure, goal: base.pure.goal + pure },
    covered: { session: base.covered.session + usd, goal: base.covered.goal + usd },
  }
}

/**
 * Đầu mỗi turn luồng chính: ghi model và effort của phiên (người dùng chọn) và của lượt mod phục vụ, và tính phần ghi cache
 * mà chạy thuần đã đọc được. Mod đổi họ model so với turn trước: cả ngữ cảnh; chỉ đổi effort: ngữ cảnh trừ phần cố định.
 * Không bù khi cache đã nguội hoặc vừa nén (chạy thuần cũng phải ghi), khi chưa có turn trước, hay khi chính người dùng đổi
 * model hoặc effort của phiên (chạy thuần cũng mất cache).
 */
export function planSwitch(
  ledger: Ledger,
  args: {
    turnId: string
    session: { family: ModelFamily | null; effort: string }
    served: { family: ModelFamily; effort: string } | null
    context: number
    isFree: boolean
    sysTokens: number
  },
): Ledger {
  const prev = ledger.baseline
  if (prev !== undefined && prev.turn === args.turnId) return ledger
  const previous = prev?.served ?? null
  const { served } = args
  const isUserSwitch = prev !== undefined && prev.family !== null && args.session.family !== null && (prev.family !== args.session.family || prev.effort !== args.session.effort)
  let rewrite = 0
  if (!args.isFree && !isUserSwitch && previous !== null && served !== null) {
    if (previous.family !== served.family) rewrite = args.context
    else if (previous.effort !== served.effort) rewrite = Math.max(0, args.context - (args.sysTokens > 0 ? args.sysTokens : SYSTEM_TOKENS))
  }
  const baseline = {
    turn: args.turnId,
    family: args.session.family ?? prev?.family ?? null,
    effort: args.session.family !== null ? args.session.effort : (prev?.effort ?? ''),
    served,
    rewrite,
    pure: prev?.pure ?? { session: 0, goal: 0 },
    covered: prev?.covered ?? { session: 0, goal: 0 },
  }
  return { ...ledger, baseline }
}

/** USD ghi dạng có dấu: dương là tiết kiệm, âm là tốn thêm. */
function netText(net: number, lang: 'vi' | 'en'): string {
  if (lang === 'en') return net >= 0 ? `saves ~${formatCost(net, lang)}` : `costs ~${formatCost(-net, lang)} more`
  return net >= 0 ? `tiết kiệm ~${formatCost(net, lang)}` : `tốn thêm ~${formatCost(-net, lang)}`
}

/**
 * Một dòng lợi ích ròng so với chạy thuần theo model của phiên, cả phiên lẫn mục tiêu này: chi phí chạy thuần của đúng các
 * lượt đã đo trừ (chi phí thật của các lượt đó cộng chi phí router). Cùng số token nên không tính chênh lệch token ra giữa
 * các model hay effort. Null khi chưa có lượt nào được tính.
 */
export function netLine(ledger: Ledger, lang: 'vi' | 'en' = 'vi'): string | null {
  const base = ledger.baseline
  if (base === undefined || base.family === null || base.covered.session <= 0) return null
  const session = base.pure.session - (base.covered.session + ledger.session.analyzer.usd)
  const goal = base.pure.goal - (base.covered.goal + ledger.goal.buckets.analyzer.usd)
  if (lang === 'en') return `Versus running plain ${base.family}: session ${netText(session, lang)}, this goal ${netText(goal, lang)} (estimated on the same tokens, router cost included)`
  return `So với chạy thuần ${base.family}: phiên ${netText(session, lang)}, mục tiêu này ${netText(goal, lang)} (ước tính theo cùng số token, đã tính chi phí router)`
}

/** Tổng USD của phiên theo sổ (ước lượng cộng đo được), để so với số của engine. */
export function sessionUsd(ledger: Ledger): number {
  return GROUPS.reduce((sum, group) => sum + ledger.session[group].usd, 0)
}

/** Ghi nhận một subagent đã được giao trong mục tiêu hiện tại. */
/** Một lời gọi Agent chạy thật ở luồng chính; `isUnplanned` (0.7.5): không khớp việc đã phân, tính cho cảnh báo fan-out. */
export function countSpawn(ledger: Ledger, isUnplanned = true): Ledger {
  return { ...ledger, goal: { ...ledger.goal, spawned: ledger.goal.spawned + 1, unplanned: (ledger.goal.unplanned ?? 0) + (isUnplanned ? 1 : 0) } }
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

export function shapeKey(depth: Depth, volume: Volume, kind: Kind): string {
  return `${depth}/${volume}/${kind}`
}

/**
 * Ghi token ra đo được của một turn vào dạng việc của nó, quy về effort medium. Trung bình cộng dồn tới
 * SHAPE_WINDOW lần đo, sau đó là trung bình trượt (số đo mới vẫn được tính).
 */
export function recordShape(ledger: Ledger, key: string, measuredOutput: number, effort: Effort): Ledger {
  if (measuredOutput <= 0) return ledger
  const shapes = ledger.shapes ?? {}
  const old = shapes[key] ?? { samples: 0, output: 0 }
  const normalized = measuredOutput / EFFORT_FACTOR[effort]
  const weight = Math.min(old.samples, SHAPE_WINDOW - 1)
  const output = (old.output * weight + normalized) / (weight + 1)
  return { ...ledger, shapes: { ...shapes, [key]: { samples: old.samples + 1, output } } }
}

/** Token ra ước lượng cho một dạng việc ở effort đã cho; null khi chưa đủ SHAPE_MIN lần đo. */
export function shapeOutput(ledger: Ledger, key: string, effort: Effort): number | null {
  const shape = ledger.shapes?.[key]
  return shape !== undefined && shape.samples >= SHAPE_MIN ? shape.output * EFFORT_FACTOR[effort] : null
}

/** Mục tiêu mới: xóa các nhóm của mục tiêu cũ, giữ tổng phiên và hệ số hiệu chỉnh. */
export function nextGoal(ledger: Ledger, goalId: number): Ledger {
  const base = ledger.baseline
  return {
    ...ledger,
    goal: { goalId, buckets: emptyBuckets(), spawned: 0, fanoutWarned: false },
    ...(base !== undefined ? { baseline: { ...base, pure: { ...base.pure, goal: 0 }, covered: { ...base.covered, goal: 0 } } } : {}),
  }
}

/** Reset hoàn toàn (/conductor reset, /clear), giữ hệ số hiệu chỉnh đã học; cơ sở so với chạy thuần bắt đầu lại. */
export function resetLedger(ledger: Ledger): Ledger {
  return { ...emptyLedger(0), calib: ledger.calib, samples: ledger.samples, ...(ledger.shapes ? { shapes: ledger.shapes } : {}) }
}

/**
 * Chi phí hiển thị ở mọi nơi (band, pane, nhật ký, /conductor status): hai chữ số thập phân, dấu phẩy thập phân khi giao diện
 * tiếng Việt, dấu chấm khi tiếng Anh; dương mà dưới 0,01 thì "<$0,01".
 */
export function formatCost(value: number, lang: 'vi' | 'en'): string {
  const mark = lang === 'vi' ? ',' : '.'
  if (value > 0 && value < 0.01) return `<$0${mark}01`
  return `$${value.toFixed(2).replace('.', mark)}`
}

/** Các dòng tóm tắt chi phí cho pane và /conductor status. */
export function ledgerLines(ledger: Ledger, lang: 'vi' | 'en' = 'vi'): string[] {
  const { main, agent, analyzer } = ledger.session
  const goalUsd = GROUPS.reduce((sum, group) => sum + ledger.goal.buckets[group].usd, 0)
  const c = (value: number): string => formatCost(value, lang)
  const lines =
    lang === 'en'
      ? [
          `Session, measured: ${c(sessionUsd(ledger))} (main thread ${c(main.usd)} in ${main.calls} turns; subagents ${c(agent.usd)} in ${agent.calls} turns; router ${c(analyzer.usd)} in ${analyzer.calls} turns)`,
          `This goal, measured: ${c(goalUsd)}, ${ledger.goal.spawned} subagents delegated`,
        ]
      : [
          `Phiên, đo được: ${c(sessionUsd(ledger))} (luồng chính ${c(main.usd)} trong ${main.calls} lượt; subagent ${c(agent.usd)} trong ${agent.calls} lượt; router ${c(analyzer.usd)} trong ${analyzer.calls} lượt)`,
          `Mục tiêu này, đo được: ${c(goalUsd)}, ${ledger.goal.spawned} subagent đã giao`,
        ]
  const net = netLine(ledger, lang)
  if (net !== null) lines.push(net)
  if (ledger.samples > 0) {
    const calib = (['haiku', 'sonnet', 'opus', 'fable'] as const).map(f => `${f} ×${ledger.calib[f].toFixed(2)}`)
    lines.push(lang === 'en' ? `Estimate calibration from ${ledger.samples} measurements: ${calib.join(', ')}` : `Hiệu chỉnh ước lượng theo ${ledger.samples} lần đo: ${calib.join(', ')}`)
  }
  const shapes = Object.entries(ledger.shapes ?? {})
    .filter(([, shape]) => shape.samples >= SHAPE_MIN)
    .sort((a, b) => b[1].samples - a[1].samples)
    .slice(0, 4)
    .map(([key, shape]) => `${key} ~${(shape.output / 1000).toFixed(1)}k (${shape.samples} ${lang === 'en' ? 'times' : 'lần'})`)
  if (shapes.length > 0) lines.push(lang === 'en' ? `Measured output tokens by work shape (normalized to medium effort): ${shapes.join('; ')}` : `Token ra đo được theo dạng việc (quy về effort medium): ${shapes.join('; ')}`)
  return lines
}

/**
 * Phần chi phí còn là ước tính: subagent đã giao mà chưa có số đo (ước tính lúc giao từ token ra giả định theo khối
 * lượng việc, hệ số hiệu chỉnh và số đo theo dạng việc khi có). Sổ ở trên chỉ gồm số đo; null khi không còn ước tính.
 */
export function estimateLine(log: readonly RouteEvent[], lang: 'vi' | 'en' = 'vi'): string | null {
  const pending = log.filter(entry => entry.where === 'agent' && entry.usd !== undefined && entry.measured !== true)
  if (pending.length === 0) return null
  const usd = pending.reduce((sum, entry) => sum + (entry.usd ?? 0), 0)
  if (lang === 'en') {
    return `Estimated at delegation, not measured yet: ${formatCost(usd, lang)} for ${pending.length} subagent${pending.length === 1 ? '' : 's'} (assumed output tokens by work volume; replaced by measurements when each agent finishes)`
  }
  return `Ước tính lúc giao, chưa có số đo: ${formatCost(usd, lang)} cho ${pending.length} subagent (giả định token ra theo khối lượng việc; được thay bằng số đo khi agent kết thúc)`
}
