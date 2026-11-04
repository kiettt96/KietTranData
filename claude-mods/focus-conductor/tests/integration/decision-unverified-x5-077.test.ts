// 0.7.7 X5: cuối turn có cảnh báo chưa kiểm thì nhật ký quyết định (option decisionLog) ghi một dòng `unverified`: số thay đổi, số lệnh kiểm
// đạt, tối đa 3 lệnh kiểm bị loại gần nhất (lệnh cắt 120 ký tự, lý do) và cảnh báo có nhẹ không.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'

const LOG = { options: { decisionLog: '/tmp/fc-unverified-077.jsonl' } }

function logLines(on: On): () => Array<Record<string, unknown>> {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

function setup(on: On, output = 'log') {
  base(on)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: output }))
  on('turn.complete', () => ({ text: '' }))
}

const edit = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const done = ($: Engine) => $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
const unverified = (lines: Array<Record<string, unknown>>) => lines.filter(l => l['kind'] === 'unverified')

describe('0.7.7 X5: dòng unverified trong nhật ký quyết định', () => {
  test('đủ trường, đúng kiểu', LOG, async ($, on) => {
    const lines = logLines(on)
    setup(on)
    await submit($, COMPLEX_PROMPT)
    await edit($)
    await bash($, 'npm test 2>&1 | tail -20')
    await done($)
    const [line] = unverified(lines())
    expect(line).toMatchObject({ kind: 'unverified', mutations: 1, checks: 0, soft: false, rejected: [{ command: 'npm test', reason: 'pipe' }] })
    expect(typeof line?.['at']).toBe('string')
  })

  test('tối đa 3 lệnh bị loại, gần nhất; lệnh cắt 120 ký tự', LOG, async ($, on) => {
    const lines = logLines(on)
    setup(on)
    await submit($, COMPLEX_PROMPT)
    await edit($)
    for (let i = 1; i <= 4; i++) await bash($, `npm test -- --n${i} 2>&1 | tail -20`)
    await bash($, `npm test -- --reporter=${'x'.repeat(200)} 2>&1 | tail -20`)
    await done($)
    const rejected = (unverified(lines())[0]?.['rejected'] ?? []) as Array<{ command: string; reason: string }>
    expect(rejected.length).toBe(3)
    expect(rejected[0]?.command).toBe('npm test -- --n3')
    expect(rejected[2]?.command.length).toBeLessThanOrEqual(120)
  })

  test('chưa bật decisionLog: không ghi file', {}, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.path)
      return { value: undefined }
    })
    setup(on)
    await submit($, COMPLEX_PROMPT)
    await edit($)
    await bash($, 'npm test 2>&1 | tail -20')
    await done($)
    expect(writes.filter(p => p.endsWith('.jsonl'))).toEqual([])
  })

  test('không có cảnh báo chưa kiểm: không có dòng unverified', LOG, async ($, on) => {
    const lines = logLines(on)
    setup(on, '12 passing (3ms)')
    await submit($, COMPLEX_PROMPT)
    await edit($)
    await bash($, 'npm test')
    await done($)
    expect(unverified(lines())).toEqual([])
  })

  test('cảnh báo nhẹ (chỉ sửa tài liệu, đã đọc lại): dòng unverified ghi soft true', LOG, async ($, on) => {
    const lines = logLines(on)
    setup(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, COMPLEX_PROMPT)
    await edit($, 'docs/a.md')
    await $.tool.call({ tool: 'Read', file_path: 'docs/a.md' } as never)
    await done($)
    expect(unverified(lines())[0]).toMatchObject({ kind: 'unverified', mutations: 1, checks: 0, soft: true, rejected: [] })
  })
})
