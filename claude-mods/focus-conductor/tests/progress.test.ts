// 0.6.1, thanh tiến độ 2.4: hàm thuần của tiến độ từng việc (hooks/lib/progress.ts) và thanh của một việc (taskBarRuns).

import { describe, expect, test } from 'claude-code/testing'
import type { AgentProgress, Core } from '../types'
import { byPriority, taskRows } from '../hooks/lib/progress'
import * as S from '../hooks/lib/state'
import { taskBarRuns } from '../hooks/ui/style'
import { makeBrief } from './support/commands'

const task = (index: number, run: 'main' | 'agent', title: string) => ({
  index,
  title,
  run,
  pick: { family: run === 'main' ? 'opus' : 'haiku', effort: run === 'main' ? 'high' : 'low' },
  depth: 'light',
  volume: 'small',
  kind: 'edit',
  why: '',
})
const brief = makeBrief({ goalId: 7, goal: 'Nâng cấp', tasks: [task(1, 'agent', 'Tìm chỗ gọi'), task(2, 'main', 'Thiết kế'), task(3, 'agent', 'Đổi tên')] as never })
const agent = (over: Partial<AgentProgress>): AgentProgress => ({ agentId: 'a1', title: 'Việc 1: tìm', taskIndex: 1, family: 'haiku', effort: 'low', state: 'running', tools: 0, startedAt: 1000, steps: [], ...over })
const coreOf = (over: Partial<Core> = {}): Core => S.normalizeCore({ brief, delegations: { goalId: 7, items: [{ index: 1, title: 'Tìm chỗ gọi', state: 'pending' }, { index: 3, title: 'Đổi tên', state: 'pending' }] }, ...over })
const text = (runs: ReturnType<typeof taskBarRuns>) => runs.map(r => r.text).join('')

describe('0.6.1 2.4: taskBarRuns', () => {
  test('không có bước: chỉ trạng thái, không phần trăm', () => {
    expect(text(taskBarRuns({ kind: 'state', state: 'pending' }, 6))).toBe('╌╌╌╌╌╌')
    expect(taskBarRuns({ kind: 'state', state: 'pending' }, 6)[0]).toMatchObject({ color: 'subtle', dim: true })
    expect(text(taskBarRuns({ kind: 'state', state: 'idle' }, 6))).toBe('╌╌╌╌╌╌')
    expect(taskBarRuns({ kind: 'state', state: 'running' }, 6)).toEqual([{ text: '◐', color: 'claude', bold: true }, { text: '╌╌╌╌╌', color: 'subtle' }])
    expect(taskBarRuns({ kind: 'state', state: 'done' }, 6)).toEqual([{ text: '━━━━━━', color: 'success' }])
    expect(taskBarRuns({ kind: 'state', state: 'failed' }, 6)[0]).toEqual({ text: '■', color: 'error', bold: true })
    expect(taskBarRuns({ kind: 'state', state: 'cut' }, 6)[0]).toEqual({ text: '■', color: 'warning', bold: true })
    expect(taskBarRuns({ kind: 'state', state: 'running' }, 2)).toEqual([])
  })

  test('có bước: đúng như barRuns, độ dài đúng số ô', () => {
    const plan = [{ id: 1, title: 'a', status: 'done' as const }, { id: 2, title: 'b', status: 'doing' as const }]
    expect(text(taskBarRuns({ kind: 'steps', plan }, 8))).toBe('━━━━◐╌╌╌')
  })
})

