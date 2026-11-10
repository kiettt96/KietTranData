// Giữ nhất quán: tool plan, theo dõi mọi tool, chặn kết thúc khi checklist còn mở, cộng chi phí đo được.

import { atom, derive, read, update } from 'claude-code'
import { caught, noteBehavior, noteHookError } from '../lib/errlog'
import type { AgentState, Choice, Core, DelegationState, RetryItem, Warning } from '../../types'
import { acceptsVerified, classifyBash, evidenceStrength, filePathOf, freshTestRun, hardChanges, isCheckTool, isExecuting, isFullyClosed, isGoalDone, isMutation, isPlanFile, normalizePath, isSkillTrial, markVerified, newTracker, skillNameOf, noteEvidence, observe, openSteps, pendingSteps, suggestCheckCommands, summarize, trackVerification } from '../lib/drift'
import type { Finding, Focus, ToolObservation, TurnTracker } from '../lib/drift'
import { checkCommand, checkSignature, coversFailure, isFailedRun } from '../lib/drift/evidence'
import { isCustomCheck } from '../lib/drift/verify'
import type { CheckRun, EvidenceEntry, EvidenceLog } from '../lib/drift/evidence'
import { clipText } from '../lib/decisions'
import { addUsage, calibrate, recordShape, shapeKey } from '../lib/ledger'
import { applyPlan } from '../lib/plan'
import type { RetryLine } from '../lib/text'
import type { PlanInput } from '../lib/plan'
import { describePick, familyOf } from '../lib/route'
import { askRouter, driftRequest, nextLevel, openPhase, parseDrift, parsePlanReview, planReviewRequest } from '../lib/router'
import { hasFixes, reviewReason } from '../lib/approval'
import { taskRows } from '../lib/progress'
import { EMPTY_QUOTA, evaluateQuota, normalizeQuota, quotaSettings, softNotices } from '../lib/quota'
import { storeKey, withNote } from '../lib/checkpoint'
import * as S from '../lib/state'
import { fableStep } from './fable'
import { isMainConducting } from '../lib/conductor'
import type { View } from '../lib/state'
import { shownPlan } from '../lib/mirror'
import { forkFailures, forkFiles, forkResults, liveForks, mergeDue } from '../lib/forks'
import { PLAN_TOOL_FULL, RETRY_REPORT, chainedCheckNote, retryAgentNotice, RETRY_ROUNDS, noCheckReason, waiveAskText, blockText, firstErrorLine, clipMiddle, RETRY_COMMAND_CHARS, joinStopReasons, retryDoneNote, retryEditNote, retryFailNotice, retryName, retryStepNote, retryStopReason, skillTrialReason, changedFilesNotice, checkHintText, compactReminderText, conductorKeepText, criteriaNotice, driftContext, missingTasks, missingTasksNotice, needsChecklist, noChecklistReason, pendingNotice, qualityNotice, renderBulk, renderPlan, requirementsNotice, setResultText, staticOnlyNotice, stopBlockReason, subagentReminder, unbackedNotice, forkMergedNote } from '../lib/text'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { clockOf, labels, langOf } from '../ui/labels'
import type { Lang } from '../ui/labels'
import { EDIT_TOOLS, ERROR_BURST } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
/** Số lệnh kiểm bị loại gần nhất ghi vào dòng unverified của nhật ký quyết định (0.7.7 X5). */
const UNVERIFIED_REJECTED = 3

const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)

/** Áp kết quả một lượt router gửi Fable vào Core (0.8.4 C6): vừa tạm ngừng thì toast và một dòng nhật ký conductor. */
async function noteFableRouter($: EngineInterface, ctx: Ctx, isOk: boolean): Promise<void> {
  const at = await $.clock.now()
  const step = fableStep(S.normalizeCore(await read($, coreState)), isOk, ctx.routerModel, at)
  if (step === null) return
  await update($, coreState, step.change)
  if (step.text !== null) $.ui.toast(step.text)
  if (step.log !== null) {
    ctx.record(at, 'conductor', step.log)
    await ctx.flushDecisions((path, body) => $.fs.write(path, body))
  }
}
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)
/** Thư mục làm việc của Bash sau cd cuối, theo luồng ('main') hay agentId (0.8.0 A1); tối đa BASH_DIRS khóa. */
const bashDirState = atom({ plugin: 'focus-conductor', key: 'bashDirs' } as const, {} as Record<string, string>)
const BASH_DIRS = 50

/** Trần số lệnh kiểm chưa đạt có tên riêng (0.7.8 vòng sửa 3, W4); phần dư gộp vào một mục tổng, vẫn chặn và vẫn tính lượt. */
const RETRY_ITEMS = 5
/** Chữ ký của mục tổng gộp các lệnh vượt trần. */
const RETRY_MORE = '*'

/** Lần chạy kiểm của một chữ ký "loại:lệnh". */
function runOf(sig: string): CheckRun {
  const at = sig.indexOf(':')
  return { check: sig.slice(0, at) === 'static' ? 'static' : 'test', command: sig.slice(at + 1) }
}

/** Lời gọi có thể là lần kiểm: lệnh Bash, hay tool MCP khai trong checkTools (0.7.9 Y4). */
function isCheckCall(tool: string): boolean {
  return tool === 'Bash' || isCheckTool(tool)
}

/** Mục chưa hết lượt của mục tiêu hiện tại, trừ mục chủ mod đã miễn (0.7.9 Y5). */
function liveRetry(core: Core): RetryItem[] {
  return core.brief !== null && core.retry.goalId === core.brief.goalId ? core.retry.items.filter(item => !item.exhausted && !S.isWaived(core, item.sig)) : []
}

/** Các lần chạy kiểm mới của nhật ký kể từ mốc seq. */
function newChecks(log: EvidenceLog, since: number): EvidenceEntry[] {
  return log.commands.filter(entry => entry.seq > since && entry.check !== null)
}

/** Mức "họ/effort" thành lựa chọn. */
function pickOf(level: string | undefined, fallback: Choice): Choice {
  const [family, effort] = (level ?? '').split('/')
  return family && effort ? ({ family, effort } as Choice) : fallback
}

/** Phụ thuộc của phần lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4), lấy từ ctx và trạng thái cục bộ của registerConsistency. */
type RetryDeps = {
  record: Ctx['record']
  flushDecisions: Ctx['flushDecisions']
  noteStuck: (core: Core, fallback: string) => void
  policy: Ctx['policy']
  mainLevel: () => Choice
  toolCalls: () => number
  lang: Lang
}

/**
 * Ghi các lần chạy kiểm mới vào trạng thái lượt của mục tiêu (0.7.8 vòng sửa 3, W4): lần lỗi chưa có mục thì thêm mục lượt 1 ở mức
 * `start`; lần lỗi của lệnh đã có mục thì ghi lỗi cuối và báo kẹt (G6); lần đạt xóa mọi mục nó phủ. Lượt và mức sàn chỉ tăng ở cổng
 * Stop. Trả dòng báo cho luồng chính, một lần mỗi lệnh mỗi lượt.
 */
async function noteChecks($: EngineInterface, deps: RetryDeps, core: Core, goalId: number, entries: readonly EvidenceEntry[], observation: { output?: string; isError: boolean }, start: Choice, isMain: boolean, agent?: string): Promise<string[]> {
  if (entries.length === 0) return []
  const retry = core.retry.goalId === goalId ? core.retry : { goalId, items: [] }
  let items: RetryItem[] = retry.items.map(item => ({ ...item, levels: [...item.levels], closedSteps: [...item.closedSteps], more: [...item.more] }))
  const error = firstErrorLine(observation.output, observation.isError)
  // Người chạy và giờ chạy lần lỗi (0.8.0 A6).
  const runner = isMain ? '' : clipText(agent ?? 'không tên', 60)
  const ranAt = clockOf(await $.clock.now())
  const touched = new Set<RetryItem>()
  let stuck: string | null = null
  // Lệnh miễn của mục tiêu (0.7.9 Y5): lần chạy đạt phủ lệnh đó thì xóa lệnh miễn.
  const waivers = core.waivers.goalId === goalId ? core.waivers.items : []
  let waived = waivers
  let plan = core.plan
  const cleared: Array<{ item: RetryItem; step: number }> = []
  const agentNotes: string[] = []
  for (const entry of entries) {
    const run: CheckRun = { check: entry.check ?? 'test', command: checkCommand(entry) }
    const sig = checkSignature(run)
    if (entry.ok) {
      // Hết lượt rồi chạy lại đạt (0.8.0 A12): trả bước mod đã ghi blocked về trạng thái và note cũ (verified về done), nếu Claude chưa sửa bước.
      for (const item of items) {
        const back = item.restore
        if (!item.exhausted || back === null || item.step === null || item.sig === RETRY_MORE || !coversFailure(run, item)) continue
        item.restore = null
        const at = plan.find(s => s.id === item.step)
        if (at === undefined || at.status !== 'blocked' || (at.note ?? '') !== back.mark) continue
        const status = back.status === 'verified' ? 'done' : back.status
        // Bước "Chưa đạt" mod tự tạo (0.8.0 vòng 2 W1): note là giờ đạt của lần chạy này.
        const note = back.stamp === true ? labels(deps.lang).retryPassedAt(ranAt) : back.note
        plan = plan.map(s => (s.id === at.id ? { ...s, status, ...(note !== null ? { note } : { note: undefined }), auto: undefined } : s))
        cleared.push({ item, step: at.id })
      }
      waived = waived.filter(w => !coversFailure(run, runOf(w.sig)))
      items = items
        .map(item => (item.sig === RETRY_MORE ? { ...item, more: item.more.filter(m => !coversFailure(run, runOf(m))) } : item))
        .filter(item => (item.sig === RETRY_MORE ? item.more.length > 0 : (item.exhausted && !item.logged) || !coversFailure(run, item)))
      continue
    }
    if (!isFailedRun(entry, observation as never)) continue
    const known = items.find(item => item.sig === sig) ?? items.find(item => item.more.includes(sig))
    if (known !== undefined) {
      if (error !== '') known.lastError = error
      known.runner = runner
      known.ranAt = ranAt
      // Chạy lại vẫn lỗi (0.8.0 A2): Stop kế tiếp được tăng lượt.
      known.retried = true
      known.idle = 0
      touched.add(known)
      stuck = sig
      continue
    }
    const fresh: RetryItem = {
      sig,
      check: run.check,
      command: run.command,
      round: 1,
      levels: [describePick(start)],
      floor: null,
      isTop: false,
      lastError: error,
      noticed: 0,
      edited: 0,
      calls: 0,
      closedSteps: [],
      exhausted: false,
      reportAsked: false,
      logged: false,
      step: null,
      more: [],
      restore: null,
      retried: false,
      idle: 0,
      runner,
      ranAt,
    }
    // Mục tạo từ lần chạy của subagent (0.8.0 A12): luồng chính được báo một lần, ở kết quả tool kế tiếp.
    if (!isMain && agent !== undefined) agentNotes.push(retryAgentNotice(run.command, agent))
    if (items.filter(item => item.sig !== RETRY_MORE).length < RETRY_ITEMS) {
      items.push(fresh)
      touched.add(fresh)
      continue
    }
    const more = items.find(item => item.sig === RETRY_MORE)
    if (more !== undefined) {
      more.more.push(sig)
      touched.add(more)
    } else {
      const merged = { ...fresh, sig: RETRY_MORE, command: '', more: [sig] }
      items.push(merged)
      touched.add(merged)
    }
  }
  if (stuck !== null) deps.noteStuck(core, stuck)
  if (cleared.length > 0) {
    const at = await $.clock.now()
    for (const { item, step } of cleared) {
      deps.record(at, 'retry-cleared', { signature: item.sig, step })
      $.ui.toast(labels(deps.lang).retryCleared(item.command, step))
    }
  }
  const notes: string[] = [...agentNotes]
  if (isMain) {
    for (const item of touched) {
      if (item.exhausted || item.noticed >= item.round || waived.some(w => w.sig === item.sig)) continue
      item.noticed = item.round
      notes.push(retryFailNotice(item))
    }
  }
  await update($, coreState, c => {
    const next = S.withRetry({ goalId, items })(plan !== core.plan ? S.withPlan(plan)(c) : c)
    return waived.length !== waivers.length ? S.withWaivers({ goalId, items: waived })(next) : next
  })
  if (cleared.length > 0) await deps.flushDecisions((path, text) => $.fs.write(path, text))
  return notes
}

