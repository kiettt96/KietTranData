// 0.9.0 A5 (tích hợp, nối tiếp retired-e1-089): yêu cầu đã rời kế hoạch (brief.retired) không còn hiện như yêu cầu đang mở ở lời nhắc
// đối chiếu yêu cầu khi checklist đóng hẳn và ở lý do cổng Stop khi chưa có checklist; thay vào đó có một dòng đếm "đã bỏ N". Pane không
// liệt kê yêu cầu (0.8.9), nên phần pane không đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { noChecklistReason, requirementsNotice } from '../../hooks/lib/text'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'
import { makeBrief } from '../support/commands'

const OPTS = { options: { planApproval: 'off' } }
const PLAN = 'mcp__focus-conductor__plan'
const REQS = ['Xuất báo cáo tháng', 'Gửi thư tổng kết', 'Lưu bản sao lên kho', 'Ghi nhật ký thay đổi']
const FIRST = plan({
  goal: 'Hoàn thiện quy trình cuối tháng',
  depth: 'hard',
  volume: 'medium',
  kind: 'edit',
  requirements: REQS,
  tasks: REQS.map((r, i) => task(`Phần ${i + 1}: ${r}`, 'main', 'sonnet', 'medium', { covers: [i + 1] })),
})
const DROP = plan({ relation: 'refine', intent: 'amend', goal: '', arrange: { order: [], drop: [{ task: 2, why: 'không gửi thư nữa' }, { task: 3, why: 'không lưu bản sao nữa' }], merge: [] } })
const router = (request: string): Json => (request.includes('thôi phần') ? DROP : FIRST)
const callRequirements = (fn: (...a: unknown[]) => string, ...args: unknown[]) => fn(...args)

describe('0.9.0 A5: hàm dựng danh sách yêu cầu bỏ yêu cầu đã rời kế hoạch', () => {
  test('requirementsNotice: không có (2) và (3), có "đã bỏ 2"; giữ số gốc của (1) và (4)', () => {
    const text = callRequirements(requirementsNotice as (...a: unknown[]) => string, REQS, [2, 3])
    expect(text).toContain('(1) Xuất báo cáo tháng')
    expect(text).toContain('(4) Ghi nhật ký thay đổi')
    expect(text).not.toContain('Gửi thư tổng kết')
    expect(text).not.toContain('Lưu bản sao lên kho')
    expect(text).toContain('đã bỏ 2 yêu cầu')
  })
  test('requirementsNotice không có yêu cầu nào bỏ: như 0.8.9, không có dòng đã bỏ', () => {
    expect(requirementsNotice(REQS)).not.toContain('đã bỏ')
  })
  test('noChecklistReason (mục tiêu không có việc): không liệt kê yêu cầu đã bỏ, có dòng đếm', () => {
    const text = noChecklistReason(makeBrief({ requirements: REQS, retired: [2] }), false)
    expect(text).not.toContain('Gửi thư tổng kết')
    expect(text).toContain('đã bỏ 1 yêu cầu')
  })
})

describe('0.9.0 A5: toàn luồng, bỏ hai việc rồi đóng checklist', () => {
  test('lời nhắc đối chiếu yêu cầu khi đóng checklist không nêu hai yêu cầu đã bỏ, có "đã bỏ 2"', OPTS, async ($: Engine, on) => {
    base(on, { router })
    await submit($, 'Hoàn thiện quy trình cuối tháng')
    await submit($, 'thôi phần gửi thư và phần lưu bản sao')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phần 1' }, { title: 'Phần 4' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const out = await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    const text = [String(out.result ?? ''), ...(out.context ?? [])].join('\n')
    expect(text).toContain('Đối chiếu từng yêu cầu')
    expect(text).not.toContain('Gửi thư tổng kết')
    expect(text).toContain('đã bỏ 2 yêu cầu')
  })
})
