// 0.7.5 L6 (vòng sửa 2): nhãn dòng việc: việc có mã (BƯỚC 4, K4.2, Việc 3) hiện chính mã đó, không ghép "Việc 5: BƯỚC 4: ..."; dòng
// việc nhiều lô trên pane đã có "r đang chạy" trong phần chi tiết nên không lặp chữ trạng thái "đang chạy".

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { labels, taskLabel } from '../hooks/ui/labels'
import { PANE, base, plan, spawnTool, submit, task } from './support/engine'

const vi = labels('vi')
const en = labels('en')

describe('0.7.5 L6: nhãn dòng việc theo mã', () => {
  test('việc có mã bước hiện mã, không thêm "Việc N:"', () => {
    expect(taskLabel(vi, { kind: 'agent', index: 5, title: 'BƯỚC 4: lọc tin' })).toBe('BƯỚC 4: lọc tin')
    expect(taskLabel(vi, { kind: 'direct', index: 2, title: 'Bước 7 đổi tên' })).toBe('Bước 7 đổi tên')
    expect(taskLabel(en, { kind: 'agent', index: 5, title: 'Step 4: filter' })).toBe('Step 4: filter')
  })

  test('việc có mã mục (K4.2) hay đã mở đầu bằng "Việc N" cũng giữ nguyên tiêu đề', () => {
    expect(taskLabel(vi, { kind: 'agent', index: 2, title: 'K4.2. Việc giao' })).toBe('K4.2. Việc giao')
    expect(taskLabel(vi, { kind: 'direct', index: 3, title: 'Việc 3: thiết kế' })).toBe('Việc 3: thiết kế')
  })

  test('việc Claude tự giao (không có số việc) mang mã trong mô tả vẫn có đầu "Claude tự giao"', () => {
    expect(taskLabel(vi, { kind: 'agent', title: 'BƯỚC 9: lọc tin lô 2' })).toBe(`${vi.taskOwn}: BƯỚC 9: lọc tin lô 2`)
  })

  test('việc không mã vẫn là "Việc N: tiêu đề"; việc chính và việc tự giao như cũ', () => {
    expect(taskLabel(vi, { kind: 'direct', index: 2, title: 'Đổi tên userId' })).toBe('Việc 2: Đổi tên userId')
    expect(taskLabel(vi, { kind: 'main', title: 'Cập nhật dữ liệu' })).toBe('Việc chính: Cập nhật dữ liệu')
    expect(taskLabel(vi, { kind: 'agent', title: 'Lọc tin lô 1' })).toBe(`${vi.taskOwn}: Lọc tin lô 1`)
    expect(taskLabel(en, { kind: 'direct', index: 2, title: 'Rename userId' })).toBe('Task 2: Rename userId')
  })
})

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return texts.filter((t): t is string => typeof t === 'string')
}

describe('0.7.5 L6: dòng pane của việc có mã và nhiều lô', () => {
  test('3 lô của "BƯỚC 4": nhãn là mã bước, chi tiết "r đang chạy" và không lặp chữ "đang chạy"', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Cập nhật dữ liệu theo các bước', depth: 'hard', volume: 'large', tasks: [task('BƯỚC 4: lọc tin', 'agent', 'sonnet', 'medium')] }) })
    hooks(on)
    await submit($, 'Cập nhật dữ liệu theo các bước')
    for (const n of [1, 2, 3]) await spawnTool($, `u${n}`, `BƯỚC 4: lọc tin lô ${n}`, 'x')
    const texts = await paneTexts($)
    expect(texts).toContain('BƯỚC 4: lọc tin')
    expect(texts.some(t => t.startsWith('Việc 1: BƯỚC'))).toBe(false)
    expect(texts).toContain('0/3 lô xong, 3 đang chạy')
    expect(texts).not.toContain('đang chạy')
  })

  test('việc không mã một lô đang chạy: vẫn ghi chữ "đang chạy" của trạng thái', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Cập nhật dữ liệu theo các bước', depth: 'hard', volume: 'large', tasks: [task('Chuẩn hóa đơn vị tính', 'agent', 'sonnet', 'medium'), task('Đổi tên cột', 'main', 'sonnet', 'medium')] }) })
    hooks(on)
    await submit($, 'Cập nhật dữ liệu theo các bước')
    await spawnTool($, 'u1', 'Việc 1: chuẩn hóa', 'x')
    const texts = await paneTexts($)
    expect(texts).toContain('Việc 1: Chuẩn hóa đơn vị tính')
    expect(texts).toContain('đang chạy')
  })
})
