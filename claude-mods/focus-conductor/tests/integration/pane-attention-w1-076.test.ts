// 0.7.6 W1: mục "Cần chú ý" ở đầu pane, ngay dưới thanh tiến độ và trước checklist, xếp theo mức độ của band; tạm dừng cứng hiện lý do,
// giờ làm mới và lệnh chạy tiếp; mục "Cảnh báo khác" chỉ còn cảnh báo chưa hiện ở "Cần chú ý" (mỗi cảnh báo một lần).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, base, plan, submit, task } from '../support/engine'
import { quotaMeter, week } from '../support/quota'
import { TITLES, rowOf } from '../support/pane-long'

const PLAN = 'mcp__focus-conductor__plan'
const LONG = { timeoutMs: 120_000 }
const GOAL = 'Cập nhật sổ giá tuần theo 11 bước, lọc tin bằng subagent và kiểm số liệu bằng script khai sẵn'

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
}

const routed = (fanout: boolean) =>
  plan({
    goal: GOAL,
    depth: 'hard',
    volume: 'large',
    kind: 'edit',
    main: { model: 'opus', effort: 'high', why: 'việc dài nhiều bước' },
    scope: ['src/', 'data/'],
    tasks: TITLES.map((title, k) => (fanout && [3, 4, 5].includes(k) ? task(title, 'agent', 'sonnet', 'medium') : task(title, 'main', 'opus', 'high'))),
  })

