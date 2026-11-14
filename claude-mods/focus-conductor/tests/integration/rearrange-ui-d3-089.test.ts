// 0.8.9 D3 (tích hợp): luồng chính và pane thấy kế hoạch sau điều chỉnh. Prompt tiếp nối và tin chen ngang có điều phối lại thì context nêu
// bốn phần (thứ tự làm, việc đã bỏ, việc đã gộp, câu dặn cập nhật checklist); không có arrange thì context trùng 7682ef7. Mục tiến độ từng
// việc của pane xếp ba nhóm (đang chạy và lỗi; chưa làm theo thứ tự làm; đã xong, gộp một dòng khi nhiều hơn 5 việc) với tiêu đề tổng kết;
// /conductor status nêu các việc đã gỡ.

import { describe, expect, test } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE_ROWS } from '../../hooks/lib/pane'
import { FOLLOW_UP_7682, INTERJECT_7682 } from '../fixtures/rearrange-d3-089'
import { DEFAULT_ROUTER, PANE, base, conductor, plan, spawnTool, step, submit, task } from '../support/engine'
import type { Json } from '../support/engine'
import { drawn, longGoal, rowOf, stepRow } from '../support/pane-long'
import { followUpContextOf, interjectContextOf } from '../support/rearrange-ui'

const OPTS = { options: { planApproval: 'off' } }
// Pane đo với neon off: tiêu đề mục là một Text, không bị tách theo ô màu.
const PANE_OPTS = { options: { planApproval: 'off', neon: 'off' } }
const ORDER_LEAD = 'Kế hoạch sau điều chỉnh, theo thứ tự làm:'
const ASK_LEAD = 'Cập nhật checklist bằng tool plan cho khớp'
const refine = (arrange: Json, over: Json = {}) => plan({ relation: 'refine', intent: 'amend', goal: '', arrange, ...over })
const mains = (n: number) => Array.from({ length: n }, (_, i) => task(`Phần ${i + 1}`, 'main', 'sonnet', 'medium'))
const agents = (n: number) => Array.from({ length: n }, (_, i) => task(`Việc giao ${i + 1}`, 'agent', 'sonnet', 'medium'))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
/** Checklist hai bước không khớp việc nào, như phiên thật: các việc nằm ở mục tiến độ từng việc, không đi cùng bước. */
const unrelatedChecklist = ($: Engine) => $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Chuẩn bị môi trường' }, { title: 'Tổng kết kết quả' }] } as never)

/** Phần context nêu kế hoạch sau điều chỉnh: từ dòng thứ tự làm tới hết câu dặn. */
function arrangedBlock(context: string): string {
  const from = context.indexOf(ORDER_LEAD)
  const ask = context.indexOf(ASK_LEAD)
  if (from < 0 || ask < 0) return ''
  const end = context.indexOf('\n', ask)
  return context.slice(from, end < 0 ? undefined : end)
}

/** Mục tiêu 88 việc ở luồng chính; prompt điều chỉnh bỏ 12 việc, 8 mục gộp hai việc, sắp lại 60 việc còn mở. */
function bigAdjust(): Json {
  const drop = range(1, 12).map(n => ({ task: n, why: `phần ${n} không còn cần sau khi đổi phạm vi xuất báo cáo` }))
  const merge = range(0, 7).map(k => ({ tasks: [13 + 2 * k, 14 + 2 * k], into: 29 + k }))
  return refine({ order: range(29, 88).reverse(), drop, merge })
}

