// Lệnh /conductor: pane, status, mode, goal, reroute, reset, pause, resume.

import { atom, derive, read, update } from 'claude-code'
import type { Brief, Core, QuotaCheckpoint } from '../../types'
import { buildCheckpoint, forceUntil, pruneKeys, storeKey } from '../lib/checkpoint'
import { EMPTY_QUOTA, evaluateQuota, newPause, normalizeQuota, quotaSettings, reasonsOf } from '../lib/quota'
import { restorableSteps } from '../lib/drift'
import { cacheNote, priceNote } from '../lib/cost'
import { estimateLine, formatUsd, ledgerLines } from '../lib/ledger'
import { describePick } from '../lib/route'
import { clipText } from '../lib/decisions'
import { askRouter, bareBrief, briefOf, nextBrief, parseRoute, rerouted, routerRequest } from '../lib/router'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { briefContext, droppedPlanNotice, quotaStatusLines, renderPlan, resetLabel, unroutedContext } from '../lib/text'
import { PANE, PANE_TITLE } from '../ui/pane'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { COMMAND_HELP } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const resetArmedState = atom({ plugin: 'focus-conductor', key: 'resetArmedUntil' } as const, 0)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

/** /conductor resume discard phải gõ lần hai trong bấy nhiêu ms (như nút Đặt lại). */
const DISCARD_ARM_MS = 10_000

/**
 * /conductor pause: ghi điểm dừng như khi vào vùng dừng (giai đoạn một), vào $.store theo thư mục, bỏ bản thừa để kho
 * còn tối đa năm. Kho từ chối thì trả false (bản sao trong $.state vẫn giữ).
 */
async function savePauseCheckpoint($: EngineInterface, cp: QuotaCheckpoint): Promise<boolean> {
  try {
    const key = storeKey(cp.cwd)
    await $.store.set(key, cp)
    const entries: Array<{ key: string; status: QuotaCheckpoint['status']; createdAt: number }> = []
    for (const k of (await $.store.keys()).filter(k => k.startsWith('checkpoint:'))) {
      const value = (await $.store.get(k)) as Partial<QuotaCheckpoint> | undefined
      entries.push({ key: k, status: value?.status ?? 'consumed', createdAt: value?.createdAt ?? 0 })
    }
    for (const k of pruneKeys(entries, key)) await $.store.delete(k)
    return true
  } catch {
    return false
  }
}

/** Kích thước và thời điểm sửa của các file cho điểm dừng (-1 khi không đọc được). */
async function pauseFileStats($: EngineInterface, paths: readonly string[]): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  const out: Array<{ path: string; mtimeMs: number; size: number }> = []
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(() => null)
    out.push({ path, mtimeMs: stat?.mtimeMs ?? -1, size: stat?.size ?? -1 })
  }
  return out
}

