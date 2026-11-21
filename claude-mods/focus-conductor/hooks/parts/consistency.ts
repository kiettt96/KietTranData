// Giữ nhất quán: tool plan, theo dõi mọi tool, chặn kết thúc khi checklist còn mở, cộng chi phí đo được.

import { atom, derive, read, update } from 'claude-code'
import { caught, noteBehavior, noteHookError } from '../lib/errlog'
import type { AgentState, ApprovalState, Brief, Choice, Core, DelegationState, Mode, ModelFamily, PlanStep, RetryItem, Role, Warning } from '../../types'
import { acceptsVerified, checkKindOf, classifyBash, evidenceStrength, filePathOf, freshTestRun, hardChanges, isCheckTool, isExecuting, isFullyClosed, isGoalDone, isMutation, isPlanFile, normalizePath, isSkillTrial, markVerified, newTracker, skillNameOf, noteEvidence, observe, openSteps, pendingSteps, suggestCheckCommands, summarize, trackVerification } from '../lib/drift'
import { isRoleTemp, isSidePath } from '../lib/drift/scope'
import type { WriteEffect } from '../lib/drift/classify'
import { STEP_RUNS, runKey, stepCheckOf, stepEvidence, stepRunOf } from '../lib/drift/stepcheck'
import type { StepRun } from '../lib/drift/stepcheck'
import { checkScopeOf, inCheckScope, splitCheckScope } from '../lib/drift/verify'
import { globToRegExp } from '../lib/drift/soft'
import { coversScope } from '../lib/drift/evidence'
import { PLAN_SET_CHECK_LINE } from '../lib/approval'
import { hasNoVerdictLine, isUnclearVerdict, reportTable, verdictOf } from '../lib/verdict'
import { EMPTY_CLOSING, closingSnapshot, normalizeClosing, restoreClosing } from '../lib/closing-state'
import { listScope, newFiles, scopeRoots } from '../lib/scope-list'
import { goalFilePath, goalFileText } from '../lib/goal-file'
import { tempRewrite } from '../lib/drift/tempdir'
import { pipedCheck } from '../lib/drift/pipecheck'
import { EMPTY_REVIEW_PRINTS, changedPrints, isMeasured, normalizeReviewPrints, printNames, printTargets, takePrints, withPrint, withStale } from '../lib/prints'
import { closingNote, closingSteps, hardFileCount, hasKnownCheck, isDocsOnly, prefixRole, teamCause } from '../lib/team'
import type { ClosingVerdict } from '../lib/team'
import type { SideLists } from '../lib/drift/scope'
import type { Finding, Focus, ToolObservation, TurnTracker } from '../lib/drift'
import { checkCommand, checkSignature, coversFailure, isFailedRun } from '../lib/drift/evidence'
import { isCustomCheck } from '../lib/drift/verify'
import type { CheckRun, EvidenceEntry, EvidenceLog } from '../lib/drift/evidence'
import { BASE_SEEN, baseOf, errorCountOf, hasChanges, hasGrown, isBaseline, isBaselineRun, seenOf, stripBase } from '../lib/baseline'
import type { BaseItem, BaseState, Write } from '../lib/baseline'
import { clipText } from '../lib/decisions'
import { addUsage, calibrate, recordShape, safeUsage, shapeKey } from '../lib/ledger'
import { applyPlan } from '../lib/plan'
import type { RetryLine } from '../lib/text'
import type { PlanInput } from '../lib/plan'
import { describePick, familyOf } from '../lib/route'
import { askRouter, driftRequest, nextLevel, openPhase, parseDrift, parsePlanReview, planReviewRequest, topFamily } from '../lib/router'
import { hasFixes, reviewReason } from '../lib/approval'
import { taskRows } from '../lib/progress'
import { EMPTY_QUOTA, evaluateQuota, normalizeQuota, quotaSettings, softNotices } from '../lib/quota'
import { storeKey, withNote } from '../lib/checkpoint'
import * as S from '../lib/state'
import { statusTextOf } from '../ui/direction'
import { fableStep } from './fable'
import { isMainConducting } from '../lib/conductor'
import type { View } from '../lib/state'
import { shownPlan } from '../lib/mirror'
import { forkFailures, forkFiles, forkResults, liveForks, mergeDue } from '../lib/forks'
import { PLAN_TOOL_FULL, RETRY_REPORT, chainedCheckNote, retryAgentNotice, RETRY_ROUNDS, noCheckReason, waiveAskText, blockText, firstErrorLine, clipMiddle, RETRY_COMMAND_CHARS, joinStopReasons, retryDoneNote, retryEditNote, baselineAskText, retryBaselineNotice, retryFailNotice, retryGrewNotice, retryName, retryStepNote, retryStopReason, skillTrialReason, changedFilesNotice, checkHintText, compactReminderText, conductCheckDenyText, conductReadText, conductWriteDenyText, conductorKeepText, criteriaNotice, driftContext, missingTasks, missingTasksNotice, needsChecklist, noChecklistReason, pendingNotice, qualityNotice, renderBulk, renderPlan, requirementsNotice, setResultText, staticOnlyNotice, stopBlockReason, subagentReminder, unbackedNotice, forkMergedNote } from '../lib/text'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx, VerdictRun } from '../context'
import { modeOf, viewOf } from '../atoms'
import { clockOf, labels, langOf } from '../ui/labels'
import type { Lang } from '../ui/labels'
import { EDIT_TOOLS, ERROR_BURST } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
/** Số lệnh kiểm bị loại gần nhất ghi vào dòng unverified của nhật ký quyết định (0.7.7 X5). */
const UNVERIFIED_REJECTED = 3

const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
// Dấu file của các lượt duyệt (0.9.0, C2 đo dấu file); cùng key với parts/agents.ts.
const printState = atom({ plugin: 'focus-conductor', key: 'reviewPrints' } as const, EMPTY_REVIEW_PRINTS)
const closingStore = atom({ plugin: 'focus-conductor', key: 'closing' } as const, EMPTY_CLOSING)

/** Ghi tệp trạng thái mục tiêu của dự án khi Core hay bản ghi cổng đóng đổi (vòng 2 M15); không có mục tiêu hay mã phiên thì không ghi. */
async function saveGoalFile($: EngineInterface, ctx: Ctx): Promise<void> {
  try {
    const sessionId = await $.session.id()
    const core = S.normalizeCore(await read($, coreState))
    if (typeof sessionId !== 'string' || sessionId === '' || core.brief === null) return
    const closing = normalizeClosing(await read($, closingStore))
    const key = goalFileText(sessionId, 0, core, closing)
    if (key === ctx.local.goalFileSaved) return
    ctx.local.goalFileSaved = key
    await $.fs.write(goalFilePath(await $.session.root()), goalFileText(sessionId, await $.clock.now(), core, closing))
  } catch {
    // Engine không cho ghi hay không trả mã phiên: bỏ qua, như trước bản này.
  }
}

/** Nạp trạng thái cổng đóng từ $.state một lần mỗi lần nạp mod (0.9.0 vòng 2 M6), trước lần đọc đầu tiên. */
async function hydrateClosing($: EngineInterface, ctx: Ctx): Promise<void> {
  const L = ctx.local
  if (L.closingLoaded) return
  L.closingLoaded = true
  const snap = normalizeClosing(await read($, closingStore))
  restoreClosing(L, snap)
  L.closingSaved = JSON.stringify(closingSnapshot(L))
}

/** Ghi trạng thái cổng đóng vào $.state khi đổi (0.9.0 vòng 2 M6). */
async function persistClosing($: EngineInterface, ctx: Ctx): Promise<void> {
  const L = ctx.local
  if (!L.closingLoaded) return
  const snap = closingSnapshot(L)
  const text = JSON.stringify(snap)
  if (text === L.closingSaved) return
  L.closingSaved = text
  await update($, closingStore, () => snap)
}

/** Áp kết quả một lượt router gửi Fable vào Core (0.8.4 C6): vừa tạm ngừng thì toast và một dòng nhật ký conductor. */
/**
 * Vai điều phối của một lời gọi của luồng chính (0.8.6 R1, R2): null khi không điều phối hay khi đích là file kế hoạch; ngược lại số mục
 * tiêu và có được miễn không (/conductor solo, hay lời gọi Agent gần nhất bị từ chối mà không sinh subagent).
 */
/**
 * Lời gọi ghi chỉ vào tệp trạng thái của mục tiêu (0.9.0 B4): tool sửa file có đường dẫn là tệp trạng thái, hay Bash mà mọi tác động là ghi
 * có đích đọc được và mọi đích là tệp trạng thái. Mục tiêu không có tệp trạng thái thì false.
 */
async function writesOnlyStateFiles($: EngineInterface, brief: Brief, e: { tool: string } & Record<string, unknown>): Promise<boolean> {
  const root = await $.session.root().catch(caught('session.root', null))
  const cwd = await $.session.cwd().catch(caught('session.cwd', null))
  if (e.tool !== 'Bash') {
    const path = filePathOf({ tool: e.tool, input: e, isError: false, isReadOnly: false })
    return path !== '' && isSidePath(path, brief, root, cwd, 'state')
  }
  // Vai điều phối tự lưu bản (0.9.0 B14 mục 9): ghi vào tệp trạng thái hay nơi ghi phụ (cp, mkdir -p, shasum >), và git add, commit, tag, push.
  const classified = classifyBash(String(e['command'] ?? ''))
  if (classified.effects.length === 0) return false
  return classified.effects.every(effect => effect.kind === 'write' && (isSaveHistory(effect) || (!effect.isUnknown && effect.paths.length > 0 && effect.paths.every(path => isSidePath(path, brief, root, cwd, 'all')))))
}

/** Lệnh git lưu bản mà vai điều phối được chạy (0.9.0 B14 mục 9): add, commit, tag, push. */
function isSaveHistory(effect: WriteEffect): boolean {
  return effect.isHistory === true && /^(?:add|commit|tag|push)$/.test(effect.gitSub ?? '')
}

/**
 * Câu dặn vòng sửa theo kết luận CHƯA ĐẠT (0.9.0 C7), không quá 200 ký tự: vòng 1 chuyển nguyên văn phần lỗi cho đúng việc và agent đã làm;
 * vòng 2 (trước vòng 3) giao vai thiết kế chẩn đoán bằng model mạnh nhất được phép; hết trần thì ghi blocked và dừng lại hỏi người dùng.
 */
export function verdictRetryNote(name: string, round: number, top: ModelFamily): string {
  const text =
    round >= RETRY_ROUNDS
      ? `[focus-conductor] Vai ${name} báo CHƯA ĐẠT sau ${RETRY_ROUNDS} vòng: ghi bước blocked kèm phần lỗi, dừng lại hỏi người dùng.`
      : round === RETRY_ROUNDS - 1
        ? `[focus-conductor] Vai ${name} báo CHƯA ĐẠT (vòng ${round}/${RETRY_ROUNDS}): trước vòng ${RETRY_ROUNDS}, giao một việc vai thiết kế (Agent Plan) chẩn đoán bằng ${top}, rồi mới sửa.`
        : `[focus-conductor] Vai ${name} báo CHƯA ĐẠT (vòng ${round}/${RETRY_ROUNDS}): chuyển nguyên văn phần lỗi cho đúng việc và agent đã làm phần đó, rồi giao kiểm lại.`
  return text.slice(0, 200)
}

/** Lần chặn tối đa của cổng đóng mục tiêu cho một mục tiêu (0.9.0 C6), và trần ký tự của lý do. */
export const CLOSING_BLOCKS = 3
export const CLOSING_CHARS = 600

/** Trần ký tự của dòng nhắc đọc kết quả lượt duyệt không có dòng kết luận, và của dòng nhắc ống lệnh (sau phiên thật D4). */
export const GATE_NOTE_CHARS = 160

/** Dòng nhắc khi lượt có tiền tố duyệt không có dòng kết luận (sau phiên thật D4, mục 1f). */
export function assumedVerdictNote(description: string): string {
  return `[focus-conductor] Lượt "${clipText(description, 40)}" không có dòng kết luận: đọc kết quả và xử lý lỗi lượt đó nêu trước khi đóng.`.slice(0, GATE_NOTE_CHARS)
}