describe('0.8.9 D3: context sau điều chỉnh', () => {
  test('prompt tiếp nối có điều phối lại: bốn phần đúng thứ tự; tổng phần thêm không quá 900 ký tự với 60 việc mở, 12 việc bỏ, 8 mục gộp', OPTS, async ($, on) => {
    const seen = base(on, { router: request => (request.includes('điều chỉnh') ? bigAdjust() : plan({ goal: 'Nâng cấp tám mươi tám phần', depth: 'hard', volume: 'large', kind: 'edit', tasks: mains(88) })) })
    await submit($, 'Nâng cấp tám mươi tám phần')
    await submit($, 'điều chỉnh: đổi phạm vi xuất báo cáo')
    const context = (seen.contexts.at(-1) ?? []).join('\n')
    const block = arrangedBlock(context)
    expect(block.length).toBeGreaterThan(0)
    expect(block.length).toBeLessThanOrEqual(900)
    const at = (lead: string) => block.indexOf(lead)
    expect(at(ORDER_LEAD)).toBe(0)
    expect(at('Đã bỏ:')).toBeGreaterThan(at(ORDER_LEAD))
    expect(at('Đã gộp:')).toBeGreaterThan(at('Đã bỏ:'))
    expect(at(ASK_LEAD)).toBeGreaterThan(at('Đã gộp:'))
    expect(block).toContain('Việc 88, 87, 86')
    expect(block).toMatch(/\(và \d+ việc khác\)/)
  })

  test('prompt tiếp nối không có arrange: context trùng 7682ef7 từng ký tự', OPTS, async ($, on) => {
    expect(await followUpContextOf($, on)).toBe(FOLLOW_UP_7682)
  })

  test('tin chen ngang có điều phối lại: bốn phần có trong context, tổng vẫn không quá 1.500 ký tự với 60 việc mở', OPTS, async ($, on) => {
    const seen = base(on, { router: request => (request.includes('điều chỉnh') ? bigAdjust() : plan({ goal: 'Nâng cấp tám mươi tám phần', depth: 'hard', volume: 'large', kind: 'edit', tasks: mains(88) })) })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Nâng cấp tám mươi tám phần')
    await $.turn.start({ text: 'làm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.prompt.submit({ text: 'điều chỉnh: đổi phạm vi xuất báo cáo', wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
    const context = (seen.contexts.at(-1) ?? []).find(part => part.includes('Yêu cầu chen ngang')) ?? ''
    expect(context.length).toBeLessThanOrEqual(1500)
    const block = arrangedBlock(context)
    expect(block.length).toBeGreaterThan(0)
    expect(block.length).toBeLessThanOrEqual(700)
    for (const lead of ['Đã bỏ:', 'Đã gộp:', ASK_LEAD]) expect(block, lead).toContain(lead)
  })

  test('tin chen ngang không có arrange: context trùng 7682ef7 từng ký tự', OPTS, async ($, on) => {
    expect(await interjectContextOf($, on)).toBe(INTERJECT_7682)
  })
})

function agentHooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('classic.Stop', () => ({}))
}
const ended = (agentId: string, reason: 'answer' | 'error'): TurnCompleteInput => ({ turnId: `t-${agentId}`, agentId, answer: '', durationMs: 1, isAborted: false, reason }) as TurnCompleteInput

async function paneTexts($: Engine, columns: number, lang: 'vi' | 'en' = 'vi'): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  void lang
  return texts
}

/** Mục tiêu 42 việc giao subagent: 12 xong, 3 đang chạy (13 tới 15), 1 lỗi (16), 26 chưa bắt đầu; prompt điều chỉnh sắp lại 26 việc đó. */
async function fortyTwo($: Engine, on: On, adjust: Json = refine({ order: range(17, 42).reverse(), drop: [], merge: [] })) {
  base(on, { router: request => (request.includes('điều chỉnh') ? adjust : request.includes('Bốn mươi hai') ? plan({ goal: 'Bốn mươi hai việc', depth: 'hard', volume: 'large', kind: 'edit', tasks: agents(42) }) : DEFAULT_ROUTER(request)) })
  agentHooks(on)
  await submit($, 'Bốn mươi hai việc')
  await unrelatedChecklist($)
  for (const n of range(1, 16)) await spawnTool($, `u${n}`, `Việc ${n}: Việc giao ${n}`, `Làm việc giao ${n}`)
  for (const n of range(1, 12)) await $.turn.complete(ended(`a-u${n}`, 'answer'))
  await $.turn.complete(ended('a-u16', 'error'))
  await submit($, 'điều chỉnh: làm các việc cuối trước')
}

/** Các dòng của mục tiến độ từng việc: từ tiêu đề mục tới trước tiêu đề mục kế. */
function taskSection(texts: string[]): string[] {
  const start = texts.findIndex(t => /^(Tiến độ từng việc|Progress by task)/.test(t.trimStart()))
  if (start < 0) return []
  const end = texts.findIndex((t, i) => i > start + 1 && /^(Đang chạy|Running|Nhật ký|Log|Ràng buộc|Constraints)\b/.test(t.trimStart()))
  return texts.slice(start, end < 0 ? undefined : end)
}

