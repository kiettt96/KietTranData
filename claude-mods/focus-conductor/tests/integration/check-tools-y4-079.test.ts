// 0.7.9 Y4: lệnh kiểm chạy qua tool MCP đã khai trong option checkTools. Mỗi lời gọi tool trong danh sách là một lần kiểm loại test,
// chữ ký là tên tool cộng đầu vào (JSON sắp xếp khóa, cắt 200 ký tự), lỗi khi isError hay output lỗi, rỗng, không chạy gì. Lần kiểm đi
// chung đường với lệnh Bash: nhật ký bằng chứng (verified, cảnh báo chưa kiểm) và cổng W4. Chỉ cùng tool, cùng đầu vào mới phủ lần lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'
import * as EV from '../../hooks/lib/drift/evidence'

const PLAN = 'mcp__focus-conductor__plan'
const TOOL = 'mcp__ci__run_tests'
const OTHER = 'mcp__ci__lint'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const ON = { options: { checkTools: TOOL } }

function setup(on: On) {
  const passing = new Set<string>()
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  const answer = (_$: unknown, e: unknown) => {
    const input = e as { suite?: unknown; tool?: unknown }
    const key = `${String(input.tool)}:${String(input.suite ?? '')}`
    return passing.has(key) ? { result: JS.bun_pass, text: JS.bun_pass } : { result: JS.bun_fail, text: JS.bun_fail, isError: true as const }
  }
  on('tool.call', { tool: TOOL }, answer as never)
  on('tool.call', { tool: OTHER }, answer as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return { seen, passing }
}

const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
const run = ($: Engine, tool: string, suite: string) => $.tool.call({ tool, suite } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

/** Mục tiêu một bước, turn t1, sửa file, tool kiểm `tool` lỗi với suite `suite`, rồi bước đóng done. */
async function failing($: Engine, seen: Seen, tool = TOOL, suite = 'all') {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await edit($)
  await run($, tool, suite)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.7.9 Y4: tool MCP trong checkTools là lệnh kiểm', () => {
  test('1. tool trong checkTools lỗi rồi Stop: chặn, lý do có tên tool và 2/3', ON, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    const reason = await stop($)
    expect(reason).toContain(TOOL)
    expect(reason).toContain('2/3')
  })

  test('2. gọi lại cùng tool, cùng đầu vào, đạt: Stop qua', ON, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen)
    passing.add(`${TOOL}:all`)
    await run($, TOOL, 'all')
    expect(await stop($)).toBe('')
  })

  test('3. cùng tool, đầu vào khác, đạt: không phủ, Stop vẫn chặn', ON, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen)
    passing.add(`${TOOL}:unit`)
    await run($, TOOL, 'unit')
    expect(await stop($)).toContain(TOOL)
  })

  test('4. tool MCP không có trong checkTools lỗi: không ghi lần kiểm, Stop qua như cũ', ON, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen, OTHER)
    expect(await stop($)).not.toContain(OTHER)
    expect(await stop($)).not.toContain('2/3')
  })

  test('5. checkTools rỗng: tool kiểm lỗi không chặn như trước 0.7.9', {}, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    expect(await stop($)).not.toContain('2/3')
  })

  test('6. tool trong checkTools đạt sau thay đổi cuối: bước done tự lên verified như lệnh test Bash', ON, async ($, on) => {
    const { seen, passing } = setup(on)
    passing.add(`${TOOL}:all`)
    await submit($, 'Sửa hàm tính phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await run($, TOOL, 'all')
    expect(await shown($)).toContain('[v] 1. Sửa hàm tính phí')
  })
})

describe('0.7.9 Y4: luật phủ của lần kiểm qua tool MCP', () => {
  test('chỉ cùng tool cùng đầu vào phủ; isNarrow không áp', () => {
    const fail = { check: 'test' as const, command: `${TOOL} {"suite":"all"}` }
    expect(EV.coversFailure({ check: 'test', command: `${TOOL} {"suite":"all"}` }, fail)).toBe(true)
    expect(EV.coversFailure({ check: 'test', command: `${TOOL} {"suite":"unit"}` }, fail)).toBe(false)
    expect(EV.coversFailure({ check: 'test', command: `${OTHER} {"suite":"all"}` }, fail)).toBe(false)
  })

  test('chữ ký: JSON sắp xếp khóa, cắt 200 ký tự', () => {
    expect(EV.checkToolCommand(TOOL, { suite: 'all', a: 1 })).toBe(`${TOOL} {"a":1,"suite":"all"}`)
    expect(EV.checkToolCommand(TOOL, { x: 'y'.repeat(400) }).length).toBe(TOOL.length + 1 + 200)
  })
})
