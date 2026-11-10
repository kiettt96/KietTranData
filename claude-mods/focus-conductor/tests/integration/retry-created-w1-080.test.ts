// 0.8.0 vòng 2 W1: hết lượt W4 mà checklist không có bước doing hay bước vừa đóng thì mod tạo bước "Chưa đạt: <lệnh>" ở trạng thái blocked.
// Lần chạy đạt sau đó của đúng lệnh đóng bước này thành done, note ghi giờ đạt, có dòng retry-cleared; Claude đã sửa note thì giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const LOG = '/tmp/fc-retry-created-w1-080.jsonl'

function setup(on: On) {
  const passing = new Set<string>()
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true as const }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, passing, lines }
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const row = async ($: Engine, id: number) => (await shown($)).split('\n').find(line => line.includes(` ${id}. `)) ?? ''

/** Hai bước còn todo, không bước nào doing hay vừa đóng; `npm test` lỗi qua ba lượt tới khi hết lượt. */
async function exhaust($: Engine, seen: Seen): Promise<void> {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }, { title: 'Ghi tài liệu' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await bash($, 'npm test')
  await stop($)
  await bash($, 'npm test')
  await stop($, true)
  await bash($, 'npm test')
  await stop($, true)
}

describe('0.8.0 vòng 2 W1: bước "Chưa đạt" mod tự tạo', () => {
  test('hết lượt tạo bước 3 blocked; chạy lại đạt thì bước 3 thành done, note có giờ đạt, có dòng retry-cleared', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, passing, lines } = setup(on)
    await exhaust($, seen)
    const before = await row($, 3)
    expect(before).toContain('[b] 3.')
    expect(before).toContain('Chưa đạt: npm test')
    passing.add('npm test')
    await bash($, 'npm test')
    const after = await row($, 3)
    expect(after).not.toContain('[b] 3.')
    expect(after).toContain('[x] 3.')
    expect(after).toMatch(/đã đạt lúc \d{2}:\d{2}/)
    expect(lines().some(l => l['kind'] === 'retry-cleared' && l['step'] === 3)).toBe(true)
  })

  test('Claude sửa note của bước "Chưa đạt" trước lần chạy đạt: bước giữ nguyên', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, passing } = setup(on)
    await exhaust($, seen)
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'blocked', note: 'chờ chủ mod cung cấp bảng giá' })
    passing.add('npm test')
    await bash($, 'npm test')
    const after = await row($, 3)
    expect(after).toContain('[b] 3.')
    expect(after).toContain('chờ chủ mod cung cấp bảng giá')
  })

  test('uiLanguage en: note ghi "passed at HH:MM"', { options: { planApproval: 'off', uiLanguage: 'en' } }, async ($, on) => {
    const { seen, passing } = setup(on)
    await exhaust($, seen)
    passing.add('npm test')
    await bash($, 'npm test')
    expect(await row($, 3)).toMatch(/passed at \d{2}:\d{2}/)
  })
})
