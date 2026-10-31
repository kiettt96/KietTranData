// 0.7.5 A2: model của phiên đọc qua $.session.model() ngay ở prompt đầu (trước đây chỉ biết từ step đầu), nên router đọc
// prompt đầu đã có dòng Session model và chính sách model của phiên áp được ngay ở turn đầu.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, base, plan, submit, task } from '../support/engine'

const sessionModel = (on: On, model: string) => on('session.model', () => ({ value: model }) as never)
const SESSION_LINE = 'Session model (the model the user runs this session on): opus.'

describe('0.7.5 A2: model của phiên ở prompt đầu', () => {
  test('prompt đầu: request router có dòng Session model', {}, async ($, on) => {
    const seen = base(on)
    sessionModel(on, 'claude-opus-5-5')
    await submit($, COMPLEX_PROMPT)
    expect(seen.routed[0]).toContain(SESSION_LINE)
  })

  test('sessionModel ceiling: luồng chính ở turn đầu không vượt model của phiên', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    sessionModel(on, 'claude-sonnet-5-5')
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]?.join('\n')).toContain('Điều phối: luồng chính sonnet/')
    expect(seen.contexts[0]?.join('\n')).not.toContain('luồng chính opus')
  })

  test('quy định "mô hình của phiên": việc có quy định đó không thấp hơn model của phiên ở turn đầu', {}, async ($, on) => {
    // Router giả làm đúng lời dặn: việc lọc tin chạy model của phiên nêu ở dòng Session model; không có dòng đó thì đoán haiku.
    const seen = base(on, {
      router: request => {
        const family = /Session model \(the model the user runs this session on\): (\w+)\./.exec(seen.routed.at(-1) ?? '')?.[1] ?? 'haiku'
        return plan({
          goal: request.split('\n')[0],
          constraints: ['Việc lọc tin chạy bằng mô hình của phiên'],
          tasks: [task('Lọc tin theo tiêu chí', 'agent', family, 'medium', { kind: 'investigate' })],
        })
      },
    })
    sessionModel(on, 'claude-opus-5-5')
    await submit($, 'Lọc tin theo tiêu chí trong thư mục data, việc lọc tin chạy bằng mô hình của phiên')
    const brief = seen.contexts[0]?.join('\n') ?? ''
    expect(brief).toContain('opus')
    expect(brief).not.toContain('haiku')
  })

  test('engine không trả được model của phiên: như cũ, không có dòng Session model', {}, async ($, on) => {
    const seen = base(on)
    on('session.model', () => {
      throw new Error('không có model')
    })
    await submit($, COMPLEX_PROMPT)
    expect(seen.routed[0]).not.toContain('Session model')
  })
})
