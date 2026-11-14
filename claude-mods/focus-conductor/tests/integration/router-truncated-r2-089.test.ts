// 0.8.9 R2 (tích hợp): ba nơi ghi dòng route của nhật ký quyết định (prompt lập mục tiêu hay tiếp nối, tin hỏi tiến độ, tin ngoài lề)
// đều ghi firstFail khi lượt sau cứu được lượt đầu. Router giả trả JSON hỏng ở lần đầu của mỗi prompt và JSON đúng ở lượt hỏi lại.

import { describe, expect, test } from 'claude-code/testing'
import { base, plan, step, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-truncated-r2-089.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const GOAL = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: ['Sửa hàm phí'] })
const STATUS = plan({ relation: 'continue', intent: 'status', goal: '', depth: 'none', volume: 'small', kind: 'answer', main: MAIN })
const ASIDE = plan({ relation: 'new', intent: 'task', goal: 'Giải thích git rebase', depth: 'none', volume: 'small', kind: 'answer', main: MAIN, tasks: [] })
const BAD = 'câu trả lời không đúng định dạng'

describe('0.8.9 R2: firstFail ở ba nơi ghi dòng route', () => {
  test('prompt lập mục tiêu, tin hỏi tiến độ, tin ngoài lề: lượt đầu hỏng JSON, lượt hỏi lại đọc được; ba dòng route có firstFail', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const asked = new Map<string, number>()
    const seen = base(on, {
      router: request => {
        const n = (asked.get(request) ?? 0) + 1
        asked.set(request, n)
        if (n === 1) return '{"goal": "hỏng'
        return request.includes('tới đâu rồi') ? STATUS : request.includes('git rebase') ? ASIDE : GOAL
      },
    })
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'làm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }, { title: 'Thêm test' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await submit($, 'tới đâu rồi')
    await submit($, 'git rebase là gì')
    const routes = (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>).filter(line => line['kind'] === 'route')
    expect(routes.map(line => line['intent'])).toEqual(['task', 'status', 'aside'])
    for (const line of routes) expect(line['firstFail'], String(line['intent'])).toBe(BAD)
  })
})
