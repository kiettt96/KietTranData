// 0.7.5 L2 (vòng sửa 2): lần plan tool đặt lại mutationsSinceCheck (verified được nhận) phải đặt lại cả checkpointMark, nếu không
// 5 thay đổi kế tiếp không nhắc checkpoint vì mốc cũ còn lớn hơn số thay đổi. Hàm markVerified dùng chung cho lần kiểm đạt
// của tracker và nhánh verified của plan tool.

import { describe, expect, test } from 'claude-code/testing'
import * as tracker from '../hooks/lib/drift/tracker'

const FOCUS = { goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const }
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const fires = (t: ReturnType<typeof tracker.newTracker>, path: string) => tracker.observe(t, edit(path), FOCUS, []).some(f => f.kind === 'checkpoint')
const markVerified = (t: ReturnType<typeof tracker.newTracker>) => (tracker as unknown as { markVerified?: (t: ReturnType<typeof tracker.newTracker>) => void }).markVerified?.(t)

describe('0.7.5 L2: markVerified đặt lại cả bộ đếm và mốc đã nhắc', () => {
  test('sau 10 thay đổi (mốc 2) đặt lại: bộ đếm, mốc về 0, isVerified true; 5 thay đổi kế tiếp lại nhắc ở thay đổi thứ 5', () => {
    const t = tracker.newTracker('t')
    for (let i = 1; i <= 10; i++) fires(t, `/repo/src/a${i}.ts`)
    expect(t.checkpointMark).toBe(2)
    markVerified(t)
    expect(t.mutationsSinceCheck).toBe(0)
    expect(t.checkpointMark).toBe(0)
    expect(t.isVerified).toBe(true)
    const at: number[] = []
    for (let i = 1; i <= 5; i++) if (fires(t, `/repo/src/b${i}.ts`)) at.push(i)
    expect(at).toEqual([5])
  })
})
