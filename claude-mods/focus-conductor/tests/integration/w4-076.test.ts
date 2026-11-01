// 0.7.6 W4: bốn chỉnh nhỏ của giao diện. (1) Bước đang có lô chạy hiện \u25D0 thay \u25CB ở pane và band. (2) Band ghi lô lỗi kèm mã bước
// ("BƯỚC 4: 3 lô lỗi chưa giao lại"). (3) Status line chưa có checklist hiện tên ngắn của mục tiêu thay cho chỉ chế độ. (4) Thời gian đã chạy
// làm tròn theo phút và mục Đang chạy của pane ghi "từ <giờ bắt đầu>".

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'
import { TITLES } from '../support/pane-long'
import { statusLine } from '../../hooks/lib/text'
import { labels } from '../../hooks/ui/labels'
import { makeBrief } from '../support/commands'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = 'Cập nhật sổ giá theo các bước'
const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join(''))
const kidsOf = (n: Node) => (n.children ?? []).filter((c): c is Node => c !== null && typeof c === 'object')

function pathTo(n: Node, want: string, path: Node[] = []): Node[] | null {
  if (n.type === 'Text' && textOf(n) === want) return [...path, n]
  for (const k of kidsOf(n)) {
    const found = pathTo(k, want, [...path, n])
    if (found) return found
  }
  return null
}

/** Ký hiệu ở đầu dòng bước có tên `title` (hàng: [ô ký hiệu và số, cột tên, ...]). */
function markOf(tree: Node, title: string): string {
  const path = pathTo(tree, title)
  if (!path) throw new Error(`không thấy bước ${title}`)
  const row = path.at(-3)!
  return textOf(kidsOf(kidsOf(row)[0]!)[0]!)
}

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

const routed = () => plan({ goal: GOAL, depth: 'hard', volume: 'large', tasks: TITLES.map((title, k) => (k === 3 ? task(title, 'agent', 'sonnet', 'medium') : task(title, 'main', 'opus', 'high'))) })

async function bandText($: Engine) {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '').join('')
  await ui.unmount()
  return text
}

async function paneTree($: Engine) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80, scroll: { offset: 0, bodyRows: 60 } } })
  const tree = (await pane.drawn()) as Node
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return { tree, texts }
}

/** Bốn bước đầu đã đóng, BƯỚC 3 (bước 4) còn todo mà đã có lô đang chạy. */
async function runningTodo($: Engine, on: On) {
  base(on, { router: routed })
  hooks(on)
  await submit($, GOAL)
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
  for (let id = 1; id <= 3; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
  await spawnTool($, 'u1', 'BƯỚC 3: lọc tin lô 1', 'lọc')
}

describe('0.7.6 W4: bước có lô đang chạy hiện \u25D0', () => {
  test('pane: bước todo có lô đang chạy là \u25D0, các bước todo khác vẫn \u25CB', async ($, on) => {
    await runningTodo($, on)
    const { tree } = await paneTree($)
    expect(markOf(tree, 'BƯỚC 3: lọc tin lô 1')).toBe('\u25D0')
    expect(markOf(tree, 'BƯỚC 4: lọc tin lô 2')).toBe('\u25CB')
  })

  test('band: đầu thanh là \u25D0 khi bước hiện tại còn todo mà có lô đang chạy', async ($, on) => {
    await runningTodo($, on)
    expect(await bandText($)).toContain('\u25D0')
  })

  test('không có lô chạy: bước hiện tại còn todo thì đầu thanh của band không phải ◐', async ($, on) => {
    base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
    for (let id = 1; id <= 3; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    expect(await bandText($)).not.toContain('\u25D0')
  })

  test('chưa có checklist: bước dự kiến có lô đang chạy là \u25D0 ở pane và band', async ($, on) => {
    base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    await spawnTool($, 'u1', 'BƯỚC 3: lọc tin lô 1', 'lọc')
    const { tree } = await paneTree($)
    expect(markOf(tree, 'BƯỚC 3: lọc tin lô 1')).toBe('\u25D0')
    expect(markOf(tree, 'BƯỚC 2: chuyển dữ liệu cũ')).toBe('\u25CB')
    expect(await bandText($)).toContain('\u25CB \u25CB \u25CB \u25D0 \u25CB')
  })
})

async function failedBatches($: Engine, on: On, lastOk = true) {
  base(on, { router: routed })
  hooks(on)
  await submit($, GOAL)
  for (let n = 1; n <= 4; n++) {
    const id = `s3-${n}`
    const description = `BƯỚC 3: lọc tin lô ${n}`
    await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: `Lọc tin lô ${n}`, model: 'sonnet', subagent_type: 'general-purpose' } as never)
    await $.agent.spawn({ prompt: `Lọc tin lô ${n}`, description, tool_use_id: id } as never)
    await $.turn.start({ text: `Lọc tin lô ${n}`, turnId: `a-${id}`, agentId: `ag-${id}` } as never)
    await $.turn.complete({ turnId: `a-${id}`, agentId: `ag-${id}`, answer: n === 4 && lastOk ? 'xong' : '', durationMs: 5, isAborted: false, reason: n === 4 && lastOk ? 'answer' : 'error' } as never)
  }
}