/** Dòng nhắc khi lệnh kiểm đi qua ống che mã thoát (sau phiên thật D4, mục 2a). */
export function pipedCheckNote(command: string): string {
  return `[focus-conductor] \`${clipText(command, 40)}\` đi qua ống, mã thoát bị che nên lần chạy này không tính; chạy lại không kèm ống, hoặc thêm set -o pipefail.`.slice(0, GATE_NOTE_CHARS)
}

/** Câu đòi trả lời lại khi lượt gần nhất của vai không đọc ra kết luận (vòng 2 M1), mở đầu bằng đúng từ kết luận của vai. */
export function unreadAskText(missing: 'review' | 'design', lang: 'vi' | 'en'): string {
  if (lang === 'en') return missing === 'design' ? ' The latest readiness reply has no readable verdict: ask that subagent to answer again, starting with READY or NOT READY.' : ' The latest review reply has no readable verdict: ask that subagent to answer again, starting with PASS or NOT PASS.'
  return missing === 'design' ? ' Lượt đánh giá sẵn sàng gần nhất chưa có kết luận đọc được: hỏi chính subagent đó trả lời lại, mở đầu bằng SẴN SÀNG hay CHƯA SẴN SÀNG.' : ' Lượt duyệt gần nhất chưa có kết luận đọc được: hỏi chính subagent đó trả lời lại, mở đầu bằng ĐẠT hay CHƯA ĐẠT.'
}

/** Lý do chặn của cổng đóng mục tiêu theo bước còn thiếu đầu tiên (0.9.0 C6), không quá CLOSING_CHARS ký tự. */
export function closingReasonText(missing: 'check' | 'review' | 'design'): string {
  const text =
    missing === 'check'
      ? '[focus-conductor] Trước khi đóng mục tiêu: chưa có lần kiểm đạt sau thay đổi cuối. Chạy lệnh kiểm (khi đang điều phối thì giao subagent vai audit), rồi giao một lần duyệt độc lập: Agent có description mở đầu "Kiểm độc lập: ".'
      : missing === 'review'
        ? '[focus-conductor] Trước khi đóng mục tiêu: chưa có duyệt độc lập sau thay đổi cuối. Giao một subagent general-purpose có description mở đầu "Kiểm độc lập: " để rà độ đúng, phạm vi và quy ước; câu trả lời mở đầu bằng ĐẠT hay CHƯA ĐẠT. Không giao được thì người dùng gõ /conductor waive review.'
        : '[focus-conductor] Mục tiêu khó: đã có duyệt độc lập ĐẠT nhưng chưa có đánh giá sẵn sàng. Giao một subagent Plan đánh giá sẵn sàng sau lần duyệt; câu trả lời mở đầu bằng SẴN SÀNG hay CHƯA SẴN SÀNG.'
  return text.slice(0, CLOSING_CHARS)
}

/**
 * Cổng đóng mục tiêu (0.9.0 C6): mục tiêu substantial hay hard, edit hay mixed, checklist đóng hết, option closingReview khác off, chưa miễn.
 * Thứ tự: lần kiểm đạt sau thay đổi không nhẹ cuối; kết luận review ĐẠT sau đó; mục tiêu hard thêm kết luận design SẴN SÀNG sau review.
 * Thiếu thì ghi Core.closingGap; phiên không giao được subagent (solo, Agent bị từ chối) thì không chặn. Mỗi trạng thái thiếu chặn một lần,
 * tối đa CLOSING_BLOCKS lần mỗi mục tiêu. Trả lý do chặn hay null.
 */
async function closingGate($: EngineInterface, ctx: Ctx, core: Core, log: EvidenceLog): Promise<string | null> {
  const L = ctx.local
  await hydrateClosing($, ctx)
  const brief = core.brief
  const isDue = brief !== null && teamCause(ctx.options['closingReview'], brief, S.changedOf(core).paths) !== null && core.plan.length > 0 && isFullyClosed(core.plan)
  if (brief === null || !isDue || core.closingWaived === brief.goalId) {
    if (core.closingGap !== undefined) await update($, coreState, S.withClosingGap(null))
    return null
  }
  // Hiệu lực theo dấu file (0.9.0, C2 đo dấu file): kết luận được tính mà dấu của tập lúc cổng xét khác dấu lúc subagent hoàn tất thì hết
  // hiệu lực; fs không đo được thì giữ theo sổ thay đổi.
  const stale = await stalePrints($, brief.goalId, L.verdicts.goalId === brief.goalId ? L.verdicts.items : [])
  // Ghi lượt hết hiệu lực vào $.state (bổ sung 18/11 mục 3) rồi tính lại Core.team, để pane và band thấy bước duyệt chưa xong ngay sau lần xét.
  if (stale.agents.size > 0) {
    await update($, printState, state => withStale(normalizeReviewPrints(state), brief.goalId, stale.agents, stale.files))
    await refreshTeam($, ctx)
  }
  const staleIds = new Set([...normalizeReviewPrints(await read($, printState)).stale, ...stale.agents])
  const verdicts = (L.verdicts.goalId === brief.goalId ? L.verdicts.items : []).map(v => (staleIds.has(v.agentId) ? { ...v, isClean: false } : v))
  const lastHard = log.lastHard
  // Cùng một cách tính với pane (0.9.0 vòng sửa sau kiểm độc lập): kết luận mới nhất của mỗi bước quyết; bước kiểm chỉ khi có lệnh kiểm.
  const steps = teamSteps(core, brief, log, verdicts, ctx.local.stepRuns)
  const missing = steps.find(s => s.state !== 'pass')?.name ?? null
  const reviewSeq = verdicts.filter(v => v.isClean && v.isReview && v.verdict === 'pass' && v.seq > log.lastChange).reduce((max, v) => Math.max(max, v.seq), -1)
  if (missing === null) {
    if (core.closingGap !== undefined) await update($, coreState, S.withClosingGap(null))
    return null
  }
  // Phiên giao được subagent (0.9.0 C6): engine đã mời ít nhất một loại agent hay đã có subagent được sinh, và không solo, không bị từ chối.
  const conduct = S.conductOf(core)
  const canDelegate = ctx.offered.size > 0 || ctx.spawnedIds.size > 0
  const isSolo = conduct.solo || conduct.agentDenied || !canDelegate
  await update($, coreState, S.withClosingGap({ goalId: brief.goalId, missing, ...(isSolo ? { solo: true as const } : {}) }))
  if (isSolo) return null
  if (L.closingState.goalId !== brief.goalId) L.closingState = { goalId: brief.goalId, blocks: 0, key: '' }
  // Trạng thái của bước còn thiếu (chờ hay chưa đạt) thuộc khóa: duyệt đổi từ chờ sang chưa đạt là trạng thái thiếu mới (vòng sửa 1).
  // Lượt chưa đọc được kết luận (vòng 2 M1) thuộc khóa: mỗi lượt như vậy là trạng thái thiếu mới, chặn thêm một lần trong trần.
  const unreadId = [...verdicts].reverse().find(v => v.unread === true && v.seq > log.lastChange)?.agentId ?? ''
  const key = `${missing}:${steps.find(s => s.name === missing)?.state ?? ''}:${lastHard}:${reviewSeq}:${stale.files.join(',')}:${stale.agents.size}:${unreadId}`
  if (L.closingState.key === key || L.closingState.blocks >= CLOSING_BLOCKS) return null
  L.closingState = { goalId: brief.goalId, blocks: L.closingState.blocks + 1, key }
  await persistClosing($, ctx)
  ctx.record(await $.clock.now(), 'closing-gate', { goalId: brief.goalId, missing, n: L.closingState.blocks })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
  const reason = closingReasonText(missing)
  // Tên file đã đổi (0.9.0, C2 đo dấu file): đổi sau lượt duyệt (cổng xét lại), hay đổi ngay trong lượt duyệt sau thay đổi cuối.
  // Mọi lần chặn đều nêu tên file (vòng sửa cuối 18/11, A6): file đổi dấu đã ghi trong $.state, file đổi trong lượt duyệt, và file có lần
  // sửa definite sau lượt duyệt được tính gần nhất theo sổ.
  const prints = normalizeReviewPrints(await read($, printState))
  const named = [...stale.files, ...(prints.goalId === brief.goalId ? prints.staleFiles : []).filter(path => !stale.files.includes(path))]
  const lastRun = verdicts[verdicts.length - 1]
  for (const v of verdicts) if (v.seq > log.lastChange || v === lastRun) for (const path of v.changed ?? []) if (!named.includes(path)) named.push(path)
  const counted = (L.verdicts.goalId === brief.goalId ? L.verdicts.items : []).filter(v => v.isClean && v.isReview).reduce((max, v) => Math.max(max, v.seq), -1)
  if (counted >= 0) for (const w of log.writes) if (w.seq > counted && w.definite === true && (w.hard === true || w.skill === true)) for (const path of w.paths ?? []) if (!named.includes(path)) named.push(path)
  // Kết luận chỉ đạt một phần (luật đọc sau phiên thật D4, đây là trường hợp duy nhất còn chưa có kết luận): lượt gần nhất sau thay đổi
  // cuối chỉ có dòng như vậy.
  const latest = [...verdicts].reverse().find(v => v.seq > log.lastChange && prefixRole(v.description) !== 'audit')
  const unclear = missing !== 'check' && latest?.unclear === true ? ' Câu trả lời của lượt duyệt chưa có kết luận: kết luận chỉ đạt một phần, cần người duyệt nêu rõ đạt hay chưa đạt; hỏi lại chính subagent đó.' : ''
  // Lượt gần nhất của vai không đọc ra kết luận (vòng 2 M1): đòi người duyệt trả lời lại, mở đầu bằng đúng từ kết luận của vai.
  const unreadStep = steps.find(s => s.name === missing)?.unread === true
  const unread = missing !== 'check' && unreadStep ? unreadAskText(missing, langOf(ctx.options['uiLanguage'])) : ''
  // Mỗi file một lần trong lý do chặn (vòng 2 F2): so theo đường dẫn đã chuẩn hóa, đường dẫn tương đối giải theo thư mục gốc của phiên.
  const root = await $.session.root().catch(() => null)
  const keyOf = (path: string) => normalizePath(path.startsWith('/') || root === null ? path : `${root}/${path}`)
  const unique = named.filter((path, k) => named.findIndex(other => keyOf(other) === keyOf(path)) === k)
  const files = missing !== 'check' && unique.length > 0 ? ` File đã đổi trong hay sau lượt duyệt: ${printNames(unique)}.` : ''
  // Lượt gần nhất của bước còn thiếu báo chưa đạt (vòng 2 M5): nêu điều đó kèm số đếm.
  const failed = missing !== 'check' && steps.find(s => s.name === missing)?.state === 'fail' ? [...verdicts].reverse().find(v => v.seq > log.lastChange && v.isReview && (v.verdict === 'fail' || v.verdict === 'not-ready')) : undefined
  const failedText = failed === undefined ? '' : failed.verdict === 'not-ready' ? ` Lượt đánh giá sẵn sàng gần nhất báo chưa sẵn sàng${failed.count !== undefined ? ` ${failed.count}` : ''}: sửa theo phần người đánh giá nêu rồi giao đánh giá lại.` : ` Lượt duyệt gần nhất báo chưa đạt${failed.count !== undefined ? ` ${failed.count}` : ''}: sửa theo phần lỗi người duyệt nêu rồi giao duyệt lại.`
  // Bước còn thiếu là bước kiểm (vòng 2 M5): file sửa sau lần kiểm đạt gần nhất, tối đa ba tên.
  const passSeq = Math.max(-1, ...log.commands.filter(c => c.check !== null && c.ok && c.chained !== true).map(c => c.seq), ...stepRunsFor(ctx, brief.goalId).runs.filter(run => run.passed).map(run => run.seq))
  const afterCheck: string[] = []
  if (missing === 'check' && passSeq >= 0) for (const w of log.writes) if (w.seq > passSeq && w.definite === true && w.hard === true) for (const path of w.paths ?? []) if (!afterCheck.some(p => keyOf(p) === keyOf(path))) afterCheck.push(path)
  const checkFiles = afterCheck.length > 0 ? ` File sửa sau lần kiểm đạt gần nhất: ${printNames(afterCheck)}.` : ''
  // Lần chạy gần nhất của lệnh kiểm sau thay đổi cuối đi qua ống (sau phiên thật D4, mục 2b): nêu đúng nguyên nhân và cách chạy lại.
  const pipe = L.pipeNotes.goalId === brief.goalId ? L.pipeNotes.last : null
  // Câu về ống lệnh chỉ khi lần chạy gần nhất của lệnh đó là lần qua ống (vòng 2 F3): chính lệnh đó chạy lại sau đó thì bỏ câu.
  const rerun = pipe !== null && stepRunsFor(ctx, brief.goalId).runs.some(run => run.seq >= pipe.seq && run.keys.includes(runKey(pipe.command)))
  const piped = missing === 'check' && pipe !== null && pipe.seq > lastHard && !rerun ? ` Lần chạy \`${clipText(pipe.command, 40)}\` đi qua ống nên mã thoát bị che, không tính; chạy lại không kèm ống, hoặc thêm set -o pipefail.` : ''
  return `${reason}${unread}${failedText}${unclear}${files}${checkFiles}${piped}`.slice(0, CLOSING_CHARS)
}

