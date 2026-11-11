// 0.8.4 A1 (vòng 4 PR 37): câu hỏi ngoài lề không làm mất luồng việc đang dở. Router xếp câu hỏi kiến thức là new, kind answer, không
// việc (bản ghi ca explain). Khi có mục tiêu đang dở (checklist còn bước mở, cổng duyệt planning hay presented, hay mục tiêu lớn chưa
// lập checklist), tin đó được trả lời mà không đổi brief, checklist, yêu cầu, trạng thái duyệt hay mục tiêu đã cất; không mở đợt mới;
// tin chen ngang không qua followUpOf. Áp cho mọi giá trị của conductor. isHeldAnswer giữ ưu tiên; tin ngoài lề không xóa awaitingAnswer.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Brief, PlanStep } from '../../types'
import { isAside, parseRoute } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { asideContext } from '../../hooks/lib/text'
import { OPEN } from '../golden/cases'
import { base, conductor, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { makeBrief } from '../support/commands'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-aside-a1-084.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: ['Sửa hàm phí'], ...over })
/** Dạng của bản ghi explain trong tests/golden/replies.ts: new, task, answer, none, không việc, có một yêu cầu. */
const ASIDE = (over: Json = {}) =>
  plan({ why: 'Câu hỏi giải thích khái niệm, không cần sửa file.', confidence: 0.97, relation: 'new', intent: 'task', goal: 'Giải thích git rebase', requirements: ['Giải thích git rebase'], depth: 'none', volume: 'small', kind: 'answer', main: { model: 'haiku', effort: 'low', why: '' }, tasks: [], ...over })
const RESUME = plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const QUESTIONS = ['Giữ API cũ hay đổi chữ ký hàm (giữ, đổi)?', 'Phí làm tròn lên hay xuống (lên, xuống, ngân hàng)?']
const STEP1: PlanStep = { id: 1, title: 'Sửa hàm phí', status: 'doing' }
const OPTIONS = [
  ['conductor mặc định', { planApproval: 'off', decisionLog: LOG }],
  ['conductor fable', { planApproval: 'off', conductor: 'fable', decisionLog: LOG }],
] as const
const isFable = (opts: { readonly conductor?: string; readonly decisionLog: string }) => opts.conductor === 'fable'
const expectedMain = (opts: { readonly conductor?: string; readonly decisionLog: string }) => (isFable(opts) ? 'claude-fable-5-2/medium' : 'claude-sonnet-5-5/medium')
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)
const statusText = async ($: Engine) => String((await conductor($, 'status')).text ?? '')
const lastContext = (seen: Seen) => seen.contexts.at(-1) ?? []
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ deny?: string }>

/** Router giả trả lần lượt các câu trả lời (câu cuối lặp lại); lượt rà kế hoạch trả sạch. */
function setup(on: On, replies: Json[]) {
  let n = 0
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : (replies[Math.min(n++, replies.length - 1)] ?? null)),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

