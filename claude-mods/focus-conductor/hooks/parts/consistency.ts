// Giữ nhất quán: tool plan, theo dõi mọi tool, chặn kết thúc khi checklist còn mở, cộng chi phí đo được.

import { atom, derive, read, update } from 'claude-code'
import type { AgentState, DelegationState, Warning } from '../../types'
import { acceptsVerified, evidenceStrength, filePathOf, isExecuting, isFullyClosed, isGoalDone, isMutation, isPlanFile, newTracker, noteEvidence, observe, openSteps, pendingSteps, suggestCheckCommands, summarize, trackVerification } from '../lib/drift'
import type { Focus } from '../lib/drift'
import { clipText } from '../lib/decisions'
import { addUsage, calibrate, recordShape, shapeKey } from '../lib/ledger'
import { applyPlan } from '../lib/plan'
import type { PlanInput } from '../lib/plan'
import { familyOf } from '../lib/route'
import { askRouter, driftRequest, parseDrift } from '../lib/router'
import { EMPTY_QUOTA, normalizeQuota, quotaSettings } from '../lib/quota'
import { storeKey, withNote } from '../lib/checkpoint'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import { PLAN_TOOL_FULL, blockText, criteriaNotice, driftContext, pendingNotice, qualityNotice, renderBulk, renderPlan, staticOnlyNotice, stopBlockReason, subagentReminder, unbackedNotice } from '../lib/text'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { EDIT_TOOLS, ERROR_BURST } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

/**
 * Khung đối chiếu phạm vi của mục tiêu: thư mục gốc của phiên chốt một lần cho mỗi mục tiêu (không đổi theo `cd`
 * của shell) và thư mục làm việc hiện tại. Chỉ hỏi engine khi mục tiêu có giới hạn phạm vi; lỗi thì null.
 */
async function frameOf($: EngineInterface, roots: Map<number, string | null>, goalId: number, scopePaths: readonly string[]) {
  if (scopePaths.length === 0) return { root: null, cwd: null }
  if (!roots.has(goalId)) {
    roots.set(goalId, await $.session.root().catch(() => null))
    const oldest = roots.keys().next().value
    if (roots.size > 8 && oldest !== undefined) roots.delete(oldest)
  }
  return { root: roots.get(goalId) ?? null, cwd: await $.session.cwd().catch(() => null) }
}

/** Status line kèm nhãn hạn mức (0.6.1): mọi chỗ đặt status của file này đi qua đây, nên nhãn không mất giữa các hook. */
async function showStatus($: EngineInterface, current: View, options: Ctx['options']): Promise<void> {
  $.ui.status(S.statusText(current, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(options)))
}

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

