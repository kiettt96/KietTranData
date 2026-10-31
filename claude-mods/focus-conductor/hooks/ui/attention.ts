// Dòng cần chú ý của band (0.7.6, U2): các việc người dùng có thể phải can thiệp, xếp theo mức độ chứ không theo thời điểm.
// Thứ tự: tạm dừng > lô lỗi chưa giao lại > sửa ngoài phạm vi > báo hạn mức mềm > mục bị bỏ > bước chưa kiểm chứng > vượt ngân sách
// tool call > các cảnh báo khác. Hàm thuần: chỉ đọc View và dữ liệu hạn mức mà hook đã tính; không đổi cảnh báo đã lưu.

import type { Core, Warning, WarningKind } from '../../types'
import type { Severity } from './style'
import { severityOf } from './style'
import { labels, shownWarning } from './labels'
import type { Lang } from './labels'

/** Một mục cần chú ý: hạng (nhỏ là quan trọng hơn), mức màu và câu hiển thị; `warning` là cảnh báo đã lưu mà mục này đại diện (pane dùng để không hiện hai lần). */
export type Attention = { rank: number; severity: Severity; text: string; kind: 'pause' | 'failed' | 'notice' | WarningKind; warning?: Warning }

/** Hạng của từng loại cảnh báo đã lưu; loại không có trong bảng xếp sau vượt ngân sách. */
const WARNING_RANK: Partial<Record<WarningKind, number>> = { scope: 2, dropped: 4, unverified: 5, budget: 6 }
const OTHER_RANK = 7

/** Số lô hay việc giao subagent đã lỗi mà chưa giao lại trong mục tiêu đang mở. */
export function failedBatches(core: Core): number {
  const brief = core.brief
  if (brief === null) return 0
  const tallies = core.agentProgress.goalId === brief.goalId ? (core.agentProgress.tally ?? []) : []
  const tallied = new Set(tallies.map(t => t.taskIndex).filter((n): n is number => n !== undefined))
  const fromTallies = tallies.reduce((sum, t) => sum + t.failed, 0)
  const delegations = core.delegations.goalId === brief.goalId ? core.delegations.items : []
  return fromTallies + delegations.filter(d => d.state === 'failed' && !tallied.has(d.index)).length
}

/**
 * Các mục cần chú ý của mục tiêu đang mở, đã xếp. `paused`: đang tạm dừng (hạn mức hay người dùng); `notice`: câu báo hạn mức mềm, hay null.
 * Cảnh báo chi phí không lên band (0.7.5); cảnh báo vượt ngân sách tool call không lên band khi mục tiêu có giao subagent theo kế hoạch,
 * vì số tool call khi giao nhiều lô là dự kiến (vẫn lưu và vẫn chèn như cũ). Cùng hạng thì mục mới hơn trước.
 */
export function attentionItems(core: Core, lang: Lang, quota: { paused: boolean; notice: string | null } = { paused: false, notice: null }): Attention[] {
  const brief = core.brief
  if (brief === null) return []
  const l = labels(lang)
  const items: (Attention & { order: number })[] = []
  if (quota.paused) items.push({ rank: 0, severity: 'warning', text: l.quotaPaused, kind: 'pause', order: 0 })
  const failed = failedBatches(core)
  if (failed > 0) items.push({ rank: 1, severity: 'error', text: l.attentionFailed(failed), kind: 'failed', order: 0 })
  if (quota.notice !== null) items.push({ rank: 3, severity: 'warning', text: quota.notice, kind: 'notice', order: 0 })
  const isPlannedFanout = brief.tasks.some(task => task.run === 'agent')
  core.warnings
    .filter(w => w.at >= brief.at && w.kind !== 'cost' && !(w.kind === 'budget' && isPlannedFanout))
    .forEach((w, i) => items.push({ rank: WARNING_RANK[w.kind] ?? OTHER_RANK, severity: severityOf(w.kind), text: shownWarning(w.text, lang), kind: w.kind, warning: w, order: -i }))
  return items.sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ order: _order, ...item }) => item)
}