/** Mục tiêu substantial, edit; turn 1 lập checklist 2 bước, bước 1 đang làm, turn kết thúc. */
async function firstTurn($: Engine, seen: Seen) {
  await submit($, 'Sửa luồng thanh toán')
  await $.turn.start({ text: 'làm', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }, { title: 'Thêm test' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

/** Đóng hết checklist hiện tại; trả lời nhắc đối chiếu yêu cầu (G2) của lần đóng cuối. */
async function closeAll($: Engine, ids: number[]) {
  let last = ''
  for (const id of ids) last = String((await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)).result)
  return last
}

describe('0.8.4 A1: câu hỏi ngoài lề khi mục tiêu đang dở', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: tin cậy 0,97: mục tiêu, checklist, yêu cầu giữ nguyên; một dòng asideContext; luồng chính của mục tiêu; Stop không chặn; rồi tiếp tục từ bước 1`, { options: { ...opts, enforceChecklist: true } }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE(), RESUME])
      await firstTurn($, seen)
      const before = await show($)
      await submit($, 'git rebase là gì?')
      expect(await show($)).toBe(before)
      const context = lastContext(seen)
      expect(context.some(c => c.includes('Checklist cũ'))).toBe(false)
      expect(context.filter(c => c === asideContext(false, STEP1)).length).toBe(1)
      await $.turn.start({ text: 'trả lời', turnId: 't2' })
      expect(pick(await step($, seen, { turnId: 't2' }))).toBe(expectedMain(opts))
      if (isFable(opts)) expect(await statusText($)).toContain('Điều phối: fable/medium, đang điều phối')
      expect(await stop($)).toBe('')
      await $.turn.complete({ turnId: 't2', answer: 'Rebase đặt lại các commit lên nhánh khác.', durationMs: 5, isAborted: false, reason: 'answer' } as never)
      await submit($, 'tiếp tục')
      expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước 1. Sửa hàm phí'))).toBe(true)
      await $.turn.start({ text: 'làm', turnId: 't3' })
      expect(pick(await step($, seen, { turnId: 't3' }))).toBe(expectedMain(opts))
      // Yêu cầu của mục tiêu không có câu hỏi ngoài lề.
      expect(await closeAll($, [1, 2])).not.toContain('Giải thích git rebase')
    })

    test(`${name}: tin cậy 0,5: không mở đợt mới`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE({ confidence: 0.5 })])
      await firstTurn($, seen)
      await submit($, 'git rebase là gì?')
      expect(lastContext(seen).some(c => c.includes('Đợt 2'))).toBe(false)
      expect(await show($)).toContain('[~] 1. Sửa hàm phí')
    })

    test(`${name}: investigate light không việc là tin ngoài lề; investigate hard lập mục tiêu mới`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE({ kind: 'investigate', depth: 'light', goal: 'Tra cấu hình CI' }), ASIDE({ kind: 'investigate', depth: 'hard', goal: 'Rà toàn bộ kiến trúc' })])
      await firstTurn($, seen)
      await submit($, 'CI chạy bằng gì vậy?')
      expect(await show($)).toContain('Mục tiêu: Sửa luồng thanh toán')
      await submit($, 'rà toàn bộ kiến trúc giúp tôi')
      expect(await show($)).toContain('Mục tiêu: Rà toàn bộ kiến trúc')
      expect(lastContext(seen).some(c => c.includes('Checklist cũ'))).toBe(true)
    })

    test(`${name}: tin new, edit, light, tin cậy 0,97: mục tiêu mới, checklist cũ được cất`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), plan({ relation: 'new', confidence: 0.97, goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit' })])
      await firstTurn($, seen)
      await submit($, 'Sửa chú thích README')
      expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
      expect(lastContext(seen).some(c => c.includes('Checklist cũ'))).toBe(true)
    })

    test(`${name}: tin new, answer có một việc: không phải tin ngoài lề, lập mục tiêu mới`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE({ tasks: [task('Giải thích rebase', 'main', 'haiku', 'low', { kind: 'answer', depth: 'none' })] })])
      await firstTurn($, seen)
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    })

    test(`${name}: tin ngoài lề chen ngang giữa turn: yêu cầu và việc không đổi; asideContext dạng giữa turn`, { options: opts }, async ($, on) => {
      const { seen, lines } = setup(on, [BIG(), ASIDE()])
      await firstTurn($, seen)
      await $.turn.start({ text: 'làm', turnId: 't2' })
      await $.prompt.submit({ text: 'git rebase là gì?', wait: false, turnId: 't2', origin: { kind: 'composer' } } as never)
      expect(lastContext(seen).filter(c => c === asideContext(true, STEP1)).length).toBe(1)
      expect(lastContext(seen).some(c => c.includes('Yêu cầu chen ngang'))).toBe(false)
      const route = lines().filter(l => l['kind'] === 'route').at(-1)
      expect([route?.['intent'], route?.['relation']]).toEqual(['aside', 'new'])
      expect(await show($)).toContain('[~] 1. Sửa hàm phí')
      expect(await closeAll($, [1, 2])).not.toContain('Giải thích git rebase')
    })

    test(`${name}: mục tiêu lớn chưa có checklist, cổng duyệt tắt: tin ngoài lề không thay mục tiêu`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE()])
      await submit($, 'Sửa luồng thanh toán')
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Sửa luồng thanh toán')
      expect(lastContext(seen).filter(c => c === asideContext(false, undefined)).length).toBe(1)
    })

    test(`${name}: nhật ký quyết định có dòng route intent aside kèm goalId của mục tiêu đang dở`, { options: opts }, async ($, on) => {
      const { seen, lines } = setup(on, [BIG(), ASIDE()])
      await firstTurn($, seen)
      await submit($, 'git rebase là gì?')
      const route = lines().filter(l => l['kind'] === 'route').at(-1)
      expect(route?.['intent']).toBe('aside')
      expect(route?.['goalId']).toBe(1)
    })
  }
})

describe('0.8.4 A1: không có mục tiêu đang dở thì như cũ', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: chưa có mục tiêu: tin new, answer lập mục tiêu mới`, { options: opts }, async ($, on) => {
      setup(on, [ASIDE()])
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    })

    test(`${name}: mục tiêu light đã đóng hết checklist: lập mục tiêu mới`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [plan({ goal: 'Sửa phí', depth: 'light', volume: 'small', kind: 'edit' }), ASIDE()])
      await submit($, 'Sửa phí')
      await step($, seen, { turnId: 't1' })
      await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
      await closeAll($, [1])
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    })

    test(`${name}: mục tiêu lớn đã đóng hết checklist: lập mục tiêu mới`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE()])
      await firstTurn($, seen)
      await closeAll($, [1, 2])
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    })

    test(`${name}: mục tiêu là brief đối chiếu: như cũ, tin new lập mục tiêu mới`, { options: opts }, async ($, on) => {
      setup(on, [BIG({ reference: true }), ASIDE()])
      await submit($, 'Sửa luồng thanh toán (chỉ để đối chiếu)')
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    })
  }
})

