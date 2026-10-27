// 0.7.4 điểm 2: nhịp nhắc checkpoint giãn dần (5, 10, 20, 40 rồi mỗi 40) trong một turn, đặt lại khi một lệnh kiểm
// được nhận và đạt; câu nhắc dặn kiểm theo cách người dùng quy định, không tạo bộ kiểm mới khi không được yêu cầu.

import { describe, expect, test } from 'claude-code/testing'

import { isCheckpointDue, newTracker, observe } from '../hooks/lib/drift/tracker'

const FOCUS = { goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const }
const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const check = { tool: 'Bash', input: { command: 'npx tsc --noEmit' }, isError: false, isReadOnly: false }

/** Số thay đổi tại đó có nhắc checkpoint, cho `n` lần sửa liên tiếp chưa kiểm. */
function firedAt(n: number): number[] {
  const tracker = newTracker('t')
  const out: number[] = []
  for (let i = 1; i <= n; i++) if (observe(tracker, edit(`src/f${i}.ts`), FOCUS, []).some(f => f.kind === 'checkpoint')) out.push(i)
  return out
}

describe('0.7.4 2: isCheckpointDue', () => {
  test('mốc nhắc 5, 10, 20, 40 rồi mỗi 40', () => {
    const due: number[] = []
    for (let n = 1; n <= 200; n++) if (isCheckpointDue(n - 1, n)) due.push(n)
    expect(due).toEqual([5, 10, 20, 40, 80, 120, 160, 200])
  })

  test('một lời gọi vượt qua mốc (nhiều lần ghi) vẫn nhắc; không vượt mốc thì không', () => {
    expect(isCheckpointDue(3, 6)).toBe(true)
    expect(isCheckpointDue(38, 41)).toBe(true)
    expect(isCheckpointDue(11, 19)).toBe(false)
    expect(isCheckpointDue(41, 79)).toBe(false)
  })
})

describe('0.7.4 2: checkpoint trong một turn', () => {
  test('có nhắc ở 5, 10, 20, 40, 80, 120; không nhắc ở 15, 30, 60', () => {
    const fired = firedAt(125)
    expect(fired).toEqual([5, 10, 20, 40, 80, 120])
    for (const n of [15, 30, 60]) expect(fired).not.toContain(n)
  })

  test('1.000 thay đổi liên tiếp chưa kiểm: 28 lời nhắc', () => {
    expect(firedAt(1000).length).toBe(28)
  })

  test('lệnh kiểm được nhận và đạt đặt lại nhịp: lần nhắc kế tiếp ở thay đổi thứ 5 sau đó', () => {
    const tracker = newTracker('t')
    for (let i = 0; i < 12; i++) observe(tracker, edit(`src/a${i}.ts`), FOCUS, [])
    observe(tracker, check, FOCUS, [])
    expect(tracker.mutationsSinceCheck).toBe(0)
    const fired: number[] = []
    for (let i = 1; i <= 10; i++) if (observe(tracker, edit(`src/b${i}.ts`), FOCUS, []).some(f => f.kind === 'checkpoint')) fired.push(i)
    expect(fired).toEqual([5, 10])
  })

  test('lệnh kiểm lỗi không đặt lại nhịp', () => {
    const tracker = newTracker('t')
    for (let i = 0; i < 12; i++) observe(tracker, edit(`src/a${i}.ts`), FOCUS, [])
    observe(tracker, { ...check, isError: true }, FOCUS, [])
    expect(tracker.mutationsSinceCheck).toBe(12)
  })

  test('câu nhắc mới: kiểm theo cách người dùng quy định, không tạo bộ kiểm mới; giữ dòng mục tiêu', () => {
    const tracker = newTracker('t')
    let context = ''
    for (let i = 0; i < 5; i++) context = observe(tracker, edit(`src/c${i}.ts`), FOCUS, [{ id: 2, title: 'Ghi dữ liệu lô 1', status: 'doing' }]).find(f => f.kind === 'checkpoint')?.context ?? context
    expect(context).toContain('[focus-conductor] Checkpoint: 5 thay đổi liên tiếp chưa được kiểm tra.')
    expect(context).toContain('Mục tiêu: Cập nhật dữ liệu theo các bước | Bước còn mở: 2. Ghi dữ liệu lô 1')
    expect(context).toContain('kiểm lại phần vừa làm theo cách người dùng quy định (đọc lại, chạy lệnh kiểm có sẵn); không tạo bộ kiểm mới nếu người dùng không yêu cầu')
    expect(context).not.toContain('chạy test, type-check hoặc đọc lại diff')
  })
})