/**
 * Cổng Stop cho lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4). Mọi mục chưa hết lượt của mục tiêu: lượt dưới RETRY_ROUNDS thì tăng một lượt,
 * nâng mức một bậc (nextLevel) làm sàn cho lần giao sửa lỗi; đã ở lượt cuối thì hết lượt: ghi bước blocked (nếu Claude chưa ghi), toast,
 * cảnh báo loop, và chặn một lần đòi báo cáo cuối. Lần dừng sau lần đòi báo cáo thì ghi dòng retry-exhausted kèm `reported`. Trả lý do
 * chặn, hoặc null khi không có gì cần chặn.
 */
async function retryGate($: EngineInterface, deps: RetryDeps, lastMessage: string | undefined): Promise<{ reason: string | null; isPlanChanged: boolean }> {
  let core = S.normalizeCore(await read($, coreState))
  if (core.brief === null) return { reason: null, isPlanChanged: false }
  if (typeof lastMessage === 'string') await logExhausted($, deps, core, lastMessage, null)
  core = S.normalizeCore(await read($, coreState))
  const live = liveRetry(core)
  if (live.length === 0) return { reason: null, isPlanChanged: false }
  const rules = deps.policy()
  const at = await $.clock.now()
  const lang = deps.lang
  let plan = core.plan
  const advanced: RetryLine[] = []
  const exhausted: RetryLine[] = []
  const waiting: RetryLine[] = []
  const warnings: Warning[] = []
  let marked = 0
  const items = core.retry.items.map(item => {
    if (item.exhausted || S.isWaived(core, item.sig)) return item
    // Lần thử mới (0.8.0 A2): lượt 1 lên lượt 2 ngay; từ lượt 2 chỉ tăng khi đã chạy lại vẫn lỗi, hay ở lần Stop thứ hai liên tiếp chưa chạy lại.
    const isTried = item.round === 1 || item.retried || item.idle >= 1
    if (!isTried) {
      waiting.push({ name: retryName(item), round: item.round, level: item.levels.at(-1) ?? '', isTop: item.isTop, error: item.lastError, runner: item.runner, at: item.ranAt })
      return { ...item, idle: item.idle + 1, calls: deps.toolCalls() }
    }
    const isAdvance = item.round < RETRY_ROUNDS
    if (isAdvance) {
      const prev = item.floor ?? pickOf(item.levels.at(-1), deps.mainLevel())
      const next = nextLevel(prev, rules)
      const level = describePick(next.pick)
      const round = item.round + 1
      deps.record(at, 'retry', { signature: item.sig, round, level })
      advanced.push({ name: retryName(item), round, level, isTop: next.isTop, error: item.lastError, runner: item.runner, at: item.ranAt })
      return { ...item, round, levels: [...item.levels, level], floor: next.pick, isTop: next.isTop, calls: deps.toolCalls(), retried: false, idle: 0 }
    }
    // Hết lượt: bước blocked kèm note của mod, trừ khi Claude đã ghi một bước blocked có note nhắc lệnh này.
    const mentioned = item.more.length === 0 ? plan.find(step => step.status === 'blocked' && (step.note ?? '').includes(item.command)) : undefined
    let stepId = mentioned?.id ?? null
    let restore: RetryItem['restore'] = null
    if (mentioned === undefined) {
      const note = retryStepNote(item)
      const closed = [...item.closedSteps].reverse().map(id => plan.find(step => step.id === id)).find(step => step !== undefined && (step.status === 'done' || step.status === 'verified'))
      const target = plan.find(step => step.status === 'doing') ?? closed
      if (target !== undefined) {
        stepId = target.id
        restore = { status: target.status, note: target.note ?? null, mark: note }
        plan = plan.map(step => (step.id === target.id ? { ...step, status: 'blocked' as const, note, auto: undefined } : step))
      } else {
        stepId = plan.reduce((max, step) => Math.max(max, step.id), 0) + 1
        // Bước mod tự tạo (0.8.0 vòng 2 W1): lần chạy đạt của đúng lệnh đóng bước thành done kèm giờ đạt.
        restore = { status: 'done', note: null, mark: note, stamp: true }
        plan = [...plan, { id: stepId, title: `Chưa đạt: ${clipMiddle(item.command || retryName(item), RETRY_COMMAND_CHARS)}`, status: 'blocked' as const, note }]
      }
    }
    const name = item.more.length > 0 ? retryName(item) : item.command
    $.ui.toast(labels(lang).retryExhausted(name))
    warnings.push({ at, kind: 'loop', text: `Chưa đạt sau ${RETRY_ROUNDS} lượt: ${name}` })
    exhausted.push({ name: retryName(item), round: item.round, level: item.levels.at(-1) ?? '', isTop: item.isTop, error: item.lastError, runner: item.runner, at: item.ranAt })
    if (mentioned === undefined) marked += 1
    return { ...item, exhausted: true, reportAsked: true, step: stepId, calls: deps.toolCalls(), restore }
  })
  await update($, coreState, c => {
    const next = S.withRetry({ goalId: core.retry.goalId, items })(plan !== core.plan ? S.withPlan(plan)(c) : c)
    return warnings.length > 0 ? S.withWarnings(...warnings)(next) : next
  })
  await deps.flushDecisions((path, text) => $.fs.write(path, text))
  return { reason: retryStopReason(advanced, exhausted, marked, waiting), isPlanChanged: plan !== core.plan }
}

/**
 * Dòng retry-exhausted của các lệnh đã chặn đòi báo cáo mà chưa ghi (0.7.8 vòng sửa 3, W4): `reported` là câu trả lời cuối có mục
 * "Chưa đạt yêu cầu". `answer` null là không có chữ câu trả lời: ghi reported null kèm lý do.
 */
/**
 * Lần chặn đòi mục "Lệnh kiểm được miễn" (0.7.9 Y5): còn lệnh miễn của mục tiêu chưa đòi thì trả lý do và đánh dấu đã đòi, nên chỉ chặn
 * một lần cho mỗi lệnh miễn. Không có thì null.
 */
async function askWaived($: EngineInterface): Promise<string | null> {
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || core.waivers.goalId !== core.brief.goalId) return null
  const due = core.waivers.items.filter(w => !w.asked)
  if (due.length === 0) return null
  await update($, coreState, S.withWaivers({ goalId: core.waivers.goalId, items: core.waivers.items.map(w => ({ ...w, asked: true })) }))
  return waiveAskText(due)
}

/**
 * Rà kế hoạch trước khi trình duyệt (0.8.2 N2), xét đầu tiên ở Stop. `allow`: cho kết thúc ngay, bỏ qua mọi cổng sau (turn hỏi làm rõ,
 * kế hoạch đã trình, lượt rà đạt hay đã hết lượt, router lỗi). `block`: chặn với lý do của lượt rà. `none`: không liên quan (mục tiêu không
 * thuộc diện duyệt, đã duyệt, hay checklist trống thì G1 xử lý như cũ).
 */
async function planReviewGate($: EngineInterface, ctx: Ctx): Promise<{ kind: 'none' | 'allow' } | { kind: 'block'; reason: string }> {
  const core = S.normalizeCore(await read($, coreState))
  const brief = core.brief
  if (brief === null) return { kind: 'none' }
  const approval = S.approvalOf(core)
  // Turn hỏi làm rõ: không rà, không chặn.
  if ((approval.status === 'planning' || approval.status === 'presented') && approval.awaitingAnswer) return { kind: 'allow' }
  if (approval.status === 'presented') return { kind: 'allow' }
  if (approval.status !== 'planning' || core.plan.length === 0) return { kind: 'none' }
  const at = await $.clock.now()
  const present = async (cause: string, warning?: string) => {
    await update($, coreState, c => {
      const next = S.withApproval({ ...S.approvalOf(c), status: 'presented' })(c)
      return warning !== undefined ? S.withWarnings({ at, kind: 'model', text: warning })(next) : next
    })
    ctx.record(at, 'approval', { goalId: brief.goalId, status: 'presented', cause })
    await ctx.flushDecisions((path, text) => $.fs.write(path, text))
    return { kind: 'allow' as const }
  }
  // Lượt cuối đã chặn một lần: lần Stop này cho kết thúc, không rà thêm.
  if (approval.rounds >= ctx.planReviewRounds) return present('rounds')
  // Model của lượt rà (0.8.4 C2): Fable khi sẵn sàng, không thì option router. Tạm ngừng router cũ chỉ áp khi không gọi Fable (C6).
  const target = ctx.routerTarget(core, S.modeOf(await read($, modeState), ctx.options))
  if (!target.isFable && ctx.isRouterPaused()) return present('router-paused', 'Router đang tạm ngừng nên chưa rà kế hoạch; kế hoạch được trình như hiện có')
  const request = planReviewRequest({
    goal: brief.goal,
    requirements: brief.requirements ?? [],
    constraints: brief.constraints,
    quality: brief.quality,
    steps: core.plan.map(step => ({ title: step.title, ...(step.check !== undefined ? { check: step.check } : {}) })),
    model: target.model,
    ...(target.isFable ? { isFable: true } : {}),
  })
  const startedAt = await $.clock.now()
  const outcome = await askRouter(r => $.model.complete(r), request, parsePlanReview)
  ctx.noteRouterFailure('review', outcome.failure)
  if (target.isFable) await noteFableRouter($, ctx, outcome.result !== null)
  ctx.noteRouterTime((await $.clock.now()) - startedAt)
  const rounds = approval.rounds + 1
  // Chi phí mỗi lượt rà cộng vào sổ nhóm router; lượt rà tăng sau mỗi lần gọi.
  await update($, coreState, c => S.withApproval({ ...S.approvalOf(c), rounds })(S.withAnalyzerUsage(outcome.usages, target.family)(c)))
  const review = outcome.result
  ctx.record(at, 'plan-review', { goalId: brief.goalId, round: rounds, missing: review?.missing ?? null, extra: review?.extra ?? null, issues: review?.issues.length ?? null, ...(review === null ? { reason: outcome.reason } : {}) })
  // Router lỗi: không đoán, trình kế hoạch như hiện có kèm cảnh báo.
  if (review === null) return present('router-fail', `Router không rà được kế hoạch (${outcome.reason}); kế hoạch được trình như hiện có`)
  if (!hasFixes(review)) return present('review')
  await ctx.flushDecisions((path, text) => $.fs.write(path, text))
  return { kind: 'block', reason: reviewReason(review, brief.requirements ?? [], core.plan, rounds, ctx.planReviewRounds, rounds >= ctx.planReviewRounds) }
}

