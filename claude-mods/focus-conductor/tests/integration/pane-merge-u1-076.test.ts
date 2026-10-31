// 0.7.6 U1: pane gộp checklist và "Tiến độ từng việc": dòng bước nào khớp một việc thì mang luôn chip model và số lô ("sonnet 0/3 · 3
// đang chạy"); chỉ giữ dòng riêng cho việc Claude tự giao và việc của luồng chính không khớp bước nào. Mỗi bước chỉ xuất hiện một lần.

import { describe, expect, test } from 'claude-code/testing'
import { spawnTool } from '../support/engine'
import { TITLES, drawn, longGoal, rowOf } from '../support/pane-long'

describe('0.7.6 U1: checklist và tiến độ từng việc là một danh sách', () => {
  test('mục tiêu 11 bước có mã: mỗi bước chỉ xuất hiện một lần trong pane (40 dòng)', async ($, on) => {
    await longGoal($, on, 3)
    const { texts } = await drawn($, 40)
    // Nhật ký điều phối ghi từng lời gọi Agent theo description: không phải dòng bước, nên chỉ đếm phần trước mục đó.
    const end = texts.findIndex(t => /^Nhật ký điều phối/.test(t))
    const list = end < 0 ? texts : texts.slice(0, end)
    // Bước đã đóng dồn vào dòng tóm tắt (0 lần); bước mở đúng một lần.
    for (const title of TITLES) expect(list.filter(t => t.includes(title)).length, title).toBeLessThanOrEqual(1)
    for (const title of TITLES.slice(3)) expect(list.filter(t => t.includes(title)).length, title).toBe(1)
  })

  test('pane 24 dòng: thấy bước đang làm và số lô của nó trên cùng dòng', async ($, on) => {
    await longGoal($, on, 3)
    const { tree, texts } = await drawn($, 24)
    const step = rowOf(tree, /BƯỚC 3: lọc tin lô 1/)
    expect(step).toBeGreaterThanOrEqual(0)
    expect(step).toBeLessThan(24)
    expect(rowOf(tree, /^sonnet 0\/3 · 3 đang chạy$/)).toBe(step)
    expect(texts.some(t => /^sonnet 0\/3 · 3 đang chạy$/.test(t))).toBe(true)
  })

  test('lô lỗi: chip của dòng bước ghi số lô lỗi', async ($, on) => {
    await longGoal($, on, 3)
    await $.turn.complete({ turnId: 't-u1', agentId: 'a-u1', answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    const { tree, texts } = await drawn($, 24)
    expect(texts.some(t => /^sonnet 0\/3 · 2 đang chạy · 1 lỗi$/.test(t))).toBe(true)
    expect(rowOf(tree, /^sonnet 0\/3 · 2 đang chạy · 1 lỗi$/)).toBe(rowOf(tree, /BƯỚC 3: lọc tin lô 1/))
  })

  test('việc Claude tự giao vẫn có dòng riêng', async ($, on) => {
    await longGoal($, on, 3)
    await spawnTool($, 'own1', 'Kiểm tra log lỗi thanh toán', 'kiểm tra')
    const { texts } = await drawn($, 40)
    expect(texts.some(t => /^Claude tự giao: Kiểm tra log lỗi thanh toán/.test(t))).toBe(true)
  })
})
