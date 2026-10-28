// 0.7.5 C6: pane mở 16 dòng: checklist và tiến độ từng việc đứng ngay sau phần đầu (mục tiêu, thanh tiến độ), trước chọn chế
// độ, Hạn mức và cảnh báo; mục Hạn mức ẩn khi chưa có số đo (không dừng, không có điểm dừng).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FOUR, PANE, base, spawnTool, submit } from '../support/engine'
import { quotaMeter, session } from '../support/quota'
import { PANE_ROWS } from '../../hooks/lib/pane'

const PLAN = 'mcp__focus-conductor__plan'

async function texts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const all = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return all
}

/** "Engine" cho lời gọi Agent: cho chạy và khởi động agent. */
function agents(on: Parameters<typeof base>[0]) {
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
}

async function goal($: Engine) {
  await submit($, FOUR)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: tìm chỗ gọi charge' }, { title: 'Việc 2: đổi tên userId' }, { title: 'Việc 3: thiết kế' }, { title: 'Việc 4: README' }] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
  await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
}

describe('0.7.5 C6: thứ tự mục của pane', () => {
  test('checklist và tiến độ từng việc đứng trước chọn chế độ và Hạn mức, trong 16 dòng đầu', {}, async ($, on) => {
    base(on)
    quotaMeter(on, [session(40)])
    agents(on)
    await goal($)
    const all = await texts($)
    const checklist = all.findIndex(t => /^Checklist/.test(t))
    const tasks = all.findIndex(t => /^Tiến độ từng việc/.test(t))
    const mode = all.findIndex(t => t === 'Chế độ')
    expect(checklist).toBeGreaterThanOrEqual(0)
    expect(tasks).toBeGreaterThan(checklist)
    expect(mode).toBeGreaterThan(tasks)
    expect(PANE_ROWS).toBe(16)
    expect(all.findIndex(t => /^Việc 1: /.test(t))).toBeLessThan(PANE_ROWS)
  })
})

describe('0.7.5 C6: mục Hạn mức khi chưa có số đo', () => {
  test('chưa có số đo, không dừng, không có điểm dừng: không có mục Hạn mức', {}, async ($, on) => {
    base(on)
    agents(on)
    await goal($)
    expect((await texts($)).some(t => /^Hạn mức ─/.test(t))).toBe(false)
  })

  test('có số đo: mục Hạn mức như cũ', {}, async ($, on) => {
    base(on)
    quotaMeter(on, [session(40)])
    agents(on)
    await goal($)
    expect((await texts($)).some(t => /^Hạn mức ─/.test(t))).toBe(true)
  })
})