describe('0.8.9 D3: mục tiến độ từng việc của pane', () => {
  for (const columns of [120, 80, 44]) {
    test(`42 việc, ${columns} cột: nhóm đang chạy và lỗi đứng đầu, việc chưa làm theo thứ tự làm, một dòng gộp việc đã xong, tiêu đề tổng kết`, PANE_OPTS, async ($, on) => {
      await fortyTwo($, on)
      const texts = await paneTexts($, columns)
      const section = taskSection(texts)
      const header = columns < 48 ? '12/42' : '12/42 xong · 3 đang chạy · 26 chưa làm · 1 lỗi'
      expect(section.some(t => t.includes(header)), header).toBe(true)
      if (columns < 48) expect(section.some(t => t.includes('đang chạy ·'))).toBe(false)
      const firstOf = (n: number) => section.findIndex(t => t === `Việc ${n}: Việc giao ${n}` || t.startsWith(`Việc ${n}: Việc giao ${n}`) || t === `${n}. Việc giao ${n}` || t.startsWith(`${n}. Việc giao ${n}`))
      for (const n of [13, 14, 15, 16]) expect(firstOf(n), String(n)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...[13, 14, 15, 16].map(firstOf))).toBeLessThan(firstOf(42))
      expect(firstOf(42)).toBeLessThan(firstOf(41))
      expect(firstOf(18)).toBeLessThan(firstOf(17))
      expect(section.filter(t => /^12 việc đã xong: 1, 2, 3/.test(t)).length).toBe(1)
      for (const n of range(1, 12)) expect(firstOf(n), String(n)).toBe(-1)
    })
  }

  test('mục tiêu 4 việc, 2 xong: việc đã xong vẫn mỗi việc một dòng', PANE_OPTS, async ($, on) => {
    base(on, { router: request => (request.includes('bốn việc') ? plan({ goal: 'Bốn việc', depth: 'hard', volume: 'medium', kind: 'edit', tasks: agents(4) }) : DEFAULT_ROUTER(request)) })
    agentHooks(on)
    await submit($, 'Làm bốn việc')
    await unrelatedChecklist($)
    for (const n of [1, 2]) {
      await spawnTool($, `u${n}`, `Việc ${n}: Việc giao ${n}`, `Làm việc giao ${n}`)
      await $.turn.complete(ended(`a-u${n}`, 'answer'))
    }
    const section = taskSection(await paneTexts($, 80))
    expect(section.some(t => t.includes('2/4 xong · 0 đang chạy · 2 chưa làm'))).toBe(true)
    expect(section.some(t => /việc đã xong:/.test(t))).toBe(false)
    for (const n of [1, 2]) expect(section.some(t => t.endsWith(`Việc giao ${n}`)), String(n)).toBe(true)
  })

  test('sau khi bỏ 5 việc: tiêu đề có "· đã bỏ 5"; /conductor status liệt kê đủ 5 việc kèm lý do', PANE_OPTS, async ($, on) => {
    const drop = range(38, 42).map(n => ({ task: n, why: `không cần việc ${n} nữa` }))
    await fortyTwo($, on, refine({ order: [], drop, merge: [] }))
    const section = taskSection(await paneTexts($, 120))
    expect(section.some(t => t.includes('12/37 xong · 3 đang chạy · 21 chưa làm · 1 lỗi · đã bỏ 5'))).toBe(true)
    const status = String((await conductor($, 'status')).text)
    for (const n of range(38, 42)) expect(status, String(n)).toContain(`${n}. Việc giao ${n}: không cần việc ${n} nữa`)
  })

  test('pane tự mở 16 dòng, checklist 11 bước, với mục tiến độ mới: bước đang làm và mục Cần chú ý vẫn nằm trong 16 dòng đầu', OPTS, async ($, on) => {
    await longGoal($, on, 8)
    const { tree } = await drawn($)
    const row = stepRow(tree, 8)
    expect(row).toBeGreaterThanOrEqual(0)
    expect(row).toBeLessThan(PANE_ROWS)
    const attention = rowOf(tree, /^Cần chú ý/)
    if (attention >= 0) expect(attention).toBeLessThan(PANE_ROWS)
  })
})