export function registerConsistency(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { agentFailures, agentTrackers, agents, blockLimit, carryEvidence, flushDecisions, delegationItems, evidenceFor, failedFor, isRouterPaused, moveDelegation, noteRouterTime, pendingFor, record, remindSubagents, routerFamily, routerModel, semanticDrift, steppedEarly, strictDelegation, trackDelegations } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ------------------------------------------ 3. giữ nhất quán

  // Tool plan chỉ đổi trạng thái nội bộ của mod: không cần hỏi quyền.
  on('tool.check', { tool: 'mcp__focus-conductor__plan' }, () => ({
    decision: 'allow' as const,
    reason: 'focus-conductor: checklist nội bộ của phiên',
  })).catch(($, e, next) => next(e))

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
        const isSaved = await $.store.set(storeKey(cp.cwd), cp).then(() => true).catch(() => false)
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
    const isAccepted = strength !== null && log !== null && acceptsVerified(strength, log)
    const isDowngraded = isVerifiedAsk && !isAccepted
    const outcome = applyPlan(before.plan, isDowngraded ? { ...input, status: 'done' } : input)
    if (outcome.error !== undefined) return { deny: outcome.error }

    // "set" chốt lại mục tiêu và các bước: làm mới cả từ khóa của brief để
    // việc nhận diện prompt tiếp nối dựa trên mục tiêu mới, không phải mục tiêu cũ.
    const isSet = input.action === 'set'
    const titles = outcome.plan.map(step => step.title)
    const core = await update($, coreState, c => {
      const withPlan = S.withPlan(outcome.plan)(c)
      return isSet ? S.withRetarget(outcome.goal, titles, outcome.scope)(withPlan) : withPlan
    })
    L.tracker.planUpdates += 1
    if (isAccepted && strength?.level === 'strong') {
      L.tracker.isVerified = true
      L.tracker.mutationsSinceCheck = 0
    }
    const notes: string[] = []
    if (isDowngraded) {
      const reason = strength?.reason ?? 'chưa đối chiếu được evidence với mục tiêu hiện tại'
      const text = `Bước ${String(input.step)} ghi verified nhưng ${reason}: lưu là done`
      const at = await $.clock.now()
      await update($, coreState, S.withWarnings({ at, kind: 'unverified', text }))
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
    if (isUpdate && openSteps(before.plan).length > 0 && openSteps(core.plan).length === 0 && pendingSteps(core.plan).length > 0) notes.push(pendingNotice(core.plan))
    await showStatus($, await read($, view), ctx.options)
    const shown = outcome.bulk !== undefined ? renderBulk(core.plan, outcome.changed ?? [], outcome.bulk.status, outcome.bulk.note) : renderPlan(core.brief, core.plan, input.action === 'update' || input.action === 'add' ? outcome.changed : undefined)
    return { result: [shown, ...notes].join('\n') }
  }).catch(() => ({ deny: 'focus-conductor: lỗi nội bộ khi cập nhật checklist; tiếp tục làm việc không cần tool này.' }))

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
      const brief = S.normalizeCore(await read($, coreState)).brief
      const waiting = current === 'auto' || current === 'subagents' ? pendingFor(brief) : []
      const path = filePathOf({ tool: e.tool, input: e as unknown as Record<string, unknown>, isError: false, isReadOnly: false })
      if (waiting.length > 0 && !isPlanFile(path) && L.delegation.blocks < blockLimit) {
        L.delegation.blocks += 1
        return { deny: blockText(waiting, blockLimit - L.delegation.blocks) }
      }
    }
    const result = await next(e)
    if (result.deny !== undefined || e.tool === PLAN_TOOL_FULL) return result
    if ((await read($, mode)) === 'off') return result

    const observation = {
      tool: e.tool,
      input: e as unknown as Record<string, unknown>,
      isError: result.isError === true,
      isReadOnly: result.isReadOnly === true,
      output: result.text ?? (typeof result.result === 'string' ? result.result : undefined),
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
        noteEvidence(evidenceFor(agentBrief.goalId), observation, e.agentId)
        trackVerification(L.tracker, observation, e.agentId)
      }
      const scopePaths = remindSubagents ? (agentBrief?.scopePaths ?? []) : []
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
    // Ghi cả lệnh lỗi: evidence nhắc tới một lệnh kiểm tra đã lỗi thì không được tính là đã kiểm tra.
    if (core.brief !== null) noteEvidence(evidenceFor(core.brief.goalId), observation)
    // Luồng chính vừa thay đổi file: việc làm trực tiếp chưa có bước chuyển từ chưa bắt đầu sang đang làm (0.6.1).
    if (core.brief !== null && !observation.isError && isMutation(observation)) await update($, coreState, S.withActivity(core.brief.goalId))
    const focus: Focus | null = core.brief !== null ? { ...core.brief, ...(await frameOf($, L.roots, core.brief.goalId, core.brief.scopePaths)) } : null
    const findings = observe(L.tracker, observation, focus, core.plan)
    const isErrorBurst = L.tracker.errors === ERROR_BURST
    // Luồng chính bắt đầu tự sửa file trong khi còn việc đã ghi giao subagent: nhắc một lần.
    // Ghi file kế hoạch của plan mode không phải là làm một việc đã phân.
    const pending = pendingFor(core.brief)
    const planFile = isPlanFile(filePathOf(observation))
    // Mặc định nhắc một lần ở lần sửa file đầu tiên; strictDelegation remind/block nhắc ở mọi lần thay đổi (kể cả lệnh ghi file).
    const isStrict = strictDelegation !== 'off'
    const isChange = isStrict ? isMutation(observation) : EDIT_TOOLS.has(e.tool)
    const nudge =
      isChange && !planFile && !observation.isError && pending.length > 0 && (isStrict || !L.delegation.isNudged)
        ? `[focus-conductor] Phân việc còn việc ghi giao subagent chưa giao: Việc ${pending.join(', ')}. Nếu thay đổi này thuộc các việc đó, giao qua Agent với description "Việc N: ..." để chạy đúng model đã chấm.`
        : null
    if (nudge) L.delegation.isNudged = true
    const withNudge = (r: typeof result) => (nudge ? { ...r, context: [...(r.context ?? []), nudge] } : r)
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
    }
    if (isErrorBurst) {
      warnings.push({ at, kind: 'loop', text: `${ERROR_BURST} tool call lỗi trong turn này: turn sau nâng effort một bậc` })
      effortLift = 1
    }
    const lifts = depthLift > 0 || effortLift > 0
    if (warnings.length > 0 || lifts) {
      await update($, coreState, c => {
        const withWarnings = S.withWarnings(...warnings)(c)
        return lifts ? S.withLift(depthLift, effortLift)(withWarnings) : withWarnings
      })
    }

    // semanticDrift (người dùng tự bật): ở checkpoint, router đọc mục tiêu và các thay đổi gần đây để nhận ra lạc đề
    // theo nội dung, thứ mà theo dõi hành vi tool không thấy.
    let driftNote: string | null = null
    if (semanticDrift && core.brief !== null && findings.some(f => f.kind === 'checkpoint') && !isRouterPaused()) {
      const request = driftRequest({
        goal: core.brief.goal,
        steps: openSteps(core.plan).map(step => step.title),
        commands: L.evidenceLog.commands.map(entry => entry.command),
        paths: L.evidenceLog.paths,
        model: routerModel,
      })
      const startedAt = await $.clock.now()
      const outcome = await askRouter(r => $.model.complete(r), request, parseDrift)
      noteRouterTime((await $.clock.now()) - startedAt)
      const verdict = outcome.result
      const now = await $.clock.now()
      await update($, coreState, c => {
        const used = S.withAnalyzerUsage(outcome.usages, routerFamily)(c)
        return verdict !== null && !verdict.onTrack ? S.withWarnings({ at: now, kind: 'drift', text: `Router: có thể lạc đề (${verdict.why})` })(used) : used
      })
      record(now, 'drift', { onTrack: verdict?.onTrack ?? null, why: verdict?.why ?? outcome.reason, retried: outcome.retried })
      await flushDecisions((path, text) => $.fs.write(path, text))
      if (verdict !== null && !verdict.onTrack) driftNote = driftContext(core.brief.goal, verdict.why)
    }
    const top = findings.filter(f => f.context).sort((a, b) => b.priority - a.priority)[0]
    const extra = [...(top?.context ? [top.context] : []), ...(driftNote ? [driftNote] : [])]
    if (extra.length === 0) return withNudge(result)
    return withNudge({ ...result, context: [...(result.context ?? []), ...extra] })
  }).catch(($, e, next) => next(e))

  // Claude định kết thúc mà checklist còn mở, hoặc còn việc giao subagent đã lỗi chưa giao lại: yêu cầu hoàn thành
  // hoặc giải thích. stop_hook_active chặn vòng lặp: chỉ nhắc một lần mỗi lần dừng. Chỉ chặn turn đang thực thi
  // mục tiêu (có thay đổi, cập nhật checklist, giao subagent, hoặc làm tiếp mục tiêu); turn hỏi đáp thì không.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block || result.preventContinuation || e.stop_hook_active || !isExecuting(L.tracker, L.promptIntent)) return result
    if (ctx.options['enforceChecklist'] !== true || (await read($, mode)) === 'off') return result
    // Đang dừng vì hạn mức (hay người dùng tạm dừng): cho kết thúc, nếu không sẽ vòng lặp chặn khi mọi tool bị từ chối.
    if (normalizeQuota(await read($, quotaState)).pause !== null) return result
    const core = S.normalizeCore(await read($, coreState))
    const failed = failedFor(core.brief)
    if (isGoalDone(core.plan) && failed.length === 0) return result
    return { ...result, block: stopBlockReason(core.plan, failed) }
  }).catch(($, e, next) => next(e))

  // Chi phí đo được: luồng chính (không có agentId) vào nhóm luồng chính; subagent
  // vào nhóm agent và gắn vào dòng nhật ký của đúng agent. Hiệu chỉnh ước lượng theo số đo.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, mode)) === 'off') return result
    const at = await $.clock.now()

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const meta = agents.get(agentId)
      steppedEarly.delete(agentId)
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
      // Việc đã phân mà agent này làm: ghi xong hoặc lỗi (lỗi thì Stop và cảnh báo cuối turn nhắc giao lại).
      if (meta?.taskIndex !== undefined) {
        moveDelegation(meta.goalId, meta.taskIndex, end.delegation)
        const brief = S.normalizeCore(await read($, coreState)).brief
        if (brief !== null && brief.goalId === meta.goalId) await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
      }
      return result
    }

    const core = S.normalizeCore(await read($, coreState))
    // Đang dừng vì hạn mức: không có thông báo cuối turn nào (Claude đã được yêu cầu chỉ ghi điểm dừng).
    const isPaused = normalizeQuota(await read($, quotaState)).pause !== null
    const findings = isPaused ? [] : summarize(L.tracker, core.brief, core.plan)
    const warnings: Warning[] = findings.map(f => ({
      at,
      kind: f.kind === 'checkpoint' ? 'unverified' : f.kind,
      text: f.text,
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
    const waiting = pendingFor(core.brief)
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
    const end = await $.session.usage().catch(() => null)
    const endContext = end?.context.tokens ?? L.turnContext
    await update($, coreState, c => S.withTurnMark(at, endContext)(S.withLedger(() => ledger)(S.withWarnings(...warnings)(c))))
    const unverified = findings.find(f => f.kind === 'unverified')
    if (unverified) $.ui.toast(unverified.text)
    await showStatus($, await read($, view), ctx.options)
    return result
  })
}
