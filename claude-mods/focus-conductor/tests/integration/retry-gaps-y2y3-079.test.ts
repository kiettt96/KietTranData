// 0.7.9 Y2, Y3: hai test ghim cho cổng lệnh kiểm chưa đạt (W4 của 0.7.8). Y2: turn đã nhận câu báo hạn mức mềm thì lệnh kiểm chưa đạt không
// chặn kết thúc, không tăng lượt, không có dòng retry. Y3: lần đạt là lệnh hẹp dạng tệp::tên không phủ lần lỗi của cả thư mục test.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS, PYTEST } from '../fixtures/runner-output'
import { FOUR, SEARCH, base, plan, spawnTool, step, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-retry-gaps-079.jsonl'

function hooks(on: On, passing: Set<string>, failure: string) {
  const writes: string[] = []
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: command.startsWith('pytest') ? PYTEST.pass : JS.bun_pass } : { result: failure, isError: true }
  })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const edit = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never) as Promise<{ context?: string[] }>
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')

describe('0.7.9 Y2: turn đã nhận báo hạn mức mềm', () => {
  test('lệnh kiểm chưa đạt: Stop qua, lượt không tăng (không có dòng retry)',{ options: { noticeWeekRemainingPct: 20, decisionLog: LOG } }, async ($, on) => {
    const seen = base(on)
    const lines = hooks(on, new Set(), JS.bun_fail)
    const meter = quotaMeter(on, [week(50)])
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await $.turn.start({ text: FOUR, turnId: 't1' })
    meter.set([week(81)])
    await seen.clock.advance(10_000)
    const out = await edit($, '/repo/src/a.ts')
    expect((out.context ?? []).some(c => c.includes('Hạn mức tuần còn 19%'))).toBe(true)
    await bash($, 'bun test')
    expect(await stop($)).toBe('')
    expect(lines().some(l => l['kind'] === 'retry')).toBe(false)
  })
})