/** Script của package.json đáng chạy để kiểm, theo thứ tự ưu tiên (0.7.9 Y6). */
const CHECK_SCRIPTS = ['test', 'typecheck', 'lint', 'check']

/** Lệnh chạy một script của package.json theo trình quản lý gói nhận ra từ lockfile; không có lockfile thì npm. */
async function scriptCommand($: EngineInterface, root: string, script: string): Promise<string> {
  const has = async (name: string) => (await $.fs.stat(`${root}/${name}`).then(() => true, () => false))
  const pm = (await has('bun.lock')) || (await has('bun.lockb')) ? 'bun' : (await has('pnpm-lock.yaml')) ? 'pnpm' : (await has('yarn.lock')) ? 'yarn' : 'npm'
  if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`
  return pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`
}

/**
 * Lệnh kiểm rõ ràng của dự án để nêu trong lý do chặn của Y6 (0.7.9), theo thứ tự: checkCommands, checkTools, lần kiểm đạt gần nhất của mục
 * tiêu, script kiểm trong package.json ở thư mục gốc phiên (đọc lỗi thì coi như không có). Không có nguồn nào thì null.
 */
async function projectCheck($: EngineInterface, options: Ctx['options'], log: EvidenceLog): Promise<string | null> {
  const declared = String(options['checkCommands'] ?? '').split(',').map(item => item.trim()).find(Boolean)
  if (declared !== undefined) return declared
  const tool = String(options['checkTools'] ?? '').split(',').map(item => item.trim()).find(name => name.startsWith('mcp__'))
  if (tool !== undefined) return tool
  const passed = [...log.commands].reverse().find(entry => entry.check !== null && entry.ok)
  if (passed !== undefined) return checkCommand(passed)
  const root = await $.session.root().catch(caught('session.root', null))
  if (!root) return null
  const text = await $.fs.read(`${root}/package.json`).catch(() => null)
  if (typeof text !== 'string') return null
  let scripts: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown }
    if (parsed !== null && typeof parsed.scripts === 'object' && parsed.scripts !== null) scripts = parsed.scripts as Record<string, unknown>
  } catch {
    return null
  }
  const script = CHECK_SCRIPTS.find(name => typeof scripts[name] === 'string')
  return script === undefined ? null : scriptCommand($, root, script)
}

/**
 * Cổng Y6 (0.7.9): mục tiêu có thay đổi chắc chắn vào file không nhẹ (0.8.0 A5: lệnh "có thể ghi", file dữ liệu và báo cáo không tính) mà
 * chưa có lần kiểm nào chạy sau thay đổi cuối, tier không phải trivial, không còn subagent chạy chưa trả về, dự án có lệnh kiểm rõ ràng, và
 * mục tiêu chưa bị chặn vì lý do này: ghi khóa noCheckNudged rồi trả lý do. Không thì null.
 */
async function noCheckGate($: EngineInterface, options: Ctx['options'], core: Core, log: EvidenceLog, isWaiting: boolean): Promise<string | null> {
  const brief = core.brief
  if (brief === null || core.noCheckNudged === brief.goalId || brief.tier === 'trivial' || isWaiting) return null
  // Lần chạy nối && chưa rõ kết quả (0.8.0 A11) không tính là đã kiểm.
  if (log.hard === 0 || log.commands.some(entry => entry.check !== null && entry.chained !== true && entry.seq > log.lastHard)) return null
  const command = await projectCheck($, options, log)
  if (command === null) return null
  await update($, coreState, S.withNoCheckNudged(brief.goalId))
  return noCheckReason(command)
}

/**
 * Lần chạy đạt của một lệnh khai trong checkCommands (0.8.2 N3): là bằng chứng thử skill. Lần nối && chưa rõ kết quả không tính.
 */
function passedDeclared(entries: readonly EvidenceEntry[]): boolean {
  return entries.some(entry => entry.ok && entry.chained !== true && (isCustomCheck(entry.command) || (entry.raw !== undefined && isCustomCheck(entry.raw))))
}

/**
 * Cổng thử skill (0.8.2 N3): mục tiêu có lần ghi file skill mà chưa có lần thử nào sau đó, tier không phải trivial, không còn subagent chạy
 * chưa trả về, và mục tiêu chưa bị chặn vì lý do này: ghi khóa skillNudged rồi trả lý do. Không thì null.
 */
async function skillTrialGate($: EngineInterface, core: Core, isWaiting: boolean): Promise<string | null> {
  const brief = core.brief
  if (brief === null || core.skillNudged === brief.goalId || brief.tier === 'trivial' || isWaiting) return null
  if (!S.isSkillUntried(core)) return null
  await update($, coreState, S.withSkillNudged(brief.goalId))
  const path = S.skillOf(core).path
  return skillTrialReason(skillNameOf(path), path)
}

async function logExhausted($: EngineInterface, deps: RetryDeps, core: Core, answer: string | null, why: string | null): Promise<void> {
  if (core.brief === null || core.retry.goalId !== core.brief.goalId) return
  const due = core.retry.items.filter(item => item.reportAsked && !item.logged)
  if (due.length === 0) return
  const at = await $.clock.now()
  for (const item of due) {
    noteBehavior('retry-exhausted', `hết lượt chạy lại: ${item.sig === RETRY_MORE ? item.more.join(', ') : item.sig}`)
    deps.record(at, 'retry-exhausted', {
      signature: item.sig === RETRY_MORE ? item.more.join(', ') : item.sig,
      levels: item.levels,
      step: item.step,
      reported: answer === null ? null : answer.includes(RETRY_REPORT),
      ...(answer === null && why !== null ? { why } : {}),
    })
  }
  await update($, coreState, S.withRetry({ goalId: core.retry.goalId, items: core.retry.items.map(item => (due.includes(item) ? { ...item, logged: true } : item)) }))
  await deps.flushDecisions((path, text) => $.fs.write(path, text))
}

/**
 * Khung đối chiếu phạm vi của mục tiêu: thư mục gốc của phiên chốt một lần cho mỗi mục tiêu (không đổi theo `cd`
 * của shell) và thư mục làm việc hiện tại. Chỉ hỏi engine khi mục tiêu có giới hạn phạm vi; lỗi thì null.
 */
async function frameOf($: EngineInterface, roots: Map<number, string | null>, goalId: number, scopePaths: readonly string[]) {
  if (scopePaths.length === 0) return { root: null, cwd: null }
  return { root: await rootFor($, roots, goalId), cwd: await $.session.cwd().catch(caught('session.cwd', null)) }
}

/** Thư mục gốc của phiên chốt một lần cho mỗi mục tiêu (dùng chung cho phạm vi và file đã đổi của 0.8.2 N5); lỗi thì null. */
async function rootFor($: EngineInterface, roots: Map<number, string | null>, goalId: number): Promise<string | null> {
  if (!roots.has(goalId)) {
    roots.set(goalId, await $.session.root().catch(caught('session.root', null)))
    const oldest = roots.keys().next().value
    if (roots.size > 8 && oldest !== undefined) roots.delete(oldest)
  }
  return roots.get(goalId) ?? null
}

// File của mod và file kế hoạch không phải phần việc của mục tiêu (0.8.2 N5).
const CHANGED_SKIP = /(?:^|\/)(?:\.claude\/plans\/|\.focus-conductor(?:\/|$))/

/**
 * Đích của một lần ghi file đã chạy xong không lỗi (0.8.2 N5), theo cách của hạn mức: filePathOf, không thì classifyBash(command).paths.
 * Đường dẫn tương đối nối với thư mục của Bash rồi đổi về tương đối với thư mục gốc phiên; ngoài gốc thì giữ tuyệt đối. Không phải lần
 * ghi thì null; Bash ghi mà không đọc được đích thì isUnknown.
 */
function changedTargets(observation: ToolObservation, root: string | null): { paths: string[]; isUnknown: boolean } | null {
  if (observation.isError || !isMutation(observation)) return null
  const path = filePathOf(observation)
  const command = observation.tool === 'Bash' ? String(observation.input['command'] ?? '') : ''
  const raw = path ? [path] : command ? classifyBash(command).paths : []
  if (raw.length === 0) return { paths: [], isUnknown: observation.tool === 'Bash' }
  const base = observation.cwd ?? root ?? ''
  const relative = raw.map(item => {
    const full = normalizePath(item.startsWith('/') || base === '' ? item : `${base}/${item}`)
    const top = root ? normalizePath(root) : ''
    return top !== '' && top !== '/' && full.startsWith(`${top}/`) ? full.slice(top.length + 1) : full
  })
  return { paths: relative.filter(item => item !== '' && !CHANGED_SKIP.test(item)), isUnknown: false }
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

/**
 * Gợi ý khai option checkCommands tới người dùng (0.7.3): lưu vào Core (pane và /conductor status đọc) và báo toast một
 * lần mỗi mục tiêu; gợi ý đổi (có script kiểm mới) thì chỉ cập nhật, không báo lại. Chỉ gợi ý, không tự khai.
 */
async function offerCheckHint($: EngineInterface, goalId: number, commands: string[]): Promise<void> {
  const stored = S.normalizeCore(await read($, coreState)).checkHint
  const current = stored !== null && stored.goalId === goalId ? stored : null
  if (commands.length === 0) return
  if (current !== null && current.commands.join('\n') === commands.join('\n')) return
  await update($, coreState, S.withCheckHint({ goalId, commands, isToasted: true }))
  if (current?.isToasted !== true) $.ui.toast(checkHintText(commands))
}

/** Khoảng tối thiểu giữa hai lượt kiểm lạc đề (đồng hồ engine, 0.7.0): mỗi lượt là một lần gọi router. */

/**
 * Kết cục của một subagent theo `reason` của turn.complete (0.6.1): chỉ 'answer' là xong. 'error' là lỗi; 'aborted' (người dùng
 * ngắt) và 'refusal' (model từ chối, không có model dự phòng) cũng là lỗi. Đang tạm dừng vì hạn mức thì agent kết thúc là bị cắt
 * ngang, trừ 'error' (lỗi thắng cắt). Việc đã phân luôn về `failed` khi chưa xong, để Stop và cảnh báo nhắc giao lại.
 */
function agentEnd(reason: string, isPaused: boolean): { agent: Exclude<AgentState, 'running'>; delegation: DelegationState } {
  if (reason === 'answer') return isPaused ? { agent: 'cut', delegation: 'failed' } : { agent: 'done', delegation: 'done' }
  if (reason === 'error') return { agent: 'failed', delegation: 'failed' }
  return { agent: isPaused ? 'cut' : 'failed', delegation: 'failed' }
}

/**
 * Sau cảnh báo chưa kiểm của một turn (0.8.0 A5): toast một lần mỗi nguyên nhân trong mục tiêu (0.7.7 X4, khóa lưu trong Core nên giữ qua
 * hot reload), dòng nhật ký quyết định (X5), và gợi ý khai lệnh kiểm khi cả turn không có lệnh kiểm nào được nhận (0.7.3).
 */
async function announceUnverified($: EngineInterface, ctx: Ctx, finding: Finding, tracker: TurnTracker, brief: Core['brief'], at: number, isPaused: boolean): Promise<void> {
  if (brief !== null && finding.isSoft !== true) {
    const key = finding.cause ?? finding.text
    if (!S.isToasted(S.normalizeCore(await read($, coreState)), brief.goalId, key)) {
      $.ui.toast(finding.text)
      await update($, coreState, S.withToasted(brief.goalId, key))
    }
  }
  const rejected = tracker.rejected.slice(-UNVERIFIED_REJECTED).map(r => ({ command: clipText(r.command, 120), reason: r.reason }))
  ctx.record(at, 'unverified', { mutations: tracker.mutations, hard: hardChanges(tracker), maybe: tracker.maybe, checks: tracker.checks, rejected, soft: finding.isSoft === true })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text))
  if (finding.isSoft !== true && tracker.checks === 0 && !isPaused && brief !== null) await offerCheckHint($, brief.goalId, suggestCheckCommands(ctx.evidenceFor(brief.goalId)))
}

