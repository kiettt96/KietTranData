// Lệnh /conductor: pane, status, mode, goal, reroute, reset, pause, resume.

import { atom, derive, read, update } from 'claude-code'
import { caught } from '../lib/errlog'
import type { Brief, Core, Depth, QuotaCheckpoint } from '../../types'
import { buildCheckpoint, forceUntil, pruneKeys, storeKey } from '../lib/checkpoint'
import { EMPTY_QUOTA, evaluateQuota, newPause, normalizeQuota, quotaSettings, reasonsOf } from '../lib/quota'
import { restorableSteps } from '../lib/drift'
import { cacheNote, priceNote } from '../lib/cost'
import { estimateLine, formatCost, ledgerLines } from '../lib/ledger'
import { describePick } from '../lib/route'
import { clipText } from '../lib/decisions'
import { askRouter, bareBrief, briefOf, failFields, nextBrief, parseRoute, rerouted, routerFailOf, routerRequest } from '../lib/router'
import { shownPlan } from '../lib/mirror'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { RETRY_ROUNDS, WAIVE_REPORT, briefContext, checkHintLines, droppedGoalNotice, headlessOffNote, droppedItemsText, droppedPlanNotice, quotaStatusLines, renderPlan, resetLabel, routerFailLines, unroutedContext } from '../lib/text'
import { PANE_ROWS, shouldAutoOpenPane } from '../lib/pane'
import { PANE, PANE_TITLE } from '../ui/pane'
import { conductStatusSuffix, conductorLine, labels, langOf } from '../ui/labels'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { COMMAND_HELP } from '../context'
import { isBigGoal } from '../lib/conductor'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const resetArmedState = atom({ plugin: 'focus-conductor', key: 'resetArmedUntil' } as const, 0)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
// Cờ phiên không tương tác đặt mode off (0.8.0 A13), cùng khóa với parts/session.ts; chỉ đọc để /conductor nêu lý do (0.8.7 H1).
const headlessState = atom({ plugin: 'focus-conductor', key: 'headlessOff' } as const, false)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)
// Mục tiêu mà người dùng đã tự đóng pane chi tiết (-1 là chưa); ghi ở hook ui.close của parts/ui.tsx.
const paneClosedState = atom({ plugin: 'focus-conductor', key: 'paneClosedGoal' } as const, -1)

/** Mở pane chi tiết cho mục tiêu mới nếu cần (0.7.2), như parts/session.ts: không focus; kết quả ghi vào nhật ký quyết định. */
async function autoOpenPane($: EngineInterface, ctx: Ctx, goalId: number, at: number, depth: Depth | null): Promise<void> {
  const panes = await $.ui.panes().catch(caught('ui.panes', []))
  const isOpen = panes.some(pane => pane.id === PANE)
  if (!shouldAutoOpenPane({ enabled: ctx.autoPane, goalId, closedGoal: await read($, paneClosedState), isOpen, depth })) return
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS }).catch(caught('ui.open', null))
  // Chỉ ghi khi pane chưa được đặt (màn hình hẹp, chưa có surface, engine từ chối): đặt được là trường hợp bình thường, không cần dòng log.
  if (opened?.isPlaced === true) return
  ctx.record(at, 'pane', { goalId, isPlaced: false, reason: opened === null ? 'engine từ chối mở pane' : opened.reason })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text))
}

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
    const stat = await $.fs.stat(path).catch(caught('fs.stat', null))
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

/** Lệnh kiểm chưa đạt của mục tiêu hiện tại cho /conductor status (0.7.8 vòng sửa 3, W4): lượt và mức của từng lượt. */
function retryLines(core: Core): string[] {
  if (core.brief === null || core.retry.goalId !== core.brief.goalId || core.retry.items.length === 0) return []
  // Đánh số để /conductor waive N chọn đúng lệnh (0.7.9 Y5); lệnh đã miễn ghi kèm.
  const rows = core.retry.items.map((item, i) => {
    const name = item.more.length > 0 ? `và ${item.more.length} lệnh khác` : item.command
    const state = item.exhausted ? `hết ${RETRY_ROUNDS} lượt, chưa đạt` : `lượt ${item.round}/${RETRY_ROUNDS}`
    return `  ${i + 1}. ${name}: ${state}; mức ${item.levels.join(', ')}${S.isWaived(core, item.sig) ? ' (đã miễn)' : ''}`
  })
  return [`Lệnh kiểm chưa đạt:\n${rows.join('\n')}`]
}

