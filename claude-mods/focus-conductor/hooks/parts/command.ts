// Lệnh /conductor: pane, status, mode, goal, reroute, reset.

import { atom, derive, read, update } from 'claude-code'
import type { Brief, Core } from '../../types'
import { openSteps } from '../lib/drift'
import { priceNote } from '../lib/cost'
import { addUsage, formatUsd, ledgerLines } from '../lib/ledger'
import { describePick } from '../lib/route'
import { clipText } from '../lib/decisions'
import { askRouter, bareBrief, briefOf, nextBrief, parseRoute, rerouted, routerRequest } from '../lib/router'
import * as S from '../lib/state'
import { briefContext, droppedPlanNotice, renderPlan, unroutedContext } from '../lib/text'
import { PANE, PANE_TITLE } from '../ui/pane'
import type { On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { COMMAND_HELP } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

export function registerCommand(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { blocked, decisionLog, decisionText, expectedMain, failures, policy, ranText, record, resetLocal, routerFamily, routerModel, trackDelegations, untrackedAgents, wantedPick } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ------------------------------------------------------- lệnh /conductor

  on('command.run', { command: 'conductor' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()

    if (sub === '' || sub === 'show') {
      const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: opened.isPlaced ? 'Đã mở pane Focus Conductor.' : 'Pane Focus Conductor sẽ hiện khi màn hình đủ rộng.' }
    }

    if (sub === 'mode') {
      if (!S.isMode(arg)) return { text: `Chế độ phải là auto, subagents, suggest hoặc off.\n${COMMAND_HELP}` }
      await update($, modeState, () => arg)
      $.ui.status(S.statusOf(await read($, view)))
      return { text: `Focus Conductor chuyển sang chế độ ${arg}.` }
    }

    if (sub === 'reset') {
      resetLocal()
      await update($, coreState, S.resetCore)
      $.ui.status(S.statusOf(await read($, view)))
      return { text: 'Đã xóa mục tiêu, checklist, cảnh báo, sổ chi phí và danh sách model bị chặn.' }
    }

    if (sub === 'goal') {
      if (arg === '') return { text: 'Cần mô tả mục tiêu: /conductor goal kèm mô tả' }
      const before = S.normalizeCore(await read($, coreState))
      const prev = before.brief
      const rules = policy()
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng sau các lần lỗi.
      const request = routerRequest({ text: arg, prev, ran: null, policy: rules, model: routerModel, isForcedNew: true })
      const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseRoute(reply, rules))
      const plan = outcome.result
      if (plan !== null) L.routerTrouble = { failures: 0, pausedUntil: 0 }
      const now = await $.clock.now()
      const goalId = (prev?.goalId ?? 0) + 1
      // Mục tiêu đặt bằng lệnh luôn là mục tiêu mới; router lỗi thì đặt mục tiêu không có lựa chọn model.
      const brief: Brief = plan ? { ...briefOf(plan, arg, goalId, now), goal: plan.goal || arg.slice(0, 200) } : bareBrief(arg, goalId, now)
      const isApplied = (await read($, mode)) === 'auto'
      // Router lỗi: route cũ bỏ đi, không để status hiện một route mà lượt này không dùng.
      const core = await update($, coreState, c => {
        const adopted = S.adoptGoal(brief)(c)
        const withRoute = plan === null ? S.withRoute(null)(adopted) : adopted
        return outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), withRoute)
      })
      L.lastPrompt = null
      L.isGoalNew = true
      L.pinnedGoalId = null
      record(now, plan !== null ? 'route' : 'router-fail', { command: 'goal', prompt: clipText(arg), reason: outcome.reason, retried: outcome.retried })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      $.ui.status(S.statusOf(await read($, view)))
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      const dropped = openSteps(before.plan)
      const notice = dropped.length > 0 ? [droppedPlanNotice(dropped)] : []
      return {
        text:
          plan !== null
            ? `Đã đặt mục tiêu: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}).`
            : `Đã đặt mục tiêu: ${brief.goal}. Router không đọc được (${outcome.reason}); mod không chọn model cho mục tiêu này.`,
        context: [
          plan !== null
            ? `Người dùng đặt mục tiêu thủ công.\n${briefContext(brief, expected, isApplied)}`
            : `Người dùng đặt mục tiêu thủ công: ${brief.goal}\n${unroutedContext(outcome.reason)}`,
          ...notice,
        ],
      }
    }

    if (sub === 'reroute') {
      if ((await read($, mode)) === 'off') return { text: 'Focus Conductor đang tắt (mode off); bật lại bằng /conductor mode auto.' }
      const before = S.normalizeCore(await read($, coreState))
      const current = before.brief
      const last = L.lastPrompt
      if (last === null || (current?.goalId ?? null) !== last.goalId) {
        return { text: 'Không có prompt nào của mục tiêu hiện tại để router đọc lại. Đặt mục tiêu bằng /conductor goal kèm mô tả.' }
      }
      const rules = policy()
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng.
      const request = routerRequest({ text: last.text, prev: last.prev, ran: ranText(before), policy: rules, model: routerModel })
      const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseRoute(reply, rules))
      const now = await $.clock.now()
      const withUsage = (c: Core): Core =>
        outcome.usages.reduce((acc, usage) => S.withLedger(l => addUsage(l, 'analyzer', routerFamily, usage).ledger)(acc), c)
      const plan = outcome.result
      if (plan === null) {
        await update($, coreState, withUsage)
        record(now, 'router-fail', { command: 'reroute', prompt: clipText(last.text), reason: outcome.reason, retried: outcome.retried })
        if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
        return { text: `Router không đọc được (${outcome.reason}); giữ điều phối hiện tại.` }
      }
      L.routerTrouble = { failures: 0, pausedUntil: 0 }
      const fresh = nextBrief(last.prev, plan, last.text, now)
      // Prompt gần nhất đã lập mục tiêu hiện tại (không phải tiếp nối mục tiêu trước nó).
      const wasNew = current !== null && current.goalId !== (last.prev?.goalId ?? null)
      const archivedPrev = last.prev ? before.archived.findIndex(a => a.brief.goalId === last.prev?.goalId) : -1
      let brief: Brief
      if (current === null || (fresh.isNewGoal && !wasNew)) {
        // Lần trước router lỗi nên prompt chưa lập mục tiêu; giờ router xếp là mục tiêu mới.
        brief = fresh.brief
        await update($, coreState, c => withUsage(S.adoptGoal(brief)(c)))
      } else if (fresh.isNewGoal) {
        brief = rerouted(current, fresh.brief)
        await update($, coreState, c => withUsage(S.withDecision(brief)(c)))
      } else if (wasNew && archivedPrev >= 0) {
        // Lần trước xếp nhầm là mục tiêu mới: khôi phục mục tiêu trước (checklist còn bước mở), áp phần đọc mới lên nó.
        const back = S.restoreArchived(before, archivedPrev + 1)
        const restored = 'error' in back ? null : back
        brief = { ...fresh.brief, goalId: restored?.restored.brief.goalId ?? current.goalId }
        await update($, coreState, c => withUsage(S.withDecision(brief)(restored ? restored.core : c)))
      } else {
        brief = { ...fresh.brief, goalId: current.goalId }
        await update($, coreState, c => withUsage(S.withDecision(brief)(c)))
      }
      L.lastPrompt = { ...last, goalId: brief.goalId }
      L.isGoalNew = true
      L.pinnedGoalId = null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      const core = S.normalizeCore(await read($, coreState))
      const isApplied = (await read($, mode)) === 'auto'
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      record(now, 'reroute', { prompt: clipText(last.text), relation: plan.relation, confidence: plan.confidence, retried: outcome.retried, main: brief.main, expected })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
      $.ui.status(S.statusOf(await read($, view)))
      return {
        text: `Router đã đọc lại prompt gần nhất: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}).`,
        context: [`Người dùng yêu cầu router đọc lại prompt gần nhất.\n${briefContext(brief, expected, isApplied)}`],
      }
    }

    if (sub === 'status') {
      const { core, mode: current } = await read($, view)
      const usage = await $.session.usage().catch(() => null)
      const costLines = ledgerLines(core.ledger)
      if (core.sysTokens > 0) costLines.push(`Phần cố định của ngữ cảnh (system prompt, tools): ${Math.round(core.sysTokens / 1000)}k token, đo ở đầu phiên`)
      if (usage?.cost) costLines.push(`Chi phí cả phiên theo Claude Code (gồm cả phần trước khi mod bắt đầu ghi sổ): ${formatUsd(usage.cost.usd)}`)
      costLines.push(priceNote(await $.clock.now()))
      if (core.brief === null) return { text: [`Chế độ ${current}. Chưa có mục tiêu.`, ...costLines].join('\n') }
      const routeLine = core.route
        ? `${describePick(core.route)} (${core.route.reason})`
        : core.brief.main === null
          ? 'model của phiên (router chưa chọn)'
          : 'model của phiên'
      const blockedLine = blocked.size > 0 ? `\nModel tạm ngừng dùng: ${[...blocked].join(', ')}` : ''
      const judged = `Đánh giá của router: độ sâu ${core.brief.depth}, khối lượng ${core.brief.volume}, bản chất ${core.brief.kind}${core.brief.why ? ` (${core.brief.why})` : ''}`
      const agentLines = core.log
        .filter(entry => entry.where === 'agent')
        .slice(-5)
        .map(entry => {
          const cost = entry.usd !== undefined ? ` ${formatUsd(entry.usd)}${entry.measured ? '' : ' ước tính'}` : ''
          return `  ${entry.label}: ${entry.family}${entry.effort ? `/${entry.effort}` : ''}${cost} (${entry.reason})`
        })
      const untracked = untrackedAgents()
      const untrackedLine =
        untracked.length > 0 ? `\nAgent ngoài điều phối (untracked agent, mod không chấm, không ép, không đo): ${untracked.length} (${[...new Set(untracked)].join(', ')})` : ''
      const agentBlock = (agentLines.length > 0 ? `\nSubagent gần nhất:\n${agentLines.join('\n')}` : '') + untrackedLine
      return {
        text: [
          `Chế độ ${current}`,
          judged,
          `Luồng chính: ${routeLine}${blockedLine}`,
          renderPlan(core.brief, core.plan),
          ...costLines,
        ].join('\n') + agentBlock,
      }
    }

    return { text: COMMAND_HELP }
  })
}