/** Cảnh báo chưa kiểm cuối turn của một tracker, không tính phần nhẹ (0.8.0 A5). */
function unverifiedOf(ctx: Ctx, tracker: TurnTracker, core: Core): Finding | undefined {
  const suggestions = core.brief !== null && tracker.checks === 0 ? suggestCheckCommands(ctx.evidenceFor(core.brief.goalId)) : []
  return summarize(tracker, core.brief, core.plan, suggestions).find(f => f.kind === 'unverified' && f.isSoft !== true)
}

/**
 * Tính lại cảnh báo chưa kiểm đã hoãn vì còn subagent chạy (0.8.0 A5), khi không còn subagent nào chưa trả về: subagent cuối trả về
 * hay Stop đầu tiên thấy không còn subagent. Thay đổi trong lúc chờ đã nằm trong tracker nên được đếm; đã kiểm thì không còn gì để báo.
 * Trả đúng khi có cảnh báo mới để người gọi vẽ lại band.
 */
async function settleDeferred($: EngineInterface, ctx: Ctx): Promise<boolean> {
  const L = ctx.local
  if (L.liveAgents.size > 0 || L.deferred.length === 0) return false
  const trackers = L.deferred
  L.deferred = []
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || normalizeQuota(await read($, quotaState)).pause !== null) return false
  const at = await $.clock.now()
  let isChanged = false
  for (const tracker of trackers) {
    const finding = unverifiedOf(ctx, tracker, core)
    if (finding === undefined) continue
    await update($, coreState, S.withWarnings({ at, kind: 'unverified', text: finding.text, ...(finding.cause !== undefined ? { cause: finding.cause } : {}) }))
    await announceUnverified($, ctx, finding, tracker, core.brief, at, false)
    isChanged = true
  }
  return isChanged
}

