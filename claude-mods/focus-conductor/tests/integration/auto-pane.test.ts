// 0.7.2 điểm 4: pane chi tiết tự mở ở mỗi mục tiêu mới (option autoPane, mặc định bật), không chiếm phím (không focus), chỉ khi pane
// chưa mở. Kit kiểm thử không phát được ui.close (engine tự phát khi người dùng bấm dấu đóng, và từ chối $.ui.close của hook test), nên
// hook ui.close của mod chỉ được kiểm bằng hàm thuần ở tests/pane-open.test.ts; pane đã đóng được mô phỏng bằng option panesClosed của base().

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, ROUTER_TIMEOUT, base, conductor, plan, submit } from '../support/engine'

const PANE_ID = 'focus-conductor'

describe('0.7.2 4: pane tự mở ở mục tiêu mới', () => {
  test('mục tiêu đầu tiên: mở pane của mod, không focus, số dòng vừa phải', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.opened).toEqual([{ id: PANE_ID, title: 'Focus Conductor', rows: 16 }])
  })

  test('prompt tiếp nối: không mở thêm dù pane đã đóng', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { panesClosed: true, router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : plan({ relation: 'continue', goal: '' })) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.opened.length).toBe(1)
  })

  test('pane đã đóng: mục tiêu mới mở lại', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { panesClosed: true, router: () => plan({ goal: `Mục tiêu ${(n += 1)}`, relation: 'new' }) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Chuyển sang việc khác')
    expect(seen.opened.length).toBe(2)
  })

  test('pane đã mở: mục tiêu mới không gọi mở lần nữa', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => plan({ goal: `Mục tiêu ${(n += 1)}`, relation: 'new' }) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Chuyển sang việc khác')
    expect(seen.opened.length).toBe(1)
  })
})

describe('0.7.2 4: tắt hay không áp dụng', () => {
  test('autoPane false: không mở', { options: { autoPane: false } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.opened).toEqual([])
  })

  test('mode off: không mở', {}, async ($, on) => {
    const seen = base(on)
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    expect(seen.opened).toEqual([])
  })
})

describe('0.7.2 4: các đường lập mục tiêu khác', () => {
  test('router lỗi ở prompt đầu (mục tiêu tối thiểu): vẫn mở pane', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    expect(seen.opened.map(o => o.id)).toEqual([PANE_ID])
  })

  test('/conductor goal: mở pane', {}, async ($, on) => {
    const seen = base(on)
    await conductor($, 'goal Sửa module thanh toán')
    expect(seen.opened.map(o => o.id)).toEqual([PANE_ID])
  })
})

describe('0.7.2 4: pane chưa được đặt', () => {
  test('isPlaced false (màn hình hẹp): không toast lỗi, ghi nhật ký quyết định kèm lý do', { options: { decisionLog: '/tmp/fc-auto-pane.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const seen = base(on, { paneUnplaced: 'màn hình 100 cột, cần 110' })
    await submit($, COMPLEX_PROMPT)
    expect(seen.toasts.some(t => t.toLowerCase().includes('pane'))).toBe(false)
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.find(line => line['kind'] === 'pane')).toMatchObject({ kind: 'pane', isPlaced: false, reason: 'màn hình 100 cột, cần 110' })
  })

  test('isPlaced true (trường hợp bình thường): không thêm dòng pane vào nhật ký', { options: { decisionLog: '/tmp/fc-auto-pane2.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    base(on)
    await submit($, COMPLEX_PROMPT)
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.find(line => line['kind'] === 'pane')).toBeUndefined()
  })
})
