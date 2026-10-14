// Điều phối luồng chính và subagent lúc chạy: turn.start, turn.step (ép model + effort).

import { atom, derive, read, update } from 'claude-code'
import type { ModelFamily, Warning } from '../../types'
import { newTracker } from '../lib/drift'
import { DEFAULT_CONTEXT, fixedContextTokens } from '../lib/cost'
import { EFFORTS, familyOf, resolveModelId } from '../lib/route'
import * as S from '../lib/state'
import type { EngineInterface, On, TurnStepInput } from 'claude-code'
import type { Ctx } from '../context'
import { modeOf, viewOf } from '../atoms'
import { BLOCK_TURNS, DEFAULT_WINDOW, FAIL_LIMIT } from '../context'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

/**
 * Đầu turn luồng chính: ghi vào cơ sở so với chạy thuần model và effort của phiên (engine gửi) cùng lượt mod phục vụ
 * (`served`; null là đúng lựa chọn của engine), và phần ghi cache mà chạy thuần đọc được.
 */
async function markBaseline(
  $: EngineInterface,
  e: TurnStepInput,
  served: { family: ModelFamily; effort: string } | null,
  context: number,
  isCacheFree: Ctx['isCacheFree'],
): Promise<void> {
  const engine = { family: familyOf(e.model), effort: String(e.effort ?? '') }
  const core = S.normalizeCore(await read($, coreState))
  const pair = served ?? (engine.family !== null ? { family: engine.family, effort: engine.effort } : null)
  await update($, coreState, S.withBaseline({ turnId: e.turnId, session: engine, served: pair, context, isFree: isCacheFree(core, await $.clock.now(), context) }))
}

