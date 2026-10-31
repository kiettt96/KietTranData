// 0.7.5 T8 (vòng rà soát 5): loại việc luồng chính bằng tiếng Anh nhận theo gốc từ (summaries, explaining, synthesizing, reads,
// writing), không chỉ đúng các dạng liệt kê ở S9.

import { describe, expect, test } from 'claude-code/testing'
import { sessionFloor } from '../hooks/lib/route'

describe('0.7.5 T8: gốc từ tiếng Anh của loại việc luồng chính', () => {
  test('"Filtering uses sonnet; summaries use the session model": sàn là model của phiên', () => {
    expect(sessionFloor(['Filtering uses sonnet; summaries use the session model'], 'opus')).toBe('opus')
  })

  test('explaining, synthesizing, reads, writing đi với session model tạo sàn', () => {
    for (const kind of ['Explaining', 'Synthesizing', 'Reads', 'Writing', 'Summarizing', 'Explanations']) {
      expect(sessionFloor([`${kind} uses the session model`], 'opus'), kind).toBe('opus')
    }
  })

  test('từ chỉ trùng phần đầu (readme, ready, writer) và việc của subagent không tạo sàn', () => {
    for (const kind of ['Readme files', 'Ready checks', 'Filtering']) {
      expect(sessionFloor([`${kind} use the session model`], 'opus'), kind).toBe(null)
    }
  })
})