describe('0.7.6 W4: band ghi lô lỗi kèm mã bước', () => {
  test('"BƯỚC 3: 3 lô lỗi chưa giao lại"', async ($, on) => {
    await failedBatches($, on)
    const text = await bandText($)
    expect(text).toContain('BƯỚC 3: 3 lô lỗi chưa giao lại')
  })

  // Thêm ở commit sửa để ghim mẫu đột biến: lô lỗi của một việc đếm một lần dù việc giao cũng ghi lỗi; lô lỗi hay xong không phải đang chạy.
  test('cả bốn lô lỗi: "BƯỚC 3: 4 lô lỗi chưa giao lại", đếm một lần', async ($, on) => {
    await failedBatches($, on, false)
    expect(await bandText($)).toContain('BƯỚC 3: 4 lô lỗi chưa giao lại')
    // Pane liệt kê mọi mục: chỉ một mục cho BƯỚC 3, không thêm mục từ danh sách việc giao.
    const { texts } = await paneTree($)
    expect(texts.filter(t => /BƯỚC 3: \d+ lô lỗi chưa giao lại/.test(t))).toHaveLength(1)
  })

  test('bước có lô lỗi hay xong (không còn lô chạy) vẫn là ○ ở pane', async ($, on) => {
    base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
    for (let id = 1; id <= 3; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
    for (let n = 1; n <= 4; n++) {
      const id = `s3-${n}`
      const description = `BƯỚC 3: lọc tin lô ${n}`
      await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: `Lọc tin lô ${n}`, model: 'sonnet', subagent_type: 'general-purpose' } as never)
      await $.agent.spawn({ prompt: `Lọc tin lô ${n}`, description, tool_use_id: id } as never)
      await $.turn.start({ text: `Lọc tin lô ${n}`, turnId: `a-${id}`, agentId: `ag-${id}` } as never)
      await $.turn.complete({ turnId: `a-${id}`, agentId: `ag-${id}`, answer: '', durationMs: 5, isAborted: false, reason: 'error' } as never)
    }
    const { tree } = await paneTree($)
    expect(markOf(tree, 'BƯỚC 3: lọc tin lô 1')).toBe('\u25CB')
  })

  test('uiLanguage en', { options: { uiLanguage: 'en' } }, async ($, on) => {
    await failedBatches($, on)
    expect(await bandText($)).toContain('BƯỚC 3: 3 failed runs not re-delegated')
  })
})

describe('0.7.6 W4: status line chưa có checklist', () => {
  const brief = makeBrief({ goal: 'Sửa module thanh toán' })
  test('hiện tên ngắn của mục tiêu thay cho chỉ chế độ; chế độ khác auto ghi cuối', () => {
    expect(statusLine(brief, [], null, 'auto')).toBe('Sửa module thanh toán')
    expect(statusLine(brief, [], null, 'suggest')).toBe('Sửa module thanh toán · suggest')
  })

  test('mục tiêu dài cắt ở 24 ký tự; mã đầu mục tiêu giữ nguyên', () => {
    const long = statusLine(makeBrief({ goal: 'BƯỚC 2: cập nhật sổ giá tuần theo mười một bước' }), [], null, 'auto')
    expect(long.startsWith('BƯỚC 2: ')).toBe(true)
    expect([...long].length).toBeLessThanOrEqual(25)
    expect(long.endsWith('\u2026')).toBe(true)
  })

  test('không có mục tiêu: chỉ chế độ như cũ', () => {
    expect(statusLine(null, [], null, 'auto')).toBe('auto')
  })
})