/** Số đo hạn mức tươi cho lệnh (không tốn chi phí); engine không trả được thì null. */
async function commandLimits($: EngineInterface): Promise<readonly unknown[] | null> {
  let usage: { rateLimits?: unknown } | null = null
  try {
    usage = await $.session.usage()
  } catch {
    usage = null
  }
  return usage !== null && Array.isArray(usage.rateLimits) ? usage.rateLimits : null
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

export function registerCommand(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { blocked, flushDecisions, delegationItems, expectedMain, failures, noteRouterTime, policy, ranText, record, resetLocal, routerFamily, routerModel, routerTimeLine, trackDelegations, untrackedAgents, wantedPick } = ctx
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
      await showStatus($, await read($, view), ctx.options)
      return { text: `Focus Conductor chuyển sang chế độ ${arg}.` }
    }

    if (sub === 'reset') {
      resetLocal()
      await update($, coreState, S.resetCore)
      await update($, resetArmedState, () => 0)
      await showStatus($, await read($, view), ctx.options)
      return { text: 'Đã xóa mục tiêu, checklist, cảnh báo, mục tiêu đã cất, sổ chi phí và danh sách model bị chặn. Giữ nhật ký điều phối và hệ số hiệu chỉnh đã học.' }
    }

    if (sub === 'goal') {
      if (arg === '') return { text: 'Cần mô tả mục tiêu: /conductor goal kèm mô tả' }
      const before = S.normalizeCore(await read($, coreState))
      const prev = before.brief
      const rules = policy()
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng sau các lần lỗi.
      const request = routerRequest({ text: arg, prev, ran: null, policy: rules, model: routerModel, isForcedNew: true })
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules))
      noteRouterTime((await $.clock.now()) - startedAt)
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
        return S.withAnalyzerUsage(outcome.usages, routerFamily)(withRoute)
      })
      L.lastPrompt = null
      L.isGoalNew = true
      L.pinnedGoalId = null
      record(now, plan !== null ? 'route' : 'router-fail', { command: 'goal', prompt: clipText(arg), reason: outcome.reason, retried: outcome.retried })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
      const dropped = restorableSteps(before.plan)
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
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules))
      noteRouterTime((await $.clock.now()) - startedAt)
      const now = await $.clock.now()
      const withUsage = (c: Core): Core =>
        S.withAnalyzerUsage(outcome.usages, routerFamily)(c)
      const plan = outcome.result
      if (plan === null) {
        await update($, coreState, withUsage)
        record(now, 'router-fail', { command: 'reroute', prompt: clipText(last.text), reason: outcome.reason, retried: outcome.retried })
        await flushDecisions((path, text) => $.fs.write(path, text))
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
      await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
      const core = S.normalizeCore(await read($, coreState))
      const isApplied = (await read($, mode)) === 'auto'
      const wanted = wantedPick(brief, core.lift)
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      record(now, 'reroute', { prompt: clipText(last.text), relation: plan.relation, confidence: plan.confidence, retried: outcome.retried, main: brief.main, expected })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      return {
        text: `Router đã đọc lại prompt gần nhất: ${brief.goal} (${brief.depth}, khối lượng ${brief.volume}, luồng chính ${expected ? describePick(expected) + (isApplied ? '' : ' (chỉ đề xuất)') : 'model của phiên'}).`,
        context: [`Người dùng yêu cầu router đọc lại prompt gần nhất.\n${briefContext(brief, expected, isApplied)}`],
      }
    }

    if (sub === 'pause') {
      // Người dùng chủ động dừng: cùng đường dừng mềm (tool bị từ chối trừ plan) và ghi điểm dừng ngay.
      const settings = quotaSettings(ctx.options)
      if (!settings.enabled) return { text: 'Bảo vệ hạn mức đang tắt (quotaGuard false); /conductor pause không có tác dụng.' }
      const now = await $.clock.now()
      const q = normalizeQuota(await read($, quotaState))
      if (q.pause?.source === 'user') return { text: 'Đang tạm dừng theo yêu cầu; dùng /conductor resume để chạy tiếp.' }
      const core = S.normalizeCore(await read($, coreState))
      const goalId = core.brief?.goalId ?? 0
      const root = await $.session.root().catch(() => null)
      const dir = root || ((await $.session.cwd().catch(() => null)) ?? '')
      const cp = buildCheckpoint({
        id: `cp-${now}`,
        now,
        cwd: dir,
        reason: [],
        brief: core.brief,
        plan: core.plan,
        delegations: core.delegations.goalId === goalId ? core.delegations.items : [],
        recent: q.recent,
        files: await pauseFileStats($, q.touched.goalId === goalId ? q.touched.paths : []),
        denied: null,
      })
      await update($, quotaState, c => ({ ...normalizeQuota(c), pause: newPause(now, 'user', []), checkpoint: cp, resume: null }))
      const isSaved = await savePauseCheckpoint($, cp)
      if (!isSaved) $.ui.toast('Focus Conductor: không lưu được điểm dừng vào kho của mod; điểm dừng chỉ còn trong phiên này')
      return { text: 'Đã tạm dừng: mọi tool (trừ plan) bị từ chối tới khi dùng /conductor resume. Điểm dừng đã được ghi; prompt sau khi resume sẽ tiếp tục từ đó.' }
    }

    if (sub === 'resume') {
      // Tiếp tục từ điểm dừng: force ép chạy tiếp tới mốc làm mới sớm nhất (không mất điểm dừng); discard bỏ điểm dừng
      // sau khi gõ lần hai trong 10 giây; không tham số thì mở lại sau /conductor pause và báo cách tiếp tục.
      const now = await $.clock.now()
      const q = normalizeQuota(await read($, quotaState))
      const cp = q.checkpoint !== null && q.checkpoint.status !== 'consumed' ? q.checkpoint : null
      if (arg === 'force') {
        // Chỉ miễn các cửa sổ đang chạm ngưỡng lúc gõ force; cửa sổ khác chạm ngưỡng sau đó vẫn dừng.
        const hits = evaluateQuota(await commandLimits($), now, quotaSettings(ctx.options)).hits
        if (hits.length === 0) {
          if (q.pause === null) return { text: 'Không có gì để ép: hạn mức chưa chạm ngưỡng và mod không đang tạm dừng.' }
          await update($, quotaState, c => ({ ...normalizeQuota(c), pause: null, resumeArmed: cp !== null }))
          await showStatus($, await read($, view), ctx.options)
          return { text: `Đã mở tạm dừng; hạn mức chưa chạm ngưỡng nên không cần ép.${cp !== null ? ' Prompt kế tiếp sẽ tiếp tục từ điểm dừng.' : ''}` }
        }
        const until = forceUntil(reasonsOf(hits), now)
        const kinds = hits.map(h => h.kind)
        await update($, quotaState, c => ({ ...normalizeQuota(c), overrideUntil: until, overrideKinds: kinds, pause: null, resumeArmed: cp !== null }))
        await showStatus($, await read($, view), ctx.options)
        return {
          text:
            `Đã ép chạy tiếp ${kinds.map(k => (k === 'five_hour' ? 'hạn mức phiên' : 'hạn mức tuần')).join(' và ')} tới ${resetLabel(new Date(until).toISOString())}; ` +
            `sau mốc đó bảo vệ tự bật lại, cửa sổ khác chạm ngưỡng vẫn dừng.${cp !== null ? ' Điểm dừng giữ nguyên: prompt kế tiếp sẽ tiếp tục từ đó.' : ''}`,
        }
      }
      if (arg === 'discard') {
        if (cp === null) return { text: 'Không có điểm dừng nào đang mở cho thư mục này.' }
        if (q.discardArmedUntil <= now) {
          await update($, quotaState, c => ({ ...normalizeQuota(c), discardArmedUntil: now + DISCARD_ARM_MS }))
          return { text: 'Bỏ điểm dừng thì không tiếp tục từ đó được nữa; gõ lại /conductor resume discard trong 10 giây để xác nhận.' }
        }
        const dropped: QuotaCheckpoint = { ...cp, status: 'consumed' }
        await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: dropped, resume: null, discardArmedUntil: 0 }))
        await $.store.set(storeKey(dropped.cwd), dropped).catch(() => undefined)
        return { text: 'Đã bỏ điểm dừng; prompt kế tiếp chạy như bình thường.' }
      }
      if (q.pause?.source === 'user') await update($, quotaState, c => ({ ...normalizeQuota(c), pause: null }))
      if (cp === null) return { text: 'Không có điểm dừng nào đang mở cho thư mục này.' }
      // Prompt kế tiếp tiếp tục điểm dừng dù router xếp nó là việc khác.
      await update($, quotaState, c => ({ ...normalizeQuota(c), resumeArmed: true }))
      return { text: 'Có điểm dừng đang mở: gõ prompt (ví dụ "tiếp tục") để Claude tiếp tục từ đó. Nếu hạn mức chưa làm mới, dùng /conductor resume force.' }
    }

    if (sub === 'status') {
      const { core, mode: current } = await read($, view)
      const usage = await $.session.usage().catch(() => null)
      const costLines = ledgerLines(core.ledger)
      if (core.sysTokens > 0) costLines.push(`Phần cố định của ngữ cảnh (system prompt, tools): ${Math.round(core.sysTokens / 1000)}k token, đo ở đầu phiên`)
      if (usage?.cost) costLines.push(`Chi phí cả phiên theo Claude Code (gồm cả phần trước khi mod bắt đầu ghi sổ): ${formatUsd(usage.cost.usd)}`)
      const estimate = estimateLine(core.log)
      if (estimate) costLines.push(estimate)
      costLines.push(priceNote(await $.clock.now()))
      costLines.push(cacheNote(ctx.cacheTtlMs / 60_000))
      const latency = routerTimeLine()
      if (latency) costLines.push(latency)
      const quotaNow = normalizeQuota(await read($, quotaState))
      costLines.push(
        ...quotaStatusLines({
          enabled: quotaSettings(ctx.options).enabled,
          limits: usage !== null && Array.isArray(usage.rateLimits) ? usage.rateLimits : null,
          thresholds: quotaSettings(ctx.options),
          pause: quotaNow.pause,
          overrideUntil: quotaNow.overrideUntil,
          overrideKinds: quotaNow.overrideKinds,
          checkpoint: quotaNow.checkpoint,
          now: await $.clock.now(),
        }),
      )
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
      const items = core.delegations.goalId === core.brief.goalId ? core.delegations.items : []
      const stateText = { pending: 'chờ giao', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại' } as const
      const delegationBlock = items.length > 0 ? `\nViệc giao subagent:\n${items.map(item => `  ${item.index}. ${item.title}: ${stateText[item.state]}`).join('\n')}` : ''
      const agentBlock = delegationBlock + (agentLines.length > 0 ? `\nSubagent gần nhất:\n${agentLines.join('\n')}` : '') + untrackedLine
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
