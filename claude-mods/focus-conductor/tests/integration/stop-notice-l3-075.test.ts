// 0.7.5 L3 (vòng sửa 2): turn đã nhận câu báo hạn mức mềm thì Stop bỏ chặn vì checklist còn mở CHỈ khi cửa sổ vẫn còn trong
// vùng báo; cửa sổ đã làm mới (ra khỏi vùng báo) thì chặn như cũ. Việc giao subagent đã lỗi chưa giao lại vẫn bị chặn ở cả hai
// trường hợp.

import { describe, expect, test } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { FOUR, SEARCH, base, spawnTool, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const OPTIONS = { options: { noticeWeekRemainingPct: 20 } }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<{ deny?: string; context?: string[] }>
const edit = ($: Engine, path = '/repo/src/a.ts') => call($, { tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false })) as { block?: string }).block ?? '')
const ended = (agentId: string): TurnCompleteInput => ({ turnId: `t-${agentId}`, agentId, answer: '', durationMs: 1, isAborted: false, reason: 'error' })

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
}

/** Mục tiêu bốn việc, việc 1 giao subagent u1, checklist hai bước, rồi tuần còn 19% và một lần sửa nhận câu báo mềm trong turn t1. */
async function noticed($: Engine, on: On) {
  const seen = base(on)
  hooks(on)
  const meter = quotaMeter(on, [week(50)])
  await submit($, FOUR)
  await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
  await $.turn.start({ text: FOUR, turnId: 't1' })
  await call($, { tool: PLAN, action: 'set', steps: [{ title: 'Tìm chỗ gọi' }, { title: 'Đổi tên' }] })
  meter.set([week(81)])
  await seen.clock.advance(10_000)
  const out = await edit($)
  expect((out.context ?? []).some(c => c.includes('Hạn mức tuần còn 19%'))).toBe(true)
  return { seen, meter }
}

describe('0.7.5 L3: bỏ chặn checklist chỉ khi cửa sổ còn trong vùng báo', () => {
  test('cửa sổ vẫn trong vùng báo: Stop không chặn vì checklist', OPTIONS, async ($, on) => {
    await noticed($, on)
    expect(await stop($)).toBe('')
  })

  test('cửa sổ làm mới trong cùng turn (tuần còn 90%): Stop chặn vì checklist như cũ', OPTIONS, async ($, on) => {
    const { seen, meter } = await noticed($, on)
    meter.set([week(10)])
    await seen.clock.advance(60_000)
    await edit($, '/repo/src/b.ts')
    expect(await stop($)).toContain('Checklist còn 2 bước mở')
  })

  test('cửa sổ vào vùng dừng cứng: Stop cho kết thúc như cũ (dừng vì hạn mức)', OPTIONS, async ($, on) => {
    const { seen, meter } = await noticed($, on)
    meter.set([week(99)])
    await seen.clock.advance(60_000)
    await call($, { tool: 'Read', file_path: '/repo/src/b.ts' })
    expect(await stop($)).toBe('')
  })
})

describe('0.7.5 L3: việc giao lỗi vẫn bị chặn sau câu báo mềm', () => {
  test('cửa sổ còn trong vùng báo, việc 1 giao subagent đã lỗi: Stop chặn vì việc giao lỗi, không nêu checklist', OPTIONS, async ($, on) => {
    await noticed($, on)
    await $.turn.complete(ended('a-u1'))
    const block = await stop($)
    expect(block).toContain('Việc giao subagent đã lỗi, chưa giao lại: Việc 1')
    expect(block).not.toContain('Checklist còn')
  })

  test('cửa sổ làm mới, việc giao lỗi: Stop nêu cả checklist và việc giao lỗi', OPTIONS, async ($, on) => {
    const { seen, meter } = await noticed($, on)
    await $.turn.complete(ended('a-u1'))
    meter.set([week(10)])
    await seen.clock.advance(60_000)
    await edit($, '/repo/src/b.ts')
    const block = await stop($)
    expect(block).toContain('Checklist còn 2 bước mở')
    expect(block).toContain('Việc giao subagent đã lỗi, chưa giao lại: Việc 1')
  })
})