describe('0.6.1 2.4: taskRows', () => {
  test('chưa có mục tiêu: rỗng; mới vào mục tiêu: việc chính, rồi việc theo số thứ tự', () => {
    expect(taskRows(S.normalizeCore({}), 0)).toEqual([])
    const rows = taskRows(coreOf(), 0)
    expect(rows.map(r => `${r.kind}:${r.index ?? ''}:${r.state}`)).toEqual(['main::idle', 'agent:1:pending', 'direct:2:idle', 'agent:3:pending'])
    expect(rows[1]?.pick).toEqual({ family: 'haiku', effort: 'low' })
  })

  test('việc làm trực tiếp: bước "Việc N" cho thanh theo bước; không có bước thì đang làm khi đã có thay đổi hay bước đóng', () => {
    const plan = [{ id: 1, title: 'Việc 2: phác', status: 'done' as const }, { id: 2, title: 'Việc 2: chốt', status: 'todo' as const }, { id: 3, title: 'Gộp', status: 'todo' as const }]
    const direct = taskRows(coreOf({ plan }), 0).find(r => r.kind === 'direct')
    expect(direct?.bar).toEqual({ kind: 'steps', plan: plan.slice(0, 2) })
    expect(direct?.state).toBe('running')
    const loose = [{ id: 1, title: 'Phác', status: 'todo' as const }]
    expect(taskRows(coreOf({ plan: loose }), 0).find(r => r.kind === 'direct')?.state).toBe('idle')
    expect(taskRows(coreOf({ plan: loose, activity: { goalId: 7, changes: 2 } }), 0).find(r => r.kind === 'direct')?.state).toBe('running')
    expect(taskRows(coreOf({ plan: loose, activity: { goalId: 6, changes: 2 } }), 0).find(r => r.kind === 'direct')?.state).toBe('idle')
    expect(taskRows(coreOf({ plan: [{ id: 1, title: 'Phác', status: 'done' }] }), 0).find(r => r.kind === 'direct')?.state).toBe('done')
  })

  test('việc giao: mỗi lần gọi Agent một dòng; danh sách riêng cho thanh theo bước; lỗi và bị cắt luôn là thanh trạng thái', () => {
    const steps = [{ key: 'todo-1', title: 'x', status: 'done' as const }, { key: 'todo-2', title: 'y', status: 'todo' as const }]
    const core = coreOf({
      agentProgress: {
        goalId: 7,
        items: [agent({ agentId: 'a1', tools: 3, steps }), agent({ agentId: 'a2', taskIndex: 3, state: 'failed', steps, endedAt: 5000 }), agent({ agentId: 'a3', taskIndex: undefined, title: 'Kiểm log', state: 'cut' })],
      },
    })
    const rows = taskRows(core, 61_000)
    const first = rows.find(r => r.key === 'agent-a1')
    expect(first?.bar.kind).toBe('steps')
    expect(first?.elapsedMs).toBe(60_000)
    expect(first?.title).toBe('Tìm chỗ gọi')
    const failed = rows.find(r => r.key === 'agent-a2')
    expect(failed?.bar).toEqual({ kind: 'state', state: 'failed' })
    expect(failed?.elapsedMs).toBe(4000)
    expect(rows.at(-1)).toMatchObject({ key: 'agent-a3', state: 'cut', title: 'Kiểm log' })
    expect(rows.at(-1)?.index).toBeUndefined()
    // Mục tiêu khác: dòng của agent không được tính.
    expect(taskRows({ ...core, agentProgress: { ...core.agentProgress, goalId: 6 } }, 0).some(r => r.key.startsWith('agent-'))).toBe(false)
  })

  test('việc giao chưa gọi Agent: trạng thái theo danh sách việc giao (lỗi chưa giao lại vẫn là lỗi)', () => {
    const core = coreOf({ delegations: { goalId: 7, items: [{ index: 1, title: 'Tìm', state: 'failed' }, { index: 3, title: 'Đổi', state: 'done' }] } })
    expect(taskRows(core, 0).filter(r => r.kind === 'agent').map(r => r.state)).toEqual(['failed', 'done'])
  })

  test('đọc lại từ $.state (như sau hot-reload): cùng kết quả, chỉ từ Core', () => {
    const core = coreOf({ agentProgress: { goalId: 7, items: [agent({ tools: 4 })] }, activity: { goalId: 7, changes: 1 } })
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)))
    expect(taskRows(reloaded, 9000)).toEqual(taskRows(core, 9000))
  })

  test('byPriority: đang chạy, rồi lỗi hay bị cắt, rồi chờ, rồi xong; giữ thứ tự trong cùng mức', () => {
    const rows = ['done', 'pending', 'cut', 'running', 'failed', 'idle', 'running'].map((state, i) => ({ key: String(i), state })) as never
    expect(byPriority(rows).map(r => r.key)).toEqual(['3', '6', '2', '4', '1', '5', '0'])
  })
})

describe('0.6.1 2.4: reducer tiến độ agent', () => {
  test(`tối đa ${S.AGENT_PROGRESS_LIMIT} dòng, cùng agentId thì thay; mục tiêu mới làm mới`, () => {
    let core = coreOf()
    for (let i = 0; i < S.AGENT_PROGRESS_LIMIT + 3; i++) core = S.withAgentStart(7, agent({ agentId: `a${i}` }))(core)
    expect(core.agentProgress.items.length).toBe(S.AGENT_PROGRESS_LIMIT)
    expect(core.agentProgress.items[0]?.agentId).toBe('a3')
    core = S.withAgentStart(7, agent({ agentId: 'a5', tools: 9 }))(core)
    expect(core.agentProgress.items.filter(i => i.agentId === 'a5').length).toBe(1)
    core = S.withAgentTool('a5')(core)
    core = S.withAgentEnd('a5', 'done', 3000)(core)
    expect(core.agentProgress.items.find(i => i.agentId === 'a5')).toMatchObject({ tools: 10, state: 'done', endedAt: 3000 })
    expect(S.withAgentTool('khong-co')(core).agentProgress).toEqual(core.agentProgress)
    const next = S.adoptGoal(makeBrief({ goalId: 8 }))(S.withActivity(7)(core))
    expect(next.agentProgress).toEqual({ goalId: 8, items: [] })
    expect(next.activity).toEqual({ goalId: 8, changes: 0 })
  })

  test('withActivity: đếm theo mục tiêu, đổi mục tiêu thì đếm lại; trạng thái cũ không có trường thì mặc định', () => {
    expect(S.withActivity(7)(S.withActivity(7)(coreOf())).activity).toEqual({ goalId: 7, changes: 2 })
    expect(S.withActivity(8)(S.withActivity(7)(coreOf())).activity).toEqual({ goalId: 8, changes: 1 })
    expect(S.normalizeCore({}).agentProgress).toEqual({ goalId: -1, items: [] })
  })
})
