// 0.7.8 G6: luồng chính kẹt (lệnh lỗi lặp, router thấy lạc đề) thì có đường nâng ngay trong turn: câu nhắc dặn giao phần đang kẹt cho
// subagent để trống model, và danh sách việc đã lỗi (agentFailures) có mục "luồng chính kẹt: ..." để router chấm subagent chọn cao hơn
// một bậc. Cổng Stop không đổi hành vi (không dùng danh sách này).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, spawnTool, submit } from '../support/engine'

const STUCK_HINT = 'giao phần đó cho subagent'
const STUCK = 'luồng chính kẹt: '
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
/** Engine giả cho tool Agent: tool.call trả kết quả, agent.spawn trả id. */
function agentHooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}
const edit = ($: Engine, name: string) => $.tool.call({ tool: 'Edit', file_path: `src/${name}.ts`, old_string: 'x', new_string: 'y' })

describe('0.7.8 G6: kẹt giữa lúc chạy thì có đường nâng ngay trong turn', () => {
  test('lệnh lỗi ba lần: câu nhắc có đường giao subagent; request chấm subagent ngay sau đó có mục "luồng chính kẹt"', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa build', depth: 'light', volume: 'medium' }) })
    agentHooks(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'Sửa build')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa lỗi biên dịch ở module thanh toán' }] })
    await bash($, 'make build')
    await bash($, 'make build')
    const third = await bash($, 'make build')
    const context = (third.context ?? []).join('\n')
    expect(context).toContain('Dừng thử lại')
    expect(context).toContain(STUCK_HINT)
    await spawnTool($, 'a1', 'Sửa lỗi biên dịch', 'Tìm và sửa lỗi biên dịch ở module thanh toán')
    const request = seen.agentRouted.at(-1) ?? ''
    expect(request).toContain('Failed pieces in this goal:')
    expect(request).toContain(`${STUCK}Sửa lỗi biên dịch ở module thanh toán`)
  })

  test('không có bước đang mở: mục ghi lệnh lỗi', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa build', depth: 'light', volume: 'medium' }) })
    agentHooks(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'Sửa build')
    for (let i = 0; i < 3; i += 1) await bash($, 'make build')
    await spawnTool($, 'a1', 'Sửa lỗi biên dịch', 'Tìm và sửa lỗi biên dịch')
    expect(seen.agentRouted.at(-1) ?? '').toContain(`${STUCK}make build`)
  })

  test('router thấy lạc đề: câu nhắc có đường giao subagent và danh sách có mục "luồng chính kẹt"', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa form', depth: 'light', volume: 'medium' }), drift: () => ({ onTrack: false, why: 'đang sửa phần khác' }) })
    agentHooks(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa form đăng ký')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa form' }] })
    let last = ''
    for (const f of ['a', 'b', 'c', 'd', 'e']) last = ((await edit($, f)).context ?? []).join('\n')
    expect(last).toContain('đang lệch mục tiêu')
    expect(last).toContain(STUCK_HINT)
    await spawnTool($, 'a1', 'Sửa lỗi hiển thị', 'Sửa lỗi hiển thị ở form')
    expect(seen.agentRouted.at(-1) ?? '').toContain(`${STUCK}Sửa form`)
  })

  test('không có lặp: câu nhắc và danh sách như cũ', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa build', depth: 'light', volume: 'medium' }) })
    agentHooks(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'Sửa build')
    const two = [await bash($, 'make a'), await bash($, 'make b')]
    expect(two.every(r => !(r.context ?? []).join('\n').includes(STUCK_HINT))).toBe(true)
    await spawnTool($, 'a1', 'Sửa lỗi biên dịch', 'Tìm và sửa lỗi biên dịch')
    expect(seen.agentRouted.at(-1) ?? '').not.toContain(STUCK)
  })

  test('mục tiêu khác không thấy mục của mục tiêu trước', {}, async ($, on) => {
    const seen = base(on, { router: request => plan({ goal: request.split('\n')[0], depth: 'light', volume: 'medium' }) })
    agentHooks(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'Sửa build')
    for (let i = 0; i < 3; i += 1) await bash($, 'make build')
    await submit($, 'Viết hàm slugify có unit test')
    await spawnTool($, 'a1', 'Viết slugify', 'Viết hàm slugify')
    expect(seen.agentRouted.at(-1) ?? '').not.toContain(STUCK)
  })

  test('cổng Stop không đổi hành vi: mục "luồng chính kẹt" không làm Stop đòi giao lại việc', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa build', depth: 'light', volume: 'medium' }) })
    agentHooks(on)
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'Sửa build')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'done' })
    for (let i = 0; i < 3; i += 1) await bash($, 'make build')
    const block = (await $.classic.Stop({ stop_hook_active: false })).block
    expect(block ?? '').not.toContain('Việc giao subagent đã lỗi')
  })
})