/** Lệnh kiểm chủ mod đã miễn trong mục tiêu (0.7.9 Y5): số thứ tự, lệnh, lý do, lượt lúc miễn. */
function waiverLines(core: Core): string[] {
  if (core.brief === null || core.waivers.goalId !== core.brief.goalId || core.waivers.items.length === 0) return []
  const rows = core.waivers.items.map((w, i) => `  ${i + 1}. ${w.command}: ${w.reason} (lượt ${w.round})`)
  return [`${WAIVE_REPORT}:\n${rows.join('\n')}`]
}

/** Nơi phát lệnh được nhận cho /conductor waive (0.7.9 Y5): người gõ ở terminal hay qua Remote Control; plugin, SDK, lịch thì không. */
const WAIVE_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])
const WAIVE_REASON_MIN = 10
const WAIVE_USAGE = `Cách dùng: /conductor waive <số thứ tự hoặc lệnh> <lý do từ ${WAIVE_REASON_MIN} ký tự>; số thứ tự lấy từ mục "Lệnh kiểm chưa đạt" của /conductor status. Bỏ lệnh miễn: /conductor waive undo <số thứ tự>.`

export function registerCommand(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { blocked, flushDecisions, delegationItems, expectedMain, failures, noteRouterTime, ranText, record, resetLocal, routerTimeLine, trackDelegations, untrackedAgents, wantedPick } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ------------------------------------------------------- lệnh /conductor

  on('command.run', { command: 'conductor' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()

    if (sub === '' || sub === 'show') {
      const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
      const head = opened.isPlaced ? 'Đã mở pane Focus Conductor.' : 'Pane Focus Conductor sẽ hiện khi màn hình đủ rộng.'
      const core = S.normalizeCore(await read($, coreState))
      return { text: [head, ...retryLines(core), ...waiverLines(core)].join('\n') }
    }

    if (sub === 'waive') {
      // Chỉ người gõ (0.7.9 Y5): origin do engine đóng dấu (composer, bridge); Claude và plugin không có đường tự miễn.
      if (!WAIVE_ORIGINS.has(e.origin.kind)) return { text: 'Chỉ nhận /conductor waive do người gõ; lệnh từ plugin, SDK hay lịch không miễn được.' }
      const core = S.normalizeCore(await read($, coreState))
      if (core.brief === null || core.retry.goalId !== core.brief.goalId) return { text: `Không có lệnh kiểm chưa đạt nào trong mục tiêu này. ${WAIVE_USAGE}` }
      const goalId = core.brief.goalId
      const waivers = core.waivers.goalId === goalId ? core.waivers.items : []
      const now = await $.clock.now()
      if (rest[0] === 'undo') {
        const index = Number(rest[1]) - 1
        const waiver = Number.isInteger(index) ? waivers[index] : undefined
        if (waiver === undefined) return { text: `Không có lệnh miễn số ${rest[1] ?? ''}. ${WAIVE_USAGE}` }
        const old = waiver.step
        await update($, coreState, c => {
          const next = S.withWaivers({ goalId, items: waivers.filter(w => w !== waiver) })(c)
          return old === null ? next : S.withPlan(next.plan.map(s => (s.id === old.id ? { ...s, status: old.status, note: old.note ?? undefined } : s)))(next)
        })
        record(now, 'waive-undo', { signature: waiver.sig, round: waiver.round })
        await flushDecisions((path, text) => $.fs.write(path, text))
        await showStatus($, await read($, view), ctx.options)
        return { text: `Đã bỏ lệnh miễn của \`${waiver.command}\`; lệnh quay lại lượt ${waiver.round}/${RETRY_ROUNDS}.` }
      }
      const byIndex = /^\d+$/.test(rest[0] ?? '') ? core.retry.items[Number(rest[0]) - 1] : undefined
      const byCommand = byIndex === undefined ? [...core.retry.items].filter(item => item.command !== '' && (arg === item.command || arg.startsWith(`${item.command} `))).sort((a, b) => b.command.length - a.command.length)[0] : undefined
      const item = byIndex ?? byCommand
      const reason = (byIndex !== undefined ? rest.slice(1).join(' ') : item !== undefined ? arg.slice(item.command.length) : '').trim()
      if (item === undefined || item.more.length > 0) return { text: `Không thấy lệnh kiểm chưa đạt đó. ${WAIVE_USAGE}` }
      if (reason.length < WAIVE_REASON_MIN) return { text: `Cần lý do từ ${WAIVE_REASON_MIN} ký tự trở lên. ${WAIVE_USAGE}` }
      if (waivers.some(w => w.sig === item.sig)) return { text: `\`${item.command}\` đã được miễn trong mục tiêu này.` }
      // Bước blocked mod đã ghi cho lệnh này thành skipped, giữ trạng thái và note cũ cho waive undo.
      const target = item.step !== null ? core.plan.find(s => s.id === item.step && s.status === 'blocked') : undefined
      const waiver = { sig: item.sig, command: item.command, reason, round: item.round, asked: false, step: target === undefined ? null : { id: target.id, status: target.status, note: target.note ?? null } }
      await update($, coreState, c => {
        const next = S.withWaivers({ goalId, items: [...waivers, waiver] })(c)
        return target === undefined ? next : S.withPlan(next.plan.map(s => (s.id === target.id ? { ...s, status: 'skipped' as const, note: `miễn bởi chủ mod: ${reason}` } : s)))(next)
      })
      record(now, 'waive', { signature: item.sig, reason, round: item.round })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      return { text: `Đã miễn \`${item.command}\` cho mục tiêu này (lượt ${item.round}/${RETRY_ROUNDS}): không còn chặn kết thúc. Câu trả lời cuối cần mục "${WAIVE_REPORT}".` }
    }

    if (sub === 'approve') {
      // Duyệt kế hoạch (0.8.2 N2): chỉ người gõ, cùng luật origin như /conductor waive; Claude và plugin không tự duyệt được.
      const isTyped = WAIVE_ORIGINS.has(e.origin.kind)
      if (!isTyped) return { text: 'Chỉ nhận /conductor approve do người gõ; lệnh từ plugin, SDK hay lịch không duyệt được kế hoạch.' }
      const core = S.normalizeCore(await read($, coreState))
      if (core.brief === null || !S.isPlanGated(core)) return { text: 'Không có kế hoạch nào đang chờ duyệt.' }
      await update($, coreState, S.withApproval({ ...S.approvalOf(core), status: 'approved' }))
      record(await $.clock.now(), 'approval', { goalId: core.brief.goalId, status: 'approved', cause: 'command' })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      return { text: 'Đã duyệt kế hoạch; Claude được sửa file theo checklist.' }
    }

    if (sub === 'solo') {
      // Lối thoát của vai điều phối (0.8.6 R6): chỉ người gõ, cùng luật origin như /conductor waive; Claude và plugin không tự miễn được.
      if (!WAIVE_ORIGINS.has(e.origin.kind)) return { text: 'Chỉ nhận /conductor solo do người gõ; lệnh từ plugin, SDK hay lịch không miễn được vai điều phối.' }
      if (arg !== '' && arg !== 'off') return { text: 'Dùng /conductor solo để luồng chính tự sửa file và tự chạy kiểm trong mục tiêu này, /conductor solo off để bỏ.' }
      const core = S.normalizeCore(await read($, coreState))
      if (core.brief === null || !ctx.isConducting(core, await read($, mode))) return { text: 'Luồng chính không đang giữ vai điều phối nên không có gì để miễn.' }
      const isOn = arg !== 'off'
      const goalId = core.brief.goalId
      if (S.conductOf(core).solo !== isOn) {
        await update($, coreState, S.withConduct(goalId, () => ({ solo: isOn })))
        record(await $.clock.now(), 'conduct-exempt', { state: isOn ? 'on' : 'off', reason: 'solo' })
        await flushDecisions((path, text) => $.fs.write(path, text))
      }
      await showStatus($, await read($, view), ctx.options)
      return {
        text: isOn
          ? 'Đã miễn vai điều phối cho mục tiêu này: luồng chính được tự sửa file và tự chạy kiểm; /conductor solo off để bỏ.'
          : 'Đã bỏ miễn: luồng chính lại giao việc sửa file và chạy kiểm cho subagent.',
      }
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
      const basePolicy = ctx.routePolicy(before, ctx.maxForks >= 2 ? await $.session.root().catch(caught('session.root', null)) : null)
      const rules = ctx.conductorState(before, await read($, mode)) === null ? { ...basePolicy, conductor: true, goalIsBig: isBigGoal(before.brief) } : basePolicy
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng sau các lần lỗi.
      const target = ctx.routerTarget(before, await read($, mode))
      const request = routerRequest({ text: arg, prev, ran: null, policy: rules, model: target.model, ...(target.isFable ? { isFable: true } : {}), sessionFamily: L.sessionFamily, isForcedNew: true })
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules), undefined, { retryMissingConfidence: true, ...(target.isFable ? { isFable: true } : {}) })
      ctx.noteRouterFailure('prompt', outcome.failure)
      noteRouterTime((await $.clock.now()) - startedAt)
      const plan = outcome.result
      if (plan !== null) L.routerTrouble = { failures: 0, pausedUntil: 0 }
      const now = await $.clock.now()
      const fail = plan === null ? routerFailOf(outcome, now, now - startedAt) : null
      const goalId = (prev?.goalId ?? 0) + 1
      // Mục tiêu đặt bằng lệnh luôn là mục tiêu mới; router lỗi thì đặt mục tiêu không có lựa chọn model.
      const brief: Brief = plan ? { ...briefOf(plan, arg, goalId, now), goal: plan.goal || arg.slice(0, 200) } : bareBrief(arg, goalId, now)
      const isApplied = (await read($, mode)) === 'auto'
      // Router lỗi: route cũ bỏ đi, không để status hiện một route mà lượt này không dùng.
      const core = await update($, coreState, c => {
        const adopted = S.adoptGoal(brief)(c)
        const withRoute = plan === null ? S.withRoute(null)(adopted) : adopted
        return S.withRouterFail(fail)(S.withAnalyzerUsage(outcome.usages, target.family)(withRoute))
      })
      L.lastPrompt = null
      L.isGoalNew = true
      L.pinnedGoalId = null
      // Mục tiêu mới đặt bằng lệnh thì band đã ẩn hiện lại, như mục tiêu mới do router đọc (0.7.2).
      await update($, bandHiddenState, () => false)
      record(now, plan !== null ? 'route' : 'router-fail', { command: 'goal', prompt: clipText(arg), reason: outcome.reason, retried: outcome.retried, ...(fail ? failFields(fail) : {}) })
      await flushDecisions((path, text) => $.fs.write(path, text))
      await showStatus($, await read($, view), ctx.options)
      const wanted = wantedPick(brief, core.lift, core, await read($, mode))
      const expected = wanted !== null ? expectedMain(core, brief, wanted, now) : null
      trackDelegations(brief.goalId, brief.isReference ? [] : brief.tasks)
      await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
      await autoOpenPane($, ctx, brief.goalId, now, null)
      const dropped = restorableSteps(before.plan)
      // Mục tiêu đang dở chưa có checklist (0.8.5 K2) cũng được lưu qua adoptGoal: một dòng báo riêng.
      const notice = dropped.length > 0 ? [droppedPlanNotice(dropped)] : prev !== null && S.pendingOf(before) ? [droppedGoalNotice(prev.goal)] : []
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
      if ((await read($, mode)) === 'off') return { text: `Focus Conductor đang tắt (mode off${(await read($, headlessState)) === true ? headlessOffNote() : ''}); bật lại bằng /conductor mode auto.` }
      const before = S.normalizeCore(await read($, coreState))
      const current = before.brief
      // Router đọc được prompt gần nhất (0.7.5): đọc lại prompt đã lập mục tiêu hiện tại, không phải prompt tiếp nối ngắn gần nhất.
      // Lần đọc gần nhất lỗi thì đọc lại chính prompt đó như cũ.
      const isGoalRead = before.routerFail === null && L.goalPrompt !== null && L.goalPrompt.goalId === (current?.goalId ?? null)
      const last = isGoalRead ? L.goalPrompt : L.lastPrompt
      if (last === null || (current?.goalId ?? null) !== last.goalId) {
        return { text: 'Không có prompt nào của mục tiêu hiện tại để router đọc lại. Đặt mục tiêu bằng /conductor goal kèm mô tả.' }
      }
      const basePolicy = ctx.routePolicy(before, ctx.maxForks >= 2 ? await $.session.root().catch(caught('session.root', null)) : null)
      const rules = ctx.conductorState(before, await read($, mode)) === null ? { ...basePolicy, conductor: true, goalIsBig: isBigGoal(before.brief) } : basePolicy
      // Lệnh do người dùng gõ: luôn hỏi router, kể cả khi router đang tạm ngừng.
      const target = ctx.routerTarget(before, await read($, mode))
      const request = routerRequest({ text: last.text, prev: last.prev, ran: ranText(before), policy: rules, model: target.model, ...(target.isFable ? { isFable: true } : {}), sessionFamily: L.sessionFamily })
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, reply => parseRoute(reply, rules), undefined, { retryMissingConfidence: true, ...(target.isFable ? { isFable: true } : {}) })
      ctx.noteRouterFailure('prompt', outcome.failure)
      noteRouterTime((await $.clock.now()) - startedAt)
      const now = await $.clock.now()
      const withUsage = (c: Core): Core =>
        S.withAnalyzerUsage(outcome.usages, target.family)(c)
      const plan = outcome.result
      if (plan === null) {
        const fail = routerFailOf(outcome, now, now - startedAt)
        await update($, coreState, c => S.withRouterFail(fail)(withUsage(c)))
        record(now, 'router-fail', { command: 'reroute', prompt: clipText(last.text), reason: outcome.reason, retried: outcome.retried, ...failFields(fail) })
        await flushDecisions((path, text) => $.fs.write(path, text))
        await showStatus($, await read($, view), ctx.options)
        return { text: `Router không đọc được (${outcome.reason}); giữ điều phối hiện tại.` }
      }
      L.routerTrouble = { failures: 0, pausedUntil: 0 }
      await update($, coreState, S.withRouterFail(null))
      const fresh = nextBrief(last.prev, plan, last.text, now, { sessionFamily: L.sessionFamily })
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
      const wanted = wantedPick(brief, core.lift, core, await read($, mode))
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
      const root = await $.session.root().catch(caught('session.root', null))
      const dir = root || ((await $.session.cwd().catch(caught('session.cwd', null))) ?? '')
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
        await $.store.set(storeKey(dropped.cwd), dropped).catch(caught('store.set', undefined))
        return { text: 'Đã bỏ điểm dừng; prompt kế tiếp chạy như bình thường.' }
      }
      if (q.pause?.source === 'user') await update($, quotaState, c => ({ ...normalizeQuota(c), pause: null }))
      if (cp === null) return { text: 'Không có điểm dừng nào đang mở cho thư mục này.' }
      // Prompt kế tiếp tiếp tục điểm dừng dù router xếp nó là việc khác.
      await update($, quotaState, c => ({ ...normalizeQuota(c), resumeArmed: true }))
      return { text: 'Có điểm dừng đang mở: gõ prompt (ví dụ "tiếp tục") để Claude tiếp tục từ đó. Nếu hạn mức chưa làm mới, dùng /conductor resume force.' }
    }

    if (sub === 'errors') {
      // Nhật ký lỗi của mod (0.7.9 L1): chỉ in cho người dùng, không chèn vào context của model.
      const io = { read: (path: string) => $.fs.read(path), write: (path: string, text: string) => $.fs.write(path, text), root: () => $.session.root() }
      if (arg === 'clear') {
        if (ctx.errorLog === '') return { text: 'Nhật ký lỗi của mod đang tắt (errorLog: off).' }
        const now = await $.clock.now()
        if (L.errorsClearArmedUntil <= now) {
          L.errorsClearArmedUntil = now + DISCARD_ARM_MS
          return { text: 'Xóa toàn bộ nhật ký lỗi của mod; gõ lại /conductor errors clear trong 10 giây để xác nhận.' }
        }
        L.errorsClearArmedUntil = 0
        return { text: (await ctx.clearErrors(io)) ? 'Đã xóa nhật ký lỗi của mod.' : 'Không ghi được file nhật ký lỗi.' }
      }
      const report = await ctx.errorReport(io)
      if (report === null) return { text: 'Nhật ký lỗi của mod đang tắt (errorLog: off).' }
      const lb = labels(langOf(ctx.options['uiLanguage']))
      const behaviorLines = report.behavior.length > 0 ? [lb.behaviorHead(report.behavior.length), ...report.behavior.map(entry => `- ${lb.behaviorLine(entry.where, entry.message, entry.count, entry.firstSeen, entry.lastSeen)}`)] : []
      if (report.total === 0) return { text: behaviorLines.length > 0 ? behaviorLines.join('\n') : `Nhật ký lỗi của mod trống (${ctx.errorLog}).` }
      const head = `Nhật ký lỗi của mod: ${report.total} loại${report.dropped > 0 ? `, đã bỏ ${report.dropped} loại cũ nhất` : ''} (${ctx.errorLog}). Mới nhất trước:`
      return { text: [head, ...report.lines.map(line => `- ${line}`), ...behaviorLines].join('\n') }
    }

    if (sub === 'status') {
      const { core, mode: current, lang } = await read($, view)
      // Mode off do phiên không tương tác (0.8.7 H1): dòng đầu nêu lý do và cách bật.
      const modeText = `Chế độ ${current}${current === 'off' && (await read($, headlessState)) === true ? headlessOffNote() : ''}`
      const usage = await $.session.usage().catch(caught('session.usage', null))
      const costLines = ledgerLines(core.ledger, lang)
      if (core.sysTokens > 0) costLines.push(`Phần cố định của ngữ cảnh (system prompt, tools): ${Math.round(core.sysTokens / 1000)}k token, đo ở đầu phiên`)
      if (usage?.cost) costLines.push(`Chi phí cả phiên theo Claude Code (gồm cả phần trước khi mod bắt đầu ghi sổ): ${formatCost(usage.cost.usd, lang)}`)
      const estimate = estimateLine(core.log, lang)
      if (estimate) costLines.push(estimate)
      costLines.push(priceNote(await $.clock.now()))
      costLines.push(cacheNote(ctx.cacheTtlMs / 60_000))
      const latency = routerTimeLine()
      if (latency) costLines.push(latency)
      // Ý của tin nhắn cuối router đã đọc (0.8.2 N1).
      if (ctx.local.lastIntent !== null) costLines.push(`${lang === 'en' ? 'Last message intent' : 'Ý của tin nhắn cuối'}: ${ctx.local.lastIntent}`)
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
      // Fable điều phối (0.8.4 C8): một dòng trạng thái, chỉ khi option conductor là fable.
      // Vai điều phối của mục tiêu (0.8.6): trạng thái miễn và số đo, chỉ khi luồng chính đang điều phối.
      const conductSuffix = ctx.isConducting(core, current) ? conductStatusSuffix(S.conductOf(core), lang) : ''
      const conductorLines = ctx.conductorOption === 'fable' ? [conductorLine(core, ctx.routerModel, lang) + conductSuffix] : []
      if (core.brief === null) return { text: [`${modeText}. Chưa có mục tiêu.`, ...conductorLines, ...routerFailLines(core.routerFail), ...costLines].join('\n') }
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
          const cost = entry.usd !== undefined ? ` ${formatCost(entry.usd, lang)}${entry.measured ? '' : lang === 'en' ? ' estimated' : ' ước tính'}` : ''
          return `  ${entry.label}: ${entry.family}${entry.effort ? `/${entry.effort}` : ''}${cost} (${entry.reason})`
        })
      const untracked = untrackedAgents()
      const untrackedLine =
        untracked.length > 0 ? `\nAgent ngoài điều phối (untracked agent, mod không chấm, không ép, không đo): ${untracked.length} (${[...new Set(untracked)].join(', ')})` : ''
      const items = core.delegations.goalId === core.brief.goalId ? core.delegations.items : []
      const shown = shownPlan(core)
      const stateText = { pending: 'chờ giao', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại' } as const
      const delegationBlock = items.length > 0 ? `\nViệc giao subagent:\n${items.map(item => `  ${item.index}. ${item.title}: ${stateText[item.state]}`).join('\n')}` : ''
      const agentBlock = delegationBlock + (agentLines.length > 0 ? `\nSubagent gần nhất:\n${agentLines.join('\n')}` : '') + untrackedLine
      return {
        text: [
          modeText,
          judged,
          `Luồng chính: ${routeLine}${blockedLine}`,
          ...conductorLines,
          ...routerFailLines(core.routerFail),
          ...checkHintLines(core.checkHint, core.brief.goalId),
          ...((core.brief.dropped ?? 0) > 0 ? [droppedItemsText(core.brief.dropped ?? 0)] : []),
          renderPlan(core.brief, shown.plan) + (shown.source === 'mirror' ? '\n(theo danh sách việc của Claude Code, chỉ để theo dõi)' : ''),
          ...retryLines(core),
          ...waiverLines(core),
          ...costLines,
        ].join('\n') + agentBlock,
      }
    }

    return { text: COMMAND_HELP }
  })
}
