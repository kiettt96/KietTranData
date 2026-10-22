// 0.7.2 điểm 1: lỗi của router tự để lại bằng chứng. Status line giữ nhãn lỗi cho tới khi router đọc được lại, dòng router-fail của
// nhật ký có thời gian chờ, giới hạn và số token đầu ra, và /conductor status hiện lần lỗi gần nhất, không phụ thuộc decisionLog.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, ROUTER_TIMEOUT, base, conductor, plan, submit } from '../support/engine'

const last = (seen: { statuses: (string | undefined)[] }) => seen.statuses.at(-1) ?? ''

describe('0.7.2 1: nhãn lỗi router trên status line', () => {
  test('router hết giờ: status line ghi lỗi, số giây đã đặt và cách đọc lại', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    expect(last(seen)).toContain('router lỗi')
    expect(last(seen)).toContain('hết giờ 45s')
    expect(last(seen)).toContain('/conductor reroute')
  })

  test('router lỗi API: status line ghi lỗi kèm lý do rút gọn', {}, async ($, on) => {
    const seen = base(on, { router: () => null })
    await submit($, COMPLEX_PROMPT)
    expect(last(seen)).toContain('router lỗi')
    expect(last(seen)).toContain('lỗi API')
  })

  test('router đọc được ở prompt sau: nhãn lỗi biến mất', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (++n === 1 ? ROUTER_TIMEOUT : plan({ goal: 'Sửa lớn' })) })
    await submit($, COMPLEX_PROMPT)
    expect(last(seen)).toContain('router lỗi')
    await submit($, 'Làm lại từ đầu')
    expect(last(seen)).not.toContain('router lỗi')
  })

  test('đã có mục tiêu rồi router lỗi: nhãn vẫn hiện cạnh status của mục tiêu', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : ROUTER_TIMEOUT) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    expect(last(seen)).toContain('router lỗi')
    expect(last(seen)).toContain('hết giờ')
  })

  test('router đang tạm ngừng sau hai lần lỗi: nhãn nói router tạm ngừng', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Thử lại lần hai')
    await submit($, 'Prompt thứ ba khi router đã tạm ngừng')
    expect(last(seen)).toContain('router tạm ngừng')
    expect(last(seen)).toContain('/conductor reroute')
  })
})

describe('0.7.2 1: nhật ký và /conductor status', () => {
  test('dòng router-fail có kind, ms, timeoutMs, maxTokens và outputTokens', { options: { decisionLog: '/tmp/fc-fail-evidence.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    const lines = (writes.at(-1) ?? '').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const fail = lines.find(line => line['kind'] === 'router-fail')
    expect(fail).toMatchObject({ kind: 'router-fail', failure: 'timeout', timeoutMs: 45_000, maxTokens: 8_000, outputTokens: 0 })
    expect(typeof fail?.['ms']).toBe('number')
  })

  test('/conductor status hiện lần lỗi gần nhất kể cả khi chưa có mục tiêu, và hết khi router đọc được', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n === 1 ? ROUTER_TIMEOUT : plan({ goal: 'Sửa lớn' })) })
    await submit($, COMPLEX_PROMPT)
    const failed = String((await conductor($, 'status')).text)
    expect(failed).toContain('Router lỗi gần nhất')
    expect(failed).toContain('hết thời gian chờ')
    expect(failed).toContain('45')
    await submit($, 'Đọc lại')
    expect(String((await conductor($, 'status')).text)).not.toContain('Router lỗi gần nhất')
  })

  test('đã có mục tiêu: /conductor status hiện lần lỗi gần nhất cạnh phần đánh giá', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : ROUTER_TIMEOUT) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    const text = String((await conductor($, 'status')).text)
    expect(text).toContain('Router lỗi gần nhất')
    expect(text).toContain('Sửa lớn')
  })
})

describe('0.7.2 1: lệnh /conductor goal và reroute', () => {
  test('/conductor goal khi router lỗi: status line ghi lỗi; goal thành công thì xóa', {}, async ($, on) => {
    let fail = true
    const seen = base(on, { router: () => (fail ? ROUTER_TIMEOUT : plan({ goal: 'Sửa lớn' })) })
    await conductor($, 'goal Sửa module thanh toán')
    expect(last(seen)).toContain('router lỗi')
    fail = false
    await conductor($, 'goal Sửa module thanh toán lần hai')
    expect(last(seen)).not.toContain('router lỗi')
  })

  test('/conductor reroute khi router lỗi: ghi lỗi và status line; reroute thành công thì xóa', {}, async ($, on) => {
    let fail = false
    const seen = base(on, { router: () => (fail ? ROUTER_TIMEOUT : plan({ goal: 'Sửa lớn' })) })
    await submit($, COMPLEX_PROMPT)
    expect(last(seen)).not.toContain('router lỗi')
    fail = true
    await conductor($, 'reroute')
    expect(last(seen)).toContain('router lỗi')
    fail = false
    await conductor($, 'reroute')
    expect(last(seen)).not.toContain('router lỗi')
  })
})
