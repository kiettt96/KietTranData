// 0.8.7 H1: phiên không tương tác với headlessRouting mặc định (off) làm mod chạy như mode off (0.8.0 A13). /conductor status và câu trả
// lời của /conductor reroute nêu lý do và cách bật (option headlessRouting là auto rồi mở phiên mới, hoặc /conductor mode auto) ngay sau
// chữ "Chế độ off", tối đa 160 ký tự. Mode off do người dùng tự đặt không có phần này. Không thêm dòng context nào.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium' })
const PRESENTATION = { isFullscreen: false, columns: 80 }
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const firstLine = async ($: Engine) => (await run($, 'status')).split('\n')[0] ?? ''

function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  return seen
}
const start = ($: Engine, isInteractive: boolean) => $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive } as never)

describe('0.8.7 H1: status nêu lý do mode off ở phiên không tương tác', () => {
  test('phiên không tương tác, option mặc định: có "Chế độ off", headlessRouting và /conductor mode auto; phần thêm không quá 160 ký tự', {}, async ($, on) => {
    setup(on)
    await start($, false)
    const line = await firstLine($)
    expect(line.startsWith('Chế độ off')).toBe(true)
    expect(line).toContain('headlessRouting')
    expect(line).toContain('/conductor mode auto')
    expect(line.replace('Chế độ off', '').replace('. Chưa có mục tiêu.', '').length).toBeLessThanOrEqual(160)
  })

  test('đã có mục tiêu (dòng đầu của nhánh có mục tiêu) cũng nêu lý do', {}, async ($, on) => {
    setup(on)
    await start($, false)
    await submit($, 'Sửa hàm tính phí')
    await run($, 'goal Sửa hàm tính phí')
    const text = await run($, 'status')
    expect(text.split('\n')[0] ?? '').toContain('headlessRouting')
  })

  test('rồi /conductor mode auto: "Chế độ auto", không có headlessRouting', {}, async ($, on) => {
    setup(on)
    await start($, false)
    await run($, 'mode auto')
    const line = await firstLine($)
    expect(line.startsWith('Chế độ auto')).toBe(true)
    expect(await run($, 'status')).not.toContain('headlessRouting')
  })

  test('phiên không tương tác với headlessRouting auto: "Chế độ auto", không có phần lý do', { options: { headlessRouting: 'auto' } }, async ($, on) => {
    setup(on)
    await start($, false)
    expect((await firstLine($)).startsWith('Chế độ auto')).toBe(true)
    expect(await run($, 'status')).not.toContain('headlessRouting')
  })

  test('phiên tương tác, /conductor mode off: "Chế độ off", không có headlessRouting', {}, async ($, on) => {
    setup(on)
    await start($, true)
    await run($, 'mode off')
    expect((await firstLine($)).startsWith('Chế độ off')).toBe(true)
    expect(await run($, 'status')).not.toContain('headlessRouting')
  })

  test('phiên tương tác, option routing off: "Chế độ off", không có headlessRouting', { options: { routing: 'off' } }, async ($, on) => {
    setup(on)
    await start($, true)
    expect((await firstLine($)).startsWith('Chế độ off')).toBe(true)
    expect(await run($, 'status')).not.toContain('headlessRouting')
  })

  test('phiên không tương tác, mặc định: /conductor reroute nêu headlessRouting', {}, async ($, on) => {
    setup(on)
    await start($, false)
    expect(await run($, 'reroute')).toContain('headlessRouting')
  })

  test('phiên không tương tác, mặc định: prompt gửi đi không thêm dòng context nào', {}, async ($, on) => {
    const seen = setup(on)
    await start($, false)
    await submit($, 'Sửa hàm tính phí')
    expect(seen.contexts.at(-1) ?? []).toEqual([])
  })
})
