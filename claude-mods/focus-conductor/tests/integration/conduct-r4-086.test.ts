// 0.8.6 R4: luồng chính đang điều phối mục tiêu lớn thì việc sửa file mới của tin tiếp nối (relation khác new) cũng giao subagent, kể cả khi
// kế hoạch của chính tin đó nhẹ: parseRoute coi là điều phối khi policy.conductor và kế hoạch của tin là mục tiêu lớn, hoặc tin là tiếp nối
// của mục tiêu đang là mục tiêu lớn (Policy.goalIsBig). Request gửi router không đổi một byte.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { parseRoute, routerRequest } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { bundledPrices } from '../../hooks/lib/cost'
import { makeBrief } from '../support/commands'
import { base, plan, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const FOLLOW = 'thêm log cho hàm phí nữa'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Sửa hàm thuế', 'main', 'sonnet', 'medium')] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [task('Sửa chú thích', 'main', 'sonnet', 'low')] })
const AMEND = plan({ goal: '', relation: 'continue', intent: 'amend', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [task('Thêm log', 'main', 'sonnet', 'medium')] })
const NEW_LIGHT = plan({ goal: 'Đổi màu nút', relation: 'new', confidence: 0.95, depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [task('Đổi màu nút', 'main', 'sonnet', 'low')] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const status = async ($: Engine) => String(((await $.command.run({ command: 'conductor', args: 'status', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const delegated = (text: string) => text.split('\n').filter(line => /^\s+\d+\. /.test(line)).join('\n')

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
/** SHA-256 của request router cho tin bổ sung trong chuỗi hiện tượng, đo trên 473bc75 (0.8.5) bằng engine 2.1.296. */
const FOLLOW_REQUEST_SHA = 'e98a37c262d2eae661d82e8c1053275d98d72a172420a6ec119a205e5afba543'

function setup(on: On, first: Json, second: Json): Seen {
  let n = 0
  const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : n++ === 0 ? first : second) })
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  return seen
}
async function giveAll($: Engine) {
  for (const n of [1, 2]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'x' } as never)
}

describe('0.8.6 R4: việc mới của tin bổ sung trong mục tiêu lớn', () => {
  test('mục tiêu lớn đang điều phối, đã giao hết; tin bổ sung amend light có việc run main: việc mới là việc giao subagent', FABLE, async ($, on) => {
    const seen = setup(on, BIG, AMEND)
    await submit($, A)
    await giveAll($)
    await submit($, FOLLOW)
    expect(delegated(await status($))).toContain('Thêm log')
    expect(await sha(seen.routed.at(-1) ?? '')).toBe(FOLLOW_REQUEST_SHA)
  })

  test('tin new light khi mục tiêu hiện tại lớn: không chuyển', FABLE, async ($, on) => {
    setup(on, BIG, NEW_LIGHT)
    await submit($, A)
    await giveAll($)
    await submit($, 'Đổi màu nút gửi trên trang thanh toán')
    expect(delegated(await status($))).not.toContain('Đổi màu nút')
  })

  test('tin bổ sung trong mục tiêu light: không chuyển', FABLE, async ($, on) => {
    setup(on, LIGHT, AMEND)
    await submit($, 'Sửa chú thích README')
    await submit($, FOLLOW)
    expect(delegated(await status($))).not.toContain('Thêm log')
  })

  test('conductor mặc định: không chuyển', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on, BIG, AMEND)
    await submit($, A)
    await submit($, FOLLOW)
    expect(delegated(await status($))).not.toContain('Thêm log')
  })
})

describe('0.8.6 R4: parseRoute và routerRequest', () => {
  const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null, conductor: true }
  const reply = JSON.stringify(AMEND)

  test('tin tiếp nối của mục tiêu lớn: việc main sửa file thành việc giao subagent; mục tiêu không lớn thì giữ', () => {
    expect(parseRoute(reply, { ...OPEN, goalIsBig: true })?.tasks[0]?.run).toBe('agent')
    expect(parseRoute(reply, { ...OPEN, goalIsBig: false })?.tasks[0]?.run).toBe('main')
    expect(parseRoute(reply, { ...OPEN, conductor: false, goalIsBig: true })?.tasks[0]?.run).toBe('main')
  })

  test('tin new không chuyển dù mục tiêu hiện tại lớn', () => {
    expect(parseRoute(JSON.stringify(NEW_LIGHT), { ...OPEN, goalIsBig: true })?.tasks[0]?.run).toBe('main')
  })

  test('routerRequest không phụ thuộc goalIsBig', () => {
    const prev = makeBrief({ goalId: 1, goal: A, depth: 'substantial', kind: 'edit' })
    const args = { text: FOLLOW, prev, ran: null, model: 'sonnet', prices: bundledPrices() }
    expect(JSON.stringify(routerRequest({ ...args, policy: { ...OPEN, goalIsBig: true } }))).toBe(JSON.stringify(routerRequest({ ...args, policy: OPEN })))
  })
})
