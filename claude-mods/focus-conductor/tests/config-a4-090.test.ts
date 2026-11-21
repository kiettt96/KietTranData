// 0.9.0 A4: ba điểm cấu hình. conductorFallback trùng họ điều phối chính hay mang giá trị không hợp lệ thì mod cảnh báo một lần khi nạp
// (toast và Core.warnings); routerMaxWait chỉ nhận số và chuỗi số, true hay mảng thì dùng mặc định 1.800 giây.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as Conductor from '../hooks/lib/conductor'
import { ROUTER_MAX_WAIT_MS, routerMaxWaitOf } from '../hooks/lib/reading'
import { base, plan, submit } from './support/engine'

const issuesOf = (options: Record<string, unknown>): string[] =>
  ((Conductor as { conductorFallbackIssues?: (o: Record<string, unknown>) => string[] }).conductorFallbackIssues ?? (() => []))(options)
const PRESENTATION = { isFullscreen: false, columns: 80 }
const run = async ($: Engine, args: string) => String(((await $.command.run({ command: 'conductor', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')

describe('0.9.0 A4: routerMaxWait chỉ nhận số và chuỗi số', () => {
  test('true, mảng, đối tượng, chuỗi chữ: mặc định', () => {
    for (const value of [true, [5], [300], { a: 1 }, 'abc', '12s']) expect(routerMaxWaitOf(value), JSON.stringify(value)).toBe(ROUTER_MAX_WAIT_MS)
  })
  test('số và chuỗi số vẫn đọc và kẹp như trước', () => {
    expect([routerMaxWaitOf(300), routerMaxWaitOf('300'), routerMaxWaitOf(' 600 '), routerMaxWaitOf('50')]).toEqual([300_000, 300_000, 600_000, 120_000])
  })
})

describe('0.9.0 A4: cảnh báo cấu hình conductorFallback', () => {
  test('giá trị không hợp lệ: một cảnh báo nêu giá trị và mod dùng opus', () => {
    const issues = issuesOf({ conductor: 'fable', conductorFallback: 'gpt' })
    expect(issues.length).toBe(1)
    expect(issues[0]).toContain('"gpt"')
    expect(issues[0]).toContain('opus')
  })
  test('trùng họ điều phối chính: một cảnh báo; conductor off thì không báo trùng', () => {
    expect(issuesOf({ conductor: 'opus', conductorFallback: 'opus' })).toEqual(['conductorFallback trùng họ điều phối chính opus: không có họ dự phòng'])
    expect(issuesOf({ conductor: 'opus' }).length).toBe(1)
    expect(issuesOf({ conductor: 'off', conductorFallback: 'opus' })).toEqual([])
  })
  test('cấu hình hợp lệ: không báo', () => {
    for (const options of [{ conductor: 'fable' }, { conductor: 'fable', conductorFallback: 'sonnet' }, { conductor: 'fable', conductorFallback: 'off' }]) expect(issuesOf(options)).toEqual([])
  })
})

describe('0.9.0 A4: toàn luồng, cảnh báo một lần khi nạp', () => {
  test('conductor opus, conductorFallback opus: một toast sau session.start, không lặp ở prompt sau; status có cảnh báo', { options: { planApproval: 'off', conductor: 'opus', conductorFallback: 'opus' } }, async ($, on) => {
    const seen = base(on, { router: () => plan() })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    await submit($, 'Sửa lỗi chính tả')
    await submit($, 'Sửa thêm một chỗ')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    expect(seen.toasts.filter(t => t.includes('conductorFallback')).length).toBe(1)
  })
})
