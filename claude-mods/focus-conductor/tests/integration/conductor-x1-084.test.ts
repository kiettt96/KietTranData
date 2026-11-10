// 0.8.4 X1 (vòng 3 PR 37): mục tiêu lớn bền theo mục tiêu. followUpOf ghi depth, volume, kind của tin tiếp nối vào brief (router thật
// chấm light hay none cho tin bảo chạy tiếp, hỏi tiến độ, bổ sung nhỏ), nên trước đây một tin giữa chừng làm mục tiêu lớn mất vai điều
// phối. Brief.isBig ghi mục tiêu đã từng là mục tiêu lớn; isBigGoal đọc cờ đó (trừ brief đối chiếu và mục tiêu tối thiểu). Mục tiêu mới
// không mang cờ của mục tiêu trước; cờ đi theo brief khi cất và khôi phục. conductor mặc định: như trước.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Brief, Core } from '../../types'
import * as C from '../../hooks/lib/conductor'
import * as S from '../../hooks/lib/state'
import { briefFromCheckpoint, buildCheckpoint } from '../../hooks/lib/checkpoint'
import { conductorKeepText } from '../../hooks/lib/text'
import { base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { makeBrief } from '../support/commands'
import { memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-conductor-x1-084.jsonl'
const FABLE = { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }
const DEFAULT = { options: { planApproval: 'off', decisionLog: LOG } }
const ON = 'Điều phối: fable/medium, đang điều phối'
const BRIEFING = '[focus-conductor] Điều phối'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, ...over })
/** Tin tiếp nối như router thật chấm: không có việc, độ sâu light hay none. */
const follow = (over: Json) => plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, ...over })
const RESUME = follow({})
/** Năm loại tin giữa chừng của probe. */
const MIDDLE: Array<[string, string, Json]> = [
  ['bổ sung ý', 'thêm cả phần hoàn tiền', follow({ relation: 'refine', intent: 'amend' })],
  ['chạy tiếp', 'chạy tiếp đi', RESUME],
  ['hỏi giải thích', 'hàm tính phí chạy thế nào', follow({ intent: 'task', kind: 'answer' })],
  ['hỏi tiến độ', 'tới đâu rồi', follow({ intent: 'status', depth: 'none' })],
  ['báo chưa đạt', 'chưa đúng, phí vẫn sai', follow({ relation: 'dissatisfied', intent: 'amend' })],
]
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const statusText = async ($: Engine) => String((await conductor($, 'status')).text ?? '')
const band = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const
const bandText = async ($: Engine) => {
  const mounted = await $.ui.mount(band as never)
  const out = (await mounted.findAll({ type: 'Text' })).map(e => e.text).join(' ')
  await mounted.unmount()
  return out
}

/** Router giả trả lần lượt các câu trả lời đã cho (câu cuối lặp lại); lượt rà kế hoạch trả sạch. */
function setup(on: On, replies: Json[]) {
  let n = 0
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : (replies[Math.min(n++, replies.length - 1)] ?? null)),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
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

