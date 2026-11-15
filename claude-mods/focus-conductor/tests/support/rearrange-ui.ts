// 0.8.9 D3: kịch bản dùng chung cho test context và pane sau điều phối lại. Hai kịch bản không có arrange (prompt tiếp nối, tin chen
// ngang) dùng được cả trên bản trước D3, để ghi kỳ vọng "context trùng 7682ef7".

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { DEFAULT_ROUTER, FOUR, base, plan, step, submit, task } from './engine'
import type { Json } from './engine'

const ADD = plan({ relation: 'refine', intent: 'amend', goal: '', constraints: ['Giữ API cũ'], tasks: [task('Thêm phần kiểm thử hồi quy', 'main', 'sonnet', 'medium')] })

/** Context của prompt tiếp nối không có arrange: mục tiêu FOUR rồi một prompt thêm việc. */
export async function followUpContextOf($: Engine, on: On, reply: Json = ADD): Promise<string> {
  const seen = base(on, { router: request => (request.includes('thêm phần kiểm') ? reply : DEFAULT_ROUTER(request)) })
  await submit($, FOUR)
  await submit($, 'thêm phần kiểm thử hồi quy')
  return (seen.contexts.at(-1) ?? []).join('\n')
}

/** Context của tin chen ngang không có arrange: mục tiêu FOUR, turn t1 đang chạy, tin chen ngang thêm việc. */
export async function interjectContextOf($: Engine, on: On, reply: Json = ADD): Promise<string> {
  const seen = base(on, { router: request => (request.includes('thêm phần kiểm') ? reply : DEFAULT_ROUTER(request)) })
  on('turn.complete', () => ({ text: '' }))
  await submit($, FOUR)
  await $.turn.start({ text: 'làm', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.prompt.submit({ text: 'thêm phần kiểm thử hồi quy', wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
  return (seen.contexts.at(-1) ?? []).join('\n')
}
