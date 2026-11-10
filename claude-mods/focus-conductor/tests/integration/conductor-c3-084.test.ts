// 0.8.4 C3: khi luồng chính điều phối (Fable sẵn sàng, chế độ auto, sessionModel auto, mục tiêu lớn), mọi turn của mục tiêu chạy
// fable/medium: không nâng theo bằng chứng, không kẹp theo allowFable; bằng chứng lẽ ra nâng thì ghi conductor-hold, mỗi mức nâng mới
// một lần trong một mục tiêu. Mục tiêu không lớn, chế độ subagents, họ fable bị chặn hay option mặc định: như 0.8.3.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const LOG = '/tmp/fc-conductor-c3-084.jsonl'
const FABLE = { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' }, ...over })
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`

function setup(on: On, reply: Json, engine: { failFamily?: string } = {}) {
  const seen = base(on, { router: () => reply, ...engine })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

/** Một turn có ba lần cùng một tool call lỗi: turn sau lẽ ra nâng độ sâu. */
async function loopTurn($: Engine, seen: Seen, turnId: string) {
  await $.turn.start({ text: 'làm', turnId })
  await step($, seen, { turnId })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'cat missing.txt' } as never)
  await $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

describe('0.8.4 C3: luồng chính của mục tiêu lớn chạy fable/medium', () => {
  test('allowFable tắt, router chọn sonnet/medium: turn lập kế hoạch và turn sau khi duyệt đều gửi fable/medium', { options: { conductor: 'fable' } }, async ($, on) => {
    const { seen } = setup(on, BIG())
    await submit($, 'Sửa luồng thanh toán')
    expect(pick(await step($, seen, { turnId: 't1' }))).toBe('claude-fable-5-2/medium')
    await conductor($, 'approve')
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-fable-5-2/medium')
  })

  test('sau ba lần lặp cùng lỗi: turn kế vẫn fable/medium, có dòng conductor-hold', FABLE, async ($, on) => {
    const { seen, lines } = setup(on, BIG())
    await submit($, 'Sửa luồng thanh toán')
    await loopTurn($, seen, 't1')
    await $.turn.start({ text: 'làm', turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-fable-5-2/medium')
    await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(lines().filter(l => l['kind'] === 'conductor-hold').length).toBe(1)
  })

  test('ba turn liên tiếp cùng mức nâng: chỉ một dòng conductor-hold', FABLE, async ($, on) => {
    const { seen, lines } = setup(on, BIG())
    await submit($, 'Sửa luồng thanh toán')
    await loopTurn($, seen, 't1')
    for (const id of ['t2', 't3', 't4']) {
      await $.turn.start({ text: 'làm', turnId: id })
      await step($, seen, { turnId: id })
      await $.turn.complete({ turnId: id, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    }
    expect(lines().filter(l => l['kind'] === 'conductor-hold').length).toBe(1)
  })
})

describe('0.8.4 W2: khóa conductor-hold theo mức nâng', () => {
  test('mức nâng tăng thêm một bậc sau dòng đầu: có dòng thứ hai ghi mức mới; các turn sau cùng mức không thêm dòng', FABLE, async ($, on) => {
    const { seen, lines } = setup(on, BIG())
    await submit($, 'Sửa luồng thanh toán')
    await loopTurn($, seen, 't1')
    await loopTurn($, seen, 't2')
    for (const id of ['t3', 't4', 't5']) {
      await $.turn.start({ text: 'làm', turnId: id })
      await step($, seen, { turnId: id })
    }
    const holds = lines().filter(l => l['kind'] === 'conductor-hold')
    expect(holds.map(l => l['depth'])).toEqual([1, 2])
  })
})

describe('0.8.4 C3: các trường hợp không điều phối', () => {
  test('mục tiêu light, edit, main sonnet/low: luồng chính sonnet/low', FABLE, async ($, on) => {
    const { seen } = setup(on, BIG({ depth: 'light', volume: 'small', main: { model: 'sonnet', effort: 'low', why: '' } }))
    await submit($, 'Sửa chú thích')
    expect(pick(await step($, seen, { turnId: 't1' }))).toBe('claude-sonnet-5-5/low')
  })

  test('mục tiêu hard, answer: luồng chính theo lựa chọn của router sau fitPick', FABLE, async ($, on) => {
    const { seen } = setup(on, BIG({ depth: 'hard', kind: 'answer', main: { model: 'opus', effort: 'high', why: '' } }))
    await submit($, 'Giải thích kiến trúc thanh toán')
    expect(pick(await step($, seen, { turnId: 't1' }))).toBe('claude-opus-5-5/high')
  })

  test('chế độ subagents: luồng chính không bị đổi', FABLE, async ($, on) => {
    const { seen } = setup(on, BIG())
    await conductor($, 'mode subagents')
    await submit($, 'Sửa luồng thanh toán')
    expect(pick(await step($, seen, { turnId: 't1', model: 'claude-opus-5-5', effort: 'high' }))).toBe('claude-opus-5-5/high')
  })

  test('họ fable bị chặn giữa mục tiêu lớn: turn kế chạy main của router', FABLE, async ($, on) => {
    const { seen } = setup(on, BIG(), { failFamily: 'fable' })
    await submit($, 'Sửa luồng thanh toán')
    await step($, seen, { turnId: 't1' })
    await step($, seen, { turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't3' }))).toBe('claude-sonnet-5-5/medium')
  })

  test('conductor mặc định: mục tiêu lớn chạy lựa chọn của router như 0.8.3', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on, BIG())
    await submit($, 'Sửa luồng thanh toán')
    expect(pick(await step($, seen, { turnId: 't1' }))).toBe('claude-sonnet-5-5/medium')
  })
})