export function registerTurn(on: On, ctx: Ctx): void {
  const L = ctx.local
  const { agents, blocked, blockedUntil, decideTurn, expireBlocks, failures, isCacheFree, modelMap, steppedEarly } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))
  const mode = derive([modeState], modeOf(ctx.options))

  // ------------------------------------- 2. điều phối model / effort

  on('turn.start', async ($, e, next) => {
    L.tracker = newTracker(e.turnId)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const current = await read($, mode)
    // Subagent: ép effort (và model, với agent workflow không do script chọn) theo điều phối đã ghi.
    if (e.agentId !== undefined) {
      const agent = agents.get(e.agentId)
      // Step chạy trước khi agent.spawn kịp ghi điều phối: đánh dấu để không ép model về sau.
      if (agent === undefined && (current === 'auto' || current === 'subagents') && steppedEarly.size < 500) steppedEarly.add(e.agentId)
      const isEnforced =
        agent !== undefined && agent.applied && !agent.fallback && (current === 'auto' || current === 'subagents')
      if (agent === undefined || !isEnforced) {
        // Không ép: vẫn ghi effort thật engine gửi, để hiệu chỉnh chi phí theo đúng thực tế.
        const real = EFFORTS.find(x => x === e.effort)
        if (agent !== undefined && real !== undefined) agent.sentEffort = real
        return yield* next(e)
      }
      const effort = agent.pick.effort
      const model = agent.enforceModel ? resolveModelId(agent.pick.family, e.model, modelMap) : e.model
      const sent = EFFORTS.find(x => x === effort)
      if (sent !== undefined) agent.sentEffort = sent
      if (model === e.model && effort === e.effort) return yield* next(e)
      if (!agent.warned) {
        agent.warned = true
        const text = `Agent ${e.agentId.slice(0, 6)}: mod ép về ${model}/${effort} đã điều phối (engine gửi ${e.model}/${e.effort ?? 'mặc định'})`
        await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text }))
      }
      const stream = next({ ...e, model, effort })
      let chunks = 0
      try {
        for await (const chunk of stream) {
          chunks += 1
          yield chunk
        }
        const result = await stream.result
        const isEmpty = result.stopReason === null && result.usage === null
        if (!isEmpty || !agent.enforceModel || chunks > 0 || next.signal.aborted) return result
      } catch (error) {
        if (!agent.enforceModel || chunks > 0 || next.signal.aborted) throw error
      }
      // Model được chọn cho agent workflow không phản hồi: agent này quay về model của engine.
      agent.fallback = true
      const text = `Agent ${e.agentId.slice(0, 6)}: ${model} không phản hồi; agent này quay về model của engine`
      await update($, coreState, S.withWarnings({ at: await $.clock.now(), kind: 'model', text }))
      $.ui.toast(text)
      return yield* next(e)
    }
    // Chế độ subagents/off không chạm luồng chính. Subagents vẫn ghi model của phiên làm cơ sở so với chạy thuần.
    if (current === 'off' || current === 'subagents') {
      L.sessionFamily = familyOf(e.model) ?? L.sessionFamily
      if (current === 'subagents' && L.turnRoute.turnId !== e.turnId) {
        L.turnRoute = { turnId: e.turnId, route: null }
        await markBaseline($, e, null, L.turnContext, isCacheFree)
      }
      return yield* next(e)
    }

    if (L.turnRoute.turnId !== e.turnId) {
      L.turnCount += 1
      expireBlocks()
      L.sessionFamily = familyOf(e.model)
      const usage = await $.session.usage().catch(() => null)
      L.turnContext = usage?.context.tokens ?? DEFAULT_CONTEXT
      L.lastWindow = usage?.context.window ?? DEFAULT_WINDOW
      // Đo một lần phần cố định của ngữ cảnh (ước lượng cục bộ của engine, không tốn request).
      if (S.normalizeCore(await read($, coreState)).sysTokens === 0) {
        const detail = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
        const fixed = fixedContextTokens(detail?.context.breakdown?.categories)
        if (fixed !== null) await update($, coreState, S.withSysTokens(fixed))
      }
      const decided = decideTurn({
        core: S.normalizeCore(await read($, coreState)),
        model: e.model,
        effort: String(e.effort ?? ''),
        current,
        at: await $.clock.now(),
        context: L.turnContext,
        window: L.lastWindow,
      })
      L.turnRoute = { turnId: e.turnId, route: decided.route }
      // Lượt mod phục vụ: route đã áp (chế độ auto) hoặc đúng model và effort engine gửi.
      const served = current === 'auto' && decided.route !== null ? { family: decided.route.family, effort: decided.route.effort } : null
      await update($, coreState, c => S.withLog(...decided.logs)(S.withRoute(decided.stored)(c)))
      await markBaseline($, e, served, L.turnContext, isCacheFree)
      for (const notice of decided.notices) $.ui.toast(notice)
      $.ui.status(S.statusOf(await read($, view)))
    }
    const route = L.turnRoute.route
    if (route === null || current === 'suggest') return yield* next(e)

    // Chốt model + effort cho mọi step của turn: đổi giữa chừng sẽ mất cache.
    const input = { ...e, model: resolveModelId(route.family, e.model, modelMap), effort: route.effort }
    const isOverridden = input.model !== e.model
    const stream = next(input)
    let chunks = 0
    try {
      for await (const chunk of stream) {
        chunks += 1
        yield chunk
      }
      const result = await stream.result
      const isEmpty = result.stopReason === null && result.usage === null
      if (!isEmpty) failures.delete(route.family)
      if (!isOverridden || !isEmpty || chunks > 0 || next.signal.aborted) return result
    } catch (error) {
      if (!isOverridden || chunks > 0 || next.signal.aborted) throw error
    }

    // Model được chọn không phản hồi (không có quyền, bị chặn, sai ID, hoặc
    // lỗi tạm thời): quay về model của engine cho phần còn lại của turn. Chỉ
    // chặn họ model khi lỗi ở hai turn liên tiếp.
    const previous = failures.get(route.family)
    const count = previous && L.turnCount - previous.lastTurn <= 1 ? previous.count + 1 : 1
    failures.set(route.family, { count, lastTurn: L.turnCount })
    const isBlocked = count >= FAIL_LIMIT
    if (isBlocked) {
      blocked.add(route.family)
      blockedUntil.set(route.family, L.turnCount + BLOCK_TURNS)
    }
    L.turnRoute = { turnId: e.turnId, route: null }
    const text = isBlocked
      ? `${input.model} không phản hồi ${count} turn liên tiếp; quay về ${e.model} và tạm ngừng dùng ${route.family} trong ${BLOCK_TURNS} turn`
      : `${input.model} không phản hồi; turn này quay về ${e.model}, nếu lỗi lại sẽ tạm ngừng dùng ${route.family}`
    const warning: Warning = { at: await $.clock.now(), kind: 'model', text }
    await update($, coreState, c => S.withWarnings(warning)(S.withRoute(null)(c)))
    $.ui.toast(text)
    return yield* next(e)
  })
}
