// 0.7.0 điểm 5: hiển thị bước verified. Band, pane và status line ghi thêm số bước đã kiểm chứng ("· k✓") khi có; thanh tiến độ
// vẽ phần verified đậm, phần done thường. Không có bước verified thì mọi thứ giữ nguyên như 0.6.1.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { PlanStep } from '../../types'
import { statusLine, progress } from '../../hooks/lib/text'
import { barRuns } from '../../hooks/ui/style'
import { makeBrief } from '../support/commands'
import { COMPLEX_PROMPT, PANE, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const step = (id: number, status: PlanStep['status']): PlanStep => ({ id, title: `b${id}`, status })

describe('0.7.0 5: thanh tiến độ và số bước verified', () => {
  test('không có bước verified: thanh giữ nguyên một đoạn như 0.6.1', () => {
    expect(barRuns([step(1, 'done'), step(2, 'done'), step(3, 'todo')], 9)).toEqual([
      { text: '━━━━━━', color: 'warning' },
      { text: '╌╌╌', color: 'subtle' },
    ])
  })

  test('có bước verified: phần verified tô đậm, phần done thường, tổng số ô đúng', () => {
    const runs = barRuns([step(1, 'verified'), step(2, 'done'), step(3, 'todo')], 9)
    expect(runs.map(r => r.text).join('')).toBe('━━━━━━╌╌╌')
    expect(runs[0]).toMatchObject({ text: '━━━', bold: true })
    expect(runs[1]).toMatchObject({ text: '━━━' })
    expect(runs[1]?.bold).toBeUndefined()
  })

  test('mọi bước đóng đều verified: thanh đầy và đậm', () => {
    expect(barRuns([step(1, 'verified'), step(2, 'verified')], 8)).toEqual([{ text: '━━━━━━━━', color: 'success', bold: true }])
  })

  test('done và verified lẫn lộn khi xong hết: hai đoạn đủ số ô', () => {
    const runs = barRuns([step(1, 'verified'), step(2, 'done')], 8)
    expect(runs.map(r => r.text).join('')).toBe('━━━━━━━━')
    expect(runs[0]).toMatchObject({ bold: true })
  })

  test('status line thêm "· k✓" khi có bước verified, không thêm khi không có', () => {
    const brief = makeBrief()
    expect(statusLine(brief, [step(1, 'verified'), step(2, 'done')], null, 'auto')).toMatch(/2\/2 · 1✓$/)
    expect(statusLine(brief, [step(1, 'done'), step(2, 'todo')], null, 'auto')).not.toContain('✓')
    expect(progress([step(1, 'verified'), step(2, 'todo')])).toEqual({ closed: 1, total: 2 })
  })
})

describe('0.7.0 5: band và pane trên engine', () => {
  async function verifiedGoal($: Engine, on: On) {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
  }
  const bandTexts = async ($: Engine) => {
    const band = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    const texts = (await band.findAll({ type: 'Text' })).map(e => e.text)
    await band.unmount()
    return texts
  }
  const paneTexts = async ($: Engine) => {
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
    await pane.unmount()
    return texts
  }

  test('band ghi "1/2 · 1✓" sau khi mod tự nâng bước 1', {}, async ($, on) => {
    await verifiedGoal($, on)
    expect((await bandTexts($)).some(t => t === '1/2 · 1✓')).toBe(true)
  })

  test('pane ghi số bước verified ở tiêu đề checklist', {}, async ($, on) => {
    await verifiedGoal($, on)
    expect((await paneTexts($)).some(t => /^Danh sách bước 1\/2 · 1✓/.test(t))).toBe(true)
  })

  test('đối chứng: chưa có bước verified thì band chỉ ghi "1/2"', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect((await bandTexts($)).some(t => t === '1/2')).toBe(true)
  })
})
