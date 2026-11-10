// 0.8.0 A13: phiên không tương tác (claude -p, SDK; SessionStartInput.isInteractive false) với headlessRouting off (mặc định): mod chạy như
// routing off trong phiên đó (không gọi router, không đổi model hay effort, không chặn Stop) và ghi một dòng headless-off. headlessRouting auto
// thì điều phối như phiên thường. Phiên tương tác không đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, step, submit } from '../support/engine'

const LOG = '/tmp/fc-headless-a13-080.jsonl'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'opus', effort: 'high' } })

function setup(on: On) {
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

const start = ($: Engine, isInteractive: boolean) => $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

describe('0.8.0 A13: phiên không tương tác', () => {
  test('headlessRouting mặc định (off): không gọi router, có dòng headless-off, Stop không chặn', { options: { decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await start($, false)
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    expect(lines().some(l => l['kind'] === 'route')).toBe(false)
    expect(lines().filter(l => l['kind'] === 'headless-off').length).toBe(1)
    expect(await stop($)).toBe('')
  })

  test('headlessRouting auto: điều phối như phiên thường (có dòng route)', { options: { planApproval: 'off', decisionLog: LOG, headlessRouting: 'auto' } }, async ($, on) => {
    const { lines } = setup(on)
    await start($, false)
    await submit($, 'Sửa hàm tính phí')
    expect(lines().some(l => l['kind'] === 'route')).toBe(true)
    expect(lines().some(l => l['kind'] === 'headless-off')).toBe(false)
  })

  test('phiên tương tác: không đổi (có dòng route, không có headless-off)', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { lines } = setup(on)
    await start($, true)
    await submit($, 'Sửa hàm tính phí')
    expect(lines().some(l => l['kind'] === 'route')).toBe(true)
    expect(lines().some(l => l['kind'] === 'headless-off')).toBe(false)
  })

  test('phiên không tương tác rồi mở lại tương tác: mod điều phối lại', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { lines } = setup(on)
    await start($, false)
    await start($, true)
    await submit($, 'Sửa hàm tính phí')
    expect(lines().some(l => l['kind'] === 'route')).toBe(true)
  })
})
