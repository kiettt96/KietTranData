// 0.8.5 K3: mục tiêu được cất mang theo trạng thái duyệt kế hoạch lúc bị cất; khôi phục (tin bảo chạy tiếp hay plan action restore) đặt lại
// trạng thái đó cho số mục tiêu mới. Mục tiêu đang planning chưa duyệt thì sau khi khôi phục luồng chính vẫn chưa được sửa file. Trạng thái
// Core của 0.8.4 (mục tiêu đã cất không có trường mới) khôi phục được, trạng thái duyệt none.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Brief, Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { planningContext } from '../../hooks/lib/approval'
import { base, plan, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { makeBrief } from '../support/commands'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-approval-k3-085.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: ['Sửa hàm phí', 'Thêm test'] })
const NEW = plan({ relation: 'new', intent: 'task', confidence: 0.97, goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' } })
const RESUME = plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const APPROVE = plan({ relation: 'continue', intent: 'approve', goal: '', depth: 'light', volume: 'small', kind: 'edit' })
const OPTS = { options: { decisionLog: LOG } }
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)
const lastContext = (seen: Seen) => seen.contexts.at(-1) ?? []
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ deny?: string }>
const setSteps = ($: Engine) => $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí', check: 'bun test' }, { title: 'Thêm test', check: 'bun test' }] } as never)

function setup(on: On, replies: Json[]) {
  let n = 0
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : (replies[Math.min(n++, replies.length - 1)] ?? null)),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}

/** A lớn đang planning, Edit bị từ chối, A lập checklist; B thay A rồi đóng hết checklist. */
async function aPlanningThenB($: Engine) {
  await submit($, A)
  expect(String((await edit($)).deny ?? '')).toContain('chưa được duyệt')
  await setSteps($)
  await submit($, 'Sửa chú thích README')
  expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa chú thích' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
}

describe('0.8.5 K3: mục tiêu được khôi phục giữ trạng thái duyệt', () => {
  test('A planning bị cất, tiếp tục khôi phục A: Edit bị từ chối vì chưa duyệt; context có planningContext', OPTS, async ($, on) => {
    const seen = setup(on, [BIG, NEW, RESUME])
    await aPlanningThenB($)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(String((await edit($)).deny ?? '')).toContain('chưa được duyệt')
    expect(lastContext(seen).filter(c => c === planningContext()).length).toBe(1)
  })

  test('A planning bị cất, plan restore khôi phục A: Edit bị từ chối vì chưa duyệt', OPTS, async ($, on) => {
    setup(on, [BIG, NEW])
    await aPlanningThenB($)
    expect((await $.tool.call({ tool: PLAN, action: 'restore' } as never)).deny).toBeUndefined()
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(String((await edit($)).deny ?? '')).toContain('chưa được duyệt')
  })

  test('A đã presented bị cất rồi khôi phục: vẫn presented, tin duyệt kế tiếp duyệt được, sau đó Edit chạy', OPTS, async ($, on) => {
    setup(on, [BIG, NEW, RESUME, APPROVE])
    await submit($, A)
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await setSteps($)
    expect(await stop($)).toBe('')
    expect(String((await edit($)).deny ?? '')).toContain('chưa được duyệt')
    await submit($, 'Sửa chú thích README')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa chú thích' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(String((await edit($)).deny ?? '')).toContain('chưa được duyệt')
    await submit($, 'ok duyệt')
    expect((await edit($)).deny).toBeUndefined()
  })
})

describe('0.8.5 K3: trạng thái Core của 0.8.4', () => {
  test('mục tiêu đã cất không có trường trạng thái duyệt: khôi phục được, trạng thái duyệt none', () => {
    const current: Brief = { ...makeBrief({}), goalId: 2, goal: 'Sửa chú thích', depth: 'light', kind: 'edit' } as Brief
    const stored: Brief = { ...makeBrief({}), goalId: 1, goal: A, depth: 'substantial', kind: 'edit' } as Brief
    const old = { ...S.EMPTY_CORE, brief: current, archived: [{ brief: stored, plan: [{ id: 1, title: 'Sửa hàm phí', status: 'todo' }] }] } as unknown as Core
    const outcome = S.restoreArchived(old, 1)
    expect('error' in outcome).toBe(false)
    if ('error' in outcome) return
    expect(outcome.core.brief?.goal).toBe(A)
    expect(S.approvalOf(outcome.core).status).toBe('none')
    expect(S.isPlanGated(outcome.core)).toBe(false)
  })
})