/** Turn 1 của mục tiêu: checklist 3 bước, bước 1 đang làm, turn kết thúc. */
async function firstTurn($: Engine, seen: Seen) {
  await $.turn.start({ text: 'làm', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }, { title: 'Thêm test' }, { title: 'Cập nhật tài liệu' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

/** Probe: mục tiêu lớn, turn 1, một tin giữa chừng, rồi tin bảo chạy tiếp; trả model và effort của turn kế. */
async function probe($: Engine, on: On, middle: [string, Json]) {
  const { seen } = setup(on, [BIG(), middle[1], RESUME])
  await submit($, 'Sửa luồng thanh toán')
  await firstTurn($, seen)
  await submit($, middle[0])
  await submit($, 'chạy tiếp đi')
  await $.turn.start({ text: 'làm', turnId: 't3' })
  return pick(await step($, seen, { turnId: 't3' }))
}

/** Một turn có ba lần cùng một tool call lỗi: turn sau lẽ ra nâng độ sâu. */
async function loopTurn($: Engine, seen: Seen, turnId: string) {
  await $.turn.start({ text: 'làm', turnId })
  await step($, seen, { turnId })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'cat missing.txt' } as never)
  await $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

describe('0.8.4 X1: tin giữa chừng không làm mất vai điều phối', () => {
  for (const [name, text, reply] of MIDDLE) {
    test(`${name} rồi chạy tiếp (light): turn kế fable/medium, status đang điều phối`, FABLE, async ($, on) => {
      expect(await probe($, on, [text, reply])).toBe('claude-fable-5-2/medium')
      const status = await statusText($)
      expect(status).toContain(ON)
      expect(status).not.toContain('Điều phối: tắt')
    })
  }

  test('duyệt bằng tin nhắn (intent approve, light), cổng duyệt bật: turn sau vẫn fable/medium và vai điều phối', { options: { conductor: 'fable', enforceChecklist: true, decisionLog: LOG } }, async ($, on) => {
    const { seen } = setup(on, [BIG({ requirements: ['Sửa hàm phí', 'Thêm test'] }), follow({ intent: 'approve' })])
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí', check: 'bun test' }, { title: 'Thêm test', check: 'bun test' }] } as never)
    await $.classic.Stop({ stop_hook_active: false } as never)
    await submit($, 'ok duyệt')
    await $.turn.start({ text: 'làm', turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-fable-5-2/medium')
    expect(await statusText($)).toContain(ON)
  })

  test('chạy tiếp (light) rồi ba lần lặp cùng lỗi: turn kế vẫn fable/medium, có dòng conductor-hold', FABLE, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), RESUME])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'chạy tiếp đi')
    await loopTurn($, seen, 't1')
    await $.turn.start({ text: 'làm', turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-fable-5-2/medium')
    await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(lines().filter(l => l['kind'] === 'conductor-hold').length).toBeGreaterThanOrEqual(1)
  })

  test('chạy tiếp (light) rồi nén ngữ cảnh: lời nhắc sau nén có câu vai điều phối', FABLE, async ($, on) => {
    const messages = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]
    const { seen } = setup(on, [BIG(), RESUME])
    on('session.compact', () => ({ messages, tokensAfter: 40_000 }) as never)
    const box = { tokens: 150_000 }
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: box.tokens, window: 200_000 }, rateLimits: [] } }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
    await submit($, 'Sửa luồng thanh toán')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }, { title: 'Thêm test' }] } as never)
    await submit($, 'chạy tiếp đi')
    await step($, seen, { turnId: 't1' })
    await $.session.compact({ trigger: 'auto', messages } as never)
    box.tokens = 38_000
    await step($, seen, { turnId: 't2' })
    const read = (await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never)) as { context?: string[] }
    const note = read.context?.find(c => c.startsWith('[focus-conductor] Hội thoại vừa được nén.')) ?? ''
    expect(note).toContain(conductorKeepText())
  })

  test('dừng vì hạn mức, chạy tiếp bằng "tiếp tục" (light): vẫn điều phối, có câu vai điều phối', FABLE, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('tiếp tục') ? RESUME : BIG()) })
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await submit($, 'Sửa luồng thanh toán')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
    meter.set([session(5)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    const context = seen.contexts.at(-1) ?? []
    expect(context.some(c => c.includes('ĐIỂM DỪNG'))).toBe(true)
    expect(context.filter(c => c.includes(conductorKeepText())).length).toBe(1)
    expect(await statusText($)).toContain(ON)
  })
})

