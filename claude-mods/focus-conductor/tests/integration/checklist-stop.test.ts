// Test tích hợp: checklist và chặn kết thúc, không mất tiến độ khi đổi mục tiêu.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, DEFAULT_ROUTER, FOUR, base, plan, step, submit } from '../support/engine'

describe('checklist và chặn kết thúc', () => {
  test('checklist còn mở thì chặn dừng, đóng hết thì cho dừng', {}, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    const set = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', goal: 'Refactor thanh toán', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    expect(String(set.result)).toContain('Checklist (0/2 đã đóng)')
    expect(String(set.result)).toContain('Bước tiếp theo: 1. Phân tích')
    expect(String(set.result)).not.toContain('gợi ý')
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
    // Turn sau chỉ hỏi đáp, không thay đổi gì: không bị chặn dù checklist còn mở.
    await $.turn.start({ text: 'giải thích bước 1', turnId: 't2' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    const refused = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified' })
    expect(refused.deny).toContain('evidence')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified', evidence: 'đã đọc 3 file' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 2, status: 'skipped', note: 'người dùng hoãn' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('mục tiêu mới khi checklist cũ còn bước mở thì báo cho Claude', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng thanh toán' }, { title: 'Thiết kế lại kiến trúc' }] })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.')
    const second = seen.contexts[1]?.join('\n') ?? ''
    expect(second).toContain('Bản đọc prompt của router')
    expect(second).toContain('Checklist cũ còn 2 bước mở đã được lưu')
  })

  test('plan "set" đổi mục tiêu: router thấy mục tiêu mới; tiếp nối giữ mục tiêu đó', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Bổ sung') ? plan({ relation: 'refine', goal: '' }) : plan({ goal: 'Tạo plugin' })) })
    await submit($, 'Tạo plugin focus-conductor cho Claude Code')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', goal: 'Viết hàm slugify(text) bằng TypeScript', steps: [{ title: 'slugify.ts' }, { title: 'Unit test' }] })
    await submit($, 'Bổ sung cho slugify: bỏ dấu tiếng Việt và cập nhật unit test.')
    expect(seen.routed[1]).toContain('Previous goal: Viết hàm slugify(text) bằng TypeScript')
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Viết hàm slugify')
  })
})

describe('0.5.0: không mất tiến độ khi đổi mục tiêu', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('mục tiêu mới cất checklist cũ còn bước mở; restore khôi phục đúng mục tiêu và trạng thái từng bước', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(seen.contexts[1]?.join('\n')).toContain('action "restore"')
    expect(seen.toasts.some(t => t.includes('đã được lưu'))).toBe(true)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết slugify' }] })
    const restored = await $.tool.call({ tool: PLAN, action: 'restore' })
    expect(String(restored.result)).toContain('Đã khôi phục mục tiêu: Refactor module thanh toán')
    expect(String(restored.result)).toContain('[x] 1. Phân tích')
    expect(String(restored.result)).toContain('[ ] 2. Thiết kế')
    // Mục tiêu slugify còn bước mở nên đến lượt nó được cất; khôi phục lại được.
    const back = await $.tool.call({ tool: PLAN, action: 'restore', index: 1 })
    expect(String(back.result)).toContain('Viết slugify')
  })

  test('restore khi không có gì đã lưu, hoặc index ngoài phạm vi, thì bị từ chối kèm lý do', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore', index: 2 })).deny).toContain('index từ 1')
  })

  test('checklist cũ đã đóng hết thì không cần lưu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
  })

  test('router không ghi relation (hoặc ghi sai) thì giữ mục tiêu, không cất checklist', {}, async ($, on) => {
    const seen = base(on, {
      router: request => (request.startsWith('Làm tiếp') ? { ...plan({ goal: '' }), relation: undefined } : DEFAULT_ROUTER(request)),
    })
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Tìm chỗ gọi' }] })
    await submit($, 'Làm tiếp phần đổi tên nhé')
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    expect(seen.contexts[1]?.join('\n')).toContain('Bước còn mở: 1. Tìm chỗ gọi')
  })

  test('plan set nhận scope: sửa ngoài phạm vi bị cảnh báo; scope rỗng bỏ giới hạn; mục không phải đường dẫn bị từ chối', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const bad = await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: ['module thanh toán'] })
    expect(bad.deny).toContain('scope chỉ nhận đường dẫn')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: ['src/pay/'] })
    const outside = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/other.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.stringify(outside.context ?? [])).toContain('ngoài phạm vi')
    await $.tool.call({ tool: PLAN, action: 'set', goal: 'Refactor', scope: [] })
    const free = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/other2.ts', old_string: 'a', new_string: 'b' })
    expect(JSON.stringify(free.context ?? [])).not.toContain('ngoài phạm vi')
  })
})
