// 0.7.6 U8: nhóm agent đang chạy của mục "Đang chạy" (hàm thuần). Trạng thái cũ chưa có bộ đếm theo việc (trước 0.7.5) thì số agent
// đếm theo danh sách agent; có bộ đếm thì lấy số đang chạy của bộ đếm khi lớn hơn.

import { describe, expect, test } from 'claude-code/testing'
import type { AgentProgress, Core } from '../types'
import * as S from '../hooks/lib/state'
import { runningGroups } from '../hooks/lib/progress'
import { makeBrief } from './support/commands'

const brief = makeBrief({
  goalId: 1,
  goal: 'Lọc tin theo lô',
  tasks: [{ index: 1, title: 'BƯỚC 2: lọc tin', run: 'agent', agentType: 'general-purpose', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }],
})
const item = (n: number): AgentProgress => ({ agentId: `a${n}`, title: `BƯỚC 2: lọc tin lô ${n}`, taskIndex: 1, family: 'sonnet', effort: 'medium', state: 'running', tools: 0, startedAt: 1000 * n, steps: [] })

function running(count: number): Core {
  let core: Core = S.adoptGoal(brief)(S.EMPTY_CORE)
  for (let n = 1; n <= count; n++) core = S.withAgentStart(1, item(n))(core)
  return core
}

describe('0.7.6 U8: runningGroups', () => {
  test('trạng thái cũ chưa có bộ đếm: ba agent đang chạy đếm theo danh sách', () => {
    const core = running(3)
    const old: Core = { ...core, agentProgress: { goalId: core.agentProgress.goalId, items: core.agentProgress.items } }
    const [group] = runningGroups(old, 61_000)
    expect(group?.agents).toBe(3)
    expect(group?.range).toEqual({ first: 1, last: 3 })
    expect(group?.elapsedMs).toBe(60_000)
    expect(group?.title).toBe('BƯỚC 2: lọc tin')
  })

  test('có bộ đếm: 25 agent đang chạy dù danh sách chỉ giữ 20', () => {
    const [group] = runningGroups(running(25), 30_000)
    expect(group?.agents).toBe(25)
  })
})
