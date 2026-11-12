// 0.8.6 R2: covers nhận lần kiểm mang cờ shared (subagent chạy chung thư mục khi luồng chính đang điều phối) là phủ mọi thay đổi trước nó;
// lần kiểm không mang cờ giữ luật 0.7.0; điều kiện chạy sau thay đổi cuối của freshTestRun giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { covers, freshTestRun, newEvidenceLog, noteEvidence } from '../../hooks/lib/drift/evidence'
import type { EvidenceLog } from '../../hooks/lib/drift/evidence'
import { newTracker, trackVerification } from '../../hooks/lib/drift'
import { JS } from '../fixtures/runner-output'

const editBy = (log: EvidenceLog, author: string) => noteEvidence(log, { tool: 'Edit', input: { file_path: 'src/phi.ts' }, isError: false, isReadOnly: false }, author)
const testBy = (log: EvidenceLog, author: string, isShared = false) =>
  noteEvidence(log, { tool: 'Bash', input: { command: 'bun test' }, isError: false, isReadOnly: false, output: JS.bun_pass }, author, isShared)

describe('0.8.6 R2: covers với cờ shared', () => {
  test('lần kiểm mang cờ phủ thay đổi của subagent khác và của luồng chính', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'main')
    editBy(log, 'a-1')
    testBy(log, 'a-2', true)
    const entry = log.commands.at(-1)
    expect(entry?.shared).toBe(true)
    expect(entry !== undefined && covers(entry, log)).toBe(true)
    expect(freshTestRun(log)).toBe(entry)
  })

  test('không mang cờ: giữ luật cũ, lần kiểm của a-2 không phủ thay đổi của a-1', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'a-1')
    testBy(log, 'a-2')
    const entry = log.commands.at(-1)
    expect(entry?.shared).toBeUndefined()
    expect(entry !== undefined && covers(entry, log)).toBe(false)
    expect(freshTestRun(log)).toBeUndefined()
  })

  test('không mang cờ: lần kiểm của a-1 vẫn phủ thay đổi của chính nó', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'a-1')
    testBy(log, 'a-1')
    const entry = log.commands.at(-1)
    expect(entry !== undefined && covers(entry, log)).toBe(true)
  })

  test('cờ chỉ đặt cho subagent: luồng chính truyền isShared vẫn không mang cờ', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'main')
    testBy(log, 'main', true)
    expect(log.commands.at(-1)?.shared).toBeUndefined()
  })

  test('lần kiểm mang cờ chạy trước thay đổi cuối: freshTestRun không trả', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'a-1')
    testBy(log, 'a-2', true)
    editBy(log, 'a-1')
    expect(freshTestRun(log)).toBeUndefined()
  })

  test('lần kiểm mang cờ là mốc của luồng chính: lần kiểm sau của subagent khác phủ thay đổi trước mốc đó', () => {
    const log = newEvidenceLog(1)
    editBy(log, 'a-1')
    testBy(log, 'a-2', true)
    editBy(log, 'a-3')
    testBy(log, 'a-3')
    const entry = log.commands.at(-1)
    expect(entry !== undefined && covers(entry, log)).toBe(true)
  })
})

describe('0.8.6 R2: tracker coi lần kiểm đạt mang cờ như của luồng chính', () => {
  test('a-1 sửa, a-2 kiểm đạt mang cờ: không còn thay đổi chờ kiểm', () => {
    const tracker = newTracker('Sửa')
    trackVerification(tracker, { tool: 'Edit', input: { file_path: 'src/phi.ts' }, isError: false, isReadOnly: false }, 'a-1')
    trackVerification(tracker, { tool: 'Bash', input: { command: 'bun test' }, isError: false, isReadOnly: false, output: JS.bun_pass }, 'a-2', null, true)
    expect(tracker.pending.size).toBe(0)
    expect(tracker.isVerified).toBe(true)
  })

  test('không mang cờ: thay đổi của a-1 vẫn chờ kiểm', () => {
    const tracker = newTracker('Sửa')
    trackVerification(tracker, { tool: 'Edit', input: { file_path: 'src/phi.ts' }, isError: false, isReadOnly: false }, 'a-1')
    trackVerification(tracker, { tool: 'Bash', input: { command: 'bun test' }, isError: false, isReadOnly: false, output: JS.bun_pass }, 'a-2')
    expect(tracker.pending.has('a-1')).toBe(true)
    expect(tracker.isVerified).toBe(false)
  })
})
