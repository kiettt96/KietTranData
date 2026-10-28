// 0.7.5 B9: đếm lỗi lặp của cùng một lệnh đặt lại khi có ghi file sau lần lỗi trước hoặc khi chính lệnh đó chạy đạt.
// 0.7.5 B10: nhịp checkpoint theo mốc đã nhắc: ghi của subagent làm bộ đếm vượt mốc thì lần gọi kế tiếp của luồng chính vẫn nhắc.

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, observe, trackVerification } from '../hooks/lib/drift'

const FOCUS = { goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const }
const run = (command: string, isError: boolean) => ({ tool: 'Bash', input: { command }, isError, isReadOnly: false, output: isError ? 'lỗi' : '' })
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const looped = (findings: Array<{ kind: string }>) => findings.some(f => f.kind === 'loop')
const CMD = '/usr/bin/python3 -B /repo/scripts/ghi.py --lo 3'

describe('0.7.5 B9: đếm lỗi lặp đặt lại', () => {
  test('lỗi hai lần, sửa file, lỗi hai lần nữa: không báo lặp', () => {
    const tracker = newTracker('t')
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
    observe(tracker, edit('/repo/scripts/ghi.py'), FOCUS, [])
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
  })

  test('lỗi hai lần, lệnh đó chạy đạt, lỗi hai lần nữa: không báo lặp', () => {
    const tracker = newTracker('t')
    observe(tracker, run(CMD, true), FOCUS, [])
    observe(tracker, run(CMD, true), FOCUS, [])
    observe(tracker, run(CMD, false), FOCUS, [])
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(false)
  })

  test('lỗi ba lần liên tiếp không thay đổi gì: vẫn báo lặp như cũ', () => {
    const tracker = newTracker('t')
    observe(tracker, run(CMD, true), FOCUS, [])
    observe(tracker, run(CMD, true), FOCUS, [])
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(true)
  })

  test('lệnh khác chạy đạt không đặt lại đếm của lệnh này', () => {
    const tracker = newTracker('t')
    observe(tracker, run(CMD, true), FOCUS, [])
    observe(tracker, run(CMD, true), FOCUS, [])
    observe(tracker, run('ls /repo', false), FOCUS, [])
    expect(looped(observe(tracker, run(CMD, true), FOCUS, []))).toBe(true)
  })
})

describe('0.7.5 B10: mốc checkpoint khi subagent ghi', () => {
  test('4 sửa của luồng chính, 2 ghi của subagent (vượt mốc 5), sửa kế tiếp của luồng chính: nhắc checkpoint', () => {
    const tracker = newTracker('t')
    for (let i = 1; i <= 4; i++) observe(tracker, edit(`/repo/src/m${i}.ts`), FOCUS, [])
    trackVerification(tracker, edit('/repo/src/s1.ts'), 'agent-1')
    trackVerification(tracker, edit('/repo/src/s2.ts'), 'agent-1')
    const findings = observe(tracker, edit('/repo/src/m5.ts'), FOCUS, [])
    expect(findings.some(f => f.kind === 'checkpoint')).toBe(true)
  })

  test('mốc đã nhắc không nhắc lại; mốc kế tiếp (10) vẫn nhắc', () => {
    const tracker = newTracker('t')
    const fired: number[] = []
    for (let i = 1; i <= 12; i++) {
      if (i === 3 || i === 8) trackVerification(tracker, edit(`/repo/src/s${i}.ts`), 'agent-1')
      if (observe(tracker, edit(`/repo/src/m${i}.ts`), FOCUS, []).some(f => f.kind === 'checkpoint')) fired.push(tracker.mutationsSinceCheck)
    }
    expect(fired).toEqual([5, 10])
  })

  test('lệnh kiểm đạt đặt lại mốc: lần nhắc kế tiếp sau 5 thay đổi mới', () => {
    const tracker = newTracker('t')
    for (let i = 1; i <= 6; i++) observe(tracker, edit(`/repo/src/a${i}.ts`), FOCUS, [])
    observe(tracker, { tool: 'Bash', input: { command: 'npx tsc --noEmit' }, isError: false, isReadOnly: false }, FOCUS, [])
    const fired: number[] = []
    for (let i = 1; i <= 5; i++) if (observe(tracker, edit(`/repo/src/b${i}.ts`), FOCUS, []).some(f => f.kind === 'checkpoint')) fired.push(i)
    expect(fired).toEqual([5])
  })
})
