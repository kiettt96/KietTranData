// 0.8.0 A12: hết lượt W4 vẫn ghi bước blocked, nhưng mục W4 lưu trạng thái và note cũ của bước. Lần chạy đạt phủ mục đó trả bước về trạng
// thái và note cũ (verified về done), ghi retry-cleared và toast; không trả nếu Claude đã tự sửa bước sau khi mod ghi blocked. Câu chặn khi hết
// lượt nêu số bước mod đã ghi blocked và nói lần chạy đạt sẽ tự gỡ. Mục W4 tạo từ lần chạy của subagent: luồng chính nhận một câu (tối đa 160
// ký tự) ở kết quả tool kế tiếp (kết quả Agent khi subagent trả về), một lần mỗi mục.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const LOG = '/tmp/fc-retry-restore-a12-080.jsonl'

function setup(on: On) {
  const passing = new Set<string>()
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true as const }
  })
  // `entered` mở khi lời gọi Agent đã qua hook của mod và tới engine (lúc engine khởi động subagent); Agent trả kết quả khi test mở `release`.
  let release: () => void = () => undefined
  let enter: () => void = () => undefined
  let gate: Promise<void> = Promise.resolve()
  let entered: Promise<void> = Promise.resolve()
  const hold = () => {
    gate = new Promise(resolve => {
      release = resolve
    })
    entered = new Promise(resolve => {
      enter = resolve
    })
  }
  on('tool.call', { tool: 'Agent' }, async () => {
    enter()
    await gate
    return { result: 'đã xong' }
  })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, passing, lines, hold, release: () => release(), entered: () => entered }
}

const bash = ($: Engine, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<{ context?: string[] }>
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const row = async ($: Engine, id: number) => (await shown($)).split('\n').find(line => line.includes(` ${id}. `)) ?? ''

/** Hai bước; sửa file, `npm test` lỗi, bước 1 đóng done kèm note, rồi ba lần Stop xen chạy lại vẫn lỗi cho tới khi hết lượt. */
async function exhaust($: Engine, seen: Seen): Promise<string> {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }, { title: 'Ghi tài liệu' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await bash($, 'npm test')
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done', note: 'đã đổi công thức phí' })
  await stop($)
  await bash($, 'npm test')
  await stop($, true)
  await bash($, 'npm test')
  return stop($, true)
}

describe('0.8.0 A12: hết lượt rồi chạy lại đạt', () => {
  test('bước 1 done có note: hết lượt thành blocked; chạy lại đạt thì về done, note cũ còn, có dòng retry-cleared và toast', { options: { decisionLog: LOG } }, async ($, on) => {
    const { seen, passing, lines } = setup(on)
    await exhaust($, seen)
    expect(await row($, 1)).toContain('[b] 1.')
    passing.add('npm test')
    await bash($, 'npm test')
    const after = await row($, 1)
    expect(after).not.toContain('[b] 1.')
    expect(after).toContain('đã đổi công thức phí')
    expect(lines().some(l => l['kind'] === 'retry-cleared')).toBe(true)
    expect(seen.toasts.some(t => t.includes('npm test'))).toBe(true)
  })

  test('Claude tự sửa bước 1 sau khi mod ghi blocked: lần chạy đạt không ghi đè', {}, async ($, on) => {
    const { seen, passing } = setup(on)
    await exhaust($, seen)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'blocked', note: 'chờ chủ mod cung cấp bảng giá' })
    passing.add('npm test')
    await bash($, 'npm test')
    const after = await row($, 1)
    expect(after).toContain('[b] 1.')
    expect(after).toContain('chờ chủ mod cung cấp bảng giá')
  })

  test('câu chặn khi hết lượt nêu số bước mod đã ghi blocked và nói lần chạy đạt sẽ tự gỡ', {}, async ($, on) => {
    const { seen } = setup(on)
    const reason = await exhaust($, seen)
    expect(reason).toContain('Chưa đạt yêu cầu')
    expect(reason).toContain('1 bước')
    expect(reason).toContain('tự gỡ')
    expect(reason.length).toBeLessThanOrEqual(1200)
  })
})

describe('0.8.0 A12: lỗi do subagent chạy', () => {
  test('subagent chạy lệnh kiểm lỗi: kết quả tool Agent có câu báo, đúng một lần', {}, async ($, on) => {
    const { seen, hold, release, entered } = setup(on)
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    hold()
    const call = $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Chạy bộ kiểm phí', prompt: 'Chạy npm test' } as never) as Promise<{ context?: string[] }>
    await entered()
    await $.agent.spawn({ prompt: 'Chạy npm test', description: 'Chạy bộ kiểm phí', tool_use_id: 'u1' } as never)
    await bash($, 'npm test', 'a-u1')
    await bash($, 'npm test', 'a-u1')
    release()
    const done = await call
    const notes = (done.context ?? []).filter(c => c.includes('npm test') && c.includes('Chạy bộ kiểm phí'))
    expect(notes.length).toBe(1)
    expect(notes[0]?.length ?? 0).toBeLessThanOrEqual(160)
    const next = await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as { context?: string[] }
    expect((next.context ?? []).some(c => c.includes('Chạy bộ kiểm phí'))).toBe(false)
  })
})