/**
 * Lượt duyệt hết hiệu lực theo dấu file (0.9.0, C2 đo dấu file): với mỗi kết luận được tính có dấu lúc hoàn tất, chụp lại dấu các file đó;
 * khác thì lượt đó hết hiệu lực. fs không đo được thì không đổi gì.
 */
async function stalePrints($: EngineInterface, goalId: number, verdicts: readonly VerdictRun[]): Promise<{ agents: Set<string>; files: string[] }> {
  const state = normalizeReviewPrints(await read($, printState))
  const agents = new Set<string>()
  const files: string[] = []
  if (state.goalId !== goalId) return { agents, files }
  for (const v of verdicts) {
    const done = state.done[v.agentId]
    if (!v.isClean || !v.isReview || state.stale.includes(v.agentId)) continue
    // Dấu lúc hoàn tất đã bị đẩy khỏi trần lượt: không xét lại được thì coi là hết hiệu lực.
    if (done === undefined) {
      agents.add(v.agentId)
      continue
    }
    const root = (await $.session.root().catch(() => null)) ?? null
    const fs = { stat: (path: string) => $.fs.stat(path), read: (path: string) => $.fs.read(path) as Promise<string> }
    // Lượt theo sổ (fs không đo được lúc sinh và lúc hoàn tất): lúc cổng xét mà fs đo được thì là đo lúc được lúc không, hết hiệu lực
    // (vòng sửa cuối 18/11, A1).
    if (done === null) {
      const core = S.normalizeCore(await read($, coreState))
      const targets = printTargets(S.changedOf(core).paths, core.brief).files
      const probe = targets.length === 0 ? {} : await takePrints(fs, targets, root).catch(() => null)
      if (isMeasured(probe)) agents.add(v.agentId)
      continue
    }
    if (Object.keys(done).length === 0) continue
    const now = await takePrints(fs, Object.keys(done), root, done).catch(() => null)
    // Đã có dấu mà lúc cổng xét không đo được: chưa xác nhận, không tính (A1).
    if (now === null) {
      agents.add(v.agentId)
      continue
    }
    const changed = changedPrints(done, now)
    if (changed.length === 0) continue
    agents.add(v.agentId)
    for (const path of changed) if (!files.includes(path)) files.push(path)
  }
  return { agents, files }
}

/** Đích đọc được của một lần ghi (0.9.0 C5): đường dẫn của tool sửa file, hay đích của tác động ghi mức definite của Bash. */
/** Trạng thái các bước đóng (0.9.0 C3), dùng chung cho pane (Core.team) và cổng đóng mục tiêu. */
function teamSteps(core: Core, brief: Brief, log: EvidenceLog, verdicts: readonly ClosingVerdict[], runs: Ctx['local']['stepRuns']) {
  // Lệnh đỏ từ nền của mục tiêu (vòng 3 N5): lần chạy lỗi của chúng không làm bước Kiểm chưa đạt.
  const base = core.retry.goalId === brief.goalId ? core.retry.items.filter(isBaseline) : []
  const { checked, checkFailed } = closingCheckState(core.plan, log, runs.goalId === brief.goalId ? runs : { runs: [], checkSeq: new Map() }, base)
  // Bước Kiểm chỉ khi đã có thay đổi không nhẹ cần kiểm (vòng 2 U5); đoạn dặn bước đóng vẫn tính theo hasKnownCheck như trước.
  return closingSteps({ hasCheck: log.hard > 0 && hasKnownCheck(core.plan, S.changedOf(core).paths, log), isHard: brief.depth === 'hard', checked, checkFailed, lastHard: log.lastHard, lastChange: log.lastChange, verdicts })
}

/**
 * Bước kiểm của cổng đóng và của pane (0.9.0 vòng 2 F1, L1). Đạt khi sau thay đổi không nhẹ cuối có một lần lệnh kiểm mod nhận ra chạy đạt,
 * hoặc một lần chạy khớp lệnh ở check của một bước đủ điều kiện bằng chứng của B10 (stepEvidence), và không có lỗi theo hai luật sau.
 * Lệnh ở check của bước (L1): mỗi lệnh khác nhau lấy lần chạy gần nhất của chính nó sau thay đổi đó; một lệnh có lần gần nhất lỗi thì
 * chưa đạt, dù lệnh của bước khác chạy đạt sau đó. Lệnh kiểm mod nhận ra: lỗi khi lần chạy gần nhất của loại này lỗi và đến sau mọi lần
 * chạy của lệnh ở check. Lần chạy lỗi của lệnh đỏ từ nền (`baseline`, vòng 3 N5) bị bỏ qua ở cả hai luật; nó vẫn không là lần đạt.
 */
export function closingCheckState(plan: readonly PlanStep[], log: EvidenceLog, steps: { runs: readonly StepRun[]; checkSeq: ReadonlyMap<number, number> }, baseline: readonly { sig: string; command: string }[] = []): { checked: boolean; checkFailed: boolean } {
  const lastHard = log.lastHard
  const baseSigs = new Set(baseline.map(item => item.sig))
  const baseKeys = new Set(baseline.map(item => runKey(item.command)))
  const sigOf = (c: EvidenceEntry) => checkSignature({ check: c.check ?? 'test', command: checkCommand(c) })
  const keys = [...new Set(plan.flatMap(step => { const check = stepCheckOf(step.check); return check !== null ? [runKey(check.command)] : [] }))]
  // Dòng lệnh chứa lần chạy ở `seq` không có lệnh ở check của một bước (khác lệnh đỏ từ nền): lệnh đó không là lệnh kiểm mod nhận ra nên không
  // có kết quả riêng trong sổ, lỗi của dòng lệnh có thể là của nó, nên lần chạy không được bỏ qua (kiểm độc lập vòng 3 lỗi 1, lần hai). Lần chạy
  // kiểm mod nhận ra trong cùng dòng lệnh mang kết quả riêng nên không cản. Ống, cd, echo hay hai lệnh đỏ từ nền chạy chung thì vẫn bỏ qua.
  // Không có lần chạy Bash ghi lại (công cụ kiểm MCP) thì coi như chạy riêng.
  const isAlone = (seq: number) => {
    const run = steps.runs.find(r => r.seq >= seq)
    if (run === undefined) return true
    const whole = run.keys[0] ?? ''
    return !keys.some(key => !baseKeys.has(key) && whole.includes(key))
  }
  const isBaseFail = (c: EvidenceEntry) => !c.ok && baseSigs.has(sigOf(c)) && isAlone(c.seq)
  const known = log.commands.some(c => c.check !== null && c.ok && c.chained !== true && c.seq > lastHard && coversScope(c, log))
  const byStep = plan.some(step => stepEvidence(step, steps.runs, lastHard, steps.checkSeq.get(step.id) ?? -1) !== null)
  const lastKnown = [...log.commands].reverse().find(c => c.check !== null && c.chained !== true && c.seq > lastHard && !isBaseFail(c))
  const after = [...steps.runs].reverse().filter(run => run.seq > lastHard)
  // Lần chạy lỗi chỉ bị bỏ qua cho chính key của lệnh đỏ từ nền; lệnh khác chạy chung một dòng lệnh vẫn lấy lần chạy đó (kiểm độc lập vòng 3 lỗi 1).
  const latestOf = keys.flatMap(key => { const run = after.find(r => r.keys.includes(key) && !(baseKeys.has(key) && !r.passed)); return run !== undefined ? [run] : [] })
  const lastRun = after.find(run => latestOf.includes(run))
  const stepFailed = latestOf.some(run => !run.passed)
  const knownFailed = lastKnown !== undefined && !lastKnown.ok && (lastRun === undefined || lastKnown.seq > lastRun.seq)
  const latestFailed = stepFailed || knownFailed
  return { checked: log.hard === 0 || ((known || byStep) && !latestFailed), checkFailed: latestFailed }
}

/**
 * Đội hình do mod áp (0.9.0 C): tính lại lý do bật và trạng thái các bước đóng của mục tiêu, ghi Core.team khi đổi. Vừa bật lần đầu cho
 * mục tiêu thì ghi nhật ký 'team' và xếp đoạn dặn bước đóng vào kết quả tool kế tiếp của luồng chính. Chưa bật thì bỏ Core.team, không chèn gì.
 */
async function refreshTeam($: EngineInterface, ctx: Ctx): Promise<void> {
  const L = ctx.local
  await hydrateClosing($, ctx)
  const core = S.normalizeCore(await read($, coreState))
  const brief = core.brief
  const changed = S.changedOf(core).paths
  const cause = teamCause(ctx.options['closingReview'], brief, changed)
  if (brief === null || cause === null) {
    if (core.team !== undefined) {
      await update($, coreState, S.withTeam(null))
      await refreshStatus($, ctx)
    }
    return
  }
  const log = ctx.evidenceFor(brief.goalId)
  const hasCheck = hasKnownCheck(core.plan, changed, log)
  const prints = normalizeReviewPrints(await read($, printState))
  const staleIds = new Set(prints.goalId === brief.goalId ? prints.stale : [])
  const steps = teamSteps(core, brief, log, (L.verdicts.goalId === brief.goalId ? L.verdicts.items : []).map(v => (staleIds.has(v.agentId) ? { ...v, isClean: false } : v)), ctx.local.stepRuns)
  const isNew = core.team === undefined || core.team.goalId !== brief.goalId
  const team = { goalId: brief.goalId, cause: isNew || core.team === undefined ? cause : core.team.cause, steps }
  // Bước đóng đổi thì đặt lại status line (vòng 2 U2), để đoạn hướng khớp mục cần chú ý.
  if (JSON.stringify(team) !== JSON.stringify(core.team)) {
    await update($, coreState, S.withTeam(team))
    await refreshStatus($, ctx)
  }
  if (!isNew) return
  ctx.record(await $.clock.now(), 'team', { goalId: brief.goalId, cause, files: hardFileCount(changed) })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
  L.agentRetryNotes.push(closingNote({ hasCheck, isHard: brief.depth === 'hard', isDocs: isDocsOnly(brief, changed) }))
}


function writtenPaths(observation: ToolObservation): string[] {
  const path = filePathOf(observation)
  if (path !== '') return [normalizePath(path)]
  if (observation.tool !== 'Bash') return []
  return classifyBash(String(observation.input['command'] ?? ''), observation.cwd).effects.flatMap(effect => (effect.kind === 'write' && effect.level === 'definite' ? effect.paths.map(normalizePath) : []))
}

