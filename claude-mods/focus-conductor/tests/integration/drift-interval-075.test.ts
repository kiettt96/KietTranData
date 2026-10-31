// 0.7.5 C2: khoảng cách tối thiểu giữa hai lượt kiểm lạc đề là option driftIntervalMinutes (mặc định 10, kẹp 5 đến 120);
// mô tả semanticDrift trong plugin.json nói đúng nhịp checkpoint hiện tại (kiểm bằng claude plugin validate và đọc lại, kit
// không nạp được tệp JSON).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as C from '../../hooks/context'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'

const edit = ($: Engine, name: string) => $.tool.call({ tool: 'Edit', file_path: `src/${name}.ts`, old_string: 'x', new_string: 'y' })
const MINUTE = 60_000
const names = (from: number, count: number) => Array.from({ length: count }, (_, i) => `f${from + i}`)

describe('0.7.5 C2: driftIntervalMinutes', () => {
  test('đặt 30: checkpoint sau 20 phút không hỏi, sau hơn 30 phút thì hỏi', { options: { driftIntervalMinutes: 30 } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of names(0, 5)) await edit($, f)
    expect(seen.drift.length).toBe(1)
    await seen.clock.advance(20 * MINUTE)
    for (const f of names(5, 5)) await edit($, f)
    expect(seen.drift.length).toBe(1)
    await seen.clock.advance(11 * MINUTE)
    for (const f of names(10, 10)) await edit($, f)
    expect(seen.drift.length).toBe(2)
  })

  test('kẹp 5 đến 120 phút; không đặt hay sai kiểu là 10', () => {
    const interval = (C as Record<string, unknown>)['driftIntervalMs'] as ((raw: unknown) => number) | undefined
    expect(interval?.(undefined)).toBe(10 * MINUTE)
    expect(interval?.('abc')).toBe(10 * MINUTE)
    expect(interval?.(1)).toBe(5 * MINUTE)
    expect(interval?.(500)).toBe(120 * MINUTE)
    expect(interval?.(30)).toBe(30 * MINUTE)
  })
})