describe('0.8.4 A1: cổng duyệt và câu trả lời câu hỏi làm rõ', () => {
  const GATED = { options: { enforceChecklist: true, decisionLog: LOG } }

  test('kế hoạch đã trình: tin ngoài lề giữ presented, Edit vẫn bị từ chối, tin duyệt kế tiếp vẫn duyệt được', GATED, async ($, on) => {
    const { seen } = setup(on, [BIG({ requirements: ['Sửa hàm phí', 'Thêm test'] }), ASIDE(), plan({ relation: 'continue', intent: 'approve', goal: '', depth: 'light', volume: 'small', kind: 'edit' })])
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí', check: 'bun test' }, { title: 'Thêm test', check: 'bun test' }] } as never)
    expect(await stop($)).toBe('')
    await submit($, 'git rebase là gì?')
    expect(lastContext(seen).filter(c => c.startsWith('[focus-conductor] Câu hỏi ngoài lề')).length).toBe(1)
    expect((await edit($)).deny).toContain('chưa được duyệt')
    await submit($, 'ok duyệt')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('đang awaitingAnswer, tin không chen ngang, router trả new tin cậy thấp: vẫn đi nhánh câu trả lời (answer-held), không phải tin ngoài lề', GATED, async ($, on) => {
    const { lines } = setup(on, [BIG({ questions: QUESTIONS }), ASIDE({ confidence: 0.5 })])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'giữ, lên')
    expect(lines().some(l => l['kind'] === 'answer-held')).toBe(true)
    expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('amend')
  })

  test('đang planning và awaitingAnswer: tin ngoài lề tin cậy cao không xóa cờ; trạng thái duyệt và brief giữ; câu trả lời thật kế tiếp vẫn là câu trả lời', GATED, async ($, on) => {
    const { seen, lines } = setup(on, [BIG({ questions: QUESTIONS }), ASIDE(), ASIDE({ confidence: 0.5, goal: 'Giữ API cũ, làm tròn lên', kind: 'edit', depth: 'substantial' })])
    await submit($, 'Sửa luồng thanh toán')
    const before = await show($)
    await submit($, 'git rebase là gì?')
    expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('aside')
    expect(await show($)).toBe(before)
    expect((await edit($)).deny).toContain('chưa được duyệt')
    await submit($, 'giữ, lên')
    expect(seen.routed.at(-1)).toContain('awaits the answers')
    expect(lines().some(l => l['kind'] === 'answer-held')).toBe(true)
    expect(await show($)).toContain('Mục tiêu: Sửa luồng thanh toán')
  })
})

describe('0.8.4 A1: isAside thuần', () => {
  const POLICY: Policy = OPEN
  const parsed = (over: Json) => parseRoute(JSON.stringify(ASIDE(over)), POLICY)
  const brief = (over: Partial<Brief> = {}) => ({ ...makeBrief({}), depth: 'light', kind: 'edit', ...over }) as Brief
  const OPEN_STEPS = { open: 1, total: 2, approval: 'none' as const }
  const cases: Array<[string, Json, Partial<Brief> | null, { open: number; total: number; approval: 'none' | 'planning' | 'presented' | 'approved' }, boolean]> = [
    ['answer none, bước mở', {}, {}, OPEN_STEPS, true],
    ['answer hard, bước mở', { depth: 'hard' }, {}, OPEN_STEPS, true],
    ['investigate none', { kind: 'investigate', depth: 'none' }, {}, OPEN_STEPS, true],
    ['investigate light', { kind: 'investigate', depth: 'light' }, {}, OPEN_STEPS, true],
    ['investigate substantial', { kind: 'investigate', depth: 'substantial' }, {}, OPEN_STEPS, false],
    ['investigate hard', { kind: 'investigate', depth: 'hard' }, {}, OPEN_STEPS, false],
    ['edit light', { kind: 'edit', depth: 'light' }, {}, OPEN_STEPS, false],
    ['mixed none', { kind: 'mixed', depth: 'none' }, {}, OPEN_STEPS, false],
    ['relation continue', { relation: 'continue', intent: 'amend' }, {}, OPEN_STEPS, false],
    ['relation refine', { relation: 'refine', intent: 'amend' }, {}, OPEN_STEPS, false],
    ['có một việc', { tasks: [task('Giải thích', 'main', 'haiku', 'low', { kind: 'answer', depth: 'none' })] }, {}, OPEN_STEPS, false],
    ['reference', { reference: true }, {}, OPEN_STEPS, false],
    ['runReference', { runReference: true, relation: 'continue' }, {}, OPEN_STEPS, false],
    ['chưa có mục tiêu', {}, null, OPEN_STEPS, false],
    ['brief đối chiếu', {}, { isReference: true }, OPEN_STEPS, false],
    ['checklist đóng hết, không duyệt, không lớn', {}, {}, { open: 0, total: 2, approval: 'none' }, false],
    ['checklist trống, mục tiêu không lớn', {}, {}, { open: 0, total: 0, approval: 'none' }, false],
    ['checklist trống, planning', {}, {}, { open: 0, total: 0, approval: 'planning' }, true],
    ['checklist đóng hết, presented', {}, {}, { open: 0, total: 2, approval: 'presented' }, true],
    ['checklist đóng hết, approved', {}, {}, { open: 0, total: 2, approval: 'approved' }, false],
    ['mục tiêu lớn, checklist trống', {}, { depth: 'substantial' }, { open: 0, total: 0, approval: 'none' }, true],
    ['mục tiêu lớn, checklist đóng hết', {}, { depth: 'substantial' }, { open: 0, total: 2, approval: 'none' }, false],
  ]
  for (const [name, over, prev, state, expected] of cases) {
    test(`${name}: ${expected ? 'ngoài lề' : 'không ngoài lề'}`, () => {
      const routed = parsed(over)
      expect(routed).not.toBeNull()
      expect(isAside(routed!, prev === null ? null : brief(prev), state)).toBe(expected)
    })
  }

  test('asideContext: một dòng, tối đa 300 ký tự, hai dạng', () => {
    for (const text of [asideContext(true, STEP1), asideContext(false, STEP1), asideContext(false, undefined)]) {
      expect(text.length).toBeLessThanOrEqual(300)
      expect(text).not.toContain('\n')
    }
    expect(asideContext(true, STEP1)).toContain('1. Sửa hàm phí')
    expect(asideContext(true, STEP1)).not.toBe(asideContext(false, STEP1))
  })
})

// 0.8.4 Z2 (vòng 5 PR 37): ghim chi phí router của tin ngoài lề.
/** Dòng sổ của /conductor status: tiền và số lượt router của phiên. */
function routerLedger(status: string) {
  const match = /router <?\$([0-9,]+) trong ([0-9]+) lượt/.exec(status)
  return { usd: Number((match?.[1] ?? '').replace(',', '.')), calls: Number(match?.[2] ?? Number.NaN) }
}

describe('0.8.4 Z2: tin ngoài lề vẫn cộng chi phí router', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: sau một tin ngoài lề, số lượt router tăng đúng 1 và tiền router tăng`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), ASIDE()])
      await firstTurn($, seen)
      const before = routerLedger(await statusText($))
      await submit($, 'git rebase là gì vậy')
      expect(await show($)).toContain('Mục tiêu: Sửa luồng thanh toán')
      const after = routerLedger(await statusText($))
      expect(after.calls).toBe(before.calls + 1)
      // Status làm tròn tới cent: một lượt router sonnet giả không đổi số hiện, một lượt Fable thì có.
      if (isFable(opts)) expect(after.usd).toBeGreaterThan(before.usd)
      else expect(after.usd).toBeGreaterThanOrEqual(before.usd)
    })
  }
})
