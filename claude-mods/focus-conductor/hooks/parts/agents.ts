// Subagent: agent ngoài điều phối, nguồn đổi model, loại agent engine mời, lời gọi Agent, agent.spawn.

import { atom, derive, read, update } from 'claude-code'
import type { RouteEvent, Warning } from '../../types'
import { turnCost } from '../lib/cost'
import { addUsage, countSpawn, shapeKey, shapeOutput } from '../lib/ledger'
import { EFFORTS, familyOf, taskMatch } from '../lib/route'
import { clipText } from '../lib/decisions'
import { agentRouterRequest, askRouter, parseAgentRoute, taskRoute } from '../lib/router'
import type { AgentRoute } from '../lib/router'
import * as S from '../lib/state'
import type { On } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf } from '../atoms'
import { FANOUT_WARN } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

export function registerAgents(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { agentFailures, agentRoutes, agents, decisionLog, decisionText, isAgentRouterPaused, noteAgentRouter, offered, pendingAgents, policy, recognized, record, refit, rememberAgentRoute, routerFamily, routerModel, spawnedIds, startedAgents, steppedEarly } = ctx
  const mode = derive([modeState], modeOf(ctx.options))

  // Agent khởi động mà không đi qua agent.spawn của mod: ghi để /conductor status báo là agent ngoài điều phối.
  // So khớp lúc đọc (không lúc khởi động), vì engine có thể báo khởi động trước khi agent.spawn của mod kịp ghi.
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)
    if (startedAgents.size < 1000) startedAgents.set(e.agent_id, e.agent_type)
    return result
  }).catch(($, e, next) => next(e))

  // Nguồn của lần đổi model phiên: người dùng (/model, picker, SDK) hay engine tự đổi (auto, resume).
  // Step đầu của turn sau đọc nó để quyết định có tạm dừng tự điều phối hay không.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    L.lastSwitch = { source: e.source, toModel: e.to_model }
    record(await $.clock.now(), 'model-switch', { source: e.source, from: e.from_model, to: e.to_model, requested: e.requested_model })
    if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // Ghi nhận loại agent nào đang được mời dùng, để chỉ đổi sang Explore khi có.
  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (result.isOffered) offered.set(e.agent, e.description)
    else offered.delete(e.agent)
    return result
  }).catch(($, e, next) => next(e))

  // Subagent: việc đã phân dùng đúng lựa chọn của router; việc khác do router chấm khi giao
  // (kèm gợi ý model và loại agent Claude ghi, agent cha, các agent đã lỗi). Router lỗi thì giữ
  // lựa chọn của Claude. Mọi lựa chọn đều qua kiểm và kẹp theo chính sách.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.subagent_type === 'fork') return next(e)
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
    let assigned = matched.task
    let route: AgentRoute | null = null
    let reason: string
    if (assigned !== undefined) {
      route = taskRoute(assigned, rules)
      reason = `việc ${assigned.index} đã phân trước${route.why ? `: ${route.why}` : ''}`
      if (e.model !== undefined && claimed !== route.pick.family) reason += `; Claude ghi ${e.model}, dùng ${route.pick.family} đã phân`
    } else if (isAgentRouterPaused()) {
      reason = 'router đang tạm ngừng; giữ lựa chọn của Claude'
    } else {
      const failed = agentFailures.filter(f => f.goalId === goalId).map(f => f.description)
      const key = `${e.description}\n${e.prompt}`
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
          model: routerModel,
          tasks: isNested || brief === null || brief.isReference ? [] : brief.tasks,
        })
        const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseAgentRoute(reply, rules))
        await update($, coreState, c =>
          outcome.usages.reduce((acc, usage) => S.withLedger(ledger => addUsage(ledger, 'analyzer', routerFamily, usage).ledger)(acc), c),
        )
        route = outcome.result
        const pauseText = noteAgentRouter(route !== null)
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
    if (assigned !== undefined && brief !== null && L.delegation.goalId === brief.goalId) L.delegation.pending.delete(assigned.index)
    if (assigned === undefined && matched.miss !== undefined) {
      record(await $.clock.now(), 'agent', { description: clipText(e.description), miss: matched.miss, routed: route !== null })
      if (decisionLog) await $.fs.write(decisionLog, decisionText()).catch(() => undefined)
    }

    const isApplied = route !== null && (current === 'auto' || current === 'subagents')
    const requested = EFFORTS.find(x => x === e.effort) ?? null
    // Họ model và effort thật sự gửi đi: lựa chọn của router khi áp dụng, nếu không thì của Claude.
    const sentFamily = isApplied && route !== null ? route.pick.family : claimed
    const sentEffort = isApplied && route !== null ? route.pick.effort : requested
    pendingAgents.set(e.tool_use_id, { route, reason, isApplied, description: e.description, sentFamily, sentEffort })
    const spawned = await update($, coreState, S.withLedger(countSpawn))
    if (spawned.ledger.goal.spawned > FANOUT_WARN && !spawned.ledger.goal.fanoutWarned) {
      const at = await $.clock.now()
      const text = `Mục tiêu này đã giao ${spawned.ledger.goal.spawned} subagent; mỗi agent có chi phí riêng, xem /conductor status`
      await update($, coreState, c =>
        S.withWarnings({ at, kind: 'cost', text })(
          S.withLedger(ledger => ({ ...ledger, goal: { ...ledger.goal, fanoutWarned: true } }))(c),
        ),
      )
      $.ui.toast(text)
    }
    if (!isApplied || route === null) return next(e)

    // Đổi loại agent chỉ khi Claude để general-purpose và engine đã mời loại router chọn.
    const isGeneral = e.subagent_type === undefined || e.subagent_type === 'general-purpose'
    const swap = isGeneral && route.agentType !== 'general-purpose' && offered.has(route.agentType)
    return next({
      ...e,
      model: route.pick.family,
      effort: route.pick.effort,
      ...(swap ? { subagent_type: route.agentType } : {}),
    })
  })

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
    if (info === undefined && isWorkflow && !isScriptModel && current !== 'off') {
      const key = `${e.description}\n${e.prompt}`
      // Việc vừa lỗi trong mục tiêu này thì router chấm lại (nó thấy danh sách lỗi và tự nâng).
      const failedHere = agentFailures.some(f => f.goalId === goalId && f.description === e.description)
      const known = failedHere ? undefined : agentRoutes.get(key)
      if (known !== undefined) {
        workflowRoute = refit(known)
        workflowReason = `router (đã chấm trước): ${known.why}`
      } else if (isAgentRouterPaused()) {
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
          model: routerModel,
          tasks: brief === null || brief.isReference ? [] : brief.tasks,
        })
        const outcome = await askRouter(r => $.model.complete(r).catch(() => null), request, reply => parseAgentRoute(reply, rules))
        await update($, coreState, c =>
          outcome.usages.reduce((acc, usage) => S.withLedger(ledger => addUsage(ledger, 'analyzer', routerFamily, usage).ledger)(acc), c),
        )
        workflowRoute = outcome.result
        const pauseText = noteAgentRouter(workflowRoute !== null)
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
          if (brief !== null && L.delegation.goalId === brief.goalId) L.delegation.pending.delete(byRouter.index)
        }
      }
    }

    const result = await next(e)
    if (result.deny !== undefined) return result
    const agentId = result.agentId
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
      })
    }
    if (agentId !== undefined) {
      steppedEarly.delete(agentId)
      if (spawnedIds.size < 1000) spawnedIds.add(agentId)
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
    await update($, coreState, c => S.withWarnings(...warnings)(S.withLog(entry)(c)))
    if (isMismatch) $.ui.toast(mismatchText)
    return result
  }).catch(($, e, next) => next(e))
}
