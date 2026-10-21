// 0.7.2 điểm 4: pane chi tiết tự mở ở mỗi mục tiêu mới (option autoPane, mặc định bật), không chiếm phím (không focus), chỉ khi pane
// chưa mở; người dùng tự đóng thì không mở lại trong mục tiêu đó, mục tiêu mới mở lại. Hook ui.close luôn cho đóng đi tiếp.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, ROUTER_TIMEOUT, base, conductor, plan, submit } from '../support/engine'

const PANE_ID = 'focus-conductor'
// Bộ kiểm thử không có lệnh ui.close của người dùng (engine tự phát khi người dùng bấm dấu đóng), nên đường đóng của người dùng được
// kiểm bằng hàm thuần ở tests/pane-open.test.ts. Ở đây một hook thử đóng pane bằng $.ui.close: origin là plugin, đi qua hook ui.close của mod.
const CLOSE = 'ĐÓNG PANE'
function closer(on: On) {
  on('prompt.submit', async ($, e, next) => {
    if (e.text === CLOSE) await $.ui.close({ id: PANE_ID })
    return next(e)
  })
}
const closeByPlugin = ($: Engine) => submit($, CLOSE)

describe('0.7.2 4: pane tự mở ở mục tiêu mới', () => {
  test('mục tiêu đầu tiên: mở pane của mod, không focus, số dòng vừa phải', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.opened).toEqual([{ id: PANE_ID, title: 'Focus Conductor', rows: 16 }])
  })

  test('prompt tiếp nối: không mở thêm', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : plan({ relation: 'continue', goal: '' })) })
    closer(on)
    await submit($, COMPLEX_PROMPT)
    await closeByPlugin($)
    expect(seen.panes).toEqual([])
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.opened.length).toBe(1)
  })

  test('pane đã mở: mục tiêu mới không gọi mở lần nữa', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => plan({ goal: `Mục tiêu ${(n += 1)}`, relation: 'new' }) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Chuyển sang việc khác')
    expect(seen.opened.length).toBe(1)
  })

  test('mod tự đóng pane (origin plugin) không tính là người dùng đóng: mục tiêu mới vẫn mở', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => plan({ goal: `Mục tiêu ${(n += 1)}`, relation: 'new' }) })
    closer(on)
    await submit($, COMPLEX_PROMPT)
    await closeByPlugin($)
    await submit($, 'Chuyển sang việc khác')
    expect(seen.opened.length).toBe(2)
  })

  test('hook ui.close cho đóng đi tiếp: pane biến mất khỏi danh sách của engine', {}, async ($, on) => {
    const seen = base(on)
    closer(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.panes).toEqual([PANE_ID])
    await closeByPlugin($)
    expect(seen.panes).toEqual([])
  })

  test('đóng pane khi chưa có mục tiêu: không lỗi, không mở gì', {}, async ($, on) => {
    const seen = base(on)
    closer(on)
    await closeByPlugin($)
    expect(seen.opened).toEqual([])
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

  test('isPlaced true: ghi nhật ký quyết định isPlaced true', { options: { decisionLog: '/tmp/fc-auto-pane2.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    base(on)
    await submit($, COMPLEX_PROMPT)
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.find(line => line['kind'] === 'pane')).toMatchObject({ kind: 'pane', isPlaced: true })
  })
})