describe('0.7.6 W4: thời gian đã chạy làm tròn theo phút', () => {
  test('goalElapsed và taskElapsed làm tròn: 150 giây là 3 phút, 29 giây là dưới 1 phút', () => {
    const vi = labels('vi')
    const en = labels('en')
    expect(vi.goalElapsed(150_000)).toBe('3 phút')
    expect(vi.taskElapsed(150_000)).toBe('3 phút')
    expect(en.goalElapsed(150_000)).toBe('3 min')
    expect(vi.goalElapsed(29_000)).toBe('<1 phút')
    expect(vi.goalElapsed(3_630_000)).toBe('1 giờ 1 phút')
  })
})

const clock = (ms: number) => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

describe('0.7.6 W4: mục Đang chạy ghi "từ <giờ bắt đầu>"', () => {
  test('vi: "· từ HH:MM" theo giờ máy của agent đầu tiên', async ($, on) => {
    const seen = base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    const started = seen.clock.now()
    await spawnTool($, 'u1', 'BƯỚC 3: lọc tin lô 1', 'lọc')
    await seen.clock.advance(150_000)
    const { texts } = await paneTree($)
    expect(texts).toContain(`BƯỚC 3: lọc tin lô 1 · lô 1 · 1 agent · 3 phút · từ ${clock(started)}`)
  })

  test('lô đến sau hai giờ: giờ bắt đầu là của agent đầu tiên', async ($, on) => {
    const seen = base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    const started = seen.clock.now()
    await spawnTool($, 'u1', 'BƯỚC 3: lọc tin lô 1', 'lọc')
    await seen.clock.advance(7_200_000)
    await spawnTool($, 'u2', 'BƯỚC 3: lọc tin lô 2', 'lọc')
    const { texts } = await paneTree($)
    expect(texts.some(t => /lô 1 đến 2 · 2 agent/.test(t) && t.endsWith(`từ ${clock(started)}`))).toBe(true)
  })

  test('en: "since HH:MM"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on, { router: routed })
    hooks(on)
    await submit($, GOAL)
    const started = seen.clock.now()
    await spawnTool($, 'u1', 'BƯỚC 3: lọc tin lô 1', 'lọc')
    await seen.clock.advance(150_000)
    const { texts } = await paneTree($)
    expect(texts.some(t => t.endsWith(`3 min · since ${clock(started)}`))).toBe(true)
  })
})

describe('0.7.6 W4: nhiều việc có lô lỗi', () => {
  test('mỗi việc một mục, theo thứ tự bước: BƯỚC 3 trước BƯỚC 4', async ($, on) => {
    base(on, { router: () => plan({ goal: GOAL, depth: 'hard', volume: 'large', tasks: TITLES.map((title, k) => (k === 3 || k === 4 ? task(title, 'agent', 'sonnet', 'medium') : task(title, 'main', 'opus', 'high'))) }) })
    hooks(on)
    await submit($, GOAL)
    for (const step of [3, 4]) {
      for (let n = 1; n <= 2; n++) {
        const id = `s${step}-${n}`
        const description = `BƯỚC ${step}: lọc tin lô ${n}`
        await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: `Lọc tin lô ${n}`, model: 'sonnet', subagent_type: 'general-purpose' } as never)
        await $.agent.spawn({ prompt: `Lọc tin lô ${n}`, description, tool_use_id: id } as never)
        await $.turn.start({ text: `Lọc tin lô ${n}`, turnId: `a-${id}`, agentId: `ag-${id}` } as never)
        await $.turn.complete({ turnId: `a-${id}`, agentId: `ag-${id}`, answer: '', durationMs: 5, isAborted: false, reason: 'error' } as never)
      }
    }
    const { texts } = await paneTree($)
    const at = texts.findIndex(t => /^Cần chú ý/.test(t))
    const first = texts.findIndex(t => t.endsWith('BƯỚC 3: 2 lô lỗi chưa giao lại'))
    const second = texts.findIndex(t => t.endsWith('BƯỚC 4: 2 lô lỗi chưa giao lại'))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(first).toBeGreaterThan(at)
    expect(second).toBeGreaterThan(first)
  })
})