export function registerConsistency(on: On, ctx: Ctx): void {
  const L = ctx.local
  /** Ghi phát hiện của turn để gửi kèm router ở prompt tiếp nối (0.7.0): tối đa 5 mục, mỗi mục 120 ký tự. */
  const noteObserved = (text: string) => {
    const item = text.slice(0, 120)
    if (!L.observed.includes(item)) L.observed.push(item)
    if (L.observed.length > 5) L.observed.shift()
  }
  const { agentFailures, agentTrackers, agents, blockLimit, carryEvidence, flushDecisions, delegationItems, evidenceFor, failedFor, isRouterPaused, moveDelegation, noteRouterTime, pendingFor, record, remindSubagents, semanticDrift, driftEveryMs, steppedEarly, strictDelegation, trackDelegations } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ------------------------------------------ 3. giữ nhất quán

  // Tool plan chỉ đổi trạng thái nội bộ của mod: không cần hỏi quyền.
  on('tool.check', { tool: 'mcp__focus-conductor__plan' }, () => ({
    decision: 'allow' as const,
    reason: 'focus-conductor: checklist nội bộ của phiên',
  })).catch(($, e, next) => (noteHookError('tool.check', next.error), next(e)))

  on('tool.call', { tool: 'mcp__focus-conductor__plan' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: 'Checklist chỉ dành cho luồng chính; subagent bỏ qua và làm đúng nhiệm vụ được giao.' }
    }
    const input = e as unknown as PlanInput
    if (input.action === 'restore') {
      // Khôi phục mục tiêu cũ đã lưu khi router xếp một prompt là mục tiêu mới.
      const index = typeof input.index === 'number' ? input.index : 1
      const stored = S.normalizeCore(await read($, coreState)).archived[index - 1]
      const outcome = S.restoreArchived(await read($, coreState), index)
      if ('error' in outcome) return { deny: outcome.error }
      // Mục tiêu khôi phục mang số mới: giữ lịch sử thay đổi và kiểm tra của nó cho việc đối chiếu evidence.
      if (stored !== undefined) carryEvidence(stored.brief.goalId, outcome.restored.brief.goalId)
      await update($, coreState, () => outcome.core)
      const restored = outcome.restored.brief
      // Việc giao còn chờ của mục tiêu khôi phục: các việc ghi giao (Claude biết việc nào đã xong từ checklist).
      trackDelegations(restored.goalId, restored.isReference ? [] : restored.tasks)
      await update($, coreState, S.withDelegations(restored.goalId, delegationItems(restored)))
      L.isGoalNew = true
      L.pinnedGoalId = null
      await showStatus($, await read($, view), ctx.options)
      const core = S.normalizeCore(await read($, coreState))
      return { result: `Đã khôi phục mục tiêu: ${restored.goal}\n${renderPlan(core.brief, core.plan)}` }
    }
    if (input.action === 'show') {
      // Chỉ xem: không đổi trạng thái, không tính là cập nhật (L.tracker.planUpdates giữ nguyên).
      const current = S.normalizeCore(await read($, coreState))
      return { result: renderPlan(current.brief, current.plan) }
    }
    if (input.action === 'checkpoint') {
      // Giai đoạn hai của điểm dừng (0.6.0): Claude ghi bước kế tiếp. Chỉ hợp lệ khi mod đang tạm dừng.
      const q = normalizeQuota(await read($, quotaState))
      if (q.pause === null) return { deny: 'action "checkpoint" chỉ dùng khi mod đang tạm dừng (hạn mức sắp hết hoặc /conductor pause).' }
      const noted = applyPlan([], input)
      if (noted.error !== undefined) return { deny: noted.error }
      const cp = q.checkpoint !== null ? withNote(q.checkpoint, noted.checkpointNote ?? '') : null
      if (cp !== null) {
        await update($, quotaState, c => ({ ...normalizeQuota(c), checkpoint: cp }))
        const isSaved = await $.store.set(storeKey(cp.cwd), cp).then(() => true).catch(caught('store.set', false))
        if (!isSaved) $.ui.toast('Focus Conductor: không lưu được điểm dừng vào kho của mod; điểm dừng chỉ còn trong phiên này')
      }
      return { result: 'Đã ghi điểm dừng. Kết thúc turn bằng một câu báo điểm dừng; lần ra lệnh sau sẽ tiếp tục từ đây.' }
    }
    const before = S.normalizeCore(await read($, coreState))
    // "verified" chỉ được lưu khi bằng chứng đủ mạnh (lệnh kiểm tra chạy thành công sau thay đổi cuối của mục tiêu,
    // hoặc việc chỉ đọc có nhắc lệnh hay file đã đụng tới); còn lại bước được lưu là done kèm lý do.
    const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : ''
    const isVerifiedAsk = input.action === 'update' && input.status === 'verified' && evidence !== '' && input.ids === undefined && input.allOpen !== true
    const log = before.brief !== null ? evidenceFor(before.brief.goalId) : null
    const strength = isVerifiedAsk && log !== null ? evidenceStrength(evidence, log) : null
    // Mod tự nâng (0.7.0): mục tiêu đã có sửa file và một lệnh test chạy đạt sau thay đổi cuối (phủ mọi thay đổi) thì verified do
    // Claude ghi được nhận mà không đòi evidence chép đúng lệnh; còn lại giữ luật cũ.
    const fresh = log !== null ? freshTestRun(log) : undefined
    const isStrict = isVerifiedAsk && log !== null && strength !== null && acceptsVerified(strength, log)
    const isAccepted = isStrict || (isVerifiedAsk && log !== null && fresh !== undefined)
    const isDowngraded = isVerifiedAsk && !isAccepted
    // Nhận nhờ test đạt chứ evidence không khớp chặt: lưu done rồi để mod nâng thành verified có dấu auto, nên sửa tiếp thì bị hạ lại.
    const isLoose = isAccepted && !isStrict
    const outcome = applyPlan(before.plan, isDowngraded || isLoose ? { ...input, status: 'done' } : input)
    if (outcome.error !== undefined) return { deny: outcome.error }

    // "set" chốt lại mục tiêu và các bước: làm mới cả từ khóa của brief để
    // việc nhận diện prompt tiếp nối dựa trên mục tiêu mới, không phải mục tiêu cũ.
    const isSet = input.action === 'set'
    const titles = outcome.plan.map(step => step.title)
    // Checklist mới giữa mục tiêu (0.8.0 A3): việc đã xong theo checklist cũ được cất vào đợt trước (nhật ký phase, cause plan-set);
    // việc chưa xong vẫn hiển thị.
    const hasSteps = isSet && Array.isArray(input.steps) && input.steps.length > 0
    const doneTasks = hasSteps && before.brief !== null && before.plan.length > 0 ? taskRows(before, await $.clock.now()).filter(row => row.index !== undefined && row.kind !== 'main' && row.state === 'done' && row.bar.kind === 'steps').map(row => row.index as number) : []
    const opened = doneTasks.length > 0 && before.brief !== null ? openPhase(before.brief, new Set(doneTasks)) : null
    let core = await update($, coreState, c => {
      const withPlan = S.withPlan(outcome.plan)(opened !== null ? S.withNoCheckNudged(-1)(S.withBrief(opened.brief)(c)) : c)
      return isSet ? S.withRetarget(outcome.goal, titles, outcome.scope)(withPlan) : withPlan
    })
    if (opened !== null) {
      record(await $.clock.now(), 'phase', { phase: opened.brief.phase, tasks: opened.tasks, items: opened.items, cause: 'plan-set' })
      await flushDecisions((path, text) => $.fs.write(path, text))
    }
    // Bước vừa đóng bằng done khi đã có test đạt sau thay đổi cuối: nâng ngay thành verified (0.7.0).
    if (fresh !== undefined && input.action === 'update') {
      const closed = (outcome.changed ?? []).filter(id => outcome.plan.some(s => s.id === id && s.status === 'done'))
      if (closed.length > 0) {
        core = await update($, coreState, S.withAutoVerified(fresh.command, closed))
        record(await $.clock.now(), 'verify-auto', { steps: closed, command: clipText(fresh.command), at: 'close' })
        await flushDecisions((path, text) => $.fs.write(path, text))
      }
    }
    L.tracker.planUpdates += 1
    if (isAccepted && (strength?.level === 'strong' || fresh !== undefined)) markVerified(L.tracker)
    const notes: string[] = []
    if (isDowngraded) {
      const reason = strength?.reason ?? 'chưa đối chiếu được evidence với mục tiêu hiện tại'
      const text = `Bước ${String(input.step)} ghi verified nhưng ${reason}: lưu là done`
      const at = await $.clock.now()
      await update($, coreState, S.withWarnings({ at, kind: 'unverified', text }))
      // Lặp lại cho cùng bước thì mới ghi nhật ký lỗi (0.8.0 A9).
      const rejectKey = `${core.brief?.goalId ?? 0}:${String(input.step)}`
      const rejects = (L.verifyRejects.get(rejectKey) ?? 0) + 1
      L.verifyRejects.set(rejectKey, rejects)
      if (rejects >= 2) noteBehavior('verify-reject', `bước ${String(input.step)} bị từ chối lần ${rejects}: ${reason}`)
      record(at, 'verify-reject', { step: input.step, level: strength?.level ?? 'none', reason, evidence: clipText(evidence) })
      await flushDecisions((path, text) => $.fs.write(path, text))
      // weak và none: lệnh kiểm tra có thể là script riêng chưa khai checkCommands; stale thì option không liên quan.
      const hasHint = (strength?.level ?? 'none') !== 'stale'
      notes.push(unbackedNotice(reason, hasHint ? (log === null ? [] : suggestCheckCommands(log)) : undefined))
    } else if (isAccepted && strength?.level === 'strong' && strength.check === 'static') {
      notes.push(staticOnlyNotice())
    }
    const target = input.action === 'update' ? core.plan.find(step => step.id === input.step) : undefined
    if (target?.check && (input.status === 'verified' || input.status === 'done')) notes.push(criteriaNotice(target))
    // Checklist vừa đóng hẳn (mọi bước done, verified hay skipped): yêu cầu xác nhận từng tiêu chí chất lượng của mục tiêu.
    // Bước mở cuối vừa hết mà còn bước đang chờ hoặc bị chặn thì chưa phải đóng hẳn: nhắc các bước đó thay cho tiêu chí chất lượng.
    // Đang dừng vì hạn mức: không nhắc tiêu chí chất lượng hay bước chờ (Claude chỉ ghi điểm dừng rồi kết thúc).
    const isPaused = normalizeQuota(await read($, quotaState)).pause !== null
    const isUpdate = input.action === 'update' && !isPaused
    const isClosing = isUpdate && !isFullyClosed(before.plan) && isFullyClosed(core.plan)
    if (isClosing && core.brief !== null && core.brief.quality.length > 0) notes.push(qualityNotice(core.brief.quality))
    // Đối chiếu từng yêu cầu router đã trích (0.7.8 G2): một lần mỗi mục tiêu, khóa trong Core; brief isReference thì không.
    const asked = core.brief?.requirements ?? []
    if (isClosing && core.brief !== null && !core.brief.isReference && asked.length > 0 && core.reqNoticed !== core.brief.goalId) {
      notes.push(requirementsNotice(asked))
      core = await update($, coreState, S.withReqNoticed(core.brief.goalId))
    }
    // File đã đổi của mục tiêu (0.8.2 N5): sau G2, một lần mỗi mục tiêu, khóa trong Core; brief isReference hay chưa đổi file nào thì không.
    const changed = S.changedOf(core)
    const hasChanged = changed.paths.length > 0 || changed.unknown > 0 || changed.overflow > 0
    if (isClosing && core.brief !== null && !core.brief.isReference && hasChanged && core.changedNoticed !== core.brief.goalId) {
      notes.push(changedFilesNotice(changed))
      core = await update($, coreState, S.withChangedNoticed(core.brief.goalId))
    }
    if (isUpdate && openSteps(before.plan).length > 0 && openSteps(core.plan).length === 0 && pendingSteps(core.plan).length > 0) notes.push(pendingNotice(core.plan))
    // Đóng bước khi còn lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4): cho phép, kèm một câu nói cổng kết thúc sẽ chặn; ghi bước vừa đóng để khi
    // hết lượt mod biết bước nào ghi blocked. Luật verified không đổi.
    const unresolved = liveRetry(core)
    if (input.action === 'update' && unresolved.length > 0 && typeof input.step === 'number' && (input.status === 'done' || input.status === 'verified')) {
      const id = input.step
      if (input.status === 'done') notes.push(retryDoneNote(unresolved.length))
      const items = core.retry.items.map(item => (unresolved.includes(item) ? { ...item, closedSteps: [...item.closedSteps.filter(s => s !== id), id] } : item))
      core = await update($, coreState, S.withRetry({ goalId: core.retry.goalId, items }))
    }
    // Việc đã phân chưa có bước nào trong checklist (0.7.8 G4): chỉ sau set và add, brief không phải isReference. Chỉ báo lại khi tập
    // việc thiếu đổi (vòng sửa 3, W3): khóa là các index thiếu xếp tăng, lưu trong Core cùng goalId; phủ đủ thì ghi khóa rỗng.
    const isListed = input.action === 'set' || input.action === 'add'
    if (isListed && core.brief !== null && !core.brief.isReference && core.brief.tasks.length > 0) {
      const missing = missingTasks(core.brief.tasks, core.plan)
      const key = missing.map(t => t.index).sort((a, b) => a - b).join(',')
      const noticed = core.missingNoticed
      const isNew = noticed.goalId !== core.brief.goalId || noticed.key !== key
      if (missing.length > 0 && isNew) notes.push(missingTasksNotice(missing))
      if (isNew) core = await update($, coreState, S.withMissingNoticed(core.brief.goalId, key))
    }
    await showStatus($, await read($, view), ctx.options)
    const shown =
      outcome.bulk !== undefined
        ? renderBulk(core.plan, outcome.changed ?? [], outcome.bulk.status, outcome.bulk.note)
        : outcome.set !== undefined
          ? setResultText(core.brief, core.plan, outcome.set, outcome.goal, before.brief?.goal ?? null)
          : renderPlan(core.brief, core.plan, input.action === 'update' || input.action === 'add' ? outcome.changed : undefined)
    return { result: [shown, ...notes].join('\n') }
  }).catch(($, e, next) => (noteHookError('tool.call plan', next.error), { deny: 'focus-conductor: lỗi nội bộ khi cập nhật checklist; tiếp tục làm việc không cần tool này.' }))

  /**
   * Luồng chính kẹt (lặp lỗi hay router thấy lạc đề, 0.7.8 G6): thêm mục "luồng chính kẹt: <bước đang mở hoặc lệnh lỗi>" vào danh
   * sách việc đã lỗi của mục tiêu, để router chấm subagent giao phần đó chọn cao hơn một bậc. Cổng Stop không đọc danh sách này.
   */
  function noteStuck(core: { brief: { goalId: number } | null; plan: Parameters<typeof openSteps>[0] }, fallback: string): void {
    if (core.brief === null) return
    const open = openSteps(core.plan)
    const what = (open.find(step => step.status === 'doing') ?? open[0])?.title ?? fallback
    agentFailures.push({ description: `luồng chính kẹt: ${clipText(what, 120)}`, goalId: core.brief.goalId })
    if (agentFailures.length > 10) agentFailures.shift()
  }

  /** Mức của luồng chính đang chạy (0.7.8 vòng sửa 3, W4): lựa chọn router cho turn, không thì model của phiên. */
  function mainLevel(): Choice {
    const route = L.turnRoute.route
    return route !== null ? { family: route.family, effort: route.effort } : { family: L.sessionFamily ?? 'sonnet', effort: 'medium' }
  }
  const retryDeps: RetryDeps = {
    record,
    flushDecisions,
    noteStuck,
    policy: ctx.policy,
    mainLevel,
    toolCalls: () => L.tracker.toolCalls,
    lang: langOf(ctx.options['uiLanguage']),
  }


  // Mọi tool: luồng chính được nhắc (context của kết quả tool) và nâng cấp theo
  // bằng chứng cho turn sau; subagent chỉ được ghi nhật ký, không bị nhắc.
  // Lời nhắc đi kèm kết quả tool, không sửa system prompt, nên không ảnh hưởng cache.
  on('tool.call', async ($, e, next) => {
    // strictDelegation "block": luồng chính sửa file trong khi còn việc ghi giao subagent chưa giao thì bị từ chối,
    // tối đa blockLimit lần mỗi mục tiêu (mặc định 2; sau đó chỉ nhắc, kẻo kẹt khi không giao được).
    // Gồm lệnh Bash ghi file (sed -i, chuyển hướng ghi, rm...): isMutation đã loại lệnh chỉ đọc và lệnh kiểm tra.
    const isBashWrite =
      e.tool === 'Bash' && isMutation({ tool: 'Bash', input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
    if (strictDelegation === 'block' && e.agentId === undefined && (EDIT_TOOLS.has(e.tool) || isBashWrite)) {
      const current = await read($, mode)
      const now = S.normalizeCore(await read($, coreState))
      const waiting = current === 'auto' || current === 'subagents' ? pendingFor(now.brief, shownPlan(now).plan) : []
      const path = filePathOf({ tool: e.tool, input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
      if (waiting.length > 0 && !isPlanFile(path) && L.delegation.blocks < blockLimit) {
        L.delegation.blocks += 1
        return { deny: blockText(waiting, blockLimit - L.delegation.blocks) }
      }
    }
    const result = await next(e)
    if (result.deny !== undefined || e.tool === PLAN_TOOL_FULL) return result
    if ((await read($, mode)) === 'off') return result

    const observation: ToolObservation = {
      tool: e.tool,
      input: e as unknown as Record<string, unknown>,
      isError: result.isError === true,
      isReadOnly: result.isReadOnly === true,
      output: result.text ?? (typeof result.result === 'string' ? result.result : undefined),
    }
    // Thư mục làm việc giữa các lần Bash (0.8.0 A1): engine không cho trường thư mục của Bash, và $.session.cwd() không theo cd của subagent
    // (đo trên engine thật, xem DESIGN). Mod tự lưu thư mục sau cd cuối theo luồng hay agentId, mặc định thư mục gốc của phiên.
    if (e.tool === 'Bash') {
      const thread = e.agentId ?? 'main'
      const dirs = await read($, bashDirState)
      if (L.sessionRoot === undefined) L.sessionRoot = await $.session.root().catch(caught('session.root', null))
      const base = dirs[thread] ?? L.sessionRoot ?? ''
      if (base !== '') observation.cwd = base
      const after = classifyBash(String(observation.input['command'] ?? ''), base).dir
      if (after !== undefined && after !== dirs[thread]) {
        await update($, bashDirState, d => Object.fromEntries([...Object.entries(d).filter(([key]) => key !== thread), [thread, after]].slice(-BASH_DIRS)))
      }
    }

    // File đã đổi của mục tiêu (0.8.2 N5): cả luồng chính và subagent, độc lập với hạn mức; dùng khi đóng bước mở cuối.
    const changedBrief = S.normalizeCore(await read($, coreState)).brief
    if (changedBrief !== null && !observation.isError && isMutation(observation)) {
      const targets = changedTargets(observation, await rootFor($, L.roots, changedBrief.goalId))
      if (targets !== null && (targets.paths.length > 0 || targets.isUnknown)) await update($, coreState, S.withChanged(changedBrief.goalId, targets.paths, targets.isUnknown))
    }

    if (e.agentId !== undefined) {
      // Tiến độ từng việc (0.6.1): đếm tool call của agent có dòng tiến độ (agent đi qua agent.spawn của mod).
      const agentId = e.agentId
      if (S.normalizeCore(await read($, coreState)).agentProgress.items.some(item => item.agentId === agentId)) await update($, coreState, S.withAgentTool(agentId))
      const meta = agents.get(e.agentId)
      if (meta === undefined) return result
      const agentTracker = agentTrackers.get(e.agentId) ?? newTracker('')
      agentTrackers.set(e.agentId, agentTracker)
      // remindSubagents: subagent cũng bị kiểm phạm vi file của mục tiêu và được nhắc (kèm việc được giao);
      // mặc định chỉ ghi cảnh báo lên pane, không nhắc.
      const agentBrief = S.normalizeCore(await read($, coreState)).brief
      // Lệnh và thay đổi của subagent cùng mục tiêu vào dấu vết và trạng thái kiểm tra của luồng chính, theo tác giả:
      // subagent sửa sau lần test của luồng chính thì luồng chính phải kiểm tra lại; test của subagent chỉ phủ phần nó sửa.
      if (agentBrief !== null && meta.goalId === agentBrief.goalId) {
        const agentLog = evidenceFor(agentBrief.goalId)
        const agentSince = agentLog.seq
        noteEvidence(agentLog, observation, e.agentId)
        if (isCheckCall(observation.tool)) L.agentRetryNotes.push(...(await noteChecks($, retryDeps, S.normalizeCore(await read($, coreState)), agentBrief.goalId, newChecks(agentLog, agentSince), observation, meta.pick, false, meta.description)))
        const skillBefore = L.tracker.skillWrites
        trackVerification(L.tracker, observation, e.agentId, (await frameOf($, L.roots, agentBrief.goalId, agentBrief.scopePaths)).cwd)
        // File skill subagent ghi và lệnh khai đạt của subagent (0.8.2 N3): như của luồng chính, ghi trước, thử sau.
        if (L.tracker.skillWrites > skillBefore) await update($, coreState, S.withSkillWrite(agentBrief.goalId, L.tracker.skillPath))
        if (isCheckCall(observation.tool) && passedDeclared(newChecks(agentLog, agentSince))) await update($, coreState, S.withSkillTrial(agentBrief.goalId))
        // Subagent sửa file: bước tự nâng thành verified về done, như thay đổi của luồng chính (0.7.0).
        if (!observation.isError && isMutation(observation) && S.hasAutoVerified(S.normalizeCore(await read($, coreState)))) {
          await update($, coreState, S.withAutoDemoted)
          await showStatus($, await read($, view), ctx.options)
        }
      }
      // Phiên con của một phần (0.7.9 F1): phạm vi là files của phần đó, theo cơ chế cảnh báo ngoài phạm vi sẵn có.
      const forkScope = forkFiles(S.normalizeCore(await read($, coreState)), e.agentId)
      const scopePaths = forkScope.length > 0 ? forkScope : remindSubagents ? (agentBrief?.scopePaths ?? []) : []
      const frame = agentBrief !== null ? await frameOf($, L.roots, agentBrief.goalId, scopePaths) : { root: null, cwd: null }
      const findings = observe(agentTracker, observation, { goal: meta.description, scopePaths, tier: meta.tier, ...frame }, [])
      const at = await $.clock.now()
      const warnings: Warning[] = []
      for (const finding of findings) {
        if (finding.kind === 'checkpoint') continue
        warnings.push({ at, kind: finding.kind, text: `Agent ${e.agentId.slice(0, 6)}: ${finding.text}` })
      }
      if (warnings.length > 0) await update($, coreState, S.withWarnings(...warnings))
      const top = remindSubagents ? findings.filter(f => f.kind !== 'checkpoint' && f.context).sort((x, y) => y.priority - x.priority)[0] : undefined
      if (top?.context === undefined) return result
      return { ...result, context: [...(result.context ?? []), subagentReminder(meta.description, top.context)] }
    }

    const core = S.normalizeCore(await read($, coreState))
    // Lời nhắc sau nén (0.7.4): gắn một lần vào tool call này, dựng từ mục tiêu và checklist lúc này.
    // Luồng chính đang điều phối (0.8.4 V1): lời nhắc sau nén kèm câu nhắc lại vai điều phối.
    const keepRole = L.compaction.pending && core.brief !== null && isMainConducting(ctx.conductorInputs(core, S.modeOf(await read($, modeState), ctx.options)), core.brief)
    const compactNote = L.compaction.pending && core.brief !== null ? `${compactReminderText(core.brief, shownPlan(core).plan)}${keepRole ? `\n${conductorKeepText()}` : ''}` : null
    L.compaction.pending = false
    // Ghi cả lệnh lỗi: evidence nhắc tới một lệnh kiểm tra đã lỗi thì không được tính là đã kiểm tra.
    const retryNotes: string[] = []
    // Lệnh khai trong checkCommands chạy đạt (0.8.2 N3): bằng chứng thử skill, ghi sau lần ghi file skill của cùng lời gọi.
    let isDeclaredPass = false
    if (core.brief !== null) {
      const mainLog = evidenceFor(core.brief.goalId)
      const mainSince = mainLog.seq
      noteEvidence(mainLog, observation)
      const fresh = isCheckCall(observation.tool) ? newChecks(mainLog, mainSince) : []
      isDeclaredPass = passedDeclared(fresh)
      if (isCheckCall(observation.tool)) retryNotes.push(...(await noteChecks($, retryDeps, core, core.brief.goalId, fresh, observation, mainLevel(), true)))
      // Lệnh kiểm nối && mà cả lệnh lỗi (0.8.0 A11): kết quả chưa rõ, không đụng W4; đề nghị chạy riêng, một lần mỗi lệnh mỗi turn.
      for (const entry of fresh) {
        if (entry.chained !== true) continue
        const key = checkSignature({ check: entry.check ?? 'test', command: checkCommand(entry) })
        if (L.chainedNoted.has(key)) continue
        L.chainedNoted.add(key)
        retryNotes.push(chainedCheckNote(entry.command))
        record(await $.clock.now(), 'check-chained', { command: clipText(entry.command) })
        await flushDecisions((path, text) => $.fs.write(path, text))
      }
    }
    // Lượt 2 hay 3 của lệnh kiểm chưa đạt mà luồng chính tự sửa file (W4): dặn giao subagent ở mức đã nâng, một lần mỗi lượt, không chặn.
    if (EDIT_TOOLS.has(e.tool) && !observation.isError && !isPlanFile(filePathOf(observation))) {
      const fresh = S.normalizeCore(await read($, coreState))
      const due = liveRetry(fresh).filter(item => item.round >= 2 && item.edited < item.round)
      if (due.length > 0) {
        const lead = due.reduce((a, b) => (b.round > a.round ? b : a))
        retryNotes.push(retryEditNote(lead.round, lead.levels.at(-1) ?? ''))
        const marked = fresh.retry.items.map(item => (due.includes(item) ? { ...item, edited: item.round } : item))
        await update($, coreState, S.withRetry({ goalId: fresh.retry.goalId, items: marked }))
      }
    }
    // Luồng chính vừa thay đổi file: việc làm trực tiếp chưa có bước chuyển từ chưa bắt đầu sang đang làm (0.6.1).
    // Thay đổi mới: các bước tự nâng thành verified về done, vì lần test trước không còn phủ thay đổi này (0.7.0).
    if (core.brief !== null && !observation.isError && isMutation(observation)) {
      const goalId = core.brief.goalId
      const hadVerified = S.hasAutoVerified(core)
      await update($, coreState, c => S.withAutoDemoted(S.withActivity(goalId)(c)))
      if (hadVerified) await showStatus($, await read($, view), ctx.options)
    }
    // Lệnh test vừa chạy đạt sau thay đổi cuối (phủ mọi thay đổi): các bước done thành verified (0.7.0), chỉ những bước đóng sau lần
    // kiểm đạt trước của mục tiêu (0.7.5); lần này ghi mốc kiểm đạt mới.
    if (core.brief !== null && isCheckCall(observation.tool) && !observation.isError) {
      const log = evidenceFor(core.brief.goalId)
      const fresh = freshTestRun(log)
      if (fresh !== undefined && fresh === log.commands.at(-1) && (core.plan.some(s => s.status === 'done') || S.liveMirror(core).some(s => s.status === 'done'))) {
        await update($, coreState, S.withAutoVerified(fresh.command, undefined, true))
        record(await $.clock.now(), 'verify-auto', { command: clipText(fresh.command), at: core.plan.length === 0 ? 'mirror' : 'test' })
        await flushDecisions((path, text) => $.fs.write(path, text))
        await showStatus($, await read($, view), ctx.options)
      }
    }
    // Lệnh ghi không rõ đích cảnh báo một lần mỗi mục tiêu (0.7.5): tập khóa đổi khi đổi mục tiêu.
    if (core.brief !== null && L.unknownWrites.goalId !== core.brief.goalId) L.unknownWrites = { goalId: core.brief.goalId, keys: new Set() }
    const focus: Focus | null = core.brief !== null ? { ...core.brief, isBare: core.brief.isBare === true, warnedWrites: L.unknownWrites.keys, hints: L.sessionHints, ...(await frameOf($, L.roots, core.brief.goalId, core.brief.scopePaths)) } : null
    const skillBefore = L.tracker.skillWrites
    const findings = observe(L.tracker, observation, focus, core.plan)
    // File skill (0.8.2 N3): lần ghi cuối và lần thử lưu trong Core theo mục tiêu, nên giữ qua nhiều turn.
    if (core.brief !== null && L.tracker.skillWrites > skillBefore) await update($, coreState, S.withSkillWrite(core.brief.goalId, L.tracker.skillPath))
    if (core.brief !== null && isDeclaredPass) await update($, coreState, S.withSkillTrial(core.brief.goalId))
    const isErrorBurst = L.tracker.errors === ERROR_BURST
    // Luồng chính bắt đầu tự sửa file trong khi còn việc đã ghi giao subagent: nhắc một lần.
    // Ghi file kế hoạch của plan mode không phải là làm một việc đã phân.
    const pending = pendingFor(core.brief, shownPlan(core).plan)
    const planFile = isPlanFile(filePathOf(observation))
    // Mặc định nhắc một lần ở lần sửa file đầu tiên; strictDelegation remind/block nhắc ở mọi lần thay đổi (kể cả lệnh ghi file).
    const isStrict = strictDelegation !== 'off'
    const isChange = isStrict ? isMutation(observation) : EDIT_TOOLS.has(e.tool)
    const nudge =
      isChange && !planFile && !observation.isError && pending.length > 0 && (isStrict || !L.delegation.isNudged)
        ? `[focus-conductor] Phân việc còn việc ghi giao subagent chưa giao: Việc ${pending.join(', ')}. Nếu thay đổi này thuộc các việc đó, giao qua Agent với description "Việc N: ..." để chạy đúng model đã chấm.`
        : null
    if (nudge) L.delegation.isNudged = true
    // Việc của tin chen ngang vừa chuyển sang subagent (0.7.8 G9): báo một lần ở kết quả tool kế tiếp của luồng chính.
    const moved = L.interjectNote
    L.interjectNote = null
    // Mục W4 do subagent tạo (0.8.0 A12): câu báo chờ gắn vào kết quả tool kế tiếp của luồng chính (kết quả Agent khi subagent trả về).
    const fromAgents = L.agentRetryNotes.splice(0)
    const notes = [...(nudge ? [nudge] : []), ...(compactNote !== null ? [compactNote] : []), ...(moved !== null ? [moved] : []), ...retryNotes, ...fromAgents]
    // Gom (0.7.9 F1): mọi phần của việc tách đã có kết quả từ phiên con thì kết quả tool này kèm một câu, một lần mỗi việc, và một dòng
    // fork-archive; pane và band thu các phần đó thành một dòng.
    const merging = core.brief === null ? [] : mergeDue(core).filter(t => !L.forkMerging.has(`${core.brief?.goalId}:${t.index}`))
    if (core.brief !== null && merging.length > 0) {
      const goalId = core.brief.goalId
      for (const t of merging) L.forkMerging.add(`${goalId}:${t.index}`)
      const at = await $.clock.now()
      for (const t of merging) record(at, 'fork-archive', { task: t.index, parts: t.split?.length ?? 0, results: forkResults(core, t.index) })
      await update($, coreState, S.withForksMerged(goalId, merging.map(t => t.index)))
      await flushDecisions((path, text) => $.fs.write(path, text))
      notes.push(...merging.map(t => forkMergedNote(t.index)))
    }
    const withNudge = (r: typeof result) => (notes.length > 0 ? { ...r, context: [...(r.context ?? []), ...notes] } : r)
    // Đến checkpoint mà script kiểm đã chạy chưa được nhận: gợi ý người dùng khai checkCommands (0.7.3).
    if (core.brief !== null && findings.some(f => f.kind === 'checkpoint')) await offerCheckHint($, core.brief.goalId, suggestCheckCommands(evidenceFor(core.brief.goalId)))
    if (findings.length === 0 && !isErrorBurst) return withNudge(result)

    const at = await $.clock.now()
    const warnings: Warning[] = []
    let depthLift = 0
    let effortLift = 0
    for (const finding of findings) {
      if (finding.kind === 'checkpoint') continue
      warnings.push({ at, kind: finding.kind, text: finding.text })
      if (finding.kind === 'loop' || finding.kind === 'scope') $.ui.toast(finding.text)
      // Lặp lỗi: turn sau nâng độ sâu. Vượt ngân sách: turn sau nâng effort.
      if (finding.kind === 'loop') depthLift = 1
      if (finding.kind === 'budget') effortLift = 1
      // Gửi kèm router ở prompt tiếp nối (0.7.0): lựa chọn model của turn này đã thiếu.
      if (finding.kind === 'loop' || finding.kind === 'budget') noteObserved(finding.text)
      if (finding.kind === 'loop') noteStuck(core, typeof observation.input['command'] === 'string' ? observation.input['command'] : observation.tool)
    }
    if (isErrorBurst) {
      warnings.push({ at, kind: 'loop', text: `${ERROR_BURST} tool call lỗi trong turn này: turn sau nâng effort một bậc` })
      effortLift = 1
      noteObserved(`${ERROR_BURST} tool call lỗi trong turn này`)
    }
    const lifts = depthLift > 0 || effortLift > 0
    if (lifts) L.liftRaised = true
    if (warnings.length > 0 || lifts) {
      await update($, coreState, c => {
        const withWarnings = S.withWarnings(...warnings)(c)
        return lifts ? S.withLift(depthLift, effortLift)(withWarnings) : withWarnings
      })
    }

    // semanticDrift (người dùng tự bật): ở checkpoint, router đọc mục tiêu và các thay đổi gần đây để nhận ra lạc đề
    // theo nội dung, thứ mà theo dõi hành vi tool không thấy.
    let driftNote: string | null = null
    // Tự tắt khi hạn mức đã vào vùng gần ngưỡng (hay đang dừng): mỗi lượt kiểm là một lượt gọi router. Tối đa một lượt mỗi 10 phút.
    const quota = normalizeQuota(await read($, quotaState))
    const isNearQuota = quota.pause !== null || evaluateQuota(quota.readings, at, quotaSettings(ctx.options)).nearest !== null
    const isDriftDue = L.lastDriftAt === null || at - L.lastDriftAt >= driftEveryMs
    const driftTarget = ctx.routerTarget(core, S.modeOf(await read($, modeState), ctx.options))
    if (semanticDrift && core.brief !== null && findings.some(f => f.kind === 'checkpoint') && (driftTarget.isFable || !isRouterPaused()) && !isNearQuota && isDriftDue) {
      L.lastDriftAt = at
      const target = driftTarget
      const request = driftRequest({
        goal: core.brief.goal,
        steps: openSteps(core.plan).map(step => step.title),
        commands: L.evidenceLog.commands.map(entry => entry.command),
        paths: L.evidenceLog.paths,
        model: target.model,
        ...(target.isFable ? { isFable: true } : {}),
      })
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, parseDrift)
      ctx.noteRouterFailure('drift', outcome.failure)
      if (target.isFable) await noteFableRouter($, ctx, outcome.result !== null)
      noteRouterTime((await $.clock.now()) - startedAt)
      const verdict = outcome.result
      const now = await $.clock.now()
      const isOffTrack = verdict !== null && !verdict.onTrack
      if (isOffTrack) noteStuck(core, core.brief.goal)
      await update($, coreState, c => {
        const used = S.withAnalyzerUsage(outcome.usages, target.family)(c)
        // Lệch mục tiêu: cảnh báo, và turn sau nâng độ sâu một bậc (0.7.0).
        return isOffTrack ? S.withLift(1, 0)(S.withWarnings({ at: now, kind: 'drift', text: `Router: có thể lạc đề (${verdict?.why ?? ''})` })(used)) : used
      })
      if (isOffTrack) {
        L.liftRaised = true
        noteObserved(`Router: có thể lạc đề (${verdict?.why ?? ''})`)
      }
      record(now, 'drift', { onTrack: verdict?.onTrack ?? null, why: verdict?.why ?? outcome.reason, retried: outcome.retried })
      await flushDecisions((path, text) => $.fs.write(path, text))
      if (verdict !== null && !verdict.onTrack) driftNote = driftContext(core.brief.goal, verdict.why)
    }
    const top = findings.filter(f => f.context).sort((a, b) => b.priority - a.priority)[0]
    // Lời nhắc một lần trong phiên (T6): chỉ ghi khóa khi chính lời nhắc này được chèn.
    if (top?.hint !== undefined) L.sessionHints.add(top.hint)
    const extra = [...(top?.context ? [top.context] : []), ...(driftNote ? [driftNote] : [])]
    if (extra.length === 0) return withNudge(result)
    return withNudge({ ...result, context: [...(result.context ?? []), ...extra] })
  }).catch(($, e, next) => (noteHookError('tool.call', next.error), next(e)))

  // Claude định kết thúc mà checklist còn mở, hoặc còn việc giao subagent đã lỗi chưa giao lại: yêu cầu hoàn thành
  // hoặc giải thích. stop_hook_active chặn vòng lặp: phần checklist và G1 chỉ nhắc một lần mỗi chuỗi dừng; lệnh kiểm chưa đạt (W4) thì
  // chặn theo lượt, tối đa RETRY_ROUNDS lượt rồi một lần đòi báo cáo. Chỉ chặn turn đang thực thi mục tiêu (có thay đổi, cập nhật
  // checklist, giao subagent, hoặc làm tiếp mục tiêu); turn hỏi đáp thì không.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    // Stop đầu tiên không còn subagent nào chạy: tính lại cảnh báo chưa kiểm đã hoãn (0.8.0 A5).
    if (await settleDeferred($, ctx)) await showStatus($, await read($, view), ctx.options)
    if (result.block || result.preventContinuation || !isExecuting(L.tracker, L.promptIntent)) return result
    if ((await read($, mode)) === 'off') return result
    // Đang dừng vì hạn mức (hay người dùng tạm dừng): cho kết thúc, nếu không sẽ vòng lặp chặn khi mọi tool bị từ chối.
    const quota = normalizeQuota(await read($, quotaState))
    if (quota.pause !== null) return result
    const failed = failedFor(S.normalizeCore(await read($, coreState)).brief).concat(forkFailures(S.normalizeCore(await read($, coreState))))
    // Rà kế hoạch trước khi trình duyệt (0.8.2 N2): xét đầu tiên, trước W4, Y6, G1; không theo stop_hook_active (mỗi lần chặn là một lượt rà)
    // và không theo enforceChecklist (option planApproval riêng).
    const review = await planReviewGate($, ctx)
    if (review.kind === 'allow') {
      await showStatus($, await read($, view), ctx.options)
      return result
    }
    if (review.kind === 'block') return { ...result, block: review.reason }
    if (ctx.options['enforceChecklist'] !== true) return result
    // Turn đã nhận câu báo hạn mức mềm (0.7.5): quy tắc dừng theo hạn mức của prompt có thể đang áp, nên checklist còn mở không
    // chặn kết thúc, nhưng chỉ khi cửa sổ vẫn còn trong vùng báo (vòng sửa 2: cửa sổ đã làm mới thì chặn như cũ); việc giao
    // subagent đã lỗi vẫn bị chặn.
    const isNoticed = L.noticeTurn !== null && L.noticeTurn === L.tracker.turnId && softNotices(quota.readings, await $.clock.now(), quotaSettings(ctx.options)).length > 0
    // Lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4) xét trước checklist và G1, và không theo stop_hook_active: mỗi lần chặn là một lượt mới.
    const gate = isNoticed ? { reason: null, isPlanChanged: false } : await retryGate($, retryDeps, e.last_assistant_message)
    if (gate.isPlanChanged) await showStatus($, await read($, view), ctx.options)
    // Lệnh miễn chưa đòi báo cáo (0.7.9 Y5): chặn đúng một lần, đi chung lần chặn của W4 nếu có.
    const waiveReason = await askWaived($)
    const retryReason = gate.reason !== null && waiveReason !== null ? joinStopReasons(gate.reason, waiveReason) : gate.reason ?? waiveReason
    // stop_hook_active chỉ bỏ qua phần checklist và G1: hai cổng đó nhắc một lần mỗi chuỗi dừng.
    if (e.stop_hook_active) return retryReason !== null ? { ...result, block: retryReason } : result
    let core = S.normalizeCore(await read($, coreState))
    // Đã sửa mà chưa chạy lần kiểm nào (0.7.9 Y6): sau W4, trước G1 và checklist; theo stop_hook_active như G1.
    const noCheck = isNoticed || core.brief === null ? null : await noCheckGate($, ctx.options, core, evidenceFor(core.brief.goalId), L.liveAgents.size > 0)
    if (noCheck !== null) core = S.normalizeCore(await read($, coreState))
    // Sửa skill mà chưa thử (0.8.2 N3): sau Y6, trước G1; theo stop_hook_active như Y6 và G1.
    const skillReason = isNoticed || core.brief === null ? null : await skillTrialGate($, core, L.liveAgents.size > 0)
    if (skillReason !== null) core = S.normalizeCore(await read($, coreState))
    const prior = [retryReason, noCheck, skillReason].reduce<string | null>((acc, reason) => (reason === null ? acc : acc === null ? reason : joinStopReasons(acc, reason)), null)
    const plan = isNoticed ? [] : core.plan
    const withRetry = (reason: string) => (prior !== null ? joinStopReasons(prior, reason) : reason)
    // Mục tiêu từ moderate (hoặc có việc đã phân) mà chưa có checklist (0.7.8 G1): chặn một lần mỗi mục tiêu, khóa trong Core nên
    // giữ qua hot reload; danh sách phản chiếu từ TodoWrite chỉ để hiển thị nên không tính là checklist.
    const brief = core.brief
    if (brief !== null && core.plan.length === 0 && failed.length === 0 && !isNoticed && core.stopNudged !== brief.goalId && needsChecklist(brief)) {
      await update($, coreState, S.withStopNudged(brief.goalId))
      const hasMirror = core.mirror.goalId === brief.goalId && core.mirror.steps.length > 0
      return { ...result, block: withRetry(noChecklistReason(brief, hasMirror)) }
    }
    if (isGoalDone(plan) && failed.length === 0) return prior !== null ? { ...result, block: prior } : result
    return { ...result, block: withRetry(stopBlockReason(plan, failed)) }
  }).catch(($, e, next) => (noteHookError('classic.Stop', next.error), next(e)))

  // Chi phí đo được: luồng chính (không có agentId) vào nhóm luồng chính; subagent
  // vào nhóm agent và gắn vào dòng nhật ký của đúng agent. Hiệu chỉnh ước lượng theo số đo.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await ctx.flushErrors({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), root: () => $.session.root() })
    if ((await read($, mode)) === 'off') return result
    const at = await $.clock.now()

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const meta = agents.get(agentId)
      steppedEarly.delete(agentId)
      L.liveAgents.delete(agentId)
      if (e.usage) {
        const family = familyOf(e.usage.model) ?? meta?.family ?? 'sonnet'
        const core = S.normalizeCore(await read($, coreState))
        const added = addUsage(core.ledger, 'agent', family, e.usage)
        // Chỉ agent router đã chấm mới có khối lượng thật để hiệu chỉnh; agent không có kết quả chấm thì bỏ qua.
        const effort = meta?.sentEffort ?? meta?.pick.effort ?? 'medium'
        const ledger =
          meta !== undefined && meta.shape !== null
            ? recordShape(calibrate(added.ledger, family, e.usage.output_tokens, meta.volume, effort), meta.shape, e.usage.output_tokens, effort)
            : added.ledger
        await update($, coreState, c => S.withAgentUsd(agentId, added.usd)(S.withLedger(() => ledger)(c)))
      }
      // Lỗi hoặc bị từ chối thì lần giao lại việc đó được router chấm lại; người dùng ngắt (aborted) thì không cần.
      if ((e.reason === 'error' || e.reason === 'refusal') && meta !== undefined) {
        agentFailures.push({ description: meta.description, goalId: meta.goalId })
        if (agentFailures.length > 10) agentFailures.shift()
      }
      // Tiến độ từng việc (0.6.1): chỉ 'answer' là xong; còn lại là lỗi, hoặc bị cắt nếu đang tạm dừng vì hạn mức.
      const end = agentEnd(e.reason, normalizeQuota(await read($, quotaState)).pause !== null)
      await update($, coreState, S.withAgentEnd(agentId, end.agent, at))
      // Lần thử skill (0.8.2 N3): chỉ subagent "Thử skill: " trả lời xong mới là bằng chứng; lỗi, bị hủy, bị từ chối hay bị cắt thì không.
      // Ghi mốc cũ theo tool_use_id để kết quả tool Agent lỗi về sau trả lại mốc đó.
      const trialCall = L.skillTrials.get(agentId)
      L.skillTrials.delete(agentId)
      if (meta !== undefined && isSkillTrial(meta.description) && end.agent === 'done') {
        const before = S.normalizeCore(await read($, coreState))
        if (before.brief !== null && before.brief.goalId === meta.goalId) {
          if (trialCall !== undefined && L.trialCounted.size < 100) L.trialCounted.set(trialCall, S.skillOf(before).trialAt)
          await update($, coreState, S.withSkillTrial(meta.goalId))
        }
      }
      // Phiên con của một phần (0.7.9 F1): phần xong hay lỗi; lỗi thì Stop chặn tới khi phần được làm lại hay ghi skipped, blocked.
      const forked = liveForks(S.normalizeCore(await read($, coreState))).find(p => p.agentId === agentId && p.state === 'running')
      if (forked !== undefined) {
        const outcome: 'done' | 'failed' = end.agent === 'done' ? 'done' : 'failed'
        await update($, coreState, S.withForkEnd(agentId, outcome))
        record(at, 'fork', { task: forked.task, part: forked.part, result: outcome })
        await flushDecisions((path, text) => $.fs.write(path, text))
      }
      // Việc đã phân mà agent này làm: ghi xong hoặc lỗi (lỗi thì Stop và cảnh báo cuối turn nhắc giao lại).
      if (meta?.taskIndex !== undefined) {
        moveDelegation(meta.goalId, meta.taskIndex, end.delegation)
        const brief = S.normalizeCore(await read($, coreState)).brief
        if (brief !== null && brief.goalId === meta.goalId) await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
      }
      // Subagent cuối trả về (0.8.0 A5): tính lại cảnh báo chưa kiểm đã hoãn.
      if (await settleDeferred($, ctx)) await showStatus($, await read($, view), ctx.options)
      return result
    }

    const core = S.normalizeCore(await read($, coreState))
    // Đang dừng vì hạn mức: không có thông báo cuối turn nào (Claude đã được yêu cầu chỉ ghi điểm dừng).
    const isPaused = normalizeQuota(await read($, quotaState)).pause !== null
    const summary = isPaused ? [] : summarize(L.tracker, core.brief, core.plan, core.brief !== null && L.tracker.checks === 0 ? suggestCheckCommands(evidenceFor(core.brief.goalId)) : [])
    // Còn subagent chạy chưa trả về (0.8.0 A5): hoãn cảnh báo chưa kiểm; thay đổi vẫn nằm trong tracker và được tính lại khi subagent cuối trả về.
    const isWaiting = L.liveAgents.size > 0
    const held = isWaiting ? summary.filter(f => f.kind === 'unverified' && f.isSoft !== true) : []
    if (held.length > 0 && L.deferred.length < 5) L.deferred.push(L.tracker)
    const findings = summary.filter(f => !held.includes(f))
    const warnings: Warning[] = findings.map(f => ({
      at,
      kind: f.kind === 'checkpoint' ? 'unverified' : f.kind,
      text: f.text,
      ...(f.cause !== undefined ? { cause: f.cause } : {}),
      ...(f.isSoft === true ? { isSoft: true as const } : {}),
    }))
    let ledger = core.ledger
    if (e.usage) {
      const family = familyOf(e.usage.model) ?? core.route?.family ?? 'sonnet'
      const added = addUsage(core.ledger, 'main', family, e.usage)
      // Chỉ hiệu chỉnh khi route của chính turn này đã được áp (chế độ auto, không
      // quay về model của engine); nếu không, effort thực tế không phải effort của route.
      const applied = L.turnRoute.turnId === e.turnId ? L.turnRoute.route : null
      const isApplied = applied !== null && (await read($, mode)) === 'auto'
      const brief = core.brief
      ledger =
        isApplied && brief
          ? recordShape(
              calibrate(added.ledger, family, e.usage.output_tokens, brief.volume, applied.effort),
              shapeKey(brief.depth, brief.volume, brief.kind),
              e.usage.output_tokens,
              applied.effort,
            )
          : added.ledger
    }
    // Turn có thực thi mà các việc ghi giao subagent vẫn chưa được giao: cảnh báo chi phí một lần.
    const waiting = pendingFor(core.brief, shownPlan(core).plan)
    if (!isPaused && waiting.length > 0 && !L.delegation.isWarned && isExecuting(L.tracker, L.promptIntent)) {
      L.delegation.isWarned = true
      warnings.push({ at, kind: 'cost', text: `Việc ${waiting.join(', ')} ghi giao subagent nhưng chưa được giao; luồng chính tự làm sẽ chạy ở model đắt hơn` })
    }
    // Việc giao subagent đã lỗi mà chưa giao lại: cảnh báo mỗi việc một lần.
    if (!isPaused && core.brief !== null && L.delegation.goalId === core.brief.goalId) {
      const fresh = [...L.delegation.failed].filter(([index]) => !L.delegation.failWarned.has(index))
      for (const [index] of fresh) L.delegation.failWarned.add(index)
      if (fresh.length > 0) {
        warnings.push({ at, kind: 'open-steps', text: `Việc ${fresh.map(([, label]) => label).join(', ')} giao subagent đã lỗi, chưa giao lại` })
      }
    }
    const end = await $.session.usage().catch(caught('session.usage', null))
    const endContext = end?.context.tokens ?? L.turnContext
    // Còn lệnh kiểm chưa đạt khi turn kết thúc (0.7.8 vòng sửa 3, W4): router chấm lại luồng chính ở prompt sau (mục quan sát) và turn sau
    // nâng effort một bậc, như nhánh lặp lỗi.
    const unresolved = isPaused ? [] : liveRetry(core)
    for (const item of unresolved) noteObserved(`Lệnh kiểm chưa đạt: ${item.more.length > 0 ? retryName(item) : item.command} (lượt ${item.round}/${RETRY_ROUNDS})`)
    // Turn không có phát hiện nào làm tăng nâng cấp: nâng cấp của mục tiêu giảm một bậc (0.7.0).
    const hadFinding = L.liftRaised || unresolved.length > 0
    L.liftRaised = false
    await update($, coreState, c => {
      // Turn không có cảnh báo chưa kiểm thì chuỗi turn cùng nguyên nhân đứt (0.8.0 A5); turn hoãn vì còn subagent chưa tính là đứt.
      const isStreak = isPaused || held.length > 0 || findings.some(f => f.kind === 'unverified')
      const marked = S.withTurnMark(at, endContext)(S.withLedger(() => ledger)(S.withWarnings(...warnings)(isStreak ? c : S.withCauseBreak(c))))
      if (unresolved.length > 0) return S.withLift(0, 1)(marked)
      return hadFinding ? marked : S.withLiftDecay(marked)
    })
    // Báo cáo cuối khi hết lượt (W4): Stop không mang chữ câu trả lời thì đối chiếu answer của turn này.
    if (!isPaused) await logExhausted($, retryDeps, S.normalizeCore(await read($, coreState)), e.reason === 'answer' ? e.answer : null, 'turn kết thúc không có câu trả lời')
    const unverified = findings.find(f => f.kind === 'unverified')
    if (unverified) await announceUnverified($, ctx, unverified, L.tracker, core.brief, at, isPaused)
    await showStatus($, await read($, view), ctx.options)
    return result
  })
}
