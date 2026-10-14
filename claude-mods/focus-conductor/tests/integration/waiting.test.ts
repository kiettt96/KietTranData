// 0.5.6 hạng mục B (tích hợp): cổng Stop với waiting, thông báo đóng (qualityNotice, pendingNotice), lưu và khôi phục mục tiêu.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const QUALITY = plan({ goal: 'Dựng pipeline', depth: 'hard', volume: 'large', quality: ['Số dòng khớp nguồn'] })

describe('0.5.6 B2: cổng Stop', () => {
  test('[done, waiting] không chặn; [done, todo, waiting] chặn và nêu 1 bước mở; [done, blocked] không chặn', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'waiting', note: 'chờ lệnh nền' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 1 bước mở')
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'waiting', note: 'chờ người dùng' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'blocked', note: 'thiếu quyền' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('đặt lại bước waiting về todo thì cổng Stop chặn lại', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'waiting', note: 'chờ' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'todo' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 1 bước mở')
  })
})

describe('0.5.6 B3: thông báo khi bước mở cuối cùng đóng', () => {
  async function setup($: Engine, on: Parameters<typeof base>[0], pending: 'blocked' | 'waiting') {
    base(on, { router: () => QUALITY })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }, { title: 'b' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: pending, note: 'đang chờ' })
    return String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
  }

  test('còn bước blocked: không in "Checklist đã đóng hết", in pendingNotice; bước blocked xong thì qualityNotice đúng một lần', {}, async ($, on) => {
    const first = await setup($, on, 'blocked')
    expect(first).not.toContain('Checklist đã đóng hết')
    expect(first).toContain('Không còn bước mở')
    const second = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })).result)
    expect(second).toContain('Checklist đã đóng hết')
    const third = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })).result)
    expect(third).not.toContain('Checklist đã đóng hết')
  })

  test('còn bước waiting: cùng hành vi', {}, async ($, on) => {
    const first = await setup($, on, 'waiting')
    expect(first).not.toContain('Checklist đã đóng hết')
    expect(first).toContain('Không còn bước mở')
    expect(String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'skipped', note: 'bỏ' })).result)).toContain('Checklist đã đóng hết')
  })

  test('đối chứng: bước mở cuối đóng khi không còn bước chờ thì vẫn in qualityNotice như cũ', {}, async ($, on) => {
    base(on, { router: () => QUALITY })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }] })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(out).toContain('Checklist đã đóng hết')
    expect(out).not.toContain('Không còn bước mở')
  })
})

describe('0.5.6 B7: lưu và khôi phục mục tiêu khi còn bước waiting', () => {
  test('[done, waiting] rồi mục tiêu mới thì được lưu và restore trả lại đúng', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Chờ kết quả đo' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'waiting', note: 'chờ lệnh nền' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(seen.contexts[1]?.join('\n')).toContain('1 bước đang chờ')
    expect(seen.contexts[1]?.join('\n')).toContain('action "restore"')
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' })
    expect(String(restored.result)).toContain('[x] 1. Phân tích')
    expect(String(restored.result)).toContain('[w] 2. Chờ kết quả đo')
  })

  test('[done, blocked] không lưu như cũ', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Chờ' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'blocked', note: 'thiếu quyền' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
  })
})
