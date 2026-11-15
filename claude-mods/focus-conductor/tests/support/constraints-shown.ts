// 0.8.9 C2: dựng đầu ra của năm nơi in ràng buộc (context của mục tiêu, context tiếp tục từ điểm dừng, request tiếp nối, request rà
// kế hoạch, mục ràng buộc của pane) cho một danh sách ràng buộc tự soạn. Dùng chung cho test và cho lượt ghi kỳ vọng trên bản cũ.

import type { Engine, On } from 'claude-code/testing'
import { buildCheckpoint } from '../../hooks/lib/checkpoint'
import { planReviewRequest, routerRequest } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { briefContext, resumeContext } from '../../hooks/lib/text'
import { makeBrief } from './commands'
import { PANE, base, plan, submit } from './engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }

/** Ràng buộc tự soạn thứ i (đếm từ 1), dài bằng nhau. */
export const constraintAt = (i: number): string => `Ràng buộc số ${String(i).padStart(3, '0')} giữ nguyên định dạng tệp xuất`
export const constraintList = (n: number): string[] => Array.from({ length: n }, (_, i) => constraintAt(i + 1))

/** Bốn đầu ra dạng chuỗi với `n` ràng buộc, `base` mục đầu là của prompt lập mục tiêu. */
export function printedOutputs(n: number, base = 10): { brief: string; resume: string; followUp: string; review: string } {
  const constraints = constraintList(n)
  const brief = makeBrief({ goal: 'Cập nhật sổ giá', constraints, constraintsBase: base, quality: ['Test xanh'] })
  const cp = buildCheckpoint({
    id: 'c2',
    now: 5_000,
    cwd: '/repo/a',
    reason: [{ kind: 'five_hour', percentUsed: 96, resetsAt: '2100-01-01T00:00:00.000Z', thresholdRemainingPct: 5 }],
    brief,
    plan: [{ id: 1, title: 'Đọc', status: 'doing' }],
    delegations: [],
    recent: [],
    files: [],
    denied: null,
  })
  const request = String(routerRequest({ text: 'làm tiếp', prev: brief, ran: 'opus/high', policy: OPEN, model: 'claude-sonnet-5-5' }).prompt)
  const from = request.indexOf('Previous goal')
  const to = request.indexOf('Main thread ran')
  const review = String(planReviewRequest({ goal: brief.goal, requirements: [], constraints, constraintsBase: base, quality: brief.quality, steps: [{ title: 'Đọc' }], model: 'claude-sonnet-5-5' } as never).prompt)
  return { brief: briefContext(brief, null), resume: resumeContext(cp, []), followUp: request.slice(from, to), review }
}

/** Router giả: prompt đầu 10 ràng buộc, mỗi prompt "thêm ràng buộc k" thêm 10 ràng buộc kế tiếp (parseRoute nhận tối đa 10). */
export function constraintSession(on: On, n: number) {
  return base(on, {
    router: request => {
      const k = Number(/thêm ràng buộc (\d+)/.exec(request)?.[1] ?? '0')
      const from = 10 * k
      const items = constraintList(n).slice(from, Math.min(n, from + 10))
      return k === 0 ? plan({ goal: 'Cập nhật sổ giá', constraints: items }) : plan({ relation: 'refine', intent: 'amend', goal: '', constraints: items })
    },
  })
}

export async function submitConstraints($: Engine, n: number): Promise<void> {
  await submit($, 'Cập nhật sổ giá')
  for (let k = 1; k * 10 < n; k++) await submit($, `thêm ràng buộc ${k}`)
}

/** Chữ của mục ràng buộc trong pane: từ tiêu đề mục tới trước tiêu đề mục kế (tiêu chí chất lượng). */
export async function paneConstraints($: Engine, columns: number): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  const start = texts.findIndex(t => /^(Ràng buộc|Constraints)\b/.test(t))
  const end = texts.findIndex((t, i) => i > start && /^(Tiêu chí chất lượng|Quality criteria)\b/.test(t))
  return start < 0 ? [] : texts.slice(start, end < 0 ? undefined : end)
}
