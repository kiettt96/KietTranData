// 0.7.5 B7: tiến độ subagent với hàng chục lô: bộ đếm theo việc (giao, xong, lỗi, đang chạy) giữ ngoài danh sách 20 dòng,
// mỗi việc một dòng "k/n lô xong, r đang chạy", chip đếm theo tổng.

import { describe, expect, test } from 'claude-code/testing'
import type { AgentProgress, Core } from '../types'
import * as S from '../hooks/lib/state'
import * as P from '../hooks/lib/progress'
import { taskRows } from '../hooks/lib/progress'
import { labels } from '../hooks/ui/labels'
import { makeBrief } from './support/commands'

const brief = makeBrief({
  goalId: 1,
  goal: 'Cập nhật dữ liệu theo các lô',
  tasks: [{ index: 1, title: 'BƯỚC 7: lọc tin', run: 'agent', agentType: 'general-purpose', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }],
})
const item = (n: number, taskIndex?: number): AgentProgress => ({
  agentId: `a${n}`,
  title: `Lọc tin lô ${n}`,
  ...(taskIndex !== undefined ? { taskIndex } : {}),
  family: 'sonnet',
  effort: 'medium',
  state: 'running',
  tools: 0,
  startedAt: n,
  steps: [],
})

/** 34 lô của việc 1: 30 xong, 4 đang chạy. */
function batches(taskIndex?: number): Core {
  let core: Core = S.adoptGoal(brief)(S.EMPTY_CORE)
  for (let n = 1; n <= 34; n++) core = S.withAgentStart(1, item(n, taskIndex))(core)
  for (let n = 1; n <= 30; n++) core = S.withAgentEnd(`a${n}`, 'done', 100 + n)(core)
  return core
}

describe('0.7.5 B7: bộ đếm theo việc vượt 20 dòng', () => {
  test('34 lô của một việc: một dòng, 30/34 xong, 4 đang chạy', () => {
    const rows = taskRows(batches(1), 200).filter(row => row.index === 1)
    expect(rows.length).toBe(1)
    expect(rows[0]?.counts).toEqual({ done: 30, total: 34, running: 4 })
    expect(rows[0]?.state).toBe('running')
  })

  test('chip đếm theo tổng: 30/34', () => {
    // Gọi qua namespace để test đỏ vẫn nạp được trước khi có hàm (0.7.5).
    const totals = (P as Record<string, unknown>)['agentTotals'] as ((core: Core) => unknown) | undefined
    expect(totals?.(batches(1))).toEqual({ done: 30, total: 34 })
    expect(labels('vi').agentChip(30, 34)).toBe('subagent 30/34 xong')
  })

  test('chip của band: tổng số lần gọi cộng việc giao chưa có lần gọi; agentId khởi động lại không đếm hai lần', () => {
    const core = S.withAgentStart(1, item(34, 1))(batches(1))
    const rows = taskRows(core, 200).filter(row => row.kind === 'agent')
    expect(P.chipCounts(core, rows)).toEqual({ done: 30, total: 34 })
    const extra = { key: 'task-9', kind: 'agent' as const, index: 9, title: 'Việc chưa giao', pick: null, bar: { kind: 'state' as const, state: 'pending' as const }, state: 'pending' as const }
    expect(P.chipCounts(core, [...rows, extra])).toEqual({ done: 30, total: 35 })
  })

  test('lô Claude tự giao cùng dạng mô tả: gộp một dòng theo tổng', () => {
    const rows = taskRows(batches(), 200).filter(row => row.kind === 'agent' && row.index === undefined)
    expect(rows.length).toBe(1)
    expect(rows[0]?.counts).toEqual({ done: 30, total: 34, running: 4 })
  })

  test('lô lỗi được đếm; không còn lô chạy mà có lô lỗi thì dòng là failed', () => {
    let core = batches(1)
    for (let n = 31; n <= 33; n++) core = S.withAgentEnd(`a${n}`, 'done', 300)(core)
    core = S.withAgentEnd('a34', 'failed', 300)(core)
    const row = taskRows(core, 400).find(r => r.index === 1)
    expect(row?.counts).toEqual({ done: 33, total: 34, running: 0 })
    expect(row?.state).toBe('failed')
  })

  test('nhãn dòng việc: k/n lô xong, r đang chạy (vi, en)', () => {
    const vi = labels('vi') as unknown as Record<string, ((...a: number[]) => string) | undefined>
    const en = labels('en') as unknown as Record<string, ((...a: number[]) => string) | undefined>
    expect(vi['taskBatches']?.(30, 34, 4)).toBe('30/34 lô xong, 4 đang chạy')
    expect(vi['taskBatches']?.(34, 34, 0)).toBe('34/34 lô xong')
    expect(en['taskBatches']?.(30, 34, 4)).toBe('30/34 runs done, 4 running')
  })
})
