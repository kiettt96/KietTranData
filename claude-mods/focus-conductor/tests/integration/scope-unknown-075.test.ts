// 0.7.5 B1: cảnh báo "lệnh ghi không xác định được file đích" khóa theo trình chạy và đường dẫn script (bỏ tham số), giữ theo
// mục tiêu (không lặp lại ở mỗi turn), mức vàng và không bật toast; script khác hay mục tiêu mới thì cảnh báo lại.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { base, plan, submit } from '../support/engine'
import { newTracker, observe } from '../../hooks/lib/drift'
import { severityOf } from '../../hooks/ui/style'

const UNKNOWN = 'không xác định được file đích'
const run = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ context?: string[] }>
const warned = (out: { context?: string[] }) => (out.context ?? []).some(c => c.includes(UNKNOWN))
const SCRIPT = '/usr/bin/python3 -B /repo/scripts/ghi_du_lieu.py'
const scoped = (goal: string) => plan({ goal, scope: ['src/'], depth: 'hard', volume: 'large' })

describe('0.7.5 B1: khóa theo script, giữ theo mục tiêu', () => {
  test('cùng script khác tham số (--lo 1, 2, 3) và qua turn mới: chỉ cảnh báo một lần', {}, async ($, on) => {
    base(on, { router: request => scoped(request.split('\n')[0] ?? 'g') })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Ghi dữ liệu các lô vào bảng tổng')
    await $.turn.start({ text: 'Ghi dữ liệu các lô vào bảng tổng', turnId: 't1' })
    expect(warned(await run($, `${SCRIPT} --lo 1`))).toBe(true)
    expect(warned(await run($, `${SCRIPT} --lo 2`))).toBe(false)
    expect(warned(await run($, `${SCRIPT} --lo 3 --ghi`))).toBe(false)
    await $.turn.start({ text: 'tiếp', turnId: 't2' })
    expect(warned(await run($, `${SCRIPT} --lo 4`))).toBe(false)
  })

  test('script khác thì cảnh báo; mục tiêu mới thì cảnh báo lại', {}, async ($, on) => {
    base(on, { router: request => scoped(request.split('\n')[0] ?? 'g') })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Ghi dữ liệu các lô vào bảng tổng')
    await $.turn.start({ text: 'x', turnId: 't1' })
    expect(warned(await run($, `${SCRIPT} --lo 1`))).toBe(true)
    expect(warned(await run($, '/usr/bin/python3 -B /repo/scripts/loc_tin.py --lo 1'))).toBe(true)
    await submit($, 'Làm báo cáo tuần cho nhóm vận hành')
    await $.turn.start({ text: 'y', turnId: 't2' })
    expect(warned(await run($, `${SCRIPT} --lo 9`))).toBe(true)
  })

  test('không bật toast cho cảnh báo này', {}, async ($, on) => {
    const seen = base(on, { router: request => scoped(request.split('\n')[0] ?? 'g') })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Ghi dữ liệu các lô vào bảng tổng')
    await run($, `${SCRIPT} --lo 1`)
    expect(seen.toasts.some(t => t.includes(UNKNOWN))).toBe(false)
  })
})

describe('0.7.5 B1: mức vàng', () => {
  test('phát hiện có loại riêng, mức cảnh báo (vàng), không phải vi phạm phạm vi (đỏ)', () => {
    const findings = observe(newTracker('t'), { tool: 'Bash', input: { command: `${SCRIPT} --lo 1` }, isError: false, isReadOnly: false }, { goal: 'g', scopePaths: ['src/'], tier: 'complex', root: '/repo' }, [])
    const unknown = findings.find(f => f.text.includes(UNKNOWN))
    expect(unknown).toBeDefined()
    expect(unknown?.kind).not.toBe('scope')
    expect(severityOf(unknown!.kind as never)).toBe('warning')
  })
})
