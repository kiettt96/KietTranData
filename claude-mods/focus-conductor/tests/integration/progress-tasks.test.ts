// 0.6.1, thanh tiến độ 2.4: mỗi việc một dòng tiến độ: việc chính, từng việc router phân (làm trực tiếp hay giao subagent),
// và việc Claude tự giao. Thanh chỉ thể hiện phần trăm khi có số bước thật; không có thì chỉ thể hiện trạng thái.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { FOUR, PANE, base, spawnTool, submit } from '../support/engine'
import { memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const DONE = (turnId: string, agentId: string, reason = 'answer') => ({ turnId, agentId, answer: '', durationMs: 1, isAborted: false, reason }) as never

/** Agent của Agent tool có agentId theo tool_use_id; turn.complete và TodoWrite có câu trả lời của "engine". */
function agentHooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: unknown[] }).todos } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }) as never)
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }) as never)
}

/** Các dòng chữ của mục Tiến độ từng việc trong pane, theo thứ tự. */
async function paneRows($: Engine, columns = 80) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  expect(await pane.drawn()).toMatchObject({ type: 'Box' })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  const at = texts.findIndex(t => /^(Tiến độ từng việc|Progress by task) \d+ ─/.test(t))
  return { texts, at, hasOld: texts.some(t => /^Việc giao subagent ─/.test(t)) }
}

const has = (texts: readonly string[], pattern: RegExp) => texts.some(t => pattern.test(t))

describe('0.6.1 2.4: mục Tiến độ từng việc trong pane', () => {
  // 0.7.6 U1: việc router phân đi cùng dòng bước dự kiến của nó (chip model, trạng thái giao), không còn mục riêng hay dòng việc chính.
  test('mới vào mục tiêu: bước dự kiến mang chip model; việc giao ở trạng thái chờ giao; không có mục riêng', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    const { texts, at, hasOld } = await paneRows($)
    expect(at).toBe(-1)
    expect(hasOld).toBe(false)
    expect(has(texts, /^Việc chính: /)).toBe(false)
    expect(has(texts, /^Tìm trong src/)).toBe(true)
    expect(has(texts, /^Thiết kế lại kiến trúc/)).toBe(true)
    expect(has(texts, /^opus xhigh$/)).toBe(true)
    expect(texts.filter(t => /^(haiku|sonnet) chờ giao$/.test(t)).length).toBe(3)
  })

  // 0.7.6 U1: việc khớp bước mang chip "<model> <trạng thái>" và chi tiết số tool call, thời gian trên dòng bước; dòng bước đã có ký hiệu
  // trạng thái của checklist nên không còn thanh riêng của việc.
  test('việc giao: chip đang chạy (số tool call, thời gian), rồi xong; việc lỗi có chip lỗi', {}, async ($, on) => {
    const seen = base(on)
    agentHooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
    await spawnTool($, 'u2', 'Việc 2: đổi tên userId', 'đổi tên')
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts', agentId: 'a-u1' } as never)
    await $.tool.call({ tool: 'Read', file_path: 'src/b.ts', agentId: 'a-u1' } as never)
    await seen.clock.advance(125_000)
    let rows = await paneRows($)
    expect(has(rows.texts, /^2 tool · 2 phút$/)).toBe(true)
    expect(rows.texts.filter(t => /^sonnet đang chạy$/.test(t)).length).toBe(2)
    await $.turn.complete(DONE('t1', 'a-u1'))
    await $.turn.complete(DONE('t2', 'a-u2', 'error'))
    rows = await paneRows($)
    expect(has(rows.texts, /^sonnet xong$/)).toBe(true)
    expect(has(rows.texts, /^sonnet lỗi, chưa giao lại$/)).toBe(true)
  })

  test('subagent ghi danh sách việc riêng bằng TodoWrite: thanh theo tỷ lệ bước đóng của riêng nó', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
    const todos = [
      { content: 'Tìm', status: 'completed', activeForm: 'Tìm' },
      { content: 'Lọc', status: 'in_progress', activeForm: 'Lọc' },
      { content: 'Báo', status: 'pending', activeForm: 'Báo' },
    ]
    await $.tool.call({ tool: 'TodoWrite', todos, agentId: 'a-u1' } as never)
    const { texts } = await paneRows($)
    expect(has(texts, /^1\/3 · 1 tool/)).toBe(true)
    // Danh sách của subagent không thành checklist của luồng chính.
    expect(has(texts, /^Checklist ─/)).toBe(false)
  })

  test('việc làm trực tiếp: có bước "Việc N" thì theo tỷ lệ bước; không có thì chưa bắt đầu, đang làm, xong', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 3: phác kiến trúc' }, { title: 'Việc 3: nêu trade-off' }, { title: 'Tổng hợp' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    let rows = await paneRows($)
    // 0.7.6 U1: bước "Việc 3: ..." mang chip của việc 3, không còn dòng việc 3 riêng.
    expect(has(rows.texts, /^Việc 3: Thiết kế/)).toBe(false)
    expect(rows.texts.filter(t => /^opus xhigh$/.test(t)).length).toBeGreaterThanOrEqual(1)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phác kiến trúc' }] })
    rows = await paneRows($)
    expect(has(rows.texts, /^chưa bắt đầu$/)).toBe(true)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    rows = await paneRows($)
    expect(has(rows.texts, /^đang làm$/)).toBe(true)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    rows = await paneRows($)
    const direct = rows.texts.findIndex(t => /^Việc 3: Thiết kế/.test(t))
    expect(rows.texts.slice(direct, direct + 6).some(t => /^xong$/.test(t))).toBe(true)
  })

  test('việc Claude tự giao (ngoài phân việc): có dòng riêng sau các việc router phân', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u9', 'Kiểm tra log lỗi thanh toán', 'kiểm tra')
    const { texts } = await paneRows($)
    const own = texts.findIndex(t => /^Claude tự giao: Kiểm tra log lỗi thanh toán/.test(t))
    const four = texts.findIndex(t => /^Việc 4: /.test(t))
    expect(own).toBeGreaterThan(four)
  })

  test('subagent bị cắt vì tạm dừng hạn mức: chip trạng thái bị cắt', {}, async ($, on) => {
    const seen = base(on)
    agentHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts', agentId: 'a-u1' } as never)
    await $.turn.complete(DONE('t1', 'a-u1'))
    const { texts } = await paneRows($)
    expect(has(texts, /^sonnet bị cắt vì tạm dừng$/)).toBe(true)
  })

  for (const width of [36, 48, 80]) {
    // 0.7.6 U1: không còn mục riêng và thanh của việc; ở mọi bề rộng, cả bốn bước dự kiến mang chip của việc.
    test(`pane ${width} ô: mỗi bước dự kiến mang chip của việc`, {}, async ($, on) => {
      base(on)
      agentHooks(on)
      await submit($, FOUR)
      await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
      const { texts, at } = await paneRows($, width)
      expect(at).toBe(-1)
      expect(texts.filter(t => /^sonnet đang chạy$/.test(t)).length).toBe(1)
      expect(texts.filter(t => /^sonnet chờ giao$/.test(t)).length).toBe(2)
      expect(has(texts, /^opus xhigh$/)).toBe(true)
    })
  }

  test('uiLanguage en: nhãn tiếng Anh', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
    const { texts, at } = await paneRows($)
    // 0.7.6 U1: chưa có checklist thì mọi việc đi cùng bước dự kiến của nó.
    expect(at).toBe(-1)
    expect(has(texts, /^sonnet running$/)).toBe(true)
    expect(has(texts, /^sonnet not delegated yet$/)).toBe(true)
    expect(has(texts, /^opus xhigh$/)).toBe(true)
  })
})

