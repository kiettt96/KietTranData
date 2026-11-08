// 0.8.0 A6: câu chặn và mục "Chưa đạt yêu cầu" của cổng W4 nêu đủ lệnh, lỗi và người chạy. Lệnh quá 100 ký tự cắt ở giữa (giữ đầu và đuôi, tên
// file cuối trọn); mỗi mục lưu người chạy lần lỗi cuối (luồng chính hay subagent kèm description), giờ chạy HH:MM, đoạn lỗi cuối tối đa 160
// ký tự; câu chặn giữ trần 1.200 ký tự. Output lỗi không có dòng nào mang dấu hiệu lỗi: lấy dòng không rỗng cuối, ghi "không có dòng lỗi".

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const DEFAULT_OUT = 'error: expect(received).toBe(expected)\nExpected: 2\nReceived: 1\n'

function setup(on: On, outputs: Record<string, string> = {}) {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({ result: outputs[String((e as { command?: unknown }).command ?? '')] ?? DEFAULT_OUT, isError: true as const }))
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
  return { seen, hold, release: () => release(), entered: () => entered }
}

const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never)
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')

async function begin($: Engine, seen: Seen) {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
}

/** Đóng bước để cổng checklist không chặn trước cổng W4. */
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

const scriptOf = (name: string) => `/usr/bin/python3 -B /repo/tools/${'thu-muc-dai-'.repeat(10)}/${name}`
const OPTS = { options: { checkCommands: [...['x', 'a', 'b', 'c', 'd', 'e'].map(k => scriptOf(k === 'x' ? 'check_x.py' : `check_${k}.py`)), 'bun run gen-check'].join(',') } }

describe('0.8.0 A6: lệnh dài cắt ở giữa', () => {
  test('lệnh 160 ký tự: câu chặn giữ đầu và đuôi check_x.py, lệnh trong dấu ` không quá 100 ký tự', OPTS, async ($, on) => {
    const cmd = scriptOf('check_x.py')
    expect(cmd.length).toBeGreaterThanOrEqual(160)
    const { seen } = setup(on)
    await begin($, seen)
    await bash($, cmd)
    await close($)
    const reason = await stop($)
    expect(reason).toContain('check_x.py')
    expect(reason).toContain('/usr/bin/python3')
    expect(reason).toContain('…')
    const shown = reason.split('\n').find(line => line.includes('check_x.py')) ?? ''
    const inside = shown.slice(shown.indexOf('`') + 1, shown.indexOf('`', shown.indexOf('`') + 1))
    expect(inside.length).toBeLessThanOrEqual(100)
    expect(inside.endsWith('check_x.py')).toBe(true)
  })

  test('hết lượt: mục "Chưa đạt yêu cầu" và note bước giữ đuôi check_x.py, ghi người chạy và giờ HH:MM', OPTS, async ($, on) => {
    const cmd = scriptOf('check_x.py')
    const { seen } = setup(on)
    await begin($, seen)
    await bash($, cmd)
    await close($)
    await stop($)
    await bash($, cmd)
    await stop($, true)
    await bash($, cmd)
    const reason = await stop($, true)
    expect(reason).toContain('Chưa đạt yêu cầu')
    expect(reason).toContain('check_x.py')
    expect(reason).toMatch(/luồng chính lúc \d\d:\d\d/)
    const listed = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    const row = listed.split('\n').find(line => line.includes('Mod ghi:')) ?? ''
    expect(row).toContain('check_x.py')
    expect(row).toMatch(/luồng chính lúc \d\d:\d\d/)
  })
})

