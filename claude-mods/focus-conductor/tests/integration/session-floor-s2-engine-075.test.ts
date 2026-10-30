// 0.7.5 S2, qua engine: mục tiêu có quy tắc "đọc, giải thích, đúc kết dùng mô hình của phiên" chạy luồng chính ở model phiên (R4); một prompt
// mới không liên quan, router chọn haiku/low, thì luồng chính giữ haiku/low (vẫn qua fitPick), quy tắc vẫn mang sang cho subagent.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, base, plan, submit } from '../support/engine'

const sessionModel = (on: On, model: string) => on('session.model', () => ({ value: model }) as never)
const RULE = 'Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'

describe('0.7.5 S2: sàn model phiên qua engine', () => {
  test('mục tiêu có quy tắc: luồng chính opus; prompt mới nhỏ, router chọn haiku/low: luồng chính haiku/low', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.includes('Giá vàng')
          ? plan({ relation: 'new', confidence: 0.95, goal: 'Giá vàng hôm nay', depth: 'none', volume: 'small', kind: 'answer', main: { model: 'haiku', effort: 'low', why: 'hỏi nhanh' } })
          : plan({ goal: 'Cập nhật kho tri thức', constraints: [RULE], depth: 'hard', volume: 'large', main: { model: 'sonnet', effort: 'medium', why: 'đọc' } }),
    })
    sessionModel(on, 'claude-opus-5-5')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]?.join('\n')).toContain('luồng chính opus/')
    await submit($, 'Giá vàng SJC hôm nay bao nhiêu?')
    const second = seen.contexts[1]?.join('\n') ?? ''
    expect(second).toContain('luồng chính haiku/low')
    expect(second).not.toContain('luồng chính opus')
  })
})
