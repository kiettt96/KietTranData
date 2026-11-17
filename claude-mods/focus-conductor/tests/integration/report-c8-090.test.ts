// 0.9.0 C8 (tích hợp): khi đóng bước cuối, mod chèn một bảng gọn từ sổ kết luận của mục tiêu: mỗi việc một dòng gồm vai, model đã chạy,
// kết luận; không quá 600 ký tự, quá thì gộp theo vai. Mục tiêu không có việc nào giao subagent có vai thì không chèn gì (giữ số ký tự
// như 0.8.9). Mục 6 của khối kỷ luật nêu thêm "ai làm, kết luận duyệt, phần chưa xác minh" trong đúng số ký tự hiện có của mục đó (472).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DISCIPLINE } from '../../hooks/lib/text'
import { REPORT_TABLE_CHARS, reportTable } from '../../hooks/lib/verdict'
import { base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({
  goal: 'Sửa luồng phí',
  depth: 'substantial',
  volume: 'medium',
  kind: 'edit',
  tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium', { role: 'build' }), task('Duyệt thay đổi', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' })],
})
const PLAIN = plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit' })
type Out = { result?: string }

function setup(on: On, brief = GOAL): void {
  base(on, { router: () => brief })
  on('tool.call', { tool: /^(?:Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
}
let n = 0
async function run($: Engine, description: string, answer: string): Promise<void> {
  const id = `c8-${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Làm.' } as never)
  await $.agent.spawn({ prompt: 'Làm.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer' } as never)
}
async function closeAll($: Engine): Promise<{ first: string; last: string }> {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: Sửa hàm phí' }, { title: 'Việc 2: Duyệt thay đổi' }] })
  const first = ((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })) as Out).result ?? ''
  const last = ((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })) as Out).result ?? ''
  return { first, last }
}

describe('0.9.0 C8: bảng báo cáo khi đóng bước cuối', () => {
  test('đóng bước cuối: mỗi việc một dòng có vai, model, kết luận; bước chưa cuối thì chưa chèn', { options: { planApproval: 'off', closingReview: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng phí')
    await run($, 'Việc 1: Sửa hàm phí', 'Đã sửa src/fee.ts, chạy bun test: 12 pass.')
    await run($, 'Việc 2: Duyệt thay đổi', 'ĐẠT\n- Nhỏ: tên biến')
    const { first, last } = await closeAll($)
    expect(first).not.toContain('Bảng việc')
    const table = last.slice(last.indexOf('[focus-conductor] Bảng việc'))
    expect(last).toContain('[focus-conductor] Bảng việc')
    expect(table).toMatch(/Việc 1: vai làm, sonnet, /)
    expect(table).toMatch(/Việc 2: vai duyệt, sonnet, ĐẠT/)
    expect(table.length).toBeLessThanOrEqual(REPORT_TABLE_CHARS)
  })

  test('mục tiêu không có việc giao subagent có vai: không chèn bảng', { options: { planApproval: 'off', closingReview: 'off' } }, async ($, on) => {
    setup(on, PLAIN)
    await submit($, 'Sửa luồng phí')
    const { last } = await closeAll($)
    expect(last).not.toContain('Bảng việc')
  })

  test('quá 600 ký tự thì gộp theo vai, vẫn không quá 600', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('build' as const) : ('review' as const),
      verdict: i % 2 === 0 ? null : i % 4 === 1 ? ('pass' as const) : ('fail' as const),
      family: 'sonnet' as const,
      taskIndex: i + 1,
      description: `Việc ${i + 1}: một việc có mô tả khá dài để dòng bảng vượt trần ký tự`,
    }))
    const text = reportTable(items)
    expect(text.length).toBeLessThanOrEqual(REPORT_TABLE_CHARS)
    expect(text).toContain('vai làm: 15 việc')
    expect(text).toContain('vai duyệt: 15 việc')
    expect(text).not.toContain('Việc 3:')
  })

  test('một việc chạy nhiều lần: giữ lần cuối', () => {
    const text = reportTable([
      { role: 'review', verdict: 'fail', family: 'sonnet', taskIndex: 2, description: 'Việc 2: Duyệt' },
      { role: 'review', verdict: 'pass', family: 'opus', taskIndex: 2, description: 'Việc 2: Duyệt' },
    ])
    expect(text).toContain('Việc 2: vai duyệt, opus, ĐẠT')
    expect(text).not.toContain('CHƯA ĐẠT')
  })

  test('mục 6 của khối kỷ luật nêu ai làm, kết luận duyệt, phần chưa xác minh, giữ đúng 472 ký tự', () => {
    const six = DISCIPLINE.split('\n').find(line => line.startsWith('6. ')) ?? ''
    expect(six).toContain('ai làm, kết luận duyệt, phần chưa xác minh')
    expect(six.length).toBe(472)
  })
})
