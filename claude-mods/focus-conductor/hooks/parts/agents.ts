// Subagent: agent ngoài điều phối, nguồn đổi model, loại agent engine mời, lời gọi Agent, agent.spawn.

import { atom, derive, read, update } from 'claude-code'
import { noteHookError } from '../lib/errlog'
import type { AgentProgress, Choice, Core, ModelFamily, RetryItem, Role, RouteEvent, Warning } from '../../types'
import { turnCost } from '../lib/cost'
import { countSpawn, shapeKey, shapeOutput } from '../lib/ledger'
import { EFFORTS, agentMemoKey, applySession, describePick, familyOf, familyRank, pickRank, ruleConflict, ruleFamily, stepCovers, taskMatch } from '../lib/route'
import { clipText } from '../lib/decisions'
import { READ_ONLY_ROLES, agentRouterRequest, roleOf, roleRoute, askRouter, briefCodes, fitPick, floorRoute, isSettled, parseAgentRoute, ruleRoute, taskRoute } from '../lib/router'
import { FORK_QUOTA_DENY, RETRY_PREFIX, RETRY_ROUNDS, forkRetryNote, forkReturnNote } from '../lib/text'
import { liveForks, openParts } from '../lib/forks'
import { classifyBash, filePathOf, isSkillTrial, normalizePath } from '../lib/drift'
import { isRoleTemp } from '../lib/drift/scope'
import { listScope, scopeRoots } from '../lib/scope-list'
import { isBashWrite, isDefiniteOutsideWrite, prefixRole } from '../lib/team'
import { labels, langOf } from '../ui/labels'
import { reportLine } from '../lib/verdict'
import { EMPTY_REVIEW_PRINTS, PRINT_FILES, normalizeReviewPrints, printTargets, takePrints, withPrint, withSpawnSeq } from '../lib/prints'
import { shownPlan } from '../lib/mirror'
import { tierOf } from '../lib/scale'
import type { AgentRoute } from '../lib/router'
import * as S from '../lib/state'
import { fableStep } from './fable'
import type { EngineInterface, On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { statusTextOf } from '../ui/direction'
import { EMPTY_QUOTA, normalizeQuota, quotaSettings } from '../lib/quota'
import { FANOUT_WARN } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
// Dấu file của các lượt duyệt (0.9.0, C2 đo dấu file); khai lại ở parts/consistency.ts cùng key.
const printState = atom({ plugin: 'focus-conductor', key: 'reviewPrints' } as const, EMPTY_REVIEW_PRINTS)

/** Áp kết quả một lượt router gửi Fable vào Core (0.8.4 C6): vừa tạm ngừng thì toast và một dòng nhật ký conductor. */

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
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const quotaState = atom({ plugin: 'focus-conductor', key: 'quota' } as const, EMPTY_QUOTA)

/**
 * Mã có trong các bước của brief (R11): tiêu đề các việc đã phân, và checklist của tool plan vì plan set/update đồng bộ vào brief.steps.
 * Mã ngắn như b12 chỉ được giữ trong khóa nhớ khi nằm trong tập này.
 */
function codesOf(core: ReturnType<typeof S.normalizeCore>): ReadonlySet<string> {
  return briefCodes(core.brief?.steps ?? [])
}

/**
 * Mức sàn cho một lần giao Agent khi còn lệnh kiểm chưa đạt ở lượt 2 trở đi (0.7.8 vòng sửa 3, W4): description mở đầu "Sửa lỗi kiểm: "
 * thì lấy sàn cao nhất của các lệnh; general-purpose có prompt nhắc đúng một lệnh chưa đạt thì lấy sàn của lệnh đó. Còn lại null.
 */
export { ROLE_PREFIXES, prefixRole } from '../lib/team'

/** Vai của một lời gọi Agent (0.9.0 B): tiền tố trước, không thì vai mod suy của route. */

/** `ln` tạo liên kết mềm (`-s`, cờ gộp có `s`, `--symbolic`) ở đầu một đoạn lệnh. */
const SYMLINK_MAKE = /(?:^|[\s;&|(])ln\s+(?:-[a-zA-Z]*s[a-zA-Z]*|--symbolic)(?:\s|$)/

/**
 * Đường dẫn thật của `path` (vòng 2 M12): `$.fs.stat` với resolve trả realPath; tệp chưa có thì stat bị từ chối, nên giải thư mục cha gần
 * nhất còn đọc được rồi nối phần còn lại (kiểm độc lập vòng 1 lỗi 3), như khai báo kiểu của engine chỉ dẫn. Không giải được thì undefined.
 */
async function realOf($: EngineInterface, path: string): Promise<string | undefined> {
  const statReal = async (at: string) => ((await $.fs.stat(at, { resolve: true }).catch(() => undefined)) as { realPath?: string } | undefined)?.realPath
  const direct = await statReal(path)
  if (direct !== undefined) return direct
  const rest: string[] = []
  let dir = path
  for (let depth = 0; depth < 40 && dir.lastIndexOf('/') > 0; depth++) {
    const cut = dir.lastIndexOf('/')
    rest.unshift(dir.slice(cut + 1))
    dir = dir.slice(0, cut)
    const real = await statReal(dir)
    if (real !== undefined) return `${real.replace(/\/+$/, '')}/${rest.join('/')}`
  }
  return undefined
}

export function roleOfCall(routeRole: Role | undefined, description: string): Role | undefined {
  return prefixRole(description) ?? routeRole
}


/**
 * Lời từ chối theo vai (0.9.0 C2, đổi cách làm sang đo dấu file), không quá 200 ký tự; null là được. Mọi vai không phải build: công cụ sửa
 * file có đích ngoài thư mục tạm. Vai chỉ đọc (search, review, design): thêm lời gọi Bash có tác động ghi mức definite vào file ngoài thư mục
 * tạm; mức possible được chạy. Vai audit: lệnh Bash ghi file ngoài thư mục tạm theo isBashWrite.
 */
export function roleDenial(role: Role, tool: string, input: Record<string, unknown>, name: string, cwd?: string): string | null {
  if (role === 'build') return null
  const isReadOnly = READ_ONLY_ROLES.has(role)
  if (tool !== 'Bash') {
    const path = filePathOf({ tool, input, isError: false, isReadOnly: false })
    // Công cụ sửa file vào thư mục tạm được phép cho mọi vai (bất biến của C2; kiểm độc lập vòng 1).
    if (path !== '' && isRoleTemp(path)) return null
  } else if (isReadOnly) {
    if (!isDefiniteOutsideWrite(String(input['command'] ?? ''), cwd)) return null
  } else if (!isBashWrite(String(input['command'] ?? ''))) return null
  const text = isReadOnly
    ? `[focus-conductor] Vai ${name} chỉ đọc, không sửa file ngoài thư mục tạm. Probe thì chép mã sang thư mục tạm rồi chạy ở đó; chỗ cần sửa thì báo luồng chính.`
    : `[focus-conductor] Vai ${name} chỉ chạy kiểm, không sửa file ngoài thư mục tạm. Báo kết quả và chỗ lỗi cho luồng chính.`
  return text.slice(0, 200)
}

function retryFloorOf(core: Core, description: string, subagentType: string | undefined, prompt: string | undefined): { floor: Choice; round: number; sig: string } | null {
  if (core.brief === null || core.retry.goalId !== core.brief.goalId) return null
  const live = core.retry.items.filter(item => !item.exhausted && item.round >= 2 && item.floor !== null && !S.isWaived(core, item.sig))
  const isFix = description.startsWith(RETRY_PREFIX)
  const named = subagentType === 'general-purpose' ? live.filter(item => item.command !== '' && (prompt ?? '').includes(item.command)) : []
  const pool = isFix ? live : named
  const best = pool.reduce<RetryItem | null>((top, item) => (top === null || pickRank(item.floor as Choice) > pickRank(top.floor as Choice) ? item : top), null)
  return best === null || best.floor === null ? null : { floor: best.floor, round: best.round, sig: best.sig }
}

export function registerAgents(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { agentFailures, agentRoutes, agents, flushDecisions, delegationItems, isAgentRouterPaused, moveDelegation, noteAgentRouter, noteRouterTime, offered, pendingAgents, policy, recognized, record, refit, rememberAgentRoute, spawnedCalls, spawnedIds, startedAgents, steppedEarly } = ctx
  const mode = derive([modeState], modeOf(ctx.options))

  // Quyền theo vai (0.9.0 C2, đổi cách làm sang đo dấu file): vai search, review, design không sửa file và không chạy lệnh ghi mức definite
  // ngoài thư mục tạm; vai audit không sửa file ngoài thư mục tạm, vẫn chạy lệnh kiểm. Subagent không có vai giữ như 0.8.9.

  on('tool.call', { tool: /^(?:Edit|Write|MultiEdit|NotebookEdit|Bash)$/ }, async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const meta = agents.get(e.agentId)
    if (meta === undefined) return next(e)
    const input = e as unknown as Record<string, unknown>
    const role = meta.role
    if (role === undefined) return next(e)
    const root = (await $.session.root().catch(() => null)) ?? undefined
    const name = labels(langOf(ctx.options['uiLanguage'])).roleNames[role]
    let reason = roleDenial(role, e.tool, input, name, root)
    // Liên kết mềm (vòng 2 M12): công cụ sửa file của vai không phải build vào đích trong thư mục tạm mà đường dẫn thật ngoài thư mục tạm thì
    // từ chối như sửa ngoài thư mục tạm. Engine không trả realPath (không phải liên kết, hay chưa có tệp) thì giữ kết quả theo đường dẫn.
    if (reason === null && role !== 'build' && e.tool !== 'Bash') {
      const path = filePathOf({ tool: e.tool, input, isError: false, isReadOnly: false })
      const real = path !== '' ? await realOf($, path) : undefined
      if (real !== undefined && real !== path && !isRoleTemp(real)) reason = roleDenial(role, e.tool, { ...input, file_path: real }, name, root)
    }
    // Lệnh ghi mức definite của vai chỉ đọc vào đích trong thư mục tạm mà đường dẫn thật ngoài thư mục tạm (vòng 2 M12): từ chối.
    if (reason === null && READ_ONLY_ROLES.has(role) && e.tool === 'Bash') {
      const command = String(input['command'] ?? '')
      const definite = classifyBash(command, root).effects.flatMap(effect => (effect.kind === 'write' && effect.level === 'definite' ? effect.paths : []))
      const targets = definite.filter(isRoleTemp)
      // Lệnh vừa tạo liên kết mềm vừa ghi mức definite (kiểm độc lập vòng 1 lỗi 3): liên kết chưa có lúc xét nên không kiểm được đích thật.
      const makesLink = SYMLINK_MAKE.test(command) && definite.length > 0
      for (const target of makesLink ? [''] : targets.slice(0, 20)) {
        const real = makesLink ? '' : await realOf($, target)
        if (makesLink || (real !== undefined && real !== target && !isRoleTemp(real))) {
          reason = `[focus-conductor] Vai ${name} chỉ đọc, không sửa file ngoài thư mục tạm. Probe thì chép mã sang thư mục tạm rồi chạy ở đó; chỗ cần sửa thì báo luồng chính.`.slice(0, 200)
          break
        }
      }
    }
    if (reason === null) return next(e)
    record(await $.clock.now(), 'role-deny', { agentId: e.agentId, role, tool: e.tool })
    await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    return { deny: reason }
  }).catch(($, e, next) => (noteHookError('tool.call role', next.error), next(e)))

  // Agent khởi động mà không đi qua agent.spawn của mod: ghi để /conductor status báo là agent ngoài điều phối.
  // So khớp lúc đọc (không lúc khởi động), vì engine có thể báo khởi động trước khi agent.spawn của mod kịp ghi.
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)
    if (startedAgents.size < 1000) startedAgents.set(e.agent_id, e.agent_type)
    return result
  }).catch(($, e, next) => (noteHookError('classic.SubagentStart', next.error), next(e)))

  // Nguồn của lần đổi model phiên: người dùng (/model, picker, SDK) hay engine tự đổi (auto, resume).
  // Step đầu của turn sau đọc nó để quyết định có tạm dừng tự điều phối hay không.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    L.lastSwitch = { source: e.source, toModel: e.to_model }
    record(await $.clock.now(), 'model-switch', { source: e.source, from: e.from_model, to: e.to_model, requested: e.requested_model })
    await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    return result
  }).catch(($, e, next) => (noteHookError('classic.PostModelSwitch', next.error), next(e)))

  // Ghi nhận loại agent nào đang được mời dùng, để chỉ đổi sang Explore khi có.
  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (result.isOffered) offered.set(e.agent, e.description)
    else offered.delete(e.agent)
    return result
  }).catch(($, e, next) => (noteHookError('agent.offer', next.error), next(e)))

  // Subagent: việc đã phân dùng đúng lựa chọn của router; việc khác do router chấm khi giao
  // (kèm gợi ý model và loại agent Claude ghi, agent cha, các agent đã lỗi). Router lỗi thì giữ
  // lựa chọn của Claude. Mọi lựa chọn đều qua kiểm và kẹp theo chính sách.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, mode)
    // Phiên con chạy model và effort của luồng chính (engine bỏ qua model ghi trong lời gọi): mod không chấm, không ép. Option forks tắt
    // thì đi thẳng như trước 0.7.9.
    if (current === 'off' || (e.subagent_type === 'fork' && ctx.maxForks === 0)) return next(e)
    // Phiên con của việc tách (0.7.9 F1): khớp phần theo mã "Việc Na", không gọi router, không áp mức sàn W4. Lời gọi lỗi mà không có
    // agent.spawn fork nào cùng tool_use_id là engine từ chối phiên con; đã spawn rồi mới lỗi là phần lỗi.
    if (e.subagent_type === 'fork') {
      const core = S.normalizeCore(await read($, coreState))
      const brief = core.brief
      const isNested = e.agentId !== undefined
      const hit = !isNested && brief !== null && !brief.isReference ? taskMatch(brief.tasks, e.description) : {}
      const owner = hit.part !== undefined ? hit.task : undefined
      // Turn đã nhận báo hạn mức mềm: không mở phiên con mới.
      if (!isNested && L.noticeTurn !== null && L.noticeTurn === L.tracker.turnId) return { deny: FORK_QUOTA_DENY }
      // Lần giao "Sửa lỗi kiểm: " ở lượt 2 hay 3: phiên con không đổi được model nên không là lượt nâng; dặn giao subagent general-purpose.
      const fix = isNested ? null : retryFloorOf(core, e.description, e.subagent_type, e.prompt)
      L.forkCalls.set(e.tool_use_id, { spawned: false, ...(owner !== undefined && hit.part !== undefined ? { task: owner.index, part: hit.part } : {}) })
      if (owner !== undefined && hit.part !== undefined && brief !== null) {
        await update($, coreState, S.withForkStart(brief.goalId, { task: owner.index, part: hit.part, toolUseId: e.tool_use_id, agentId: null, state: 'running' }))
      }
      const result = await next(e)
      const call = L.forkCalls.get(e.tool_use_id)
      L.forkCalls.delete(e.tool_use_id)
      const notes: string[] = []
      if (fix !== null) notes.push(forkRetryNote())
      const at = await $.clock.now()
      const label = owner !== undefined && hit.part !== undefined ? { task: owner.index, part: hit.part } : null
      if (result.deny !== undefined) {
        // Lời gọi bị từ chối trước khi chạy (quyền, hạn mức): phần đó về luồng chính, không tính là lỗi.
        if (label !== null) await update($, coreState, S.withForkCall(e.tool_use_id, p => ({ ...p, state: 'returned' })))
      } else if (result.isError === true && call?.spawned !== true) {
        const fresh = S.normalizeCore(await read($, coreState))
        const isFirst = !L.forkRefused && fresh.forks.off !== 'engine'
        L.forkRefused = true
        const parts = owner !== undefined ? openParts(fresh, owner.index) : []
        await update($, coreState, S.withForksReturned(owner?.index ?? null))
        if (isFirst) {
          record(at, 'fork-off', { reason: 'engine', description: clipText(e.description, 120), error: clipText(String(result.text ?? result.result ?? ''), 200) })
          notes.push(forkReturnNote(owner?.index ?? null, parts))
        }
        if (label !== null) record(at, 'fork', { ...label, result: 'returned' })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
      } else if (result.isError === true && label !== null) {
        const part = liveForks(S.normalizeCore(await read($, coreState))).find(p => p.toolUseId === e.tool_use_id)
        if (part?.state === 'running') {
          await update($, coreState, S.withForkCall(e.tool_use_id, p => ({ ...p, state: 'failed' })))
          record(at, 'fork', { ...label, result: 'failed' })
          await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        }
      }
      if (result.deny !== undefined || notes.length === 0) return result
      return { ...result, context: [...(result.context ?? []), ...notes] }
    }
    // Model Claude ghi không thuộc họ Claude (model riêng của người dùng): cho qua nguyên vẹn.
    const claimed = e.model !== undefined ? familyOf(e.model) : null
    if (e.model !== undefined && claimed === null) return next(e)

    const core = S.normalizeCore(await read($, coreState))
    const brief = core.brief
    const goalId = brief?.goalId ?? 0
    const rules = policy()
    // Lời gọi từ trong một subagent không khớp việc của luồng chính và không đụng phần giao còn chờ;
    // prompt đối chiếu không có việc thật để giao.
    const isNested = e.agentId !== undefined
    const parent = e.agentId !== undefined ? agents.get(e.agentId) : undefined
    const matched = !isNested && brief !== null && !brief.isReference ? taskMatch(brief.tasks, e.description) : {}
    // Quy định model của loại việc (0.7.5); hai vế ngoại lệ khác họ cùng khớp (0.8.1 B3) thì ghi rule-conflict, null để router chấm.
    const ruled = async (constraints: readonly string[]) => {
      const conflict = ruleConflict(constraints, e.description, L.sessionFamily)
      if (conflict !== null) {
        record(await $.clock.now(), 'rule-conflict', { description: clipText(e.description), families: conflict.families, items: conflict.items })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
      }
      return ruleFamily(constraints, e.description, L.sessionFamily)
    }
    let assigned = matched.task
    let route: AgentRoute | null = null
    let reason: string
    const requested = EFFORTS.find(x => x === e.effort) ?? null
    const byPrefix = prefixRole(e.description)
    if (assigned !== undefined) {
      route = taskRoute(assigned, rules)
      reason = `việc ${assigned.index} đã phân trước${route.why ? `: ${route.why}` : ''}`
      if (claimed !== null && familyRank(claimed) < familyRank(route.pick.family)) reason += `; Claude ghi ${e.model}, dùng ${route.pick.family} đã phân`
    } else if (byPrefix !== undefined) {
      // Lời gọi theo tiền tố vai (0.9.0 B2): không qua router; model mặc định của vai, model Claude ghi vẫn là mức sàn (floorRoute).
      route = roleRoute(byPrefix, e.subagent_type, rules)
      reason = route.why
    } else if (isSettled(claimed, requested, rules)) {
      // Claude đã chốt cả họ (ở mức trần chính sách cho phép) lẫn effort (0.7.4): router không thể chọn khác, không gọi.
      reason = 'Claude đã chốt model và effort ở mức trần cho phép; không gọi router'
      record(await $.clock.now(), 'agent-floor', { description: clipText(e.description), skip: true, claimed: `${claimed}/${requested}` })
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    } else if (claimed !== null && claimed !== 'haiku' && brief !== null && !brief.isReference && (await ruled(brief.constraints)) === claimed) {
      // Model Claude ghi đúng quy định model của loại việc trong brief (0.7.5): router không được chọn khác, không gọi. Lựa chọn
      // vẫn qua chính sách (fitPick). Haiku không bỏ qua router: chỉ router biết việc có sửa file (haiku không sửa file) hay không.
      reason = `Claude ghi ${claimed} đúng quy định model của loại việc; không gọi router`
      route = ruleRoute(claimed, requested, rules)
      if (route !== null) reason += `; ${route.why}`
    } else if (!ctx.routerTarget(core, current).isFable && isAgentRouterPaused()) {
      reason = 'router đang tạm ngừng; giữ lựa chọn của Claude'
    } else {
      const failed = agentFailures.filter(f => f.goalId === goalId).map(f => f.description)
      const key = agentMemoKey(e.description, e.subagent_type, e.model, e.effort !== undefined ? String(e.effort) : undefined, codesOf(core))
      // Giao lại việc đã lỗi: hỏi lại router (nó thấy danh sách lỗi và tự nâng), không dùng kết quả nhớ.
      const known = failed.includes(e.description) ? undefined : agentRoutes.get(key)
      if (known !== undefined) {
        route = refit(known)
        reason = `router (đã chấm trước): ${known.why}`
      } else {
        L.agentCalls += 1
        const request = agentRouterRequest({
          description: e.description,
          prompt: e.prompt,
          subagentType: e.subagent_type,
          requested: { ...(e.model !== undefined ? { model: e.model } : {}), ...(e.effort !== undefined ? { effort: String(e.effort) } : {}) },
          goal: brief?.goal ?? null,
          parent: parent !== undefined ? { description: parent.description, pick: parent.pick } : null,
          failed: failed.slice(-5),
          isWorkflow: false,
          policy: rules,
          model: ctx.routerTarget(core, current).model,
          ...(ctx.routerTarget(core, current).isFable ? { isFable: true } : {}),
          tasks: isNested || brief === null || brief.isReference ? [] : brief.tasks,
          constraints: brief === null || brief.isReference ? [] : brief.constraints,
          sessionFamily: L.sessionFamily,
        })
        const startedAt = await $.clock.now()
        const outcome = await askRouter(r => $.model.complete(r), request, reply => parseAgentRoute(reply, rules))
        ctx.noteRouterFailure('agent', outcome.failure)
        noteRouterTime((await $.clock.now()) - startedAt)
        await update($, coreState, c =>
          S.withAnalyzerUsage(outcome.usages, ctx.routerTarget(core, current).family)(c),
        )
        route = outcome.result
        // Lỗi của router Fable có bộ đếm riêng (0.8.4 C6).
        const pauseText = ctx.routerTarget(core, current).isFable ? (await noteFableRouter($, ctx, route !== null, ctx.routerTarget(core, current).family), null) : noteAgentRouter(route !== null)
        if (route !== null) rememberAgentRoute(key, route)
        reason = route !== null ? `router: ${route.why}` : `router không chấm được (${outcome.reason}); giữ lựa chọn của Claude`
        if (pauseText !== null) {
          await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text: pauseText }))
          $.ui.toast(pauseText)
        }
      }
      // Router nhận ra lời gọi là một việc đã phân (dù description không ghi "Việc N"): dùng lựa chọn đã phân.
      const byRouter = isNested ? undefined : recognized(brief, route)
      if (byRouter !== undefined) {
        assigned = byRouter
        route = taskRoute(byRouter, rules)
        reason = `router nhận ra việc ${byRouter.index} đã phân${route.why ? `: ${route.why}` : ''}`
      }
    }
    // Model và effort Claude ghi là mức sàn (0.7.4): router, kết quả nhớ và việc đã phân chỉ được nâng; chính sách vẫn kẹp sau cùng.
    if (route !== null) {
      const floored = floorRoute(route, claimed, requested, rules)
      if (floored.notes.length > 0) {
        record(await $.clock.now(), 'agent-floor', {
          description: clipText(e.description),
          from: describePick(route.pick),
          to: describePick(floored.route.pick),
          claimed: e.model,
          ...(requested !== null ? { claimedEffort: requested } : {}),
        })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        route = floored.route
        reason += `; ${floored.notes.join('; ')}`
      }
    }
    // Lượt sửa lỗi kiểm (0.7.8 vòng sửa 3, W4): lần giao có description mở đầu "Sửa lỗi kiểm: ", hoặc general-purpose có prompt nhắc đúng
    // lệnh chưa đạt, chạy tối thiểu ở mức sàn của lượt; chỉ nâng, chính sách kẹp sau cùng. Lần giao khác giữ route.
    const retryFloor = isNested ? null : retryFloorOf(core, e.description, e.subagent_type, e.prompt)
    if (retryFloor !== null) {
      const from: AgentRoute | null = route
      const lifted: AgentRoute =
        from === null
          ? { pick: fitPick(retryFloor.floor, 'edit', rules).pick, agentType: 'general-purpose', depth: 'substantial', volume: 'small', kind: 'edit', tier: tierOf('substantial', 'small'), why: `sửa lỗi kiểm lượt ${retryFloor.round}/${RETRY_ROUNDS}` }
          : floorRoute(from, retryFloor.floor.family, retryFloor.floor.effort, rules).route
      route = lifted
      if (from === null || describePick(from.pick) !== describePick(lifted.pick)) {
        record(await $.clock.now(), 'agent-floor', {
          description: clipText(e.description),
          from: from === null ? null : describePick(from.pick),
          to: describePick(lifted.pick),
          retry: retryFloor.sig,
        })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
        reason += `; sàn của lượt sửa lỗi kiểm ${retryFloor.round}/${RETRY_ROUNDS}: ${describePick(lifted.pick)}`
      }
    }
    // Lần thử skill (0.8.2 N3) không chạy haiku: kẹp như việc sửa file, cả khi router chọn haiku lẫn khi Claude ghi haiku mà không có route.
    if (isSkillTrial(e.description)) {
      const from: AgentRoute | null = route
      if (from !== null && from.pick.family === 'haiku') {
        const fitted = fitPick(from.pick, 'edit', rules)
        route = { ...from, pick: fitted.pick, why: [from.why, 'thử skill không chạy haiku', ...fitted.notes].filter(Boolean).join('; ') }
        reason += `; thử skill không chạy haiku: ${describePick(fitted.pick)}`
      } else if (from === null && claimed === 'haiku') {
        const fitted = fitPick({ family: 'haiku', effort: requested ?? 'medium' }, 'edit', rules)
        route = { pick: fitted.pick, agentType: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit', tier: tierOf('light', 'small'), why: 'thử skill không chạy haiku' }
        reason += `; thử skill không chạy haiku: ${describePick(fitted.pick)}`
      }
    }
    // Việc đã phân được nhận: chuyển sang đang chạy (giao lại một việc đã lỗi cũng vậy).
    if (assigned !== undefined && brief !== null) {
      moveDelegation(brief.goalId, assigned.index, 'running')
      await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
    }
    // Lời gọi không khớp việc nào (0.8.0 A8): gắn vào việc của bước doing hiện tại (stepCovers) để pane hiện dưới việc ấy thay vì "Claude tự
    // giao". Chỉ đổi chỗ hiện; lựa chọn model, sàn W4 và danh sách việc giao không đổi. Không có bước doing gắn được thì giữ như cũ.
    let attachedTask: number | undefined
    if (assigned === undefined && matched.miss === undefined && !isNested && brief !== null && !brief.isReference) {
      for (const s of shownPlan(core).plan) {
        if (s.status !== 'doing') continue
        const covered = stepCovers(brief.tasks, s.title)
        if (covered !== undefined) {
          attachedTask = covered.index
          break
        }
      }
    }
    if (matched.miss !== undefined || attachedTask !== undefined) {
      record(await $.clock.now(), 'agent', {
        description: clipText(e.description),
        ...(matched.miss !== undefined ? { miss: matched.miss } : {}),
        ...(attachedTask !== undefined ? { attached: 'doing-step', task: attachedTask } : {}),
        ...(route?.role !== undefined ? { role: route.role } : {}),
        routed: route !== null,
      })
      await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
    }

    // Lập kế hoạch thuộc vai của Fable (0.8.4 C7): Agent Plan chạy fable/medium khi Fable sẵn sàng, sau các bước kẹp (việc đã phân,
    // kết quả nhớ, kết quả chấm), không kẹp theo allowFable; sessionModel ceiling hay fixed vẫn thắng.
    // Họ đang điều phối (0.8.7 F1): fable, hay họ dự phòng khi Fable không dùng được.
    const planConductor = e.subagent_type === 'Plan' ? ctx.activeConductorOf(core, current) : null
    if (route !== null && planConductor !== null) {
      const family = applySession(planConductor.family, rules.session)
      route = { ...route, pick: { family, effort: 'medium' }, why: [route.why, 'Plan theo vai điều phối'].filter(Boolean).join('; ') }
      reason += `; Plan theo vai điều phối: ${family}/medium`
    }
    const isApplied = route !== null && (current === 'auto' || current === 'subagents')
    // Họ model và effort thật sự gửi đi: lựa chọn của router khi áp dụng, nếu không thì của Claude.
    const sentFamily = isApplied && route !== null ? route.pick.family : claimed
    const sentEffort = isApplied && route !== null ? route.pick.effort : requested
    // Trường isolation của tool Agent (0.8.6 R2; lược đồ engine 2.1.296 và 2.1.322: "worktree" hay "remote"): có giá trị là subagent không chạy chung thư mục.
    const isolation = (e as unknown as Record<string, unknown>)['isolation']
    const isolated = typeof isolation === 'string' && isolation !== ''
    pendingAgents.set(e.tool_use_id, { route, reason, isApplied, description: e.description, sentFamily, sentEffort, isolated, ...(assigned !== undefined ? { taskIndex: assigned.index } : attachedTask !== undefined ? { taskIndex: attachedTask } : {}) })
    // Đổi loại agent chỉ khi Claude để general-purpose và engine đã mời loại router chọn.
    const isGeneral = e.subagent_type === undefined || e.subagent_type === 'general-purpose'
    const swap = isApplied && route !== null && isGeneral && route.agentType !== 'general-purpose' && offered.has(route.agentType)
    const result = await next(
      !isApplied || route === null
        ? e
        : { ...e, model: route.pick.family, effort: route.pick.effort, ...(swap ? { subagent_type: route.agentType } : {}) },
    )
    // Fan-out (0.7.5): chỉ lời gọi chạy thật ở luồng chính (không bị từ chối, không lỗi, không lồng từ subagent); cảnh báo đếm
    // lời gọi không khớp việc đã phân.
    if (!isNested && result.deny === undefined && result.isError !== true) {
      const spawned = await update($, coreState, S.withLedger(ledger => countSpawn(ledger, assigned === undefined)))
      const unplanned = spawned.ledger.goal.unplanned ?? 0
      if (unplanned > FANOUT_WARN && !spawned.ledger.goal.fanoutWarned) {
        const at = await $.clock.now()
        const text = `Mục tiêu này đã giao ${unplanned} subagent; mỗi agent có chi phí riêng, xem /conductor status`
        await update($, coreState, c =>
          S.withWarnings({ at, kind: 'cost', text })(
            S.withLedger(ledger => ({ ...ledger, goal: { ...ledger.goal, fanoutWarned: true } }))(c),
          ),
        )
        $.ui.toast(text)
      }
    }
    // Lần thử skill (0.8.2 N3): kết quả tool Agent bị từ chối hay lỗi thì không là bằng chứng; đã tính ở turn.complete thì trả lại mốc cũ.
    if (isSkillTrial(e.description)) {
      const prior = L.trialCounted.get(e.tool_use_id)
      L.trialCounted.delete(e.tool_use_id)
      if (prior !== undefined && brief !== null && (result.deny !== undefined || result.isError === true)) await update($, coreState, S.withSkillTrial(brief.goalId, prior))
    }
    // Lời gọi Agent bị từ chối hoặc lỗi trước khi agent chạy: việc trở lại danh sách chờ giao.
    if (assigned !== undefined && brief !== null && (result.deny !== undefined || result.isError === true) && L.delegation.running.has(assigned.index)) {
      pendingAgents.delete(e.tool_use_id)
      moveDelegation(brief.goalId, assigned.index, 'pending')
      await update($, coreState, S.withDelegations(brief.goalId, delegationItems(brief)))
    }
    // Vai điều phối (0.8.6 R6): lời gọi Agent của luồng chính bị từ chối hay lỗi mà không sinh subagent nào (engine, quyền, plugin khác;
    // lời từ chối của chính mod đến từ hook đăng ký trước nên không tới đây) bật cờ miễn; lời gọi đã sinh subagent thì tắt cờ.
    const isSpawned = spawnedCalls.delete(e.tool_use_id)
    if (!isNested && brief !== null) {
      const isRefused = !isSpawned && (result.deny !== undefined || result.isError === true)
      const now = S.normalizeCore(await read($, coreState))
      if (ctx.isConducting(now, current) && S.conductOf(now).agentDenied !== isRefused) {
        await update($, coreState, S.withConduct(brief.goalId, () => ({ agentDenied: isRefused })))
        record(await $.clock.now(), 'conduct-exempt', { state: isRefused ? 'on' : 'off', reason: 'agent' })
        await flushDecisions((path, text) => $.fs.write(path, text), path => $.fs.read(path))
      }
    }
    return result
  }).catch(($, e, next) => (noteHookError('tool.call', next.error), next(e)))

  // Ghi điều phối của subagent ngay khi nó khởi động (trước mọi await, để step đầu đã thấy), rồi ghi
  // nhật ký bằng model engine thực sự dùng, kèm chi phí ước tính. Model engine chạy khác model đã điều
  // phối (agent của Agent tool) thì ghi và cảnh báo. Agent của workflow không đi qua tool.call: router
  // chấm nó trước khi nó khởi động (trừ khi script đã chọn model), rồi mod ép ở từng bước.
  on('agent.spawn', async ($, e, next) => {
    const info = pendingAgents.get(e.tool_use_id)
    pendingAgents.delete(e.tool_use_id)
    const current = await read($, mode)
    const isModeApplied = current === 'auto' || current === 'subagents'
    const isWorkflow = e.workflow !== undefined
    const isScriptModel = isWorkflow && e.model !== undefined
    const core = S.normalizeCore(await read($, coreState))
    const goalId = core.brief?.goalId ?? 0
    const rules = policy()
    let workflowRoute: AgentRoute | null = null
    let workflowReason = ''
    let workflowTask: number | undefined
    if (info === undefined && isWorkflow && !isScriptModel && current !== 'off') {
      const key = agentMemoKey(e.description, e.subagentType, undefined, undefined, codesOf(core))
      // Việc vừa lỗi trong mục tiêu này thì router chấm lại (nó thấy danh sách lỗi và tự nâng).
      const failedHere = agentFailures.some(f => f.goalId === goalId && f.description === e.description)
      const known = failedHere ? undefined : agentRoutes.get(key)
      if (known !== undefined) {
        workflowRoute = refit(known)
        workflowReason = `router (đã chấm trước): ${known.why}`
      } else if (!ctx.routerTarget(core, current).isFable && isAgentRouterPaused()) {
        workflowReason = 'router đang tạm ngừng'
      } else {
        L.agentCalls += 1
        const brief = core.brief
        const request = agentRouterRequest({
          description: e.description,
          prompt: e.prompt,
          subagentType: e.subagentType,
          requested: {},
          goal: brief?.goal ?? null,
          parent: null,
          failed: agentFailures.filter(f => f.goalId === goalId).map(f => f.description).slice(-5),
          isWorkflow: true,
          policy: rules,
          model: ctx.routerTarget(core, current).model,
          ...(ctx.routerTarget(core, current).isFable ? { isFable: true } : {}),
          tasks: brief === null || brief.isReference ? [] : brief.tasks,
          constraints: brief === null || brief.isReference ? [] : brief.constraints,
          sessionFamily: L.sessionFamily,
        })
        const startedAt = await $.clock.now()
        const outcome = await askRouter(r => $.model.complete(r), request, reply => parseAgentRoute(reply, rules))
        ctx.noteRouterFailure('agent', outcome.failure)
        noteRouterTime((await $.clock.now()) - startedAt)
        await update($, coreState, c =>
          S.withAnalyzerUsage(outcome.usages, ctx.routerTarget(core, current).family)(c),
        )
        workflowRoute = outcome.result
        // Lỗi của router Fable có bộ đếm riêng (0.8.4 C6).
        const pauseText = ctx.routerTarget(core, current).isFable ? (await noteFableRouter($, ctx, workflowRoute !== null, ctx.routerTarget(core, current).family), null) : noteAgentRouter(workflowRoute !== null)
        if (workflowRoute !== null) rememberAgentRoute(key, workflowRoute)
        workflowReason = workflowRoute !== null ? `router: ${workflowRoute.why}` : `router không chấm được (${outcome.reason})`
        if (pauseText !== null) {
          await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text: pauseText }))
          $.ui.toast(pauseText)
        }
        const byRouter = recognized(brief, workflowRoute)
        if (byRouter !== undefined) {
          workflowRoute = taskRoute(byRouter, rules)
          workflowReason = `router nhận ra việc ${byRouter.index} đã phân${workflowRoute.why ? `: ${workflowRoute.why}` : ''}`
          if (brief !== null) moveDelegation(brief.goalId, byRouter.index, 'running')
          workflowTask = byRouter.index
        }
      }
    }

    // Mẫu báo cáo theo vai (0.9.0 C4): lời giao subagent có vai được nối một dòng nêu mẫu báo cáo và dòng kết luận đứng đầu câu trả lời.
    // Vai do mod suy (0.9.0 B): tiền tố, rồi vai của việc đã phân, rồi loại agent và loại việc của kết quả chấm.
    const spawnRoute = info?.route ?? workflowRoute
    const spawnRole = roleOfCall(spawnRoute?.role ?? (spawnRoute !== null && spawnRoute !== undefined ? roleOf(spawnRoute.agentType, spawnRoute.kind) : undefined), info?.description ?? e.description)
    // Dòng mẫu báo cáo (0.9.0 C4): lời gọi có tiền tố vai, hay việc có vai khi đội hình của mục tiêu đã bật (0.9.0 C); còn lại như 0.8.9.
    const spawnCore = S.normalizeCore(await read($, coreState))
    const isTeamOn = spawnCore.team !== undefined && spawnCore.brief !== null && spawnCore.team.goalId === spawnCore.brief.goalId
    const isReported = spawnRole !== undefined && e.fork !== true && (prefixRole(info?.description ?? e.description) !== undefined || isTeamOn)
    const reportSuffix = isReported && spawnRole !== undefined ? `\n\n${reportLine(spawnRole, langOf(ctx.options['uiLanguage']))}` : ''
    // Dấu file lúc sinh chụp trước next() (vòng sửa cuối 18/11, A2): next() trả về khi subagent đã khởi chạy, nên chụp sau đó có thể đã mang
    // thay đổi của chính lượt. Chụp cho mọi lượt có thể cho kết luận được tính (không phải phiên con fork, không tiền tố audit, model dự kiến
    // không phải haiku); sau next() mà hóa ra haiku hay phiên con thì bỏ bản ghi. Tập rỗng thì không gọi fs.
    const expected = info?.sentFamily ?? spawnRoute?.pick.family ?? null
    const preGoal = spawnCore.brief?.goalId
    const isPrinted = e.fork !== true && preGoal !== undefined && prefixRole(info?.description ?? e.description) !== 'audit' && expected !== 'haiku'
    const preTargets = isPrinted ? printTargets(S.changedOf(spawnCore).paths, spawnCore.brief) : null
    const prePrints = preTargets === null ? undefined : preTargets.files.length === 0 ? {} : await takePrints({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) as Promise<string> }, preTargets.files, (await $.session.root().catch(() => null)) ?? null).catch(() => null)
    const preSeq = preGoal !== undefined ? ctx.evidenceFor(preGoal).seq : 0
    // Danh sách file của phạm vi trước lượt (vòng 2 M13): lượt có vai chỉ đọc hay vai kiểm, theo tiền tố hay vai của việc.
    const listRole = prefixRole(info?.description ?? e.description) ?? spawnRole
    const isListed = e.fork !== true && preGoal !== undefined && (listRole === 'review' || listRole === 'design' || listRole === 'audit' || listRole === 'search')
    const preList = isListed ? await listScope({ list: (path?: string) => $.fs.list(path) }, scopeRoots(spawnCore.brief?.scopePaths, (await $.session.root().catch(() => null)) ?? null)) : null
    const result = await next(reportSuffix !== '' ? { ...e, prompt: `${e.prompt}${reportSuffix}` } : e)
    if (result.deny !== undefined) return result
    // Phiên con (0.7.9 F1): lời gọi Agent đã có spawn, nên lỗi về sau là lỗi của phần đó, không phải engine từ chối.
    const forkCall = e.fork === true ? L.forkCalls.get(e.tool_use_id) : undefined
    if (forkCall !== undefined) forkCall.spawned = true
    const forkPart = forkCall?.task !== undefined && forkCall.part !== undefined ? { task: forkCall.task, part: forkCall.part } : null
    const agentId = result.agentId
    if (agentId !== undefined && preList !== null && preGoal !== undefined && L.scopeLists.size < 100) L.scopeLists.set(agentId, { goalId: preGoal, files: preList })
    const route = info?.route ?? workflowRoute
    const isMissed = agentId !== undefined && steppedEarly.has(agentId)
    const applied = (info !== undefined ? info.isApplied : workflowRoute !== null && isModeApplied) && !isMissed
    const engineFamily = familyOf(result.model)
    const family = engineFamily ?? info?.sentFamily ?? route?.pick.family ?? 'sonnet'
    // Ghi ngay, không await xen giữa: step đầu của agent phải thấy điều phối này.
    if (agentId !== undefined && (info !== undefined || workflowRoute !== null)) {
      agents.set(agentId, {
        description: info?.description ?? e.description,
        tier: route?.tier ?? core.brief?.tier ?? 'moderate',
        goalId,
        family,
        volume: route?.volume ?? 'small',
        shape: route !== null ? shapeKey(route.depth, route.volume, route.kind) : null,
        // Agent của Agent tool được ép về họ và effort đã gửi lúc spawn; agent workflow về lựa chọn của router.
        pick: {
          family: info?.sentFamily ?? route?.pick.family ?? family,
          effort: info?.sentEffort ?? route?.pick.effort ?? 'medium',
        },
        applied,
        enforceModel: info === undefined ? true : info.sentFamily !== null,
        warned: false,
        fallback: false,
        ...(info?.taskIndex !== undefined ? { taskIndex: info.taskIndex } : workflowTask !== undefined ? { taskIndex: workflowTask } : {}),
        // Chung thư mục với luồng chính (0.8.6 R2): chỉ biết được với agent của tool Agent.
        ...(info !== undefined ? { sharesDir: info.isolated !== true } : {}),
        // Vai do mod suy (0.9.0 B): tiền tố, của việc đã phân, hay của loại agent và loại việc (spawnRole).
        ...(spawnRole !== undefined ? { role: spawnRole } : {}),
      })
    } else if (agentId !== undefined && forkPart !== null) {
      // Phiên con của một phần: lệnh và thay đổi của nó vào dấu vết như subagent, kiểm phạm vi theo files của phần; không ép model.
      const main = L.turnRoute.route
      agents.set(agentId, {
        description: e.description,
        tier: core.brief?.tier ?? 'moderate',
        goalId,
        family,
        volume: 'large',
        shape: null,
        pick: main !== null ? { family: main.family, effort: main.effort } : { family, effort: 'medium' },
        applied: false,
        enforceModel: false,
        warned: false,
        fallback: false,
      })
    }
    // Subagent thử skill (0.8.2 N3): turn.complete của nó tính lần thử, kết quả tool Agent lỗi trả lại mốc theo tool_use_id.
    if (agentId !== undefined && isSkillTrial(info?.description ?? e.description) && L.skillTrials.size < 100) L.skillTrials.set(agentId, e.tool_use_id)
    // Subagent đang chạy (0.8.0 A5): chưa trả về thì cảnh báo chưa kiểm cuối turn và cổng Y6 được hoãn.
    if (agentId !== undefined && L.liveAgents.size < 1000) L.liveAgents.add(agentId)
    if (agentId !== undefined) {
      steppedEarly.delete(agentId)
      if (spawnedIds.size < 1000) spawnedIds.add(agentId)
      // Lời gọi Agent đã sinh subagent (0.8.6 R6): lỗi về sau là lỗi của subagent, không bật cờ miễn của vai điều phối.
      if (e.tool_use_id !== undefined && spawnedCalls.size < 1000) spawnedCalls.add(e.tool_use_id)
    }
    if (workflowTask !== undefined && core.brief !== null) await update($, coreState, S.withDelegations(core.brief.goalId, delegationItems(core.brief)))
    if (forkPart !== null && agentId !== undefined) await update($, coreState, S.withForkCall(e.tool_use_id, p => ({ ...p, agentId })))
    // Ghi bản chụp lúc sinh (vòng sửa cuối 18/11, A2, A3): điều kiện theo hành vi, không theo vai; model đã chạy từ sonnet, không phải phiên con.
    if (agentId !== undefined && forkPart === null && prePrints !== undefined && preGoal !== undefined && family !== 'haiku') {
      if (preTargets?.isCapped === true) record(await $.clock.now(), 'print-cap', { goalId: preGoal, files: PRINT_FILES })
      await update($, printState, state => withSpawnSeq(withPrint(normalizeReviewPrints(state), preGoal, 'spawn', agentId, prePrints), preGoal, agentId, preSeq))
    }

    const sent = info?.sentFamily ?? null
    const isMismatch = info !== undefined && sent !== null && engineFamily !== null && engineFamily !== sent
    const shortId = agentId?.slice(0, 6) ?? '?'
    const base = isMismatch
      ? `${info.reason}; engine chạy ${engineFamily} thay vì ${sent}`
      : info !== undefined
        ? info.reason
        : isWorkflow
          ? isScriptModel
            ? 'agent workflow, model do script chọn'
            : `agent workflow: ${workflowReason || 'không qua điều phối'}`
          : forkPart !== null
            ? `phiên con của Việc ${forkPart.task}${forkPart.part}, chạy model của luồng chính`
            : 'không qua điều phối'
    const reason = isMissed ? `${base}; bước đầu đã chạy trước khi mod kịp ghi, không ép` : base
    const at = await $.clock.now()
    const effort = info?.sentEffort ?? route?.pick.effort
    const estimate =
      route !== null
        ? turnCost(
            family,
            effort ?? route.pick.effort,
            route.volume,
            Math.ceil(e.prompt.length / 4),
            core.ledger.calib[family],
            shapeOutput(core.ledger, shapeKey(route.depth, route.volume, route.kind), effort ?? route.pick.effort),
          )
        : undefined
    const entry: RouteEvent = {
      at,
      where: 'agent',
      label: e.description || e.subagentType,
      family,
      ...(effort !== undefined && effort !== null ? { effort } : {}),
      agentType: e.subagentType,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(estimate !== undefined ? { usd: estimate, measured: false } : {}),
      reason,
      isApplied: applied,
    }
    const warnings: Warning[] = []
    const mismatchText = `Agent ${shortId}: engine chạy ${engineFamily} thay vì ${sent} đã điều phối`
    if (isMismatch) warnings.push({ at, kind: 'model', text: mismatchText })
    // Tiến độ từng việc (0.6.1): mỗi lần gọi Agent có agentId là một dòng, gắn việc đã phân nếu có; lưu trong $.state.
    const taskIndex = info?.taskIndex ?? workflowTask ?? forkPart?.task
    const progressItem: AgentProgress | null =
      agentId !== undefined
        ? {
            agentId,
            title: info?.description ?? (e.description || e.subagentType),
            ...(taskIndex !== undefined ? { taskIndex } : {}),
            family,
            ...(effort !== undefined && effort !== null ? { effort } : {}),
            state: 'running',
            tools: 0,
            startedAt: at,
            steps: [],
          }
        : null
    await update($, coreState, c => {
      const logged = S.withWarnings(...warnings)(S.withLog(entry)(c))
      return progressItem !== null ? S.withAgentStart(goalId, progressItem)(logged) : logged
    })
    if (isMismatch) $.ui.toast(mismatchText)
    // Lượt có tiền tố duyệt hay sẵn sàng vừa sinh (vòng 2 M18, M20): vẽ lại status line để nó nói cùng câu đang duyệt với band và pane.
    const spawnPrefix = prefixRole(info?.description ?? e.description)
    if (progressItem !== null && (spawnPrefix === 'review' || spawnPrefix === 'design')) {
      const view = await read($, derive([coreState, modeState, bandHiddenState], viewOf(ctx.options)))
      $.ui.status(statusTextOf(view, normalizeQuota(await read($, quotaState)), await $.clock.now(), quotaSettings(ctx.options)))
    }
    return result
  }).catch(($, e, next) => (noteHookError('agent.spawn', next.error), next(e)))
}
