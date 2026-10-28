// Test tích hợp: subagent theo router, giao việc đã phân, hiệu chỉnh chi phí theo effort thật, danh mục agent.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { calibrate, emptyLedger } from '../../hooks/lib/ledger'
import { BIG_USAGE, COMPLEX_PROMPT, DEFAULT_AGENT, DEFAULT_ROUTER, EDIT, FOUR, FOUR_PLAN, PANE, SEARCH, base, conductor, plan, spawnTool, step, submit, task } from '../support/engine'

describe('subagent theo router', () => {
  test('"Việc N" dùng đúng lựa chọn đã phân, không gọi router lần hai; Claude ghi model cao hơn thì model đó là sàn (0.7.4)', {}, async ($, on) => {
    const seen = base(on)
    const calls: Array<{ model?: string; effort?: string; subagent_type?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên userId', prompt: EDIT, model: 'opus' })
    // Explore chỉ được gọi tên khi engine đã mời agent này; ở đây chưa mời nên giữ general-purpose.
    expect(calls[0]).toEqual({ model: 'haiku', effort: 'low', subagent_type: undefined })
    expect(calls[1]).toEqual({ model: 'opus', effort: 'medium', subagent_type: undefined })
    expect(seen.agentRouted.length).toBe(0)
  })

  test('subagent tự phát: router chấm theo việc của nó; cùng description và prompt thì dùng lại kết quả', {}, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập.', model: 'opus' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition trong luồng ghi số dư' })
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập.' })
    await $.tool.call({ tool: 'Agent', description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng ký.' })
    // 0.7.4: Claude ghi opus là sàn, router chấm haiku cho lời gọi đầu vẫn gửi opus.
    // 0.7.5 B6: khóa nhớ gồm model Claude ghi (không gồm prompt): lời gọi thứ ba không ghi model được chấm riêng; lời gọi thứ tư
    // cùng description, khác prompt, dùng lại kết quả của lời gọi thứ ba.
    expect(models).toEqual(['opus', 'opus', 'haiku', 'haiku'])
    expect(seen.agentRouted.length).toBe(3)
    // Router thấy mục tiêu và gợi ý của Claude.
    expect(seen.agentRouted[0]).toContain('Goal of the session: Refactor module thanh toán')
    expect(seen.agentRouted[0]).toContain('The main thread asked for: model opus.')
  })

  test('router lỗi khi chấm subagent: giữ nguyên lựa chọn của Claude, ghi lý do', {}, async ($, on) => {
    base(on, { agent: () => null })
    const calls: Array<{ model?: string; effort?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      calls.push({ model: e.model, effort: e.effort })
      return { result: 'đã giao' }
    })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-free' }))
    await submit($, COMPLEX_PROMPT)
    await spawnTool($, 'u1', 'Tìm file auth', 'Tìm file auth')
    await $.tool.call({ tool: 'Agent', description: 'Sửa', prompt: 'Sửa x', model: 'sonnet' })
    expect(calls).toEqual([{ model: undefined, effort: undefined }, { model: 'sonnet', effort: undefined }])
    expect(String((await conductor($, 'status')).text)).toContain('router không chấm được (lỗi API overloaded 529); giữ lựa chọn của Claude')
  })

  test('subagent lỗi rồi được giao lại: router được hỏi lại kèm danh sách việc đã lỗi', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-9' }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    await $.agent.spawn({ prompt: 'Sửa nút lệch trên trang đăng nhập', description: 'Sửa nút lệch', tool_use_id: 'u1' } as never)
    await $.turn.complete({ turnId: 'ag-9', agentId: 'agent-9', answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u2', description: 'Sửa nút lệch', prompt: 'Sửa nút lệch trên trang đăng nhập' })
    expect(seen.agentRouted.length).toBe(2)
    expect(seen.agentRouted[1]).toContain('Failed pieces in this goal:\n  - Sửa nút lệch')
  })

  test('model Claude ghi không thuộc họ Claude thì cho qua nguyên vẹn, không hỏi router', {}, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Agent', description: 'Việc riêng', prompt: 'làm', model: 'my-local-model' } as never)
    expect(models).toEqual(['my-local-model'])
    expect(seen.agentRouted.length).toBe(0)
  })

  test('sessionModel ceiling giới hạn cả lựa chọn router cho subagent', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích race condition' })
    expect(models).toEqual(['sonnet'])
  })

  test('chi phí đo được của subagent cộng vào đúng agent, không vào luồng chính', {}, async ($, on) => {
    base(on)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    const spawned = await $.agent.spawn({ prompt: 'Tìm trong codebase các file xử lý đăng nhập', description: 'Tìm file auth', subagentType: 'Explore' } as never)
    await $.turn.complete({
      turnId: 'ag1',
      agentId: spawned.agentId,
      answer: 'ok',
      durationMs: 5,
      isAborted: false,
      reason: 'answer',
      usage: { ...BIG_USAGE, model: 'claude-haiku-5-5' },
    } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('subagent $0.035 trong 1 lượt')
    expect(status).toContain('luồng chính $0.0000 trong 0 lượt')
  })

  test('spawn bị từ chối không để lại kế hoạch chờ cho lần spawn sau', {}, async ($, on) => {
    base(on)
    let calls = 0
    on('agent.spawn', () => {
      calls += 1
      return calls === 1 ? { deny: 'test: từ chối' } : { model: 'claude-sonnet-5-5', agentId: 'agent-2' }
    })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Sửa nút', prompt: 'Sửa nút lệch' })
    await $.agent.spawn({ prompt: 'Sửa nút lệch', description: 'Sửa nút', tool_use_id: 'u1' } as never)
    await $.agent.spawn({ prompt: 'Việc khác', description: 'Việc khác', tool_use_id: 'u1' } as never)
    expect(String((await conductor($, 'status')).text)).toContain('Việc khác: sonnet (không qua điều phối)')
  })

  test('luồng chính tự sửa file khi còn việc ghi giao subagent: nhắc đúng một lần', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((first.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
    const second = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    expect((second.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('mọi việc ghi giao đã có Agent nhận thì không nhắc', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    // Engine nhận lời gọi Agent (từ 0.5.1, lời gọi bị từ chối thì việc trở lại danh sách chờ).
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, FOUR)
    for (const n of [1, 2, 4]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'làm việc được giao' })
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/c.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('ghi file kế hoạch của plan mode không nhắc giao subagent; sửa file mã nguồn thì vẫn nhắc', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const planned = await $.tool.call({ tool: 'Write', file_path: '/root/.claude/plans/ke-hoach.md', content: '# Kế hoạch' })
    expect((planned.context ?? []).join('\n')).not.toContain('chưa giao')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('chưa giao')
  })

  test('giao hơn sáu subagent trong một mục tiêu thì cảnh báo chi phí đúng một lần', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Agent', description: `Tìm ${i}`, prompt: `Tìm file số ${i} trong codebase` })
    expect(seen.toasts.filter(t => t.includes('đã giao 7 subagent')).length).toBe(1)
  })
  test('engine đã mời Explore thì việc router ghi Explore được đổi sang Explore; Claude chọn loại khác thì giữ', {}, async ($, on) => {
    base(on)
    on('agent.offer', () => ({ isOffered: true }))
    const types: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      types.push(e.subagent_type)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await $.agent.offer({ agent: 'Explore', description: 'tra cứu', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH, subagent_type: 'Plan' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên', prompt: EDIT })
    expect(types).toEqual(['Explore', 'Plan', undefined])
  })

  test('việc đã phân được kiểm lại theo chính sách lúc giao (model của phiên chỉ biết từ step đầu)', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ tasks: [task('Thiết kế lại engine', 'agent', 'opus', 'high'), task('Viết test', 'agent', 'sonnet', 'medium')] }) })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, 'Làm hai việc: thiết kế lại engine và viết test')
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: thiết kế', prompt: 'làm' })
    expect(models).toEqual(['sonnet'])
  })

  test('chế độ suggest: Claude để trống model thì không có cảnh báo lệch model (mod không gửi model nào)', { options: { routing: 'suggest' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-sg' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    expect(String((await conductor($, 'status')).text)).not.toContain('thay vì')
  })
})

