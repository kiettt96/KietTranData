// 0.7.4 điểm 1 (tích hợp): lời gọi Agent qua chuỗi hook của mod. Model Claude ghi là mức sàn cho cả kết quả router
// lẫn việc đã phân; bỏ lượt router khi họ và effort đã chốt ở mức trần; ràng buộc model của brief tới router chấm subagent.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, FOUR, base, plan, step, submit } from '../support/engine'

type Sent = { model?: string; effort?: string }

function capture(on: On): Sent[] {
  const calls: Sent[] = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    calls.push({ model: e.model, effort: e.effort })
    return { deny: 'test: đã ghi nhận đầu vào' }
  })
  return calls
}

function logLines(on: On): () => Array<Record<string, unknown>> {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

const agent = ($: Engine, description: string, prompt: string, over: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Agent', description, prompt, ...over } as never)

describe('0.7.4 1a: sàn nâng', () => {
  test('Claude ghi sonnet, router chấm haiku: gửi sonnet, effort của router', {}, async ($, on) => {
    const seen = base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Tìm file auth', 'Tìm trong codebase các file xử lý đăng nhập.', { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(1)
    expect(calls).toEqual([{ model: 'sonnet', effort: 'low' }])
  })

  test('việc đã phân haiku, Claude ghi sonnet: gửi sonnet', {}, async ($, on) => {
    base(on)
    const calls = capture(on)
    await submit($, FOUR)
    await agent($, 'Việc 1: tìm chỗ gọi charge', 'Tìm trong src/ chỗ gọi charge', { model: 'sonnet' })
    expect(calls).toEqual([{ model: 'sonnet', effort: 'low' }])
  })

  test('sàn effort khi Claude ghi effort: router chấm medium, Claude ghi high thì gửi high', {}, async ($, on) => {
    base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Sửa nhỏ', 'Sửa chú thích trong file cấu hình', { model: 'sonnet', effort: 'high' })
    expect(calls).toEqual([{ model: 'sonnet', effort: 'high' }])
  })

  test('sàn đổi lựa chọn thì nhật ký quyết định có dòng agent-floor', { options: { decisionLog: '/tmp/fc-floor-074.jsonl' } }, async ($, on) => {
    base(on)
    const lines = logLines(on)
    capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Tìm file auth', 'Tìm trong codebase các file xử lý đăng nhập.', { model: 'sonnet' })
    expect(lines().find(l => l['kind'] === 'agent-floor')).toMatchObject({ kind: 'agent-floor', from: 'haiku/low', to: 'sonnet/low', claimed: 'sonnet' })
  })

  test('Claude không ghi model: như cũ, router chấm haiku thì gửi haiku, không có dòng agent-floor', { options: { decisionLog: '/tmp/fc-floor-074b.jsonl' } }, async ($, on) => {
    base(on)
    const lines = logLines(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Tìm file auth', 'Tìm trong codebase các file xử lý đăng nhập.')
    expect(calls).toEqual([{ model: 'haiku', effort: 'low' }])
    expect(lines().some(l => l['kind'] === 'agent-floor')).toBe(false)
  })

  test('fable không có allowFable vẫn về opus', {}, async ($, on) => {
    base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Tìm file auth', 'Tìm trong codebase các file xử lý đăng nhập.', { model: 'fable' })
    expect(calls[0]?.model).toBe('opus')
  })

  test('sessionModel ceiling vẫn kẹp khi Claude ghi opus', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await agent($, 'Tìm file auth', 'Tìm trong codebase các file xử lý đăng nhập.', { model: 'opus' })
    expect(calls[0]?.model).toBe('sonnet')
  })
})

describe('0.7.4 1b: bỏ lượt router khi họ và effort đã chốt', () => {
  test('Claude ghi opus và effort, allowFable tắt: router không được gọi, gửi đúng lựa chọn, nhật ký có dòng', { options: { decisionLog: '/tmp/fc-floor-074c.jsonl' } }, async ($, on) => {
    const seen = base(on)
    const lines = logLines(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Rà bảo mật', 'Rà bảo mật luồng thanh toán', { model: 'opus', effort: 'high' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls).toEqual([{ model: 'opus', effort: 'high' }])
    expect(lines().find(l => l['kind'] === 'agent-floor')).toMatchObject({ kind: 'agent-floor', skip: true, claimed: 'opus/high' })
  })

  test('Claude ghi opus mà không ghi effort: router vẫn chấm effort', {}, async ($, on) => {
    const seen = base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await agent($, 'Rà bảo mật', 'Rà bảo mật luồng thanh toán', { model: 'opus' })
    expect(seen.agentRouted.length).toBe(1)
    expect(calls).toEqual([{ model: 'opus', effort: 'high' }])
  })

  test('sessionModel fixed, Claude không ghi effort: router vẫn được gọi', { options: { sessionModel: 'fixed' } }, async ($, on) => {
    const seen = base(on)
    capture(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await agent($, 'Sửa nhỏ', 'Sửa chú thích', { model: 'sonnet' })
    expect(seen.agentRouted.length).toBe(1)
  })

  test('sessionModel fixed, Claude ghi model của phiên và effort: không gọi router', { options: { sessionModel: 'fixed' } }, async ($, on) => {
    const seen = base(on)
    const calls = capture(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-sonnet-5-5' })
    await agent($, 'Sửa nhỏ', 'Sửa chú thích', { model: 'sonnet', effort: 'low' })
    expect(seen.agentRouted.length).toBe(0)
    expect(calls).toEqual([{ model: 'sonnet', effort: 'low' }])
  })
})

describe('0.7.4 1: ràng buộc model của brief tới router chấm subagent', () => {
  test('Claude không ghi model, brief có quy định model: request chấm subagent có quy định đó và model của phiên', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Cập nhật dữ liệu', constraints: ['Việc lọc tin chạy sonnet', 'Không tạo bộ kiểm mới'] }) })
    capture(on)
    await submit($, 'Cập nhật dữ liệu theo các bước')
    await step($, seen, { model: 'claude-opus-5-5' })
    await agent($, 'Lọc tin lô 1', 'Lọc tin theo tiêu chí')
    expect(seen.agentRouted[0]).toContain('  - Việc lọc tin chạy sonnet\n  - Không tạo bộ kiểm mới')
    expect(seen.agentRouted[0]).toContain('Session model (the model the user runs this session on): opus.')
  })

  test('router đọc prompt nhận dòng model của phiên từ lượt thứ hai (model của phiên biết từ step đầu)', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { model: 'claude-opus-5-5' })
    await submit($, 'Thêm bước đo hiệu năng cho module thanh toán sau khi refactor xong')
    expect(seen.routed[0]).not.toContain('Session model')
    expect(seen.routed[1]).toContain('Session model (the model the user runs this session on): opus.')
  })
})
