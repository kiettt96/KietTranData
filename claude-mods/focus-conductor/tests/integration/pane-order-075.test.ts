// 0.7.5 C6: pane mở 16 dòng: checklist và tiến độ từng việc đứng ngay sau phần đầu (mục tiêu, thanh tiến độ), trước chọn chế
// độ, Hạn mức và cảnh báo; mục Hạn mức ẩn khi chưa có số đo (không dừng, không có điểm dừng).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, FOUR, PANE, base, conductor, spawnTool, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'
import { PANE_ROWS } from '../../hooks/lib/pane'

const PLAN = 'mcp__focus-conductor__plan'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))

/** Dòng bắt đầu của Text đầu tiên khớp `want` khi dựng cây như terminal (bỏ qua xuống dòng do bề rộng): Text là một dòng, Box
 * dọc cộng dòng của con kèm gap, Box ngang lấy con cao nhất; margin và padding trên dưới cộng thêm. */
function rowOf(root: unknown, want: RegExp): number {
  let found = -1
  const walk = (n: unknown, top: number): number => {
    if (typeof n === 'string' || n === null || typeof n !== 'object') return 0
    const node = n as Node
    const p = node.props ?? {}
    if (node.type === 'Text') {
      if (found < 0 && want.test(textOf(node))) found = top
      return 1
    }
    const before = num(p.marginTop ?? p.marginY ?? p.margin) + num(p.paddingTop ?? p.paddingY ?? p.padding)
    const after = num(p.marginBottom ?? p.marginY ?? p.margin) + num(p.paddingBottom ?? p.paddingY ?? p.padding)
    const kids = (node.children ?? []).filter(c => c !== null && typeof c === 'object')
    const column = String(p.flexDirection ?? 'row').startsWith('column')
    let height = 0
    if (column) {
      const gap = num(p.rowGap ?? p.gap)
      kids.forEach((c, i) => { height += (i > 0 ? gap : 0) + walk(c, top + before + height + (i > 0 ? gap : 0)) })
    } else {
      for (const c of kids) height = Math.max(height, walk(c, top + before))
    }
    return before + height + after
  }
  walk(root, 0)
  return found
}

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
    const pane = await $.ui.mount(PANE)
    const tree = await pane.drawn()
    await pane.unmount()
    // Bước cuối của checklist và dòng đầu của mục tiến độ từng việc (ngay dưới tiêu đề) đều trong 16 dòng đầu. Trên mã cũ hai
    // dòng này ở dòng 17 và 22.
    const last = rowOf(tree, /^Việc 4: /)
    const section = rowOf(tree, /^Tiến độ từng việc/)
    expect(last).toBeGreaterThanOrEqual(0)
    expect(section).toBeGreaterThanOrEqual(0)
    expect(last).toBeLessThan(PANE_ROWS)
    expect(section + 1).toBeLessThan(PANE_ROWS)
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

describe('0.7.5 C6: mục Hạn mức khi có điểm dừng mà không có số đo', () => {
  test('dừng vì hạn mức, ghi điểm dừng, chạy tiếp rồi số đo mất: mục Hạn mức vẫn hiện, trạng thái không có dữ liệu', {}, async ($, on) => {
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
    meter.set([session(10)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    meter.set([])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    const all = await texts($)
    expect(all.some(t => /^Hạn mức ─/.test(t))).toBe(true)
    expect(all.some(t => /^Trạng thái: không có dữ liệu \(engine không báo hạn mức/.test(t))).toBe(true)
    expect(all.some(t => /^Điểm dừng: đang mở/.test(t))).toBe(true)
  })
})

describe('0.7.5 C6: quotaGuard false', () => {
  // Sau C6, trạng thái không dữ liệu đã ẩn mục; ca này giữ cho quotaGuard false không vẽ mục Hạn mức cả khi /conductor resume
  // force (không bị chặn bởi quotaGuard) đã ghi mốc ép chạy tiếp.
  test('resume force khi quotaGuard false: không có mục Hạn mức', { options: { quotaGuard: false } }, async ($, on) => {
    base(on, RESUME)
    on('command.register', () => ({ value: { command: 'conductor' } }))
    memoryStore(on)
    quotaMeter(on, [session(99)])
    await submit($, COMPLEX_PROMPT)
    await conductor($, 'resume force')
    expect((await texts($)).some(t => /^Hạn mức ─/.test(t))).toBe(false)
  })
})
