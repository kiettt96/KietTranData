// 0.7.5 M4 (vòng sửa 2): router xếp mục tiêu mới với tin cậy dưới 0,8 khi checklist còn bước mở: chỉ giữ mục tiêu khi prompt nhắc
// tới một bước đang mở (theo tiêu đề) hay một mã bước, mã việc của mục tiêu; câu hỏi khác hẳn lập mục tiêu mới. Khi giữ thì lựa
// chọn luồng chính của prompt đó có sàn main của mục tiêu (R5, vòng rà soát 3; vòng sửa 2 từng cho theo router không sàn).

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const call = nextBrief as (...a: unknown[]) => ReturnType<typeof nextBrief>
const STEPS = ['BƯỚC 5: lọc tin lô 3', 'BƯỚC 6: đọc và giải thích biến động giá', 'BƯỚC 7: tóm tắt tin theo nhóm hàng']
const prev = makeBrief({
  goalId: 4,
  goal: 'Cập nhật sổ giá theo 11 bước',
  steps: STEPS,
  tasks: STEPS.map((title, i) => ({ index: i + 1, title, run: 'main' as const, pick: { family: 'sonnet' as const, effort: 'medium' as const }, depth: 'light' as const, volume: 'small' as const, kind: 'edit' as const, why: '' })),
  main: { family: 'opus', effort: 'high' },
})
const opts = { openSteps: STEPS.slice(1) }
const ask = (prompt: string, confidence = 0.75, over: Record<string, unknown> = {}) => call(prev, routed({ relation: 'new', confidence, goal: 'Việc khác', ...over }), prompt, 2, opts)

describe('0.7.5 M4: chỉ giữ mục tiêu khi prompt nhắc tới bước đang mở hay mã của mục tiêu', () => {
  test('câu hỏi khác hẳn ở 0,75: lập mục tiêu mới', () => {
    const out = ask('Giá vàng SJC hôm nay bao nhiêu?')
    expect(out.isNewGoal).toBe(true)
    expect(out.held).toBe(false)
  })

  test('"làm tiếp BƯỚC 6" ở 0,75: vẫn giữ mục tiêu', () => {
    const out = ask('làm tiếp BƯỚC 6')
    expect(out.isNewGoal).toBe(false)
    expect(out.held).toBe(true)
    expect(out.brief.goalId).toBe(4)
  })

  test('mã bước không thuộc mục tiêu ("BƯỚC 99") hay không nhắc bước nào: mục tiêu mới', () => {
    expect(ask('làm BƯỚC 99').isNewGoal).toBe(true)
    expect(ask('làm tiếp đi').isNewGoal).toBe(true)
  })

  test('nhắc bước đang mở theo tiêu đề: giữ; nhắc bước đã xong (không còn mở) không đủ', () => {
    expect(ask('tóm tắt tin theo nhóm hàng giúp tôi').held).toBe(true)
    expect(ask('đọc và giải thích biến động giá của tuần này').held).toBe(true)
    expect(ask('lọc tin lô 3 lại').isNewGoal).toBe(true)
  })

  test('mã bước viết "Bước 7:", "step 7" hay mã việc K4.2 của mục tiêu cũng giữ', () => {
    expect(ask('Bước 7: làm đi').held).toBe(true)
    expect(ask('step 7 please').held).toBe(true)
    const coded = makeBrief({ goalId: 4, steps: ['K4.1 Kiểm kê', 'K4.2 Xếp loại'], tasks: [], main: { family: 'opus', effort: 'high' } })
    expect(call(coded, routed({ relation: 'new', confidence: 0.6, goal: 'Khác' }), 'làm K4.2', 2, { openSteps: ['K4.2 Xếp loại'] }).held).toBe(true)
  })

  test('tin cậy từ 0,8 trở lên hay checklist không còn bước mở: mục tiêu mới dù prompt nhắc BƯỚC 6', () => {
    expect(ask('làm tiếp BƯỚC 6', 0.85).isNewGoal).toBe(true)
    expect(call(prev, routed({ relation: 'new', confidence: 0.6, goal: 'Khác' }), 'làm tiếp BƯỚC 6', 2, { openSteps: [] }).isNewGoal).toBe(true)
  })
})

describe('0.7.5 M4: biên của việc nhận ra', () => {
  const heldBy = (prompt: string, openSteps: string[], over: Partial<Parameters<typeof makeBrief>[0]> = {}) =>
    call(makeBrief({ goalId: 4, ...over }), routed({ relation: 'new', confidence: 0.6, goal: 'Khác' }), prompt, 2, { openSteps }).held

  test('tiêu đề ngắn phải được nhắc đủ từ; một từ trong hai không đủ', () => {
    expect(heldBy('xem lại phần thiết kế', ['Phân tích', 'Thiết kế'])).toBe(true)
    expect(heldBy('phân loại hàng hóa', ['Phân tích', 'Thiết kế'])).toBe(false)
  })

  test('tiêu đề dài cần ít nhất ba từ và 60% số từ', () => {
    const title = 'Kiểm kê toàn bộ bước của engine theo từng tệp nguồn'
    expect(heldBy('kiểm kê toàn bộ bước của engine', [title])).toBe(true)
    expect(heldBy('kiểm kê toàn bộ', [title])).toBe(false)
  })

  test('tiêu đề không có từ có nghĩa nào (ký hiệu, chữ số đơn) không bao giờ giữ', () => {
    expect(heldBy('a 1 abc', ['A 1'])).toBe(false)
    expect(heldBy('xong chưa', ['??'])).toBe(false)
  })

  test('mã viết "Step 2", "task 2", "bước 07" khớp việc có mã "Việc 2", "BƯỚC 7"', () => {
    expect(heldBy('task 2 đi', ['Việc 2: dọn dữ liệu'])).toBe(true)
    expect(heldBy('làm bước 07', ['BƯỚC 7: ghi'])).toBe(true)
    expect(heldBy('step 3 nhé', ['BƯỚC 3: lọc'])).toBe(true)
  })

  test('mã mục tiêu (steps, tasks) không còn mở vẫn tính; mã lạ thì không', () => {
    expect(heldBy('xem lại K4.1', ['K4.2 Xếp loại'], { steps: ['K4.1 Kiểm kê', 'K4.2 Xếp loại'] })).toBe(true)
    expect(heldBy('xem lại K9.9', ['K4.2 Xếp loại'], { steps: ['K4.1 Kiểm kê', 'K4.2 Xếp loại'] })).toBe(false)
  })
})

describe('0.7.5 M4 và R5: khi giữ, luồng chính có sàn main của mục tiêu', () => {
  test('prompt được giữ ở 0,75 với router chọn sonnet/medium: luồng chính được nâng lên sàn opus/high của mục tiêu', () => {
    const out = ask('làm tiếp BƯỚC 6', 0.75, { main: { model: 'sonnet', effort: 'medium', why: '' } })
    expect(out.held).toBe(true)
    expect(out.brief.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('tiếp nối thật (relation continue) vẫn có sàn main như A7', () => {
    const out = call(prev, routed({ relation: 'continue', confidence: 0.9, goal: '', main: { model: 'sonnet', effort: 'medium', why: '' } }), 'tiếp', 2, opts)
    expect(out.brief.main).toEqual({ family: 'opus', effort: 'high' })
  })
})
