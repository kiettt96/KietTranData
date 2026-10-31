// 0.7.6 U3: tạm dừng cứng chiếm dòng 1 của band ("⏸ Tạm dừng: <lý do hạn mức> · làm mới <giờ>"), dòng 2 là "Điểm dừng đã ghi · chạy tiếp:
// /conductor resume force"; status line kèm lệnh chạy tiếp. Báo hạn mức mềm hiện ở dòng 2 của band và mục Hạn mức của pane ghi "báo mềm"
// thay cho "bình thường". Ở 56, 72, 120 cột mục tiêu không bị cắt còn một ký tự và trạng thái tạm dừng luôn thấy.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const PAUSE = '⏸'
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')
const cells = (s: string) => [...s.normalize('NFC')].length

function hooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
}

async function bandRows($: Engine, columns: number, maxRows: number) {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const content = (tree.children ?? []).filter(c => c !== null && typeof c === 'object')[1] as Node
  return (content.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
}

async function hardPause($: Engine, on: On) {
  const seen = base(on, RESUME)
  hooks(on)
  memoryStore(on)
  const meter = quotaMeter(on, [session(10)])
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
  meter.set([session(97)])
  await seen.clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test rồi sửa phần còn lại.' } as never)
  return seen
}

describe('0.7.6 U3: tạm dừng cứng trên band', () => {
  for (const columns of [56, 72, 120]) {
    test(`${columns} cột: dòng 1 "⏸ Tạm dừng: ..." kèm giờ làm mới, dòng 2 "Điểm dừng đã ghi · chạy tiếp: /conductor resume force"`, async ($, on) => {
      await hardPause($, on)
      const rows = (await bandRows($, columns, 2)).map(textOf)
      expect(rows[0]).toContain(`${PAUSE} Tạm dừng: hạn mức phiên (5 giờ) còn 3%`)
      expect(rows[0]).toContain('làm mới')
      expect(rows[1]).toContain('Điểm dừng đã ghi')
      expect(rows[1]).toContain('chạy tiếp: /conductor resume force')
    })
  }

  test('maxRows 1: dòng tạm dừng vẫn thấy', async ($, on) => {
    await hardPause($, on)
    const rows = (await bandRows($, 72, 1)).map(textOf)
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain(`${PAUSE} Tạm dừng`)
  })

  test('status line kèm lệnh chạy tiếp', async ($, on) => {
    const seen = await hardPause($, on)
    expect(seen.statuses.filter(s => s !== undefined).at(-1)).toContain('/conductor resume force')
  })
})

describe('0.7.6 U3: báo hạn mức mềm', () => {
  test('dòng 2 của band ghi báo hạn mức; mục Hạn mức của pane ghi "báo mềm"', { options: { noticeWeekRemainingPct: 25 } }, async ($, on) => {
    const seen = base(on, RESUME)
    hooks(on)
    const meter = quotaMeter(on, [week(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
    meter.set([week(80)])
    await seen.clock.advance(120_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    const rows = (await bandRows($, 120, 2)).map(textOf)
    expect(rows[1]).toContain('báo hạn mức: tuần còn 20%')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Trạng thái: báo mềm/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Trạng thái: bình thường/ })).toBeUndefined()
    await pane.unmount()
  })
})

describe('0.7.6 U3: mục tiêu không bị cắt còn một ký tự', () => {
  for (const columns of [56, 72, 120]) {
    test(`${columns} cột, chưa có checklist: mục tiêu còn ít nhất 10 ô`, async ($, on) => {
      base(on, RESUME)
      hooks(on)
      quotaMeter(on, [session(10)])
      await submit($, COMPLEX_PROMPT)
      const [first] = await bandRows($, columns, 2)
      const kids = ((first as Node).children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
      const fixed = kids.filter(k => k.props?.flexGrow === undefined).reduce((sum, k) => sum + (k.type === 'Button' ? Math.max(10, cells(String(k.props?.label ?? '')) + 2) : cells(textOf(k))), 0)
      const gaps = Number((first as Node).props?.gap ?? 0) * Math.max(0, kids.length - 1)
      expect(columns - 2 - fixed - gaps).toBeGreaterThanOrEqual(10)
    })
  }
})
