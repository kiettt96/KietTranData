// 0.7.8 G8: ba chỗ nhỏ của router. (1) confidence thiếu là undefined; ba chỗ đọc prompt hỏi lại đúng một lần, chấm subagent và kiểm
// lạc đề giữ như 0.7.7. (2) Prompt dài hơn REQUEST_CHARS bị lược phần giữa thì có cảnh báo và một dòng context. (3) Tệp đính kèm: engine
// 2.1.296 không đưa chữ của tệp vào prompt.submit, chỉ ghi giới hạn vào README.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LOW_CONFIDENCE, askRouter, parseRoute, routerRequest } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import type { ModelFamily } from '../../types'
import { PANE, base, plan, spawnTool, submit } from '../support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const CLIPPED = 'router chưa đọc phần giữa'

function asker(replies: string[]) {
  let calls = 0
  const ask = async () => {
    calls += 1
    const reply = replies.shift()
    return reply === undefined ? null : { isAnswered: true as const, text: reply, usage: USAGE }
  }
  return { ask, calls: () => calls }
}

const request = routerRequest({ text: 'Sửa lỗi đăng nhập', prev: null, ran: null, policy: OPEN, model: 'sonnet' })
const parse = (text: string) => parseRoute(text, OPEN)
const reply = (over: Record<string, unknown>) => JSON.stringify(plan({ goal: 'Sửa lỗi', ...over }))

function agentHooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return texts
}

describe('0.7.8 G8 (1): confidence thiếu', () => {
  test('parseRoute: thiếu confidence thì undefined, không còn là 1', () => {
    expect(parseRoute(reply({ confidence: undefined }), OPEN)?.confidence).toBeUndefined()
    expect(parseRoute(reply({ confidence: 0.6 }), OPEN)?.confidence).toBe(0.6)
  })

  test('bật retryMissingConfidence: thiếu thì hỏi lại một lần; lần hai có 0,9 thì giữ lần hai', async () => {
    const a = asker([reply({ confidence: undefined, goal: 'Lần một' }), reply({ confidence: 0.9, goal: 'Lần hai' })])
    const out = await askRouter(a.ask, request, parse, undefined, { retryMissingConfidence: true })
    expect(a.calls()).toBe(2)
    expect(out.result?.goal).toBe('Lần hai')
  })

  test('bật retryMissingConfidence: cả hai thiếu thì giữ lần đầu', async () => {
    const a = asker([reply({ confidence: undefined, goal: 'Lần một' }), reply({ confidence: undefined, goal: 'Lần hai' })])
    const out = await askRouter(a.ask, request, parse, undefined, { retryMissingConfidence: true })
    expect(a.calls()).toBe(2)
    expect(out.result?.goal).toBe('Lần một')
  })

  test('bật retryMissingConfidence: lần đầu có tin cậy đủ thì không hỏi lại', async () => {
    const a = asker([reply({ confidence: LOW_CONFIDENCE })])
    await askRouter(a.ask, request, parse, undefined, { retryMissingConfidence: true })
    expect(a.calls()).toBe(1)
  })

  test('mặc định (chấm subagent, kiểm lạc đề): thiếu confidence không hỏi lại', async () => {
    const a = asker([reply({ confidence: undefined })])
    const out = await askRouter(a.ask, request, parse)
    expect(a.calls()).toBe(1)
    expect(out.retried).toBe(false)
  })

  test('đọc prompt: router trả JSON thiếu confidence thì được hỏi lại một lần', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa lỗi', confidence: undefined }) })
    await submit($, 'Sửa lỗi đăng nhập')
    expect(seen.routed.length).toBe(2)
  })

  test('mục tiêu mới thiếu confidence khi checklist còn mở không bị giữ thành tiếp nối', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.includes('slugify') ? plan({ goal: 'Viết slugify cho module đăng nhập', confidence: undefined }) : plan({ goal: 'Sửa module đăng nhập' })) })
    await submit($, 'Sửa module đăng nhập')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa module đăng nhập' }] })
    await submit($, 'Viết slugify cho module đăng nhập')
    expect(seen.contexts[1]?.join('\n')).not.toContain('Tiếp nối mục tiêu hiện tại')
  })

  test('chấm subagent thiếu confidence: router chỉ được gọi một lần', {}, async ($, on) => {
    const seen = base(on)
    agentHooks(on)
    await submit($, 'Sửa module đăng nhập')
    await spawnTool($, 'a1', 'Sửa lỗi hiển thị', 'Sửa lỗi hiển thị ở form')
    expect(seen.agentRouted.length).toBe(1)
  })

  test('kiểm lạc đề thiếu confidence: router chỉ được gọi một lần', {}, async ($, on) => {
    const seen = base(on, { drift: () => ({ onTrack: true, why: 'ổn' }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa module đăng nhập')
    for (const f of ['a', 'b', 'c', 'd', 'e']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    expect(seen.drift.length).toBe(1)
  })
})

describe('0.7.8 G8 (2): prompt dài bị lược phần giữa', () => {
  // 0.8.7 L3: router đọc trọn tới sức chứa của model; cửa sổ ngữ cảnh rất nhỏ (option contextWindows) đưa sức chứa về trần cũ 80.000.
  test('prompt 100.000 ký tự: cảnh báo và dòng context (không quá 200 ký tự)', { options: { contextWindows: 'sonnet=1000' } }, async ($, on) => {
    const seen = base(on)
    await submit($, `Sửa module đăng nhập. ${'x'.repeat(100_000)}`)
    const line = (seen.contexts[0] ?? []).join('\n').split('\n').find(l => l.includes(CLIPPED)) ?? ''
    expect(line.length).toBeGreaterThan(0)
    expect(line.length).toBeLessThanOrEqual(200)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes('Prompt dài'))).toBe(true)
  })

  test('prompt 79.000 ký tự: không có cảnh báo hay dòng context', {}, async ($, on) => {
    const seen = base(on)
    await submit($, `Sửa module đăng nhập. ${'x'.repeat(79_000)}`)
    expect((seen.contexts[0] ?? []).join('\n')).not.toContain(CLIPPED)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes('Prompt dài'))).toBe(false)
  })
})
