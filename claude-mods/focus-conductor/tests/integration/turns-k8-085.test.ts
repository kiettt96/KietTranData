// 0.8.5 K8: mục tiêu lớn không lập checklist chỉ là mục tiêu đang dở khi chưa có turn thực thi nào của luồng chính cho nó kết thúc. Sau một
// turn sửa file kết thúc, câu hỏi kiến thức lập mục tiêu mới như khi không có mục tiêu đang dở; turn hỏi đáp của tin ngoài lề không được
// đếm. Core của 0.8.4 không có trường theo dõi turn thì số turn là 0.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-turns-k8-085.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: ['Sửa hàm phí'] })
/** Dạng của bản ghi explain trong tests/golden/replies.ts: new, task, answer, none, không việc, tin cậy 0,97. */
const ASIDE = plan({ why: 'Câu hỏi giải thích khái niệm, không cần sửa file.', confidence: 0.97, relation: 'new', intent: 'task', goal: 'Giải thích git rebase', requirements: ['Giải thích git rebase'], depth: 'none', volume: 'small', kind: 'answer', main: { model: 'haiku', effort: 'low', why: '' }, tasks: [] })
const OPTIONS = [
  ['conductor mặc định', { planApproval: 'off', decisionLog: LOG }],
  ['conductor fable', { planApproval: 'off', conductor: 'fable', decisionLog: LOG }],
] as const
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const complete = ($: Engine, turnId: string) => $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)

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

describe('0.8.5 K8: mục tiêu lớn không checklist hết là mục tiêu đang dở khi đã có turn thực thi kết thúc', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: turn 1 sửa file không lập checklist rồi kết thúc: câu hỏi kiến thức lập mục tiêu mới, luồng chính theo router`, { options: opts }, async ($, on) => {
      const { seen, lines } = setup(on, [BIG, ASIDE])
      await submit($, A)
      await $.turn.start({ text: 'làm', turnId: 't1' })
      await step($, seen, { turnId: 't1' })
      await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
      await complete($, 't1')
      await submit($, 'git rebase là gì?')
      expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
      expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).not.toBe('aside')
      await $.turn.start({ text: 'trả lời', turnId: 't2' })
      expect(pick(await step($, seen, { turnId: 't2' }))).toContain('haiku')
    })

    test(`${name}: turn hỏi đáp của tin ngoài lề không được đếm: câu hỏi thứ hai vẫn là tin ngoài lề`, { options: opts }, async ($, on) => {
      const { seen, lines } = setup(on, [BIG, ASIDE])
      await submit($, A)
      await submit($, 'git rebase là gì?')
      expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('aside')
      await $.turn.start({ text: 'trả lời', turnId: 't2' })
      await step($, seen, { turnId: 't2' })
      await complete($, 't2')
      await submit($, 'git cherry-pick là gì?')
      expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('aside')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
    })
  }

  test('Core của 0.8.4 không có trường theo dõi turn: số turn là 0, chưa bị ngắt', () => {
    const { goalTurns: _drop, ...old } = S.EMPTY_CORE as Core & { goalTurns?: unknown }
    const n = S.normalizeCore(old as Partial<Core>) as Core & { goalTurns?: unknown }
    expect(n.goalTurns).toEqual({ goalId: -1, done: 0, interrupted: false })
  })
})
