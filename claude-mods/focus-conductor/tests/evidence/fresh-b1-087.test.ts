// 0.8.7 B1: freshTestRun không trả lần test đạt khi sau nó còn một lần chạy test lỗi của luồng chính hay mang cờ shared. Lần test lỗi của
// subagent không mang cờ (thư mục riêng) không làm mất lần đạt; lần lỗi chạy trước lần đạt giữ như 0.8.6.

import { describe, expect, test } from 'claude-code/testing'
import { freshTestRun, newEvidenceLog, noteEvidence } from '../../hooks/lib/drift/evidence'
import type { EvidenceLog } from '../../hooks/lib/drift/evidence'
import { JS } from '../fixtures/runner-output'

const edit = (log: EvidenceLog, author = 'main') => noteEvidence(log, { tool: 'Edit', input: { file_path: 'src/phi.ts' }, isError: false, isReadOnly: false }, author)
const pass = (log: EvidenceLog, author = 'main', isShared = false) =>
  noteEvidence(log, { tool: 'Bash', input: { command: 'bun test' }, isError: false, isReadOnly: false, output: JS.bun_pass }, author, isShared)
const fail = (log: EvidenceLog, author = 'main', isShared = false) =>
  noteEvidence(log, { tool: 'Bash', input: { command: 'bun test' }, isError: true, isReadOnly: false, output: JS.bun_fail }, author, isShared)

describe('0.8.7 B1: lần test lỗi chạy sau lần đạt', () => {
  test('luồng chính: sửa, test đạt, test lỗi: không có lần đạt; thêm một lần đạt nữa: trả lần đạt mới', () => {
    const log = newEvidenceLog(1)
    edit(log)
    pass(log)
    fail(log)
    expect(log.commands.at(-1)?.ok).toBe(false)
    expect(freshTestRun(log)).toBeUndefined()
    pass(log)
    expect(freshTestRun(log)).toBe(log.commands.at(-1))
  })

  test('subagent chung thư mục: test đạt mang cờ, test lỗi mang cờ: không có lần đạt', () => {
    const log = newEvidenceLog(1)
    edit(log, 'a-1')
    pass(log, 'a-2', true)
    fail(log, 'a-2', true)
    expect(freshTestRun(log)).toBeUndefined()
  })

  test('test lỗi của subagent không mang cờ (thư mục riêng): vẫn trả lần đạt', () => {
    const log = newEvidenceLog(1)
    edit(log)
    pass(log)
    const passed = log.commands.at(-1)
    fail(log, 'a-3')
    expect(freshTestRun(log)).toBe(passed)
  })

  test('lần kiểm nối && sau lần đạt (chained, kết quả chưa rõ): không tính là lỗi, vẫn trả lần đạt', () => {
    const log = newEvidenceLog(1)
    edit(log)
    pass(log)
    const passed = log.commands.at(-1)
    noteEvidence(log, { tool: 'Bash', input: { command: 'bun test && echo xong' }, isError: true, isReadOnly: false, output: JS.bun_pass }, 'main')
    expect(log.commands.at(-1)?.chained).toBe(true)
    expect(freshTestRun(log)).toBe(passed)
  })

  test('sửa, test lỗi, test đạt: trả lần đạt (như 0.8.6)', () => {
    const log = newEvidenceLog(1)
    edit(log)
    fail(log)
    pass(log)
    expect(freshTestRun(log)).toBe(log.commands.at(-1))
  })
})