describe('0.8.4 X1: cờ đi theo đúng mục tiêu', () => {
  test('mục tiêu lớn rồi mục tiêu mới light, edit (new, tin cậy cao): mục tiêu mới không lớn, luồng chính theo router, không còn nhãn vai', FABLE, async ($, on) => {
    const { seen } = setup(on, [BIG(), plan({ relation: 'new', goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' } })])
    await submit($, 'Sửa luồng thanh toán')
    await step($, seen, { turnId: 't1' })
    expect(await bandText($)).toContain('điều phối')
    await submit($, 'Sửa chú thích ở đầu tệp README')
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-sonnet-5-5/low')
    expect(await statusText($)).not.toContain(ON)
    expect(await bandText($)).not.toContain('điều phối')
  })

  test('mục tiêu light rồi refine substantial, edit: mục tiêu thành lớn, fable/medium, đoạn dặn đúng một lần', FABLE, async ($, on) => {
    const small = plan({ goal: 'Sửa phí', depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' } })
    const { seen } = setup(on, [small, follow({ relation: 'refine', intent: 'amend', depth: 'substantial', volume: 'medium' }), RESUME])
    const briefings = () => (seen.contexts.at(-1) ?? []).filter(c => c.includes(BRIEFING)).length
    await submit($, 'Sửa phí')
    expect(briefings()).toBe(0)
    await submit($, 'thêm cả luồng hoàn tiền và đối soát')
    expect(briefings()).toBe(1)
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-fable-5-2/medium')
    await submit($, 'chạy tiếp đi')
    expect(briefings()).toBe(0)
    expect(pick(await step($, seen, { turnId: 't3' }))).toBe('claude-fable-5-2/medium')
  })

  test('mục tiêu lớn bị cất vì một mục tiêu chen ngang, rồi khôi phục: vẫn là mục tiêu lớn', FABLE, async ($, on) => {
    const other = plan({ relation: 'new', goal: 'Viết hàm slugify', depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' } })
    const { seen } = setup(on, [BIG(), RESUME, other])
    await submit($, 'Sửa luồng thanh toán')
    await firstTurn($, seen)
    await submit($, 'chạy tiếp đi')
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(await statusText($)).not.toContain(ON)
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' } as never)
    expect(String(restored.result)).toContain('Đã khôi phục mục tiêu: Sửa luồng thanh toán')
    expect(await statusText($)).toContain(ON)
    await $.turn.start({ text: 'làm', turnId: 't4' })
    expect(pick(await step($, seen, { turnId: 't4' }))).toBe('claude-fable-5-2/medium')
  })
})

describe('0.8.4 X1: isBigGoal và trạng thái từ bản trước', () => {
  const brief = (over: Partial<Brief>) => ({ ...makeBrief({}), depth: 'substantial', kind: 'edit', isReference: false, ...over }) as Brief
  test('isBig true: lớn dù depth light; brief đối chiếu hay mục tiêu tối thiểu có isBig: không lớn', () => {
    expect(C.isBigGoal(brief({ depth: 'light', isBig: true }))).toBe(true)
    expect(C.isBigGoal(brief({ isBig: true, isReference: true }))).toBe(false)
    expect(C.isBigGoal(brief({ isBig: true, isBare: true }))).toBe(false)
  })
  test('brief từ 6164975 không có isBig: substantial, edit là lớn; light là không lớn', () => {
    expect(C.isBigGoal(brief({}))).toBe(true)
    expect(C.isBigGoal(brief({ depth: 'light' }))).toBe(false)
  })
  test('Core qua vòng JSON giữ isBig; Core không có cờ nạp được, không thêm cờ', () => {
    const core = { ...S.EMPTY_CORE, brief: brief({ depth: 'light', isBig: true }) }
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).brief?.isBig).toBe(true)
    const old = { ...S.EMPTY_CORE, brief: brief({ depth: 'light' }) }
    expect(S.normalizeCore(JSON.parse(JSON.stringify(old)) as Partial<Core>).brief?.isBig).toBeUndefined()
  })
  test('brief khôi phục từ điểm dừng là mục tiêu lớn theo công thức', () => {
    const cp = buildCheckpoint({
      id: 'c1',
      now: 5_000,
      cwd: '/repo/a',
      reason: [{ kind: 'five_hour', percentUsed: 96, resetsAt: '2100-01-01T00:00:00.000Z', thresholdRemainingPct: 5 }],
      brief: makeBrief({ goal: 'Sửa module', kind: 'edit' }),
      plan: [{ id: 1, title: 'Sửa', status: 'doing' }],
      delegations: [],
      recent: [],
      files: [],
      denied: null,
    } as never)
    expect(C.isBigGoal(briefFromCheckpoint(cp, 7_000))).toBe(true)
  })
})

describe('0.8.4 X1: conductor mặc định giữ hành vi cũ', () => {
  for (const [name, text, reply] of MIDDLE) {
    test(`${name} rồi chạy tiếp: luồng chính theo followUpMain, không có dòng Điều phối`, DEFAULT, async ($, on) => {
      expect(await probe($, on, [text, reply])).toBe('claude-sonnet-5-5/medium')
      expect(await statusText($)).not.toContain('Điều phối:')
    })
  }
})