describe('subagent chạy đúng điều phối', () => {
  test('hai subagent song song nhận đúng model và effort của việc mình, dù engine gửi khác', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
    await submit($, FOUR)
    // Khởi động ngược thứ tự: sửa trước, tra cứu sau.
    const edit = await spawnTool($, 'u2', 'Việc 2: đổi tên userId', EDIT)
    const search = await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    const before = seen.steps.length
    await step($, seen, { agentId: search.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: edit.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: search.agentId, model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    const got = seen.steps.slice(before)
    expect(got.map(g => g.effort)).toEqual(['low', 'medium', 'low'])
    expect(got.map(g => g.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  test('engine chạy model khác model đã điều phối thì ghi nhật ký và cảnh báo', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a-lech' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    expect(String((await conductor($, 'status')).text)).toContain('engine chạy opus thay vì haiku')
  })

  test('agent workflow không do script chọn model: router chấm trước khi agent chạy, mod ép ở từng bước', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `w-${e.description.slice(0, 6)}` }))
    await submit($, FOUR)
    const lookup = await $.agent.spawn({ prompt: 'Tìm trong codebase các file xử lý đăng nhập', description: 'Tìm file auth', workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
    const edit = await $.agent.spawn({ prompt: EDIT, description: 'Đổi tên userId', workflow: { runId: 'wf_1', agentIndex: 2 } } as never)
    expect(seen.agentRouted.length).toBe(2)
    expect(seen.agentRouted[0]).toContain('Started by a workflow script.')
    const before = seen.steps.length
    await step($, seen, { agentId: lookup.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: edit.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)).toEqual([
      { model: 'claude-haiku-5-5', effort: 'low' },
      { model: 'claude-sonnet-5-5', effort: 'medium' },
    ])
  })

  test('agent workflow lặp lại cùng description và prompt chỉ hỏi router một lần', {}, async ($, on) => {
    const seen = base(on)
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w-${(n += 1)}` }))
    await submit($, FOUR)
    for (let i = 1; i <= 3; i++) await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_9', agentIndex: i } } as never)
    expect(seen.agentRouted.length).toBe(1)
    const before = seen.steps.length
    await step($, seen, { agentId: 'w-3', model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
  })

  test('agent workflow có model do script chọn thì giữ nguyên model và effort của engine', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'w-script' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', model: 'sonnet', workflow: { runId: 'wf_2', agentIndex: 1 } } as never)
    expect(seen.agentRouted.length).toBe(0)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-sonnet-5-5', effort: 'high' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('agent đã chạy step trước khi mod kịp ghi điều phối thì không bị ép về sau (đổi giữa chừng phá cache)', {}, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-early' }))
    await submit($, FOUR)
    await step($, seen, { agentId: 'w-early', model: 'claude-opus-5-5', effort: 'xhigh' })
    await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_5', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: 'w-early', model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(String((await conductor($, 'status')).text)).toContain('bước đầu đã chạy trước khi mod kịp ghi, không ép')
  })

  test('chế độ suggest không ép model hay effort của subagent; nhật ký ghi là không áp dụng', { options: { routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-suggest' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_3', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /không áp dụng/ })).toBeTruthy()
    await ui.unmount()
  })

  test('agent workflow không phản hồi với model đã chọn thì quay về model của engine và ngừng ép', {}, async ($, on) => {
    const seen = base(on, { failFamily: 'haiku' })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'w-fail' }))
    await submit($, FOUR)
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Tìm chỗ gọi', workflow: { runId: 'wf_4', agentIndex: 1 } } as never)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh' })
    await step($, seen, { agentId: spawned.agentId, model: 'claude-opus-5-5', effort: 'xhigh', index: 1, messageCount: 3 })
    const got = seen.steps.slice(before)
    expect(got.map(g => g.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-opus-5-5'])
    expect(got[2]?.effort).toBe('xhigh')
    expect(seen.toasts.some(t => t.includes('không phản hồi'))).toBe(true)
  })

  test('lời gọi Agent từ trong một subagent không lấy việc của luồng chính; router thấy agent cha', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'p1' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    // Agent p1 gọi thêm một agent cho việc 2 của luồng chính: không được coi là đã giao việc 2.
    await $.tool.call({ tool: 'Agent', agentId: 'p1', tool_use_id: 'n1', description: 'Việc 2: đổi tên userId', prompt: EDIT } as never)
    expect(seen.agentRouted[0]).toContain('Started from inside another subagent: Việc 1: tìm chỗ gọi charge (haiku/low)')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 2 (sonnet/medium)')
  })

  test('chế độ subagents vẫn ép subagent, chỉ luồng chính là không bị đổi', { options: { routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-haiku-5-5', agentId: 'a-sub' }))
    await submit($, FOUR)
    const spawned = await spawnTool($, 'us', 'Việc 2: đổi tên userId', EDIT)
    const before = seen.steps.length
    await step($, seen, { agentId: spawned.agentId, model: 'claude-sonnet-5-5', effort: 'xhigh' })
    expect(seen.steps.slice(before)[0]?.effort).toBe('medium')
  })
})

describe('hiệu chỉnh chi phí subagent theo effort thật', () => {
  // 2.400 token ra: hệ số hiệu chỉnh không bị chặn ở 2, nên low và xhigh cho ra giá trị khác nhau.
  const USAGE = { input_tokens: 100_000, output_tokens: 2_400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

  // Chế độ gợi ý: engine chạy subagent theo effort của nó (không ép). Hiệu chỉnh phải dùng effort đó.
  async function calibrationAfter($: Engine, on: On, engineEffort: string): Promise<string> {
    const seen = base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-cal' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'uc', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    const spawned = await $.agent.spawn({ prompt: SEARCH, description: 'Việc 1: tìm chỗ gọi charge', tool_use_id: 'uc' } as never)
    await step($, seen, { agentId: spawned.agentId, model: 'claude-haiku-5-5', effort: engineEffort as 'low' })
    await $.turn.complete({ turnId: 'ag-cal', agentId: spawned.agentId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'claude-haiku-5-5' } } as never)
    return String((await conductor($, 'status')).text)
  }

  test('chế độ gợi ý: hiệu chỉnh haiku dùng effort xhigh mà engine đã gửi', { options: { routing: 'suggest' } }, async ($, on) => {
    const status = await calibrationAfter($, on, 'xhigh')
    expect(status).toContain(`haiku ×${calibrate(emptyLedger(0), 'haiku', USAGE.output_tokens, 'small', 'xhigh').calib.haiku.toFixed(2)}`)
  })

  test('chế độ gợi ý: hiệu chỉnh haiku dùng effort low mà engine đã gửi', { options: { routing: 'suggest' } }, async ($, on) => {
    const status = await calibrationAfter($, on, 'low')
    expect(status).toContain(`haiku ×${calibrate(emptyLedger(0), 'haiku', USAGE.output_tokens, 'small', 'low').calib.haiku.toFixed(2)}`)
  })
})

describe('0.5.0: giao việc đã phân', () => {
  test('router nhận ra lời gọi Agent là một việc đã phân dù không ghi "Việc N": dùng lựa chọn đã phân, hết chờ giao', {}, async ($, on) => {
    const seen = base(on, {
      agent: text => (text.startsWith('Description: Đổi tên') ? { why: 'đúng việc 2', task: 2, model: 'opus', effort: 'high', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' } : DEFAULT_AGENT(text)),
    })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(`${e.model}/${e.effort}`)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Đổi tên userId sang accountId', prompt: EDIT })
    expect(seen.agentRouted[0]).toContain('Tasks of the goal:')
    expect(seen.agentRouted[0]).toContain('  2. Đổi tên userId thành accountId trong 12 file controller.')
    // Lựa chọn đã phân cho việc 2 (sonnet/medium), không phải lựa chọn router vừa chấm.
    expect(models).toEqual(['sonnet/medium'])
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 4 (sonnet/medium)')
  })

  test('lời gọi gần khớp mà không khớp được ghi vào log quyết định', { options: { decisionLog: '/tmp/fc-decisions.jsonl' } }, async ($, on) => {
    base(on)
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Agent', description: 'Bước 2: đổi tên', prompt: EDIT })
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map(l => l['kind'])).toEqual(['route', 'agent'])
    expect(lines[1]?.['miss']).toContain('"Bước 2" là số bước của checklist')
  })

  test('strictDelegation off (mặc định): chỉ nhắc ở lần sửa file đầu tiên', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    const second = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    expect((first.context ?? []).join('\n')).toContain('chưa giao')
    expect((second.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('strictDelegation remind: nhắc ở mọi lần thay đổi, kể cả lệnh ghi file; lệnh chỉ đọc thì không', { options: { strictDelegation: 'remind' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    const again = await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
    const bash = await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/c.ts" })
    const read = await $.tool.call({ tool: 'Bash', command: 'cat src/c.ts' })
    expect((again.context ?? []).join('\n')).toContain('chưa giao')
    expect((bash.context ?? []).join('\n')).toContain('chưa giao')
    expect((read.context ?? []).join('\n')).not.toContain('chưa giao')
  })

  test('strictDelegation block: chặn sửa file tối đa hai lần mỗi mục tiêu; giao hết thì không chặn; file kế hoạch không chặn', { options: { strictDelegation: 'block' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    await submit($, FOUR)
    const plan = await $.tool.call({ tool: 'Write', file_path: '/root/.claude/plans/p.md', content: 'x' })
    expect(plan.deny).toBeUndefined()
    const first = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect(first.deny).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toContain('lần chặn cuối')
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
    // Mục tiêu mới, giao hết việc: không chặn.
    await submit($, `${FOUR}\n5. Thêm log.`)
    for (const n of [1, 2, 4]) await $.tool.call({ tool: 'Agent', description: `Việc ${n}: làm`, prompt: 'x' })
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
  })

  test('strictDelegation block không chặn subagent và không chặn ở chế độ suggest', { options: { strictDelegation: 'block', routing: 'suggest' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
  })
})

describe('0.5.0: danh mục agent và nhắc subagent', () => {
  test('router thấy loại agent engine mời (kèm mô tả) và loại khai trong agentTypes; chọn loại đó thì được giữ', { options: { agentTypes: 'security-reviewer' } }, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Rà soát')
          ? plan({ goal: 'Rà soát bảo mật', kind: 'mixed', tasks: [task('Rà soát webhook', 'agent', 'opus', 'high', { agent: 'security-reviewer', kind: 'investigate' })] })
          : DEFAULT_ROUTER(request),
    })
    on('agent.offer', () => ({ isOffered: true }))
    await $.agent.offer({ agent: 'test-runner', description: 'Chạy test và báo lỗi', source: 'plugin', provider: { plugin: 'x', tier: 'user' } } as never)
    await submit($, 'Rà soát bảo mật luồng webhook')
    expect(seen.routed[0]).toContain('Agent types: Explore (')
    expect(seen.routed[0]).toContain('test-runner (Chạy test và báo lỗi)')
    expect(seen.routed[0]).toContain('security-reviewer')
    expect(seen.contexts[0]?.join('\n')).toContain('1. Rà soát webhook → giao security-reviewer opus/high')
  })

  test('remindSubagents: subagent sửa file ngoài phạm vi được nhắc kèm việc được giao', { options: { remindSubagents: true } }, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('Mục tiêu: nâng cấp') ? { ...FOUR_PLAN, scope: ['src/pay/'] } : DEFAULT_ROUTER(request)) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-1' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-sub', 'Việc 2: đổi tên userId', EDIT)
    const edit = await $.tool.call({ tool: 'Edit', agentId: 'sub-1', file_path: '/repo/src/other.ts', old_string: 'a', new_string: 'b' } as never)
    const text = (edit.context ?? []).join('\n')
    expect(text).toContain('Việc được giao cho subagent này: Việc 2: đổi tên userId')
    expect(text).toContain('ngoài phạm vi')
    void seen
  })

  test('mặc định không nhắc subagent (chỉ ghi cảnh báo lên pane)', {}, async ($, on) => {
    base(on, { router: request => (request.startsWith('Mục tiêu: nâng cấp') ? { ...FOUR_PLAN, scope: ['src/pay/'] } : DEFAULT_ROUTER(request)) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-2' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-sub2', 'Việc 2: đổi tên userId', EDIT)
    let last: Awaited<ReturnType<typeof $.tool.call>> | undefined
    for (let i = 0; i < 3; i++) last = await $.tool.call({ tool: 'Bash', agentId: 'sub-2', command: 'npm run build' } as never)
    expect(last?.context ?? []).toEqual([])
  })
})
