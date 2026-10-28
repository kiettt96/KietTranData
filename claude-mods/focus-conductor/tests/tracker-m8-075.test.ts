// 0.7.5 M8 (vòng sửa 2): nhịp nhắc checkpoint của luồng chính chỉ đếm thay đổi của chính luồng chính; ghi của subagent vẫn làm
// luồng chính chưa được kiểm chứng (pending, isVerified) nhưng không tiến nhịp nhắc.

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, observe, trackVerification } from '../hooks/lib/drift'

const FOCUS = { goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const }
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const bash = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false })
const fires = (tracker: ReturnType<typeof newTracker>, call: ReturnType<typeof edit>) => observe(tracker, call, FOCUS, []).some(f => f.kind === 'checkpoint')

describe('0.7.5 M8: ghi của subagent không tiến nhịp nhắc của luồng chính', () => {
  test('3 sửa của luồng chính, 4 ghi của subagent, sửa thứ 4 của luồng chính: chưa nhắc; sửa thứ 5 mới nhắc', () => {
    const tracker = newTracker('t')
    for (let i = 1; i <= 3; i++) observe(tracker, edit(`/repo/src/m${i}.ts`), FOCUS, [])
    for (let i = 1; i <= 4; i++) trackVerification(tracker, edit(`/repo/src/s${i}.ts`), 'agent-1')
    expect(fires(tracker, edit('/repo/src/m4.ts'))).toBe(false)
    expect(fires(tracker, edit('/repo/src/m5.ts'))).toBe(true)
  })

  test('300 ghi của subagent không đổi bộ đếm nhịp, nhưng luồng chính vẫn chưa được kiểm chứng', () => {
    const tracker = newTracker('t')
    for (let i = 1; i <= 300; i++) trackVerification(tracker, edit(`/repo/src/s${i}.ts`), `agent-${i % 7}`)
    expect(tracker.mutationsSinceCheck).toBe(0)
    expect(tracker.mutations).toBe(300)
    expect(tracker.isVerified).toBe(false)
    expect(tracker.pending.size).toBe(7)
  })

  test('một lệnh Bash của luồng chính có nhiều ghi vượt mốc 5: vẫn nhắc ở lệnh đó', () => {
    const tracker = newTracker('t')
    for (let i = 1; i <= 4; i++) observe(tracker, edit(`/repo/src/m${i}.ts`), FOCUS, [])
    expect(fires(tracker, bash('cp a.ts b.ts; cp c.ts d.ts; cp e.ts f.ts'))).toBe(true)
  })
})
