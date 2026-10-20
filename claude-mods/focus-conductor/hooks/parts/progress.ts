// Tiến độ (0.6.1): phản chiếu danh sách việc Claude Code tự ghi (TodoWrite, TaskCreate, TaskUpdate) để band, pane và
// status line có thanh tiến độ cả khi Claude không dùng tool plan của mod. Chỉ đọc kết quả đã chạy xong; tool lỗi, bị từ
// chối hay vắng mặt trong phiên thì không đổi gì.

import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { clipText } from '../lib/decisions'
import { freshTestRun } from '../lib/drift'
import { applyTaskTool } from '../lib/mirror'
import { EMPTY_QUOTA, normalizeQuota, quotaSettings } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import type { Ctx } from '../context'
import { viewOf } from '../atoms'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó).
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

/** Status line kèm nhãn hạn mức (0.6.1): cùng S.statusText với mọi file khác. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerProgress(on: On, ctx: Ctx): void {
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))

  on('tool.call', { tool: /^(?:TodoWrite|TaskCreate|TaskUpdate)$/ }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.isError === true) return result
    if (S.modeOf(await read($, modeState), ctx.options) === 'off') return result
    const core = S.normalizeCore(await read($, coreState))
    // Subagent ghi danh sách của riêng nó: phản chiếu vào dòng tiến độ của agent đó (2.4), không đụng checklist của luồng chính.
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const item = core.agentProgress.items.find(i => i.agentId === agentId)
      if (item === undefined) return result
      const steps = applyTaskTool(item.steps, e.tool, e as unknown as Record<string, unknown>, result.result)
      if (steps !== null) await update($, coreState, S.withAgentSteps(agentId, steps))
      return result
    }
    // Chưa có mục tiêu, hoặc checklist của tool plan đã có bước (tool plan luôn thắng): không phản chiếu.
    if (core.brief === null || core.plan.length > 0) return result
    const goalId = core.brief.goalId
    const before = core.mirror.goalId === goalId ? core.mirror.steps : []
    const next_ = applyTaskTool(before, e.tool, e as unknown as Record<string, unknown>, result.result)
    if (next_ === null) return result
    // Lệnh test đã đạt sau thay đổi cuối thì các bước done của danh sách nâng thành verified ngay trong cùng lần ghi (0.7.1), để status
    // line không thoáng hiện bước đã hạ về done rồi mới nâng lại.
    const fresh = freshTestRun(ctx.evidenceFor(goalId))
    const isVerifying = fresh !== undefined && next_.some(s => s.status === 'done')
    await update($, coreState, c => (isVerifying ? S.withAutoVerified(fresh.command)(S.withMirror(goalId, next_)(c)) : S.withMirror(goalId, next_)(c)))
    if (isVerifying) {
      ctx.record(await $.clock.now(), 'verify-auto', { command: clipText(fresh.command), at: 'mirror' })
      await ctx.flushDecisions((path, text) => $.fs.write(path, text))
    }
    await showStatus($, await read($, view), ctx.options)
    return result
  }).catch(($, e, next) => next(e))
}
