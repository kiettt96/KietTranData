// 0.7.5 S9 (vòng rà soát 4): loại việc luồng chính viết bằng tiếng Anh (reading, synthesis, summary, explain, write) đi với
// "session model" cũng tạo sàn model phiên như R4; loại việc của subagent viết bằng tiếng Anh thì không.

import { describe, expect, test } from 'claude-code/testing'
import { sessionFloor } from '../hooks/lib/route'

describe('0.7.5 S9: cụm tiếng Anh cho loại việc luồng chính', () => {
  test('reading, synthesis, summary, explain, write (và dạng read, synthesize, summarize, explanation, writing) tạo sàn', () => {
    for (const rule of [
      'Reading uses the session model',
      'Synthesis runs on the session model',
      'Summary on the session model',
      'Explain the changes with the session model',
      'Write the report with the session model',
      'Read the docs with the session model',
      'Synthesize findings with the session model',
      'Summarize each batch with the session model',
      'Explanation uses the session model',
      'Writing uses the session model',
      'Reading, synthesis and summary use the session model',
    ]) {
      expect(sessionFloor([rule], 'opus'), rule).toBe('opus')
    }
  })

  test('loại việc của subagent bằng tiếng Anh không tạo sàn', () => {
    for (const rule of ['Filtering news uses the session model', 'Batch scanning runs on the session model']) {
      expect(sessionFloor([rule], 'opus'), rule).toBe(null)
    }
  })
})