/** Câu nhắc khi nhiều subagent chung thư mục cùng sửa một tệp (0.9.0 C5), không quá 200 ký tự. */
function fileClashNote(path: string, count: number): string {
  return `[focus-conductor] ${count} subagent chạy chung thư mục cùng sửa ${clipText(path).slice(0, 80)}: gom về một agent hay giao isolation riêng, kẻo ghi đè nhau.`.slice(0, 200)
}

/** Lần chạy Bash và mốc check của mục tiêu (0.9.0 B10): đổi mục tiêu thì bắt đầu mới. */
function stepRunsFor(ctx: Ctx, goalId: number): Ctx['local']['stepRuns'] {
  if (ctx.local.stepRuns.goalId !== goalId) ctx.local.stepRuns = { goalId, runs: [], checkSeq: new Map() }
  return ctx.local.stepRuns
}

/** Ghi một lần chạy Bash của mục tiêu (0.9.0 B10) với mốc seq hiện tại của dấu vết. */
function noteStepRun(ctx: Ctx, goalId: number, observation: ToolObservation): void {
  if (observation.tool !== 'Bash') return
  const command = String(observation.input['command'] ?? '').trim()
  if (command === '') return
  const state = stepRunsFor(ctx, goalId)
  state.runs.push(stepRunOf(command, observation.isError, observation.output, ctx.evidenceFor(goalId).seq))
  if (state.runs.length > STEP_RUNS) state.runs.shift()
}

/**
 * Nâng các bước done có bằng chứng theo trường check của chính bước (0.9.0 B10): chỉ đúng các bước đó, nhãn "tự động: <lệnh> chạy đạt sau
 * thay đổi cuối", một dòng verify-step trong nhật ký. Trả true khi đã nâng.
 */
async function liftStepChecks($: EngineInterface, ctx: Ctx, goalId: number): Promise<boolean> {
  await hydrateClosing($, ctx)
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || core.brief.goalId !== goalId) return false
  const state = stepRunsFor(ctx, goalId)
  const lastHard = ctx.evidenceFor(goalId).lastHard
  const lifts = core.plan.flatMap(step => {
    if (step.status !== 'done') return []
    const run = stepEvidence(step, state.runs, lastHard, state.checkSeq.get(step.id) ?? -1)
    const check = stepCheckOf(step.check)
    return run !== null && check !== null ? [{ id: step.id, command: check.command }] : []
  })
  if (lifts.length === 0) return false
  await update($, coreState, S.withStepVerified(lifts))
  ctx.record(await $.clock.now(), 'verify-step', { steps: lifts.map(l => l.id), command: clipText(lifts[0]?.command ?? '') })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
  return true
}

async function conductRole($: EngineInterface, ctx: Ctx, current: Mode, e: { tool: string } & Record<string, unknown>): Promise<{ goalId: number; isExempt: boolean } | null> {
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || !ctx.isConducting(core, current)) return null
  if (isPlanFile(filePathOf({ tool: e.tool, input: e, isError: false, isReadOnly: false }))) return null
  // Tệp trạng thái của lượt (0.9.0 B4): ghi vào đó không phải sửa file của việc; lệnh kiểm vẫn theo vai.
  if (await writesOnlyStateFiles($, core.brief, e)) return null
  const state = S.conductOf(core)
  return { goalId: core.brief.goalId, isExempt: state.solo || state.agentDenied }
}

/**
 * Lần test mang cờ dùng chung thư mục của subagent vừa đạt (0.8.6 R2): như lần test đạt của luồng chính (0.7.0), lần đó là lần chạy cuối
 * của dấu vết, chạy sau thay đổi cuối và phủ mọi thay đổi thì các bước done thành verified. Trả true khi đã nâng.
 */
/**
 * Bước được mod tự nâng theo lần kiểm đạt (vòng 2 M11): bước có check dạng `lệnh` => kết quả chỉ được nâng khi lần chạy của lệnh đó có kết
 * quả mong đợi theo luật so của B10 (stepEvidence), kể cả khi lệnh là lệnh kiểm mod nhận ra. Không bước nào bị giữ thì trả `only` như cũ.
 */
function autoLiftIds(ctx: Ctx, core: Core, goalId: number, only?: readonly number[]): readonly number[] | undefined {
  const state = stepRunsFor(ctx, goalId)
  const lastHard = ctx.evidenceFor(goalId).lastHard
  const held = core.plan.filter(step => stepCheckOf(step.check)?.expected !== undefined && stepEvidence(step, state.runs, lastHard, state.checkSeq.get(step.id) ?? -1) === null).map(step => step.id)
  if (held.length === 0) return only
  return core.plan.map(step => step.id).filter(id => !held.includes(id) && (only === undefined || only.includes(id)))
}

async function autoVerify($: EngineInterface, ctx: Ctx, goalId: number): Promise<boolean> {
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || core.brief.goalId !== goalId) return false
  const log = ctx.evidenceFor(goalId)
  const fresh = freshTestRun(log)
  if (fresh === undefined || fresh !== log.commands.at(-1) || !(core.plan.some(s => s.status === 'done') || S.liveMirror(core).some(s => s.status === 'done'))) return false
  await update($, coreState, S.withAutoVerified(fresh.command, autoLiftIds(ctx, core, goalId), true))
  ctx.record(await $.clock.now(), 'verify-auto', { command: clipText(fresh.command), at: core.plan.length === 0 ? 'mirror' : 'test' })
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
  return true
}

/** Đích của lời gọi đọc không tính vào số lần đọc của vai điều phối (0.8.6 R3): file kế hoạch và thư mục .focus-conductor/. */
function isConductQuietRead(input: Record<string, unknown>): boolean {
  return ['file_path', 'path'].some(key => {
    const path = typeof input[key] === 'string' ? (input[key] as string) : ''
    return path !== '' && (isPlanFile(path) || /(?:^|\/)\.focus-conductor(?:\/|$)/.test(path))
  })
}

/**
 * Cộng một lần đọc của vai điều phối (0.8.6 R3) khi luồng chính đang điều phối. Số đếm chạm bội số của `every` thì ghi mốc đã nhắc và trả
 * dòng nhắc; không thì null.
 */
async function noteConductRead($: EngineInterface, ctx: Ctx, current: Mode, input: Record<string, unknown>, every: number): Promise<string | null> {
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || !ctx.isConducting(core, current) || isConductQuietRead(input)) return null
  const reads = S.conductOf(core).reads + 1
  const isDue = reads % every === 0
  await update($, coreState, S.withConduct(core.brief.goalId, () => (isDue ? { reads, readNoted: reads } : { reads })))
  return isDue ? conductReadText(reads) : null
}