async function failedBatch($: Engine, n: number) {
  const id = `s3-${n}`
  const agentId = `ag-${id}`
  const description = `BƯỚC 3: lọc tin lô ${n}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: `Lọc tin lô ${n}`, model: 'sonnet', subagent_type: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: `Lọc tin lô ${n}`, description, tool_use_id: id } as never)
  await $.turn.start({ text: `Lọc tin lô ${n}`, turnId: `a-${id}`, agentId } as never)
  await $.turn.complete({ turnId: `a-${id}`, agentId, answer: '', durationMs: 5, isAborted: false, reason: 'error' } as never)
}

/**
 * Nhiều cảnh báo chồng (ngoài phạm vi, ngân sách tool call, bước chưa đủ bằng chứng) rồi tạm dừng cứng vì hạn mức tuần.
 * `withFailed` thêm một lô lỗi và bỏ việc giao subagent theo kế hoạch (để cảnh báo ngân sách lên band): 5 mục cần chú ý.
 */
async function stacked($: Engine, on: On, withFailed: boolean) {
  const seen = base(on, { router: () => routed(!withFailed) })
  hooks(on)
  const meter = quotaMeter(on, [])
  await submit($, GOAL)
  await $.tool.call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) } as never)
  for (let id = 1; id <= 4; id++) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 5, status: 'doing' } as never)
  await $.turn.start({ text: 'làm', turnId: 't6' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
  for (let i = 0; i < 110; i++) await $.tool.call({ tool: 'Read', file_path: `/repo/src/r${i}.ts` } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 5, status: 'verified', evidence: 'pytest: 9 passed' } as never)
  if (withFailed) await failedBatch($, 1)
  meter.set([week(99)])
  await seen.clock.advance(120_000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
}

async function drawn($: Engine, rows: number) {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: rows } } } as never)
  const tree = await pane.drawn()
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return { tree, texts }
}

const count = (texts: string[], want: RegExp) => texts.filter(t => want.test(t)).length

const SCOPE = /ngoai\.py/
const UNVERIFIED = /^\u25B3 Bước 5 ghi đã kiểm chứng/
const BUDGET = /Đã 100 tool call/

describe('0.7.6 W1: mục Cần chú ý ở đầu pane', () => {
  test('pane 16 dòng: dòng tạm dừng và cảnh báo đỏ nằm trong 16 dòng, trước tiêu đề checklist', LONG, async ($, on) => {
    await stacked($, on, false)
    const { tree, texts } = await drawn($, 16)
    const attention = rowOf(tree, /^Cần chú ý/)
    const pause = rowOf(tree, /^\u23F8 Tạm dừng:/)
    const resume = rowOf(tree, /chạy tiếp: \/conductor resume force/)
    const scope = rowOf(tree, SCOPE)
    const checklist = rowOf(tree, /^Danh sách bước/)
    const bar = rowOf(tree, /^\d+\/\d+$/)
    expect(bar).toBeGreaterThanOrEqual(0)
    expect(attention).toBeGreaterThan(bar)
    for (const row of [attention, pause, resume, scope]) {
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(16)
      expect(row).toBeLessThan(checklist)
    }
    expect(pause).toBeLessThan(scope)
    expect(texts.some(t => /^\u23F8 Tạm dừng: .*làm mới/.test(t))).toBe(true)
    expect(texts.some(t => /^\u25B2 .*ngoai\.py/.test(t))).toBe(true)
  })

  test('thứ tự mục: tạm dừng, lô lỗi, ngoài phạm vi, chưa kiểm chứng, ngân sách', LONG, async ($, on) => {
    await stacked($, on, true)
    const { tree } = await drawn($, 40)
    const rows = [/^\u23F8 Tạm dừng:/, /lô lỗi chưa giao lại/, SCOPE, UNVERIFIED, BUDGET].map(want => rowOf(tree, want))
    rows.forEach(r => expect(r).toBeGreaterThanOrEqual(0))
    expect([...rows].sort((a, b) => a - b)).toEqual(rows)
    expect(rows[0]).toBeGreaterThan(rowOf(tree, /^Cần chú ý/))
  })

  test('mỗi câu cảnh báo xuất hiện đúng một lần trong toàn pane, tạm dừng không lặp', LONG, async ($, on) => {
    await stacked($, on, false)
    const { texts } = await drawn($, 40)
    expect(texts.some(t => /^Cần chú ý/.test(t))).toBe(true)
    for (const want of [SCOPE, UNVERIFIED, BUDGET]) expect(texts.filter(t => want.test(t)).length, String(want)).toBe(1)
    expect(texts.filter(t => /^Đang tạm dừng/.test(t)).length).toBe(0)
    expect(texts.filter(t => /^\u23F8 Tạm dừng:/.test(t)).length).toBe(1)
  })

  test('tiêu đề vi: Cần chú ý và Cảnh báo khác, không còn "Cảnh báo nhất quán"', LONG, async ($, on) => {
    await stacked($, on, true)
    const { texts } = await drawn($, 40)
    expect(texts.some(t => /^Cần chú ý/.test(t))).toBe(true)
    expect(texts.some(t => /^Cảnh báo khác/.test(t))).toBe(true)
    expect(texts.some(t => /^Cảnh báo nhất quán/.test(t))).toBe(false)
  })

  test('uiLanguage en: Needs attention và Other warnings', { ...LONG, options: { uiLanguage: 'en' } }, async ($, on) => {
    await stacked($, on, true)
    const { texts } = await drawn($, 40)
    expect(texts.some(t => /^Needs attention/.test(t))).toBe(true)
    expect(texts.some(t => /^Other warnings/.test(t))).toBe(true)
    expect(texts.some(t => /^\+2 more$/.test(t))).toBe(true)
    expect(texts.some(t => /^Consistency warnings/.test(t))).toBe(false)
  })

  test('quá 4 mục: dòng "+2 mục khác", mục dư (ngân sách, lệch model) hiện ở Cảnh báo khác đúng một lần', LONG, async ($, on) => {
    await stacked($, on, true)
    const { texts } = await drawn($, 40)
    const at = texts.findIndex(t => /^Cần chú ý/.test(t))
    const other = texts.findIndex(t => /^Cảnh báo khác/.test(t))
    const more = texts.findIndex(t => /^\+2 mục khác$/.test(t))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(more).toBeGreaterThan(at)
    expect(other).toBeGreaterThan(more)
    const shown = texts.slice(at, more)
    for (const want of [/^\u23F8 Tạm dừng:/, /lô lỗi chưa giao lại/, SCOPE, UNVERIFIED]) expect(shown.some(t => want.test(t)), String(want)).toBe(true)
    expect(shown.some(t => BUDGET.test(t))).toBe(false)
    expect(texts.slice(other).filter(t => BUDGET.test(t)).length).toBe(1)
    const section = texts.slice(other, texts.findIndex(t => /^Chi phí/.test(t)))
    expect(section.filter(t => /^\u25B3 Agent .*engine chạy sonnet thay vì opus/.test(t)).length).toBe(1)
    for (const want of [SCOPE, UNVERIFIED, BUDGET]) expect(texts.filter(t => want.test(t)).length, String(want)).toBe(1)
  })

  // Thêm ở commit sửa để ghim mẫu đột biến: số dòng của mục Cần chú ý tính vào luật dạng gọn, nên danh sách đầy đủ không tràn pane.
  test('checklist dài đủ dạng đầy đủ thì mọi bước nằm trong số dòng của pane, dù có mục Cần chú ý', LONG, async ($, on) => {
    await stacked($, on, false)
    let full = 0
    for (let rows = 12; rows <= 40; rows++) {
      const { tree, texts } = await drawn($, rows)
      const isCompact = texts.some(t => /^\+\d+ bước mở/.test(t))
      if (isCompact) continue
      full += 1
      const last = rowOf(tree, /^BƯỚC 10:/)
      expect(last, `${rows} dòng`).toBeGreaterThanOrEqual(0)
      expect(last, `${rows} dòng`).toBeLessThan(rows)
    }
    expect(full).toBeGreaterThan(0)
  })
})
