// 0.7.5 L4 (vòng sửa 2): agentProgress.open (agentId đang chạy chờ báo kết thúc) có trần AGENT_OPEN_LIMIT; vượt trần thì bỏ mục cũ
// nhất (agent không báo kết thúc), bộ đếm "đang chạy" của việc đó trừ đi một để không kẹt vĩnh viễn; báo kết thúc muộn của agent
// đã bị bỏ không đếm hai lần và không lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { AgentProgress, Core } from '../types'
import * as S from '../hooks/lib/state'
import { makeBrief } from './support/commands'

const brief = makeBrief({ goalId: 1, goal: 'Cập nhật dữ liệu theo các lô' })
const item = (n: number): AgentProgress => ({ agentId: `a${n}`, title: `Lọc tin lô ${n}`, family: 'sonnet', effort: 'medium', state: 'running', tools: 0, startedAt: n, steps: [] })
const limit = (): number => (S as unknown as { AGENT_OPEN_LIMIT?: number }).AGENT_OPEN_LIMIT ?? 0
const tallyOf = (core: Core) => (core.agentProgress.tally ?? [])[0]
const start = (count: number): Core => {
  let core: Core = S.adoptGoal(brief)(S.EMPTY_CORE)
  for (let n = 1; n <= count; n++) core = S.withAgentStart(1, item(n))(core)
  return core
}

describe('0.7.5 L4: agentProgress.open có trần', () => {
  test('hàng trăm lần gọi không báo kết thúc: open giữ tối đa trần, giữ các mục mới nhất', () => {
    expect(limit()).toBe(100)
    const core = start(limit() + 40)
    const open = Object.keys(core.agentProgress.open ?? {})
    expect(open.length).toBe(limit())
    expect(open).toContain(`a${limit() + 40}`)
    expect(open).not.toContain('a1')
    expect(open).not.toContain('a40')
    expect(open).toContain('a41')
  })

  test('mục bị bỏ trừ khỏi số đang chạy; spawned giữ nguyên; các mục còn lại đếm đúng', () => {
    const core = start(limit() + 40)
    expect(tallyOf(core)?.spawned).toBe(limit() + 40)
    expect(tallyOf(core)?.running).toBe(limit())
  })

  test('báo kết thúc của agent còn trong open đếm xong như cũ; của agent đã bị bỏ không đổi gì và không lỗi', () => {
    let core = start(limit() + 40)
    core = S.withAgentEnd(`a${limit() + 40}`, 'done', 999)(core)
    expect(tallyOf(core)?.done).toBe(1)
    expect(tallyOf(core)?.running).toBe(limit() - 1)
    core = S.withAgentEnd('a1', 'done', 1000)(core)
    expect(tallyOf(core)?.done).toBe(1)
    expect(tallyOf(core)?.running).toBe(limit() - 1)
  })

  test('dưới trần không bỏ gì', () => {
    const core = start(10)
    expect(Object.keys(core.agentProgress.open ?? {}).length).toBe(10)
    expect(tallyOf(core)?.running).toBe(10)
  })
})