async function noteFableRouter($: EngineInterface, ctx: Ctx, isOk: boolean, family?: ModelFamily): Promise<void> {
  const at = await $.clock.now()
  const core = S.normalizeCore(await read($, coreState))
  // Họ dự phòng (0.8.7 F1): lỗi của nó đếm riêng; router Fable vừa tạm ngừng thì câu báo nêu họ dự phòng nhận vai nếu dùng được.
  const primary = ctx.conductorFamily
  const step = fableStep(core, isOk, ctx.routerModel, at, family, (family ?? primary) === primary ? ctx.fallbackUsable(core) : null, primary)
  if (step === null) return
  await update($, coreState, step.change)
  if (step.text !== null) $.ui.toast(step.text)
  if (step.log !== null) {
    ctx.record(at, 'conductor', step.log)
    await ctx.flushDecisions((path, body) => $.fs.write(path, body), path => $.fs.read(path))
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

/**
 * Lần ghi của chính một lần chạy kiểm (vòng 3 B1): lần ghi không definite, không có đích, trong một lần chạy Bash mà mod ghi là lần chạy kiểm
 * (có lần chạy kiểm mod nhận ra, hay cả dòng lệnh là lệnh ở check của một bước). Lần ghi nối với lần chạy Bash qua danh sách lần chạy của bước
 * (mốc seq lúc xong mỗi lần chạy); lần ghi không nằm trong lần chạy nào còn giữ thì không miễn.
 */
function checkWriteOf(log: EvidenceLog, runs: readonly StepRun[], plan: readonly PlanStep[]): (write: Write) => boolean {
  const stepKeys = new Set(plan.flatMap(step => { const check = stepCheckOf(step.check); return check !== null ? [runKey(check.command)] : [] }))
  return write => {
    if (write.definite === true || (write.paths?.length ?? 0) > 0) return false
    const at = runs.findIndex(run => run.seq >= write.seq)
    const run = runs[at]
    if (run === undefined) return false
    const from = runs[at - 1]?.seq ?? -1
    return stepKeys.has(run.keys[0] ?? '') || log.commands.some(c => c.check !== null && c.seq > from && c.seq <= run.seq)
  }
}

/** Mục chưa hết lượt của mục tiêu hiện tại, trừ mục chủ mod đã miễn (0.7.9 Y5) và mục đỏ từ nền (vòng 3 N3). */
function liveRetry(core: Core): RetryItem[] {
  return core.brief !== null && core.retry.goalId === core.brief.goalId ? core.retry.items.filter(item => !item.exhausted && !S.isWaived(core, item.sig) && !isBaseline(item)) : []
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
  /** Sổ thay đổi của mục tiêu (vòng 3): biết lần chạy lỗi có đứng trước mọi thay đổi không. */
  evidenceFor: (goalId: number) => EvidenceLog
  /** Option baselineChecks (vòng 3 N6): off thì không có lệnh đỏ từ nền. */
  baselineOn: () => boolean
  /** Lần ghi của chính một lần chạy kiểm (vòng 3 B1), theo mục tiêu và checklist. */
  checkWrite: (goalId: number, plan: readonly PlanStep[]) => (write: Write) => boolean
}

/**
 * Ghi các lần chạy kiểm mới vào trạng thái lượt của mục tiêu (0.7.8 vòng sửa 3, W4): lần lỗi chưa có mục thì thêm mục lượt 1 ở mức
 * `start`; lần lỗi của lệnh đã có mục thì ghi lỗi cuối và báo kẹt (G6); lần đạt xóa mọi mục nó phủ. Lượt và mức sàn chỉ tăng ở cổng
 * Stop. Trả dòng báo cho luồng chính, một lần mỗi lệnh mỗi lượt.
 */
async function noteChecks($: EngineInterface, deps: RetryDeps, core: Core, goalId: number, entries: readonly EvidenceEntry[], observation: { output?: string; isError: boolean }, start: Choice, isMain: boolean, agent?: string): Promise<string[]> {
  if (entries.length === 0) return []
  const retry = core.retry.goalId === goalId ? core.retry : { goalId, items: [] }
  const isOn = deps.baselineOn()
  // baselineChecks off (vòng 3 N6): mọi mục mất cờ đỏ từ nền.
  let items: RetryItem[] = retry.items.map(item => (isOn ? item : stripBase(item))).map(item => ({ ...item, levels: [...item.levels], closedSteps: [...item.closedSteps], more: [...item.more] }))
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
  // Chữ ký đã có lần chạy lỗi trong mục tiêu (vòng 3): lần lỗi sau của chúng không còn là lần lỗi đầu tiên.
  const seen = new Set(seenOf(retry))
  const grew: Array<{ item: RetryItem; base: number; now: number }> = []
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
    // Lần lỗi đầu tiên của lệnh trong mục tiêu, trước mọi thay đổi: đỏ từ nền (vòng 3 N1).
    const isBase = isOn && !seen.has(sig) && isBaselineRun(deps.evidenceFor(goalId), entry.seq, deps.checkWrite(goalId, core.plan))
    seen.add(sig)
    const known = items.find(item => item.sig === sig) ?? items.find(item => item.more.includes(sig))
    if (known !== undefined) {
      const lastBefore = known.lastError
      if (error !== '') known.lastError = error
      known.runner = runner
      known.ranAt = ranAt
      // Số đếm lỗi tăng so với lần nền (vòng 3 N6): mất cờ, thành mục thường lượt 1 kèm câu báo nêu hai số đếm.
      const count = errorCountOf(observation.output)
      if (isBaseline(known) && hasGrown(known, count)) {
        grew.push({ item: known, base: baseOf(known).baseCount as number, now: count as number })
        continue
      }
      // Lệnh đỏ từ nền chạy lại vẫn lỗi (vòng 3 N2): không tính lượt, không báo kẹt; giữ lỗi của lần nền, vì output có thể là của lệnh khác
      // chạy chung một dòng lệnh (kiểm độc lập vòng 3 lỗi 1).
      if (isBaseline(known)) {
        known.lastError = lastBefore
        continue
      }
      // Chạy lại vẫn lỗi (0.8.0 A2): Stop kế tiếp được tăng lượt.
      known.retried = true
      known.idle = 0
      touched.add(known)
      stuck = sig
      continue
    }
    const fresh: BaseItem = {
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
      ...(isBase ? { baseline: true as const, baseCount: errorCountOf(observation.output) } : {}),
    }
    // Mục tạo từ lần chạy của subagent (0.8.0 A12): luồng chính được báo một lần, ở kết quả tool kế tiếp.
    if (!isMain && agent !== undefined) agentNotes.push(isBase ? retryBaselineNotice(fresh) : retryAgentNotice(run.command, agent))
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
  const grown: string[] = []
  for (const { item, base, now } of grew) {
    const plain = { ...stripBase(item), round: 1, noticed: 1, retried: false, idle: 0 }
    items = items.map(x => (x === item ? plain : x))
    if (isMain) grown.push(retryGrewNotice(plain, base, now))
  }
  if (stuck !== null) deps.noteStuck(core, stuck)
  if (cleared.length > 0) {
    const at = await $.clock.now()
    for (const { item, step } of cleared) {
      deps.record(at, 'retry-cleared', { signature: item.sig, step })
      $.ui.toast(labels(deps.lang).retryCleared(item.command, step))
    }
  }
  const notes: string[] = [...agentNotes, ...grown]
  if (isMain) {
    for (const item of touched) {
      if (item.exhausted || item.noticed >= item.round || waived.some(w => w.sig === item.sig)) continue
      item.noticed = item.round
      notes.push(isBaseline(item) ? retryBaselineNotice(item) : retryFailNotice(item))
    }
  }
  await update($, coreState, c => {
    const next = S.withRetry({ goalId, items, seen: [...seen].slice(-BASE_SEEN) } as BaseState)(plan !== core.plan ? S.withPlan(plan)(c) : c)
    return waived.length !== waivers.length ? S.withWaivers({ goalId, items: waived })(next) : next
  })
  if (cleared.length > 0) await deps.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
  // baselineChecks off (vòng 3 N6): mọi mục mất cờ đỏ từ nền trước khi cổng xét.
  if (!deps.baselineOn() && core.retry.items.some(isBaseline)) await update($, coreState, c => S.withRetry({ ...c.retry, items: c.retry.items.map(stripBase) } as BaseState)(c))
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
    // Lệnh đỏ từ nền (vòng 3 N2): không tăng lượt, không hết lượt, không ghi bước blocked.
    if (item.exhausted || S.isWaived(core, item.sig) || isBaseline(item)) return item
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
  await deps.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
 * Lần chặn đòi mục "Lệnh kiểm đỏ từ nền" (vòng 3 N4): mục tiêu đã có thay đổi và còn mục đỏ từ nền chưa đòi thì trả lý do và đánh dấu đã
 * đòi, nên chỉ chặn một lần cho mỗi lệnh. Mục tiêu chưa có thay đổi thì không đòi.
 */
async function askBaseline($: EngineInterface, deps: RetryDeps): Promise<string | null> {
  const core = S.normalizeCore(await read($, coreState))
  if (core.brief === null || core.retry.goalId !== core.brief.goalId || !hasChanges(deps.evidenceFor(core.brief.goalId), deps.checkWrite(core.brief.goalId, core.plan))) return null
  const due = core.retry.items.filter(item => isBaseline(item) && baseOf(item).baseAsked !== true)
  if (due.length === 0) return null
  await update($, coreState, c => S.withRetry({ ...c.retry, items: c.retry.items.map(item => (isBaseline(item) ? { ...item, baseAsked: true as const } : item)) } as BaseState)(c))
  return baselineAskText(due)
}

/**
 * Rà kế hoạch trước khi trình duyệt (0.8.2 N2), xét đầu tiên ở Stop. `allow`: cho kết thúc ngay, bỏ qua mọi cổng sau (turn hỏi làm rõ,
 * kế hoạch đã trình, lượt rà đạt hay đã hết lượt, router lỗi). `block`: chặn với lý do của lượt rà. `none`: không liên quan (mục tiêu không
 * thuộc diện duyệt, đã duyệt, hay checklist trống thì G1 xử lý như cũ).
 */
/** Trạng thái duyệt bỏ cờ đã duyệt trước (0.9.0 B12). */
function withoutEarly(approval: ApprovalState): ApprovalState {
  const { early: _early, ...rest } = approval
  return rest
}

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
    await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
    ...(brief.constraintsBase !== undefined ? { constraintsBase: brief.constraintsBase } : {}),
    quality: brief.quality,
    steps: core.plan.map(step => ({ title: step.title, ...(step.check !== undefined ? { check: step.check } : {}) })),
    model: target.model,
    ...(target.isFable ? { isFable: true } : {}),
  })
  const startedAt = await $.clock.now()
  const outcome = await askRouter(r => $.model.complete(r), request, parsePlanReview)
  ctx.noteRouterFailure('review', outcome.failure)
  if (target.isFable) await noteFableRouter($, ctx, outcome.result !== null, target.family)
  ctx.noteRouterTime((await $.clock.now()) - startedAt)
  const rounds = approval.rounds + 1
  // Chi phí mỗi lượt rà cộng vào sổ nhóm router; lượt rà tăng sau mỗi lần gọi.
  await update($, coreState, c => S.withApproval({ ...S.approvalOf(c), rounds })(S.withAnalyzerUsage(outcome.usages, target.family)(c)))
  const review = outcome.result
  ctx.record(at, 'plan-review', { goalId: brief.goalId, round: rounds, missing: review?.missing ?? null, extra: review?.extra ?? null, issues: review?.issues.length ?? null, ...(review === null ? { reason: outcome.reason } : {}) })
  // Router lỗi: không đoán, trình kế hoạch như hiện có kèm cảnh báo.
  if (review === null) return present('router-fail', `Router không rà được kế hoạch (${outcome.reason}); kế hoạch được trình như hiện có`)
  // Người dùng đã duyệt trước lượt rà (0.9.0 B12): lượt rà sạch thì chuyển approved; còn chỗ sửa thì bỏ cờ, trình lại sau khi sửa.
  if (!hasFixes(review) && approval.early === true) {
    await update($, coreState, c => S.withApproval({ ...withoutEarly(S.approvalOf(c)), status: 'approved' })(c))
    ctx.record(at, 'approval', { goalId: brief.goalId, status: 'approved', cause: 'early' })
    await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    return { kind: 'allow' }
  }
  if (!hasFixes(review)) return present('review')
  if (approval.early === true) await update($, coreState, c => S.withApproval(withoutEarly(S.approvalOf(c)))(c))
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
  // Lệnh khai có phạm vi (0.9.0 B11): chỉ gợi ý lệnh không có phạm vi, hay có phạm vi phủ ít nhất một file đã sửa không nhẹ; nêu phần lệnh.
  const changed = log.writes.filter(w => w.hard === true).flatMap(w => w.paths ?? [])
  const declared = String(options['checkCommands'] ?? '')
    .split(',')
    .map(item => splitCheckScope(item.trim().split(/\s+/).filter(Boolean)))
    .find(entry => entry.command.length > 0 && (entry.scope === null || changed.some(path => inCheckScope(path, entry.scope?.map(globToRegExp) ?? []))))
  if (declared !== undefined) return declared.command.join(' ')
  const tool = String(options['checkTools'] ?? '').split(',').map(item => item.trim()).find(name => name.startsWith('mcp__'))
  if (tool !== undefined) return tool
  const passed = [...log.commands].reverse().find(entry => entry.check !== null && entry.ok && checkScopeOf(entry.raw ?? entry.command) === null)
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
  // Lần kiểm có phạm vi không phủ các thay đổi (0.9.0 B11) không tính là đã kiểm.
  if (log.hard === 0 || log.commands.some(entry => entry.check !== null && entry.chained !== true && entry.seq > log.lastHard && coversScope(entry, log))) return null
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
  await deps.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
function changedTargets(observation: ToolObservation, root: string | null, lists: SideLists | null = null): { paths: string[]; isUnknown: boolean } | null {
  if (observation.isError || !isMutation(observation)) return null
  const path = filePathOf(observation)
  const command = observation.tool === 'Bash' ? String(observation.input['command'] ?? '') : ''
  // Lệnh dùng thư mục mktemp, pushd, popd được viết lại trước khi đọc đích (vòng sửa cuối 18/11, A5), như sổ bằng chứng.
  const raw = path ? [path] : command ? classifyBash(tempRewrite(command, observation.cwd ?? root ?? null)).paths : []
  if (raw.length === 0) return { paths: [], isUnknown: observation.tool === 'Bash' }
  const base = observation.cwd ?? root ?? ''
  // Tệp trạng thái và nơi ghi phụ (0.9.0 B2) không là file đã đổi của mục tiêu.
  const kept = raw.filter(item => !isSidePath(item, lists, root, observation.cwd ?? null))
  if (kept.length === 0) return null
  const relative = kept.map(item => {
    const full = normalizePath(item.startsWith('/') || base === '' ? item : `${base}/${item}`)
    const top = root ? normalizePath(root) : ''
    return top !== '' && top !== '/' && full.startsWith(`${top}/`) ? full.slice(top.length + 1) : full
  })
  return { paths: relative.filter(item => item !== '' && !CHANGED_SKIP.test(item)), isUnknown: false }
}

/** Đặt lại status line từ trạng thái đang lưu (vòng 2 U2), cho hàm ở ngoài phần đăng ký hook (không có atom view). */
async function refreshStatus($: EngineInterface, ctx: Ctx): Promise<void> {
  await showStatus($, await read($, derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))), ctx.options)
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(statusTextOf(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
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
  await ctx.flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
  const { agentFailures, agentTrackers, agents, blockLimit, flushDecisions, delegationItems, evidenceFor, failedFor, isRouterPaused, moveDelegation, noteRouterTime, pendingFor, record, remindSubagents, semanticDrift, driftEveryMs, steppedEarly, strictDelegation } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))
  /** Luồng chính đang giữ vai điều phối cho mục tiêu hiện tại (0.8.5 D1): mức strictDelegation hiệu dụng là block. */
  const isConductingNow = (core: Core, current: Mode): boolean => ctx.isConducting(core, current)

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
      // Phần dùng chung với tin bảo chạy tiếp (0.8.4 A2): ctx.restoreGoal.
      const outcome = ctx.restoreGoal(await read($, coreState), index)
      if ('error' in outcome) return { deny: outcome.error }
      await update($, coreState, () => outcome.core)
      const restored = outcome.brief
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
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    }
    // Trường check của bước (0.9.0 B10): mốc check mới cho bước có check vừa lưu hay vừa đổi, để lần chạy trước đó không còn là bằng chứng.
    // Đổi check của một bước đã có sau khi kế hoạch được duyệt: một dòng check-changed và một cảnh báo ở mục cần chú ý.
    if (before.brief !== null && (input.action === 'set' || input.action === 'add')) {
      const goalId = before.brief.goalId
      await hydrateClosing($, ctx)
      const state = stepRunsFor(ctx, goalId)
      const seq = evidenceFor(goalId).seq
      const isApproved = S.approvalOf(before).status === 'approved'
      const changed: number[] = []
      for (const step of core.plan) {
        const old = before.plan.find(p => p.title === step.title)
        if ((step.check ?? '') === (old?.check ?? '') && old !== undefined) continue
        if (step.check !== undefined) state.checkSeq.set(step.id, seq)
        if (old !== undefined && isApproved) changed.push(step.id)
      }
      await persistClosing($, ctx)
      if (changed.length > 0) {
        const at = await $.clock.now()
        record(at, 'check-changed', { goalId, steps: changed })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        core = await update($, coreState, S.withWarnings({ at, kind: 'drift', text: `Bước ${changed.join(', ')} đổi check sau khi kế hoạch đã duyệt; bằng chứng cũ của bước không còn tính` }))
      }
    }
    // Bước vừa đóng có bằng chứng theo trường check của chính bước (0.9.0 B10): nâng ngay.
    if (before.brief !== null && input.action === 'update' && (await liftStepChecks($, ctx, before.brief.goalId))) core = S.normalizeCore(await read($, coreState))
    // Bước vừa đóng bằng done khi đã có test đạt sau thay đổi cuối: nâng ngay thành verified (0.7.0).
    if (fresh !== undefined && input.action === 'update') {
      const closed = (outcome.changed ?? []).filter(id => outcome.plan.some(s => s.id === id && s.status === 'done'))
      if (closed.length > 0) {
        core = await update($, coreState, S.withAutoVerified(fresh.command, autoLiftIds(ctx, core, before.brief?.goalId ?? -1, closed)))
        record(await $.clock.now(), 'verify-auto', { steps: closed, command: clipText(fresh.command), at: 'close' })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
      }
    }
    L.tracker.planUpdates += 1
    if (isAccepted && (strength?.level === 'strong' || fresh !== undefined)) markVerified(L.tracker)
    const notes: string[] = []
    // Dạng check của bước (0.9.0 B10): một lần mỗi mục tiêu, ở lần plan set có bước; đi kèm kết quả dưới dạng context, dòng kết quả giữ nguyên.
    const checkHint: string[] = []
    if (input.action === 'set' && core.plan.length > 0 && before.brief !== null && L.checkHinted !== before.brief.goalId) {
      L.checkHinted = before.brief.goalId
      checkHint.push(PLAN_SET_CHECK_LINE)
    }
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
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
      notes.push(requirementsNotice(asked, core.brief.retired ?? []))
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
    // Bảng báo cáo từ sổ kết luận của mục tiêu (0.9.0 C8): khi đóng bước cuối; sổ rỗng thì không chèn gì.
    if (isClosing && core.brief !== null && L.verdicts.goalId === core.brief.goalId) {
      const table = reportTable(L.verdicts.items)
      if (table !== '') notes.push(table)
    }
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
    // Đội hình do mod áp (0.9.0 C): check của bước có thể vừa biết lệnh kiểm.
    await refreshTeam($, ctx)
    await showStatus($, await read($, view), ctx.options)
    const shown =
      outcome.bulk !== undefined
        ? renderBulk(core.plan, outcome.changed ?? [], outcome.bulk.status, outcome.bulk.note)
        : outcome.set !== undefined
          ? setResultText(core.brief, core.plan, outcome.set, outcome.goal, before.brief?.goal ?? null)
          : renderPlan(core.brief, core.plan, input.action === 'update' || input.action === 'add' ? outcome.changed : undefined)
    return { result: [shown, ...notes].join('\n'), ...(checkHint.length > 0 ? { context: checkHint } : {}) }
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
    evidenceFor,
    baselineOn: () => ctx.options['baselineChecks'] !== 'off',
    checkWrite: (goalId, plan) => checkWriteOf(ctx.evidenceFor(goalId), stepRunsFor(ctx, goalId).runs, plan),
  }


  // Đọc ở vai điều phối (0.8.6 R3): Read, Grep, Glob của luồng chính đang điều phối cộng số lần đọc của mục tiêu (trừ file kế hoạch và
  // thư mục .focus-conductor/); chạm bội số của conductorReads thì kết quả kèm một dòng nhắc. Không từ chối lời gọi đọc nào.
  on('tool.call', { tool: /^(?:Read|Grep|Glob)$/ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || ctx.conductorReads === 0 || result.deny !== undefined) return result
    const note = await noteConductRead($, ctx, await read($, mode), e as unknown as Record<string, unknown>, ctx.conductorReads)
    return note === null ? result : { ...result, context: [...(result.context ?? []), note] }
  }).catch(($, e, next) => (noteHookError('tool.call conduct-read', next.error), next(e)))

  // Mọi tool: luồng chính được nhắc (context của kết quả tool) và nâng cấp theo
  // bằng chứng cho turn sau; subagent chỉ được ghi nhật ký, không bị nhắc.
  // Lời nhắc đi kèm kết quả tool, không sửa system prompt, nên không ảnh hưởng cache.
  on('tool.call', async ($, e, next) => {
    // strictDelegation "block": luồng chính sửa file trong khi còn việc ghi giao subagent chưa giao thì bị từ chối,
    // tối đa blockLimit lần mỗi mục tiêu (mặc định 2; sau đó chỉ nhắc, kẻo kẹt khi không giao được).
    // Gồm lệnh Bash ghi file (sed -i, chuyển hướng ghi, rm...): isMutation đã loại lệnh chỉ đọc và lệnh kiểm tra.
    const isBashWrite =
      e.tool === 'Bash' && isMutation({ tool: 'Bash', input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
    const isMainWrite = e.agentId === undefined && (EDIT_TOOLS.has(e.tool) || isBashWrite)
    // Lệnh kiểm của luồng chính (0.8.6 R2): Bash theo cùng phân loại khi ghi bằng chứng (checkKindOf, gồm checkCommands), và tool MCP trong checkTools.
    const isMainCheck = e.agentId === undefined && !isMainWrite && ((e.tool === 'Bash' && checkKindOf(String((e as unknown as Record<string, unknown>)['command'] ?? '')) !== null) || isCheckTool(e.tool))
    // Vai điều phối (0.8.6 R1, R2): luồng chính đang điều phối bị từ chối mọi lần sửa file trừ file kế hoạch (không xét việc còn chờ giao hay
    // blockLimit) và mọi lệnh kiểm; được miễn thì cho chạy và đếm sau khi lời gọi thật sự chạy. Không điều phối thì strictDelegation như 0.8.5.
    const roleKind: 'write' | 'check' | null = isMainWrite ? 'write' : isMainCheck ? 'check' : null
    const role = roleKind !== null ? await conductRole($, ctx, await read($, mode), e as unknown as { tool: string } & Record<string, unknown>) : null
    if (role !== null && !role.isExempt) {
      const denied = S.conductOf(await update($, coreState, S.withConduct(role.goalId, c => (roleKind === 'write' ? { deniedWrites: c.deniedWrites + 1 } : { deniedChecks: c.deniedChecks + 1 }))))
      record(await $.clock.now(), 'conduct-deny', { type: roleKind, n: roleKind === 'write' ? denied.deniedWrites : denied.deniedChecks })
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
      return { deny: roleKind === 'write' ? conductWriteDenyText() : conductCheckDenyText() }
    }
    const blockCore = isMainWrite && role === null ? S.normalizeCore(await read($, coreState)) : null
    if (blockCore !== null && strictDelegation === 'block') {
      const current = await read($, mode)
      const now = blockCore
      const waiting = current === 'auto' || current === 'subagents' ? pendingFor(now.brief, shownPlan(now).plan) : []
      const path = filePathOf({ tool: e.tool, input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
      if (waiting.length > 0 && !isPlanFile(path) && L.delegation.blocks < blockLimit) {
        L.delegation.blocks += 1
        return { deny: blockText(waiting, blockLimit - L.delegation.blocks) }
      }
    }
    const result = await next(e)
    // Lời gọi được miễn chỉ tính là tự làm khi thật sự chạy (cổng khác không từ chối).
    if (role !== null && result.deny === undefined) {
      const own = S.conductOf(await update($, coreState, S.withConduct(role.goalId, c => (roleKind === 'write' ? { selfWrites: c.selfWrites + 1 } : { selfChecks: c.selfChecks + 1 }))))
      record(await $.clock.now(), 'conduct-self', { type: roleKind, n: roleKind === 'write' ? own.selfWrites : own.selfChecks })
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    }
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
      const targets = changedTargets(observation, await rootFor($, L.roots, changedBrief.goalId), changedBrief)
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
        // Lần kiểm dùng chung thư mục (0.8.6 R2): subagent không chạy trong worktree riêng, luồng chính đang điều phối.
        const isShared = meta.sharesDir === true && isConductingNow(S.normalizeCore(await read($, coreState)), await read($, mode))
        const agentHardBefore = agentLog.lastHard
        noteEvidence(agentLog, observation, e.agentId, isShared, agentBrief)
        await hydrateClosing($, ctx)
        noteStepRun(ctx, agentBrief.goalId, observation)
        await persistClosing($, ctx)
        const isAgentHard = agentLog.lastHard > agentHardBefore
        // Một tệp một agent (0.9.0 C5): hai subagent đang chạy chung thư mục cùng ghi một tệp thì nhắc luồng chính một lần cho mỗi tệp.
        if (meta.sharesDir === true && !observation.isError && isMutation(observation)) {
          const written = writtenPaths(observation)
          const own = L.agentWrites.get(e.agentId) ?? new Set<string>()
          for (const path of written) own.add(path)
          if (L.agentWrites.size < 200) L.agentWrites.set(e.agentId, own)
          for (const path of written) {
            const others = [...L.agentWrites.entries()].filter(([id, paths]) => id !== e.agentId && L.liveAgents.has(id) && agents.get(id)?.sharesDir === true && paths.has(path)).map(([id]) => id)
            if (others.length === 0 || L.clashWarned.has(path) || L.clashWarned.size >= 200) continue
            L.clashWarned.add(path)
            record(await $.clock.now(), 'file-clash', { file: clipText(path), agents: [e.agentId, ...others] })
            await flushDecisions((path2, text) => $.fs.write(path2, text), path2 => $.fs.read(path2))
            L.agentRetryNotes.push(fileClashNote(path, 1 + others.length))
          }
        }
        if (isCheckCall(observation.tool)) L.agentRetryNotes.push(...(await noteChecks($, retryDeps, S.normalizeCore(await read($, coreState)), agentBrief.goalId, newChecks(agentLog, agentSince), observation, meta.pick, false, meta.description)))
        const skillBefore = L.tracker.skillWrites
        trackVerification(L.tracker, observation, e.agentId, (await frameOf($, L.roots, agentBrief.goalId, agentBrief.scopePaths)).cwd, isShared, agentBrief)
        // File skill subagent ghi và lệnh khai đạt của subagent (0.8.2 N3): như của luồng chính, ghi trước, thử sau.
        if (L.tracker.skillWrites > skillBefore) await update($, coreState, S.withSkillWrite(agentBrief.goalId, L.tracker.skillPath))
        if (isCheckCall(observation.tool) && passedDeclared(newChecks(agentLog, agentSince))) await update($, coreState, S.withSkillTrial(agentBrief.goalId))
        // Subagent sửa file: bước tự nâng thành verified về done, như thay đổi của luồng chính (0.7.0).
        if (!observation.isError && isMutation(observation) && S.hasAutoVerified(S.normalizeCore(await read($, coreState)))) {
          await update($, coreState, S.withAutoDemotedBy(isAgentHard))
          await showStatus($, await read($, view), ctx.options)
        }
        // Bằng chứng theo từng bước (0.9.0 B10): lần chạy của subagent cũng tính.
        if (observation.tool === 'Bash' && (await liftStepChecks($, ctx, agentBrief.goalId))) await showStatus($, await read($, view), ctx.options)
        // Lần test mang cờ dùng chung thư mục vừa đạt sau thay đổi cuối (0.8.6 R2): bước done thành verified như lần test của luồng chính.
        if (isShared && isCheckCall(observation.tool) && !observation.isError && (await autoVerify($, ctx, agentBrief.goalId))) await showStatus($, await read($, view), ctx.options)
      }
      // Phiên con của một phần (0.7.9 F1): phạm vi là files của phần đó, theo cơ chế cảnh báo ngoài phạm vi sẵn có.
      const forkScope = forkFiles(S.normalizeCore(await read($, coreState)), e.agentId)
      const scopePaths = forkScope.length > 0 ? forkScope : remindSubagents ? (agentBrief?.scopePaths ?? []) : []
      const frame = agentBrief !== null ? await frameOf($, L.roots, agentBrief.goalId, scopePaths) : { root: null, cwd: null }
      // Tệp trạng thái và nơi ghi phụ của mục tiêu (0.9.0 B2) cũng áp cho subagent.
      const sides = { ...(agentBrief?.stateFiles !== undefined ? { stateFiles: agentBrief.stateFiles } : {}), ...(agentBrief?.sideWrites !== undefined ? { sideWrites: agentBrief.sideWrites } : {}) }
      const findings = observe(agentTracker, observation, { goal: meta.description, scopePaths, tier: meta.tier, ...sides, ...frame }, [])
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
    const keepFamily = keepRole ? ctx.activeConductorOf(core, S.modeOf(await read($, modeState), ctx.options))?.family : undefined
    const compactNote = L.compaction.pending && core.brief !== null ? `${compactReminderText(core.brief, shownPlan(core).plan)}${keepRole ? `\n${conductorKeepText(keepFamily)}` : ''}` : null
    L.compaction.pending = false
    // Ghi cả lệnh lỗi: evidence nhắc tới một lệnh kiểm tra đã lỗi thì không được tính là đã kiểm tra.
    const retryNotes: string[] = []
    // Lệnh khai trong checkCommands chạy đạt (0.8.2 N3): bằng chứng thử skill, ghi sau lần ghi file skill của cùng lời gọi.
    let isDeclaredPass = false
    if (core.brief !== null) {
      const mainLog = evidenceFor(core.brief.goalId)
      const mainSince = mainLog.seq
      const hardBefore = mainLog.lastHard
      noteEvidence(mainLog, observation, 'main', false, core.brief)
      await hydrateClosing($, ctx)
      noteStepRun(ctx, core.brief.goalId, observation)
      await persistClosing($, ctx)
      L.lastWasHard = mainLog.lastHard > hardBefore
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
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
      // Bước nâng nhờ lệnh ở trường check của chính bước (0.9.0 B10) chỉ hạ khi lần ghi này là thay đổi không nhẹ.
      await update($, coreState, c => S.withAutoDemotedBy(L.lastWasHard)(S.withActivity(goalId)(c)))
      if (hadVerified) await showStatus($, await read($, view), ctx.options)
    }
    // Bằng chứng theo từng bước (0.9.0 B10): lần chạy Bash khớp lệnh ở trường check của một bước done.
    if (core.brief !== null && observation.tool === 'Bash' && (await liftStepChecks($, ctx, core.brief.goalId))) await showStatus($, await read($, view), ctx.options)
    // Lệnh test vừa chạy đạt sau thay đổi cuối (phủ mọi thay đổi): các bước done thành verified (0.7.0), chỉ những bước đóng sau lần
    // kiểm đạt trước của mục tiêu (0.7.5); lần này ghi mốc kiểm đạt mới.
    if (core.brief !== null && isCheckCall(observation.tool) && !observation.isError) {
      const log = evidenceFor(core.brief.goalId)
      const fresh = freshTestRun(log)
      if (fresh !== undefined && fresh === log.commands.at(-1) && (core.plan.some(s => s.status === 'done') || S.liveMirror(core).some(s => s.status === 'done'))) {
        await update($, coreState, S.withAutoVerified(fresh.command, autoLiftIds(ctx, core, core.brief.goalId), true))
        record(await $.clock.now(), 'verify-auto', { command: clipText(fresh.command), at: core.plan.length === 0 ? 'mirror' : 'test' })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
    // Đội hình do mod áp (0.9.0 C): tính lại sau lần ghi hay lần kiểm của luồng chính; vừa bật thì đoạn dặn đi kèm kết quả này.
    await refreshTeam($, ctx)
    const fromAgents = L.agentRetryNotes.splice(0)
    // Lệnh kiểm qua ống che mã thoát (sau phiên thật D4, mục 2a): nhắc ngay ở kết quả, tối đa hai lần mỗi mục tiêu; ghi lần chạy để lý do
    // chặn của cổng Stop nêu đúng nguyên nhân.
    if (core.brief !== null && e.tool === 'Bash' && e.agentId === undefined) {
      const stepChecks = core.plan.flatMap(step => { const check = stepCheckOf(step.check); return check !== null ? [check.command] : [] })
      const piped = pipedCheck(String(observation.input['command'] ?? ''), observation.cwd, stepChecks)
      await hydrateClosing($, ctx)
      if (L.pipeNotes.goalId !== core.brief.goalId) L.pipeNotes = { goalId: core.brief.goalId, n: 0, last: null }
      if (piped !== null) {
        L.pipeNotes.last = { seq: evidenceFor(core.brief.goalId).seq, command: piped }
        if (L.pipeNotes.n < 2) {
          L.pipeNotes.n += 1
          fromAgents.push(pipedCheckNote(piped))
        }
      }
      await persistClosing($, ctx)
    }
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
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
      if (target.isFable) await noteFableRouter($, ctx, outcome.result !== null, target.family)
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
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
    // Mọi đường ra ghi tệp trạng thái mục tiêu sau khi các cổng đã xét (vòng 2 M15).
    const finish = async <T,>(out: T): Promise<T> => {
      await saveGoalFile($, ctx)
      return out
    }
    const result = await next(e)
    // Stop đầu tiên không còn subagent nào chạy: tính lại cảnh báo chưa kiểm đã hoãn (0.8.0 A5).
    if (await settleDeferred($, ctx)) await showStatus($, await read($, view), ctx.options)
    if (result.block || result.preventContinuation || !isExecuting(L.tracker, L.promptIntent)) return finish(result)
    if ((await read($, mode)) === 'off') return finish(result)
    // Đang dừng vì hạn mức (hay người dùng tạm dừng): cho kết thúc, nếu không sẽ vòng lặp chặn khi mọi tool bị từ chối.
    const quota = normalizeQuota(await read($, quotaState))
    if (quota.pause !== null) return finish(result)
    const failed = failedFor(S.normalizeCore(await read($, coreState)).brief).concat(forkFailures(S.normalizeCore(await read($, coreState))))
    // Rà kế hoạch trước khi trình duyệt (0.8.2 N2): xét đầu tiên, trước W4, Y6, G1; không theo stop_hook_active (mỗi lần chặn là một lượt rà)
    // và không theo enforceChecklist (option planApproval riêng).
    const review = await planReviewGate($, ctx)
    if (review.kind === 'allow') {
      await showStatus($, await read($, view), ctx.options)
      return finish(result)
    }
    if (review.kind === 'block') return finish({ ...result, block: review.reason })
    if (ctx.options['enforceChecklist'] !== true) return finish(result)
    // Turn đã nhận câu báo hạn mức mềm (0.7.5): quy tắc dừng theo hạn mức của prompt có thể đang áp, nên checklist còn mở không
    // chặn kết thúc, nhưng chỉ khi cửa sổ vẫn còn trong vùng báo (vòng sửa 2: cửa sổ đã làm mới thì chặn như cũ); việc giao
    // subagent đã lỗi vẫn bị chặn.
    const isNoticed = L.noticeTurn !== null && L.noticeTurn === L.tracker.turnId && softNotices(quota.readings, await $.clock.now(), quotaSettings(ctx.options)).length > 0
    // Lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4) xét trước checklist và G1, và không theo stop_hook_active: mỗi lần chặn là một lượt mới.
    const gate = isNoticed ? { reason: null, isPlanChanged: false } : await retryGate($, retryDeps, e.last_assistant_message)
    if (gate.isPlanChanged) await showStatus($, await read($, view), ctx.options)
    // Lệnh miễn chưa đòi báo cáo (0.7.9 Y5): chặn đúng một lần, đi chung lần chặn của W4 nếu có.
    const waiveReason = await askWaived($)
    // Lệnh đỏ từ nền chưa đòi báo cáo (vòng 3 N4): chặn đúng một lần, đi chung lần chặn của W4 và lệnh miễn nếu có.
    const baseReason = isNoticed ? null : await askBaseline($, retryDeps)
    const retryReason = [gate.reason, waiveReason, baseReason].reduce<string | null>((acc, reason) => (reason === null ? acc : acc === null ? reason : joinStopReasons(acc, reason)), null)
    // stop_hook_active chỉ bỏ qua phần checklist và G1: hai cổng đó nhắc một lần mỗi chuỗi dừng.
    if (e.stop_hook_active) return finish(retryReason !== null ? { ...result, block: retryReason } : result)
    let core = S.normalizeCore(await read($, coreState))
    // Đã sửa mà chưa chạy lần kiểm nào (0.7.9 Y6): sau W4, trước G1 và checklist; theo stop_hook_active như G1.
    const noCheck = isNoticed || core.brief === null ? null : await noCheckGate($, ctx.options, core, evidenceFor(core.brief.goalId), L.liveAgents.size > 0)
    if (noCheck !== null) core = S.normalizeCore(await read($, coreState))
    // Sửa skill mà chưa thử (0.8.2 N3): sau Y6, trước G1; theo stop_hook_active như Y6 và G1.
    const skillReason = isNoticed || core.brief === null ? null : await skillTrialGate($, core, L.liveAgents.size > 0)
    if (skillReason !== null) core = S.normalizeCore(await read($, coreState))
    // Cổng đóng mục tiêu (0.9.0 C6): sau Y6 và thử skill, trước G1; theo stop_hook_active như hai cổng đó.
    const closingReason = isNoticed || core.brief === null ? null : await closingGate($, ctx, core, evidenceFor(core.brief.goalId))
    // Status line khớp sau mỗi lần cổng đóng xét, chặn hay cho qua (vòng 2 U2).
    if (!isNoticed && core.brief !== null) await showStatus($, await read($, view), ctx.options)
    if (closingReason !== null) core = S.normalizeCore(await read($, coreState))
    const prior = [retryReason, noCheck, skillReason, closingReason].reduce<string | null>((acc, reason) => (reason === null ? acc : acc === null ? reason : joinStopReasons(acc, reason)), null)
    const plan = isNoticed ? [] : core.plan
    const withRetry = (reason: string) => (prior !== null ? joinStopReasons(prior, reason) : reason)
    // Mục tiêu từ moderate (hoặc có việc đã phân) mà chưa có checklist (0.7.8 G1): chặn một lần mỗi mục tiêu, khóa trong Core nên
    // giữ qua hot reload; danh sách phản chiếu từ TodoWrite chỉ để hiển thị nên không tính là checklist.
    const brief = core.brief
    if (brief !== null && core.plan.length === 0 && failed.length === 0 && !isNoticed && core.stopNudged !== brief.goalId && needsChecklist(brief)) {
      await update($, coreState, S.withStopNudged(brief.goalId))
      const hasMirror = core.mirror.goalId === brief.goalId && core.mirror.steps.length > 0
      return finish({ ...result, block: withRetry(noChecklistReason(brief, hasMirror)) })
    }
    if (isGoalDone(plan) && failed.length === 0) return finish(prior !== null ? { ...result, block: prior } : result)
    return finish({ ...result, block: withRetry(stopBlockReason(plan, failed)) })
  }).catch(($, e, next) => (noteHookError('classic.Stop', next.error), next(e)))

  // Chi phí đo được: luồng chính (không có agentId) vào nhóm luồng chính; subagent
  // vào nhóm agent và gắn vào dòng nhật ký của đúng agent. Hiệu chỉnh ước lượng theo số đo.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await ctx.flushErrors({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), root: () => $.session.root() })
    if ((await read($, mode)) === 'off') return result
    const at = await $.clock.now()
    // ID engine đã phục vụ (0.8.7 M1): lần đầu một họ được phục vụ bằng ID khác ID ghim thì một cảnh báo model, không chèn context.
    const servedWarning = safeUsage(e.usage)?.model ? ctx.noteServed(safeUsage(e.usage)!.model) : null
    if (servedWarning !== null) await update($, coreState, S.withWarnings({ at, kind: 'model', text: servedWarning }))

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const meta = agents.get(agentId)
      steppedEarly.delete(agentId)
      L.liveAgents.delete(agentId)
      const usage = safeUsage(e.usage)
      if (usage) {
        const family = familyOf(usage.model) ?? meta?.family ?? 'sonnet'
        const core = S.normalizeCore(await read($, coreState))
        const added = addUsage(core.ledger, 'agent', family, usage)
        // Chỉ agent router đã chấm mới có khối lượng thật để hiệu chỉnh; agent không có kết quả chấm thì bỏ qua.
        const effort = meta?.sentEffort ?? meta?.pick.effort ?? 'medium'
        const ledger =
          meta !== undefined && meta.shape !== null
            ? recordShape(calibrate(added.ledger, family, usage.output_tokens, meta.volume, effort), meta.shape, usage.output_tokens, effort)
            : added.ledger
        await update($, coreState, c => S.withAgentUsd(agentId, added.usd)(S.withLedger(() => ledger)(c)))
      }
      // Lỗi hoặc bị từ chối thì lần giao lại việc đó được router chấm lại; người dùng ngắt (aborted) thì không cần.
      if ((e.reason === 'error' || e.reason === 'refusal') && meta !== undefined) {
        agentFailures.push({ description: meta.description, goalId: meta.goalId })
        if (agentFailures.length > 10) agentFailures.shift()
      }
      // Kết luận của subagent (0.9.0 D1, D2): dòng đầu câu trả lời theo các từ kết luận, có tiền tố hay không. Chỉ câu trả lời của subagent
      // không ghi file ngoài thư mục tạm mới tính cho cổng (isClean). Vai: tiền tố hay vai mod suy; không có thì theo loại kết luận.
      const read0 = e.reason === 'answer' && meta !== undefined ? verdictOf(e.answer ?? '') : null
      // Lượt có tiền tố của vai review hay sẵn sàng mà không có dòng kết luận nào: không tính là đạt (vòng 2 M1, thay luật sau phiên thật D4
      // mục 1f); bước đóng là chờ và cổng đòi người duyệt trả lời lại. Dòng nhắc luồng chính đọc kết quả giữ như trước.
      const ownPrefix = meta !== undefined ? prefixRole(meta.description) : undefined
      const isUnread = read0 === null && e.reason === 'answer' && (ownPrefix === 'review' || ownPrefix === 'design') && hasNoVerdictLine(e.answer ?? '')
      const parsed: ReturnType<typeof verdictOf> = read0
      if (isUnread && meta !== undefined) L.agentRetryNotes.push(assumedVerdictNote(meta.description))
      const isUnclear = e.reason === 'answer' && parsed === null && isUnclearVerdict(e.answer ?? '')
      // Lượt của mục tiêu cũ hoàn tất sau khi đổi mục tiêu không đụng kết luận và dấu của mục tiêu mới (vòng sửa cuối 18/11, A4).
      const liveGoal = S.normalizeCore(await read($, coreState)).brief?.goalId
      if (e.reason === 'answer' && meta !== undefined && meta.goalId === liveGoal && (parsed !== null || meta.role !== undefined || isUnclear)) {
        const role: Role = meta.role ?? (parsed?.verdict === 'ready' || parsed?.verdict === 'not-ready' ? 'design' : 'review')
        // Sạch (0.9.0, C2 đo dấu file): dấu của tập file không đổi giữa lúc sinh và lúc hoàn tất, và sổ không ghi lần ghi definite nào của
        // subagent này vào file không nhẹ ngoài thư mục tạm. fs không đo được thì chỉ theo sổ.
        // Vòng sửa 1 sau kiểm độc lập: chỉ lượt có bản ghi lúc sinh mới sạch được (lượt build, audit, haiku lúc sinh không có); file vào tập
        // sau lúc sinh tính là đổi; mốc của kết luận là mốc lúc sinh, nên thay đổi trong lúc subagent chạy làm nó hết hiệu lực theo sổ.
        const prints = normalizeReviewPrints(await read($, printState))
        const hasSpawn = prints.goalId === meta.goalId && agentId in prints.spawn
        const spawned = hasSpawn ? prints.spawn[agentId] : undefined
        const spawnSeq = hasSpawn ? prints.spawnSeq[agentId] : undefined
        let printChanged: string[] = []
        // Đo lúc được lúc không (vòng sửa cuối 18/11, A1): fs đo được ở một mốc mà không đo được ở mốc khác thì không tính; không đo được ở
        // mọi mốc thì theo sổ thay đổi.
        let isMixed = false
        if (hasSpawn) {
          const nowCore = S.normalizeCore(await read($, coreState))
          const before = spawned ?? {}
          const later = printTargets(S.changedOf(nowCore).paths, nowCore.brief).files.filter(path => !(path in before))
          const keys = [...Object.keys(before), ...later]
          const done = keys.length === 0 ? {} : await takePrints({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) as Promise<string> }, keys, (await $.session.root().catch(() => null)) ?? null, before).catch(() => null)
          const failed = spawned === null || done === null
          isMixed = failed && (isMeasured(spawned) || isMeasured(done))
          if (!failed) printChanged = [...changedPrints(before, done ?? {}), ...later]
          await update($, printState, state => withPrint(normalizeReviewPrints(state), meta.goalId, 'done', agentId, failed ? null : done))
        }
        // File mới ngoài thư mục tạm trong phạm vi mục tiêu (vòng 2 M13): lượt có vai chỉ đọc hay vai kiểm tạo ra thì kết luận không được tính,
        // tên file vào lý do chặn, kèm một cảnh báo.
        const listed = L.scopeLists.get(agentId)
        L.scopeLists.delete(agentId)
        if (listed !== undefined && listed.goalId === meta.goalId) {
          // Cùng gốc lúc sinh (kiểm độc lập vòng 1 lỗi 11).
          const nowList = await listScope({ list: (path?: string) => $.fs.list(path), stat: (path: string) => $.fs.stat(path) }, listed.roots)
          const sessionRoot = (await $.session.root().catch(() => null)) ?? ''
          const ownLog = ctx.decisionLog === '' ? [] : [ctx.decisionLog.startsWith('/') || sessionRoot === '' ? ctx.decisionLog : `${sessionRoot.replace(/\/+$/, '')}/${ctx.decisionLog}`]
          const created = nowList === null ? [] : newFiles(listed.files, nowList, ownLog)
          if (created.length > 0) {
            for (const path of created) if (!printChanged.includes(path)) printChanged.push(path)
            await update($, coreState, S.withWarnings({ at, kind: 'scope', text: `Lượt "${clipText(meta.description, 40)}" tạo file mới ngoài thư mục tạm: ${printNames(created)}` }))
          }
        }
        const wroteHard = ctx.evidenceFor(meta.goalId).writes.some(w => w.author === agentId && (w.hard === true || w.skill === true) && w.definite === true)
        const isClean = hasSpawn && !isMixed && printChanged.length === 0 && !wroteHard
        // Kết luận theo vai (0.9.0 C6): lượt có tiền tố Kiểm:, Audit: và từ ĐẠT HẾT, ALL PASS chỉ là của bước kiểm; duyệt và sẵn sàng cần model
        // từ sonnet trở lên.
        // Model đã chạy: theo usage khi có (model lạ thì không biết họ), không thì họ của lời giao.
        const usageModel = safeUsage(e.usage)?.model ?? ''
        const ranFamily = usageModel !== '' ? familyOf(usageModel) : meta.family
        const isStrong = ranFamily !== null && ranFamily !== 'haiku'
        const isReview = isClean && prefixRole(meta.description) !== 'audit' && parsed?.isCheckOnly !== true && isStrong
        await hydrateClosing($, ctx)
        if (L.verdicts.goalId !== meta.goalId) L.verdicts = { goalId: meta.goalId, items: [] }
        L.verdicts.items.push({ agentId, role, verdict: parsed?.verdict ?? null, isClean, isReview, ...(parsed?.count !== undefined ? { count: parsed.count } : {}), seq: spawnSeq !== undefined ? spawnSeq + 0.5 : ctx.evidenceFor(meta.goalId).seq, ...(printChanged.length > 0 ? { changed: printChanged.slice(0, 20) } : {}), ...(isUnclear ? { unclear: true as const } : {}), ...(isUnread ? { unread: true as const } : {}), family: ranFamily ?? meta.family, ...(meta.taskIndex !== undefined ? { taskIndex: meta.taskIndex } : {}), description: meta.description })
        if (L.verdicts.items.length > 100) L.verdicts.items.shift()
        record(at, 'verdict', { agentId, role, verdict: parsed?.verdict ?? null, ...(isClean ? {} : { wrote: true }), ...(printChanged.length > 0 ? { changed: printChanged.slice(0, 3) } : {}), ...(isReview ? { review: true } : {}), ...(parsed?.count !== undefined ? { count: parsed.count } : {}) })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        // Vòng sửa theo kết luận (0.9.0 C7): chưa đạt của một subagent không ghi file tính vòng cho cùng một mục, trần RETRY_ROUNDS. Khóa là mục
        // tiêu, vai và việc đã phân nếu có (vòng 2 M4), không theo description, nên người duyệt đổi description giữa các vòng vẫn cộng dồn.
        const roundKey = `${meta.goalId}:${role}:${meta.taskIndex ?? ''}`
        if (parsed?.verdict === 'pass') L.verdictRounds.delete(roundKey)
        if (parsed?.verdict === 'fail' && isClean) {
          const round = (L.verdictRounds.get(roundKey) ?? 0) + 1
          if (L.verdictRounds.size < 200) L.verdictRounds.set(roundKey, round)
          const name = labels(langOf(ctx.options['uiLanguage'])).roleNames[role]
          L.agentRetryNotes.push(verdictRetryNote(name, round, topFamily(ctx.policy())))
          if (round >= RETRY_ROUNDS) {
            const text = `Chưa đạt sau ${RETRY_ROUNDS} vòng: ${clipText(meta.description)}`
            await update($, coreState, S.withWarnings({ at, kind: 'loop', text }))
            $.ui.toast(text)
            record(at, 'retry-exhausted', { role, description: clipText(meta.description), round })
          }
          await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        }
        await persistClosing($, ctx)
      }
      if (meta !== undefined) await refreshTeam($, ctx)
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
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
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
    const mainUsage = safeUsage(e.usage)
    if (mainUsage) {
      const family = familyOf(mainUsage.model) ?? core.route?.family ?? 'sonnet'
      const added = addUsage(core.ledger, 'main', family, mainUsage)
      // Chỉ hiệu chỉnh khi route của chính turn này đã được áp (chế độ auto, không
      // quay về model của engine); nếu không, effort thực tế không phải effort của route.
      const applied = L.turnRoute.turnId === e.turnId ? L.turnRoute.route : null
      const isApplied = applied !== null && (await read($, mode)) === 'auto'
      const brief = core.brief
      ledger =
        isApplied && brief
          ? recordShape(
              calibrate(added.ledger, family, mainUsage.output_tokens, brief.volume, applied.effort),
              shapeKey(brief.depth, brief.volume, brief.kind),
              mainUsage.output_tokens,
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
    // Turn của mục tiêu (0.8.5 K8): turn thực thi theo cùng cách cổng Stop phân biệt; không biết ý của prompt (router lỗi, nạp lại mod) thì
    // tính là turn thực thi. Turn bị ngắt khi engine báo aborted.
    const isExecutingTurn = L.promptIntent === null || isExecuting(L.tracker, L.promptIntent)
    const isInterrupted = e.reason === 'aborted' || (e as { isAborted?: boolean }).isAborted === true
    await update($, coreState, c => {
      // Turn không có cảnh báo chưa kiểm thì chuỗi turn cùng nguyên nhân đứt (0.8.0 A5); turn hoãn vì còn subagent chưa tính là đứt.
      const isStreak = isPaused || held.length > 0 || findings.some(f => f.kind === 'unverified')
      const counted = core.brief !== null ? S.withTurnEnd(core.brief.goalId, isExecutingTurn, isInterrupted)(c) : c
      const marked = S.withTurnMark(at, endContext)(S.withLedger(() => ledger)(S.withWarnings(...warnings)(isStreak ? counted : S.withCauseBreak(counted))))
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
