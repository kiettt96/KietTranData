// 0.9.0 vòng 3, đột biến: các nhánh của lệnh đỏ từ nền chưa có ca phủ. Lệnh đỏ từ nền đạt rồi đỏ lại khi chưa sửa gì vẫn là lỗi thường
// (090-N1d); cổng lượt không tăng lượt của mục đỏ từ nền khi có mục thường (090-N2b); subagent tạo mục đỏ từ nền thì câu báo là câu của lệnh
// đỏ từ nền (090-N2d); option off cho câu báo thường (090-N6c); trạng thái lưu có cờ mà option off thì cổng Stop gỡ cờ và chặn (090-N6d);
// mục "Lệnh kiểm chưa đạt" của /conductor status không liệt kê lệnh đỏ từ nền (090-N7c); lần ghi possible trong lần chạy có lệnh kiểm mod nhận
// ra không là thay đổi (vòng 3 B1).

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, runTsc, stopSample } from '../support/baseline-red'
import { callTool, offerAgent, runCommand, sampleGoal } from '../support/closing-sample'
import { step, submit } from '../support/engine'
import { M6_STATE } from '../support/m6-state'
import { checkSignature } from '../../hooks/lib/drift/evidence'

const BASE_LINE = 'đỏ từ trước khi có thay đổi'
const FAIL_LINE = 'Lệnh kiểm chưa đạt'
const GATE = 'Còn lệnh kiểm chưa đạt'
const NPM = 'npm test'
const notice = (out: { context?: string[] }) => (out.context ?? []).find(line => line.includes(TSC)) ?? ''
type Core = { retry?: { items: Array<{ command: string; round: number }> } }

function capture(on: On, into: { core?: Core }, values: Record<string, unknown> = {}) {
  const pending = new Map(Object.entries(values))
  on('state.get', async (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string }
    const read = (await next(e)) as { value?: { value?: unknown; version: number } }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string' && pending.has(ev.key)) return { value: { value: pending.get(ev.key), version: read.value?.version ?? 0 } } as never
    return read as never
  })
  on('state.set', (_$, e, next) => {
    const ev = e as { plugin?: string; key?: string; value?: unknown }
    if (ev.plugin === 'focus-conductor' && typeof ev.key === 'string') {
      pending.delete(ev.key)
      if (ev.key === 'core') into.core = JSON.parse(JSON.stringify(ev.value ?? null)) as Core
    }
    return next(e)
  })
}

describe('0.9.0 vòng 3: nhánh của lệnh đỏ từ nền', () => {
  test('tsc đỏ từ nền, đạt, rồi đỏ lại khi chưa sửa gì: câu báo thường lượt 1/3', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    sample.count = 0
    await runTsc($)
    sample.count = 27
    const line = notice(await runTsc($))
    expect(line).toContain(FAIL_LINE)
    expect(line).toContain('lượt 1/3')
  })

  test('có mục thường lỗi sau thay đổi: Stop tăng lượt của mục thường, mục đỏ từ nền giữ lượt 1', BASE_OPTS(), async ($, on) => {
    const into: { core?: Core } = {}
    capture(on, into)
    const sample = baseSetup(on)
    sample.outputs[NPM] = { text: '1 failed\n', isError: true }
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await callTool($, { tool: 'Bash', command: NPM })
    await closeAll($)
    await stopSample($)
    const items = into.core?.retry?.items ?? []
    expect(items.find(i => i.command === NPM)?.round).toBe(2)
    expect(items.find(i => i.command === TSC)?.round).toBe(1)
  })

  test('subagent chạy tsc đỏ trước mọi thay đổi: luồng chính nhận câu của lệnh đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    const description = 'Kiểm độc lập: thống kê'
    await $.tool.call({ tool: 'Agent', tool_use_id: 's1', description, prompt: 'Rà.' } as never)
    await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: 's1' } as never)
    await $.tool.call({ tool: 'Bash', command: TSC, agentId: 'a-s1' } as never)
    const next = await callTool($, { tool: 'Read', file_path: '/repo/thong-ke.sh' })
    const line = (next.context ?? []).find(c => c.includes(TSC)) ?? ''
    expect(line).toContain(BASE_LINE)
  })

  test('npm test đạt và một script trong cùng lệnh Bash, rồi tsc: tsc đỏ từ nền (lần ghi possible của lần chạy kiểm mod nhận ra)', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    sample.outputs[`${NPM} && bash scripts/gen.sh`] = { text: '3 passed\n' }
    await baseOpen($, sample)
    await callTool($, { tool: 'Bash', command: `${NPM} && bash scripts/gen.sh` })
    expect(notice(await runTsc($))).toContain(BASE_LINE)
  })

  test('baselineChecks off: lần chạy đầu có câu báo thường', BASE_OPTS({ baselineChecks: 'off' }), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    expect(notice(await runTsc($))).toContain(FAIL_LINE)
  })

  test('trạng thái lưu có mục đỏ từ nền, option off: cổng Stop gỡ cờ và chặn', BASE_OPTS({ baselineChecks: 'off' }), async ($, on) => {
    const into: { core?: Core } = {}
    const saved = JSON.parse(JSON.stringify(M6_STATE)) as Record<string, Record<string, unknown>>
    const item = { sig: checkSignature({ check: 'static', command: TSC }), check: 'static', command: TSC, round: 1, levels: ['sonnet/medium'], floor: null, isTop: false, lastError: 'Found 27 errors', noticed: 1, edited: 0, calls: 0, closedSteps: [], exhausted: false, reportAsked: false, logged: false, step: null, more: [], restore: null, retried: false, idle: 0, runner: '', ranAt: '10:00', baseline: true, baseCount: 27 }
    ;(saved['core'] as Record<string, unknown>)['retry'] = { goalId: 1, items: [item], seen: [item.sig] }
    capture(on, into, saved)
    const sample = baseSetup(on, sampleGoal({ relation: 'continue' }))
    await offerAgent($)
    await submit($, 'Làm tiếp')
    await $.turn.start({ text: 'Làm tiếp', turnId: 't2' })
    await step($, sample.seen, { turnId: 't2' })
    await editSample($)
    expect(await stopSample($)).toContain(GATE)
  })

  test('/conductor status: mục Lệnh kiểm chưa đạt không liệt kê lệnh đỏ từ nền', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    sample.outputs[NPM] = { text: '1 failed\n', isError: true }
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await callTool($, { tool: 'Bash', command: NPM })
    const status = await runCommand($, 'status')
    const at = status.indexOf(`${FAIL_LINE}:`)
    expect(at).toBeGreaterThanOrEqual(0)
    const part = status.slice(at, status.indexOf('Lệnh kiểm đỏ từ nền', at) > 0 ? status.indexOf('Lệnh kiểm đỏ từ nền', at) : undefined)
    expect(part).toContain(NPM)
    expect(part).not.toContain(TSC)
  })
})