describe('0.8.0 A6: người chạy lần lỗi cuối', () => {
  test('lỗi do subagent: câu chặn có description của subagent, không ghi luồng chính', OPTS, async ($, on) => {
    const { seen, hold, release, entered } = setup(on)
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    hold()
    const call = $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'Chạy bộ kiểm phí', prompt: 'Chạy npm test' } as never)
    await entered()
    await $.agent.spawn({ prompt: 'Chạy npm test', description: 'Chạy bộ kiểm phí', tool_use_id: 'u1' } as never)
    await bash($, 'npm test', 'a-u1')
    release()
    await call
    await close($)
    const reason = await stop($)
    expect(reason).toContain('Chạy bộ kiểm phí')
    expect(reason).toMatch(/subagent "Chạy bộ kiểm phí" lúc \d\d:\d\d/)
    expect(reason).not.toContain('luồng chính')
  })

  test('mục lỗi ở luồng chính rồi chạy lại lỗi do luồng chính: ghi luồng chính', OPTS, async ($, on) => {
    const { seen } = setup(on)
    await begin($, seen)
    await bash($, 'npm test')
    await close($)
    expect(await stop($)).toMatch(/chạy bởi luồng chính lúc \d\d:\d\d/)
  })
})

describe('0.8.0 A6: trần 1.200 ký tự', () => {
  test('5 mục W4 với lệnh dài, lỗi dài và description 60 ký tự: câu chặn không quá 1.200 ký tự, vẫn có hướng làm lượt 2', OPTS, async ($, on) => {
    const cmds = ['a', 'b', 'c', 'd', 'e'].map(k => scriptOf(`check_${k}.py`))
    const longError = `error: ${'lỗi rất dài '.repeat(30)}`
    const outputs = Object.fromEntries(cmds.map(c => [c, longError]))
    const { seen } = setup(on, outputs)
    await begin($, seen)
    for (const cmd of cmds) await bash($, cmd)
    await close($)
    const reason = await stop($)
    expect(reason.length).toBeLessThanOrEqual(1200)
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(reason).toContain(`check_${k}.py`)
    expect(reason).toContain('Lượt 2')
    expect(reason).toMatch(/luồng chính lúc \d\d:\d\d/)
  })

  test('5 mục W4 do subagent với description 60 ký tự, hết lượt: vẫn không quá 1.200 ký tự và có mục "Chưa đạt yêu cầu"', OPTS, async ($, on) => {
    const { seen, hold, release, entered } = setup(on)
    const desc = 'Chạy bộ kiểm phí thanh toán theo quy định mới nhất của kế toán'.slice(0, 60)
    const cmds = ['a', 'b', 'c', 'd', 'e'].map(k => scriptOf(`check_${k}.py`))
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    hold()
    const call = $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: desc, prompt: 'Chạy kiểm' } as never)
    await entered()
    await $.agent.spawn({ prompt: 'Chạy kiểm', description: desc, tool_use_id: 'u1' } as never)
    for (const cmd of cmds) await bash($, cmd, 'a-u1')
    release()
    await call
    await close($)
    const first = await stop($)
    expect(first.length).toBeLessThanOrEqual(1200)
    for (const cmd of cmds) await bash($, cmd)
    await stop($, true)
    for (const cmd of cmds) await bash($, cmd)
    const last = await stop($, true)
    expect(last.length).toBeLessThanOrEqual(1200)
    expect(last).toContain('Chưa đạt yêu cầu')
  })
})

describe('0.8.0 A6: output lỗi không có dòng mang dấu hiệu lỗi', () => {
  test('"sinh 120 dòng" rồi "0": câu chặn ghi dòng cuối kèm "không có dòng lỗi", không ghi "sinh 120 dòng"', OPTS, async ($, on) => {
    const { seen } = setup(on, { 'bun run gen-check': 'sinh 120 dòng\n0\n' })
    await begin($, seen)
    await bash($, 'bun run gen-check')
    await close($)
    const reason = await stop($)
    expect(reason).toContain('không có dòng lỗi')
    expect(reason).toContain('lỗi: 0 (')
    expect(reason).not.toContain('sinh 120 dòng')
    expect(reason).not.toMatch(/mã thoát \d/)
  })

  test('output có dòng mang dấu hiệu lỗi: giữ dòng đó, không ghi "không có dòng lỗi"', OPTS, async ($, on) => {
    const { seen } = setup(on, { 'bun run gen-check': 'sinh 120 dòng\nFAIL: thiếu cột phí\n0\n' })
    await begin($, seen)
    await bash($, 'bun run gen-check')
    await close($)
    const reason = await stop($)
    expect(reason).toContain('FAIL: thiếu cột phí')
    expect(reason).not.toContain('không có dòng lỗi')
  })
})
