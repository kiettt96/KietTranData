// Test tích hợp: chi phí luồng chính, bảng giá trong /conductor status, log quyết định và hiệu chỉnh.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { BIG_USAGE, COMPLEX_PROMPT, FOUR, base, conductor, spawnTool, step, submit } from '../support/engine'

describe('chi phí luồng chính', () => {
  test('turn luồng chính kết thúc: chi phí đo được cộng vào nhóm luồng chính', {}, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('luồng chính $0.700 trong 1 lượt')
    expect(status).toContain('subagent $0.0000 trong 0 lượt')
  })

  test('turn chưa có mục tiêu vẫn được cộng vào sổ', {}, async ($, on) => {
    base(on)
    on('turn.complete', () => ({ text: '' }))
    await $.turn.complete({ turnId: 't0', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('luồng chính $0.700 trong 1 lượt')
  })

  test('chế độ suggest không áp route nên không hiệu chỉnh ước lượng', { options: { routing: 'suggest' } }, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).not.toContain('Hiệu chỉnh ước lượng')
  })

  test('chế độ auto áp route thì có hiệu chỉnh ước lượng', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).toContain('Hiệu chỉnh ước lượng theo 1 lần đo')
  })
})

describe('0.5.0: bảng giá trong /conductor status', () => {
  test('status ghi ngày bảng giá và phần ghi đè theo option prices', { options: { prices: 'opus=5/25' } }, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'status')).text)).toContain('Bảng giá kèm mod ngày 2026-10-13, ghi đè cho opus')
  })
})

describe('0.5.0: log quyết định và hiệu chỉnh', () => {
  test('log quyết định nối tiếp file cũ khi phiên bắt đầu', { options: { decisionLog: '/tmp/fc-old.jsonl' } }, async ($, on) => {
    base(on)
    const writes: string[] = []
    on('fs.read', () => ({ value: '{"at":"2026-10-01T00:00:00.000Z","kind":"route"}\nkhông phải json\n' }))
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await submit($, COMPLEX_PROMPT)
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('{"at":"2026-10-01T00:00:00.000Z","kind":"route"}')
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ kind: 'route' })
  })

  test('agent không có kết quả chấm của router không được dùng để hiệu chỉnh ước lượng', {}, async ($, on) => {
    const seen = base(on, { agent: () => null })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a-raw' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, FOUR)
    await spawnTool($, 'tu-raw', 'Rà soát phần lạ', 'Rà soát phần lạ của module')
    await $.turn.complete({ turnId: 'x', agentId: 'a-raw', answer: '', durationMs: 1, isAborted: false, reason: 'answer', usage: { ...BIG_USAGE, model: 'claude-sonnet-5-5' } } as never)
    expect(String((await conductor($, 'status')).text)).not.toContain('Hiệu chỉnh ước lượng')
    void seen
  })
})