describe('0.6.1 2.4: band với nhiều việc', () => {
  const bandAt = async ($: Engine, maxRows: number) => {
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: maxRows }, view: {} } })
    const tree = (await band.drawn()) as unknown as { children: Array<{ children?: unknown[] }> }
    const rows = (tree.children[1]?.children ?? []).length
    const texts = (await band.findAll({ type: 'Text' })).map(e => e.text)
    await band.unmount()
    return { rows, texts }
  }

  // 0.7.6: band luôn hai dòng; các dòng việc riêng chỉ ở pane. Không có gì cần chú ý thì dòng 2 ghi subagent đang chạy.
  test('maxRows 6, 3, 2: band hai dòng; dòng 2 ghi subagent đang chạy, việc đầu tiên đang chạy', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phác' }, { title: 'Gộp' }] })
    await spawnTool($, 'u2', 'Việc 2: đổi tên userId', 'đổi tên')
    await spawnTool($, 'u9', 'Kiểm tra log lỗi thanh toán', 'kiểm tra')
    for (const max of [6, 3, 2]) expect((await bandAt($, max)).rows, String(max)).toBe(2)
    const six = await bandAt($, 6)
    expect(has(six.texts, /^2 subagent đang chạy: Việc 2: /)).toBe(true)
    expect(has(six.texts, /^\+\d việc$/)).toBe(false)
    // 0.7.6 U4: chip lô chỉ ghi số đang chạy và số lỗi.
    expect(has(six.texts, /^2 đang chạy$/)).toBe(true)
  })

  test('chỉ có việc chính: band như cũ, không thêm dòng việc', {}, async ($, on) => {
    base(on)
    agentHooks(on)
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết' }, { title: 'Test' }] })
    const six = await bandAt($, 6)
    expect(six.rows).toBe(2)
  })
})

describe('0.6.1 2.4: DISCIPLINE', () => {
  test('dặn tiêu đề bước "Việc N: " cho việc của Phân việc, và subagent dùng tool danh sách việc có sẵn', {}, async ($, on) => {
    base(on)
    const result = await $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })
    const text = result.sections.map(s => s.text).join('\n')
    expect(text).toContain('tiêu đề bước mở đầu "Việc N: "')
    expect(text).toContain('việc từ ba bước trở lên thì ghi danh sách bằng tool danh sách việc có sẵn')
  })
})
