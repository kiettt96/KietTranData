// 0.6.0 hạng mục B: dừng mềm ở ranh giới tool call khi hạn mức sắp hết, Stop cho dừng, không gọi router, dừng cứng dự phòng.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, FOUR, SEARCH, base, conductor, plan, spawnTool, submit } from '../support/engine'
import { quotaMeter, session, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const EDIT = { tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as const

describe('0.6.0 B: dừng mềm khi vào vùng dừng', () => {
  test('dưới ngưỡng: tool chạy bình thường; qua ngưỡng: Edit, Bash, Read, Agent đều bị từ chối, plan được qua', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [session(50)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    meter.set([session(96)])
    await clock.advance(10_000)
    for (const call of [EDIT, { tool: 'Bash', command: 'npm test' }, { tool: 'Read', file_path: 'src/a.ts' }, { tool: 'Agent', description: 'x', prompt: 'y', subagent_type: 'general-purpose' }]) {
      const out = await $.tool.call(call as never)
      expect(out.deny).toContain('hạn mức phiên')
      expect(out.deny).toContain('checkpoint')
    }
    expect((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })).deny).toBeUndefined()
  })

  test('tuần qua ngưỡng 98 cũng dừng; số đo của cửa sổ đã làm mới thì không', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [week(98)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức tuần')
    meter.set([week(99, '1970-01-01T00:00:00.000Z')])
    await clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('cửa sổ làm mới thì tự mở khóa (số tươi, không tin cờ cũ)', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [session(97)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call(EDIT)).deny).toBeDefined()
    meter.set([session(3)])
    await clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('subagent cũng bị từ chối', {}, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call({ ...EDIT, agentId: 'agent-1' } as never)).deny).toContain('hạn mức')
  })

  test('không có số đo, kind lạ, usage lỗi: không dừng, không ném lỗi', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    meter.set([{ kind: 'spend_limit', percentUsed: 130 }])
    await clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
    meter.failing = true
    await clock.advance(10_000)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('quotaGuard false: qua ngưỡng vẫn không dừng', { options: { quotaGuard: false } }, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  })

  test('ngưỡng tùy chỉnh 90: dừng khi phiên mới dùng 10%', { options: { pauseSessionRemainingPct: 90 } }, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await $.tool.call(EDIT)).deny).toContain('hạn mức phiên')
  })
})

describe('0.6.0 B: Stop, thông báo cuối turn, router', () => {
  test('Stop không bị chặn bởi checklist còn mở khi đang dừng vì hạn mức', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call(EDIT)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn')
    meter.set([session(97)])
    await clock.advance(10_000)
    await $.tool.call(EDIT)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  })

  test('đang dừng: prompt mới không gọi router, có dòng context báo trạng thái', {}, async ($, on) => {
    const seen = base(on)
    const { clock } = seen
    quotaMeter(on, [session(97)])
    await submit($, COMPLEX_PROMPT)
    const routed = seen.routed.length
    expect(routed).toBe(0)
    expect(seen.contexts[0]?.join('\n')).toContain('hạn mức')
    expect(seen.contexts[0]?.join('\n')).toContain('/conductor resume force')
  })

  test('đang dừng: Agent bị từ chối trước khi router chấm subagent', {}, async ($, on) => {
    const seen = base(on)
    const { clock } = seen
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    meter.set([session(99)])
    await clock.advance(10_000)
    const out = await $.tool.call({ tool: 'Agent', description: 'Tìm chỗ gọi charge', prompt: 'tìm', subagent_type: 'Explore' } as never)
    expect(out.deny).toContain('hạn mức')
    expect(seen.agentRouted.length).toBe(0)
  })

  test('đang dừng: không có cảnh báo cuối turn và không chạy semanticDrift', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on)
    const { clock } = seen
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    meter.set([session(97)])
    await clock.advance(10_000)
    for (let i = 0; i < 6; i++) await $.tool.call({ ...EDIT, file_path: `src/${i}.ts` })
    const toastsBefore = seen.toasts.length
    await $.turn.complete({ turnId: 't1', answer: 'dừng', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.drift.length).toBe(0)
    expect(seen.toasts.slice(toastsBefore).filter(t => t.includes('thay đổi'))).toEqual([])
  })

  test('đang dừng: cập nhật bước mở cuối không in qualityNotice hay pendingNotice', {}, async ($, on) => {
    const { clock } = base(on, { router: () => plan({ goal: 'G', quality: ['Q'], depth: 'hard', volume: 'large' }) })
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }] })
    meter.set([session(97)])
    await clock.advance(10_000)
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(out).not.toContain('Checklist đã đóng hết')
    expect(out).not.toContain('Không còn bước mở')
  })
})

describe('0.6.0 B: việc giao subagent đang chạy được đánh dấu để làm lại', () => {
  test('agent đang chạy khi vào vùng dừng: việc đó chuyển sang lỗi (giao lại được), không phải xong', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    meter.set([session(98)])
    await clock.advance(10_000)
    expect((await $.tool.call({ tool: 'Grep', pattern: 'charge', agentId: 'ag1' } as never)).deny).toContain('hạn mức')
    await $.turn.complete({ turnId: 'ta', agentId: 'ag1', answer: 'dừng', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.: lỗi, chưa giao lại')
  })
})

describe('0.6.0 B: dừng cứng dự phòng', () => {
  test('lần từ chối thứ ba trong cùng turn gọi abort đúng một lần với đúng turnId; hai lần đầu thì không', {}, async ($, on) => {
    const { clock } = base(on)
    const meter = quotaMeter(on, [session(10)])
    const aborted: string[] = []
    on('turn.abort', (_$, e) => {
      aborted.push(e.turnId)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'làm', turnId: 'tx' })
    meter.set([session(97)])
    await clock.advance(10_000)
    await $.tool.call(EDIT)
    await $.tool.call(EDIT)
    expect(aborted).toEqual([])
    await $.tool.call(EDIT)
    expect(aborted).toEqual(['tx'])
    await $.tool.call(EDIT)
    expect(aborted).toEqual(['tx'])
  })

  test('từ chối subagent không tính vào bộ đếm dừng cứng; session.measure không bao giờ gọi abort', {}, async ($, on) => {
    const { clock } = base(on)
    quotaMeter(on, [session(99)])
    const aborted: string[] = []
    on('turn.abort', (_$, e) => {
      aborted.push(e.turnId)
      return { value: undefined }
    })
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'làm', turnId: 'ty' })
    for (let i = 0; i < 4; i++) await $.tool.call({ ...EDIT, agentId: 'agent-9' } as never)
    await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(99)], changed: ['rateLimits'] } as never)
    expect(aborted).toEqual([])
  })
})
