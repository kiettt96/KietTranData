// 0.8.5 K1: cờ đang chờ câu trả lời câu hỏi làm rõ chỉ tắt khi tin được xử lý như câu trả lời hay yêu cầu. Tin hỏi tiến độ, tin bảo chạy
// tiếp (cả approve bị kẹp thành resume) và tin đi nhánh routerSkip giữ cờ, nên câu trả lời thật đến sau vẫn được giữ trong mục tiêu
// (answer-held) dù router xếp new tin cậy thấp. Câu trả lời thật đã nhận thì cờ tắt.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-awaiting-k1-085.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const QUESTIONS = ['Giữ API cũ hay đổi chữ ký hàm (giữ, đổi)?', 'Phí làm tròn lên hay xuống (lên, xuống)?']
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: ['Sửa hàm phí'], questions: QUESTIONS })
const ANSWER_REQ = 'Giữ API cũ, phí làm tròn lên'
/** Câu trả lời câu hỏi làm rõ mà router xếp new, task, tin cậy 0,5, edit, light. */
const ANSWER = plan({ relation: 'new', intent: 'task', confidence: 0.5, goal: ANSWER_REQ, requirements: [ANSWER_REQ], depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const STATUS = plan({ relation: 'continue', intent: 'status', goal: '', depth: 'none', volume: 'small', kind: 'answer', main: MAIN })
const RESUME = plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const APPROVE = plan({ relation: 'continue', intent: 'approve', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const OPTS = { options: { decisionLog: LOG } }
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)

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

/** Câu trả lời được giữ trong mục tiêu lớn và yêu cầu của nó gộp vào mục tiêu như amend. */
async function expectHeld($: Engine, lines: () => Record<string, unknown>[]) {
  expect(lines().some(l => l['kind'] === 'answer-held')).toBe(true)
  expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('amend')
  expect(await show($)).toContain(`Mục tiêu: ${A}`)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }] } as never)
  const closed = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)).result ?? '')
  expect(closed).toContain(ANSWER_REQ)
}

describe('0.8.5 K1: tin hỏi tiến độ, bảo chạy tiếp, duyệt không xóa cờ chờ câu trả lời', () => {
  const VARIANTS: Array<[string, string, Json]> = [
    ['tin hỏi tiến độ', 'xong chưa?', STATUS],
    ['tin bảo chạy tiếp', 'tiếp tục', RESUME],
    ['tin duyệt khi chưa trình (kẹp thành resume)', 'duyệt', APPROVE],
  ]
  for (const [name, text, reply] of VARIANTS) {
    test(`${name} rồi câu trả lời new tin cậy 0,5: answer-held, mục tiêu lớn giữ, yêu cầu gộp như amend`, OPTS, async ($, on) => {
      const { lines } = setup(on, [BIG, reply, ANSWER])
      await submit($, A)
      await submit($, text)
      await submit($, 'giữ, lên')
      await expectHeld($, lines)
    })
  }

  test('routerSkip: tiếp tục đi nhánh skip rồi câu trả lời: vẫn là câu trả lời', { options: { decisionLog: LOG, routerSkip: 'tiếp tục' } }, async ($, on) => {
    const { lines } = setup(on, [BIG, ANSWER])
    await submit($, A)
    await submit($, 'tiếp tục')
    expect(lines().some(l => l['kind'] === 'skip')).toBe(true)
    await submit($, 'giữ, lên')
    await expectHeld($, lines)
  })

  test('đối chứng: không có tin ở giữa: answer-held, mục tiêu lớn giữ', OPTS, async ($, on) => {
    const { lines } = setup(on, [BIG, ANSWER])
    await submit($, A)
    await submit($, 'giữ, lên')
    await expectHeld($, lines)
  })

  test('câu trả lời thật đã nhận: cờ tắt, tin new tin cậy thấp kế tiếp không còn đi nhánh answer-held', OPTS, async ($, on) => {
    const { lines } = setup(on, [BIG, STATUS, ANSWER, ANSWER])
    await submit($, A)
    await submit($, 'xong chưa?')
    await submit($, 'giữ, lên')
    expect(lines().filter(l => l['kind'] === 'answer-held').length).toBe(1)
    await submit($, 'làm thêm trang giới thiệu')
    expect(lines().filter(l => l['kind'] === 'answer-held').length).toBe(1)
  })
})
