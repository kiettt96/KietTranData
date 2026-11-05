// 0.7.8 vòng sửa 3, W1: bước checklist không có tiền tố "Việc N:" vẫn phủ việc đã phân khi tên khớp (bằng nhau sau khi gập,
// chứa nhau với phần ngắn từ 12 ký tự, hay Dice trên từ có nghĩa từ ngưỡng TITLE_NEAR). Đồng hạng thì không phủ việc nào; bước có mã
// mà không việc nào cùng mã thì không phủ theo tên. Khớp theo tên chỉ dùng cho bước checklist; taskMatch của Agent không đổi.
// W2: câu dặn cuối nói cách đặt tiêu đề "Việc N: " và không thêm bước trùng.

import { describe, expect, test } from 'claude-code/testing'
import * as R from '../../hooks/lib/route'
import * as T from '../../hooks/lib/text'
import type { Task } from '../../types'
import { base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MISSING = 'Việc chưa có bước trong checklist'

function fakeTask(index: number, title: string): Task {
  return { index, title, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }
}

const goal = (titles: string[]) => plan({ goal: 'Sửa thanh toán', depth: 'light', volume: 'medium', tasks: titles.map(t => task(t, 'main', 'sonnet', 'medium')) })
const setSteps = async ($: Parameters<typeof submit>[0], titles: string[]) => String((await $.tool.call({ tool: PLAN, action: 'set', steps: titles.map(title => ({ title })) })).result)

describe('W1: bước khớp việc theo tên', () => {
  test('bước đúng tên việc, không tiền tố: không báo việc chưa có bước, kể cả sau add bước khác', {}, async ($, on) => {
    base(on, { router: () => goal(['Doc ma thanh toan', 'Sua ham tinh phi']) })
    await submit($, 'Sửa thanh toán')
    expect(await setSteps($, ['Doc ma thanh toan', 'Sua ham tinh phi'])).not.toContain(MISSING)
    expect(String((await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'Chay test' }] })).result)).not.toContain(MISSING)
  })

  test('khác dấu, hoa thường và dấu câu vẫn phủ', {}, async ($, on) => {
    base(on, { router: () => goal(['Sửa hàm tính phí']) })
    await submit($, 'Sửa thanh toán')
    expect(await setSteps($, ['sửa hàm tính phí.'])).not.toContain(MISSING)
  })

  test('tên gần (Dice từ ngưỡng) phủ việc', {}, async ($, on) => {
    base(on, { router: () => goal(['Viết test cho hàm tính phí']) })
    await submit($, 'Sửa thanh toán')
    expect(await setSteps($, ['Viết test hàm tính phí mới'])).not.toContain(MISSING)
  })

  test('bước chung chung "Sửa" không phủ "Sửa form đăng ký"', {}, async ($, on) => {
    base(on, { router: () => goal(['Sửa form đăng ký']) })
    await submit($, 'Sửa thanh toán')
    expect(await setSteps($, ['Sửa'])).toContain(`${MISSING}: Việc 1: Sửa form đăng ký`)
  })

  test('hai việc đồng hạng với bước "Sửa form": không phủ việc nào, báo cả hai', {}, async ($, on) => {
    base(on, { router: () => goal(['Sửa form đăng ký', 'Sửa form đăng nhập']) })
    await submit($, 'Sửa thanh toán')
    const out = await setSteps($, ['Sửa form'])
    expect(out).toContain('Việc 1: Sửa form đăng ký')
    expect(out).toContain('Việc 2: Sửa form đăng nhập')
  })

  test('một bước chỉ phủ tối đa một trong hai việc tên gần', {}, async ($, on) => {
    base(on, { router: () => goal(['Viết test hàm tính phí', 'Viết test hàm tính thuế']) })
    await submit($, 'Sửa thanh toán')
    const out = await setSteps($, ['Viết test hàm tính phí mới'])
    expect(out).toContain(`${MISSING}: Việc 2: Viết test hàm tính thuế`)
    expect(out).not.toContain('Việc 1: Viết test hàm tính phí')
  })

  test('bước có mã mà không việc nào cùng mã: không phủ theo tên', {}, async ($, on) => {
    base(on, { router: () => goal(['Kiểm kê kho hàng']) })
    await submit($, 'Sửa thanh toán')
    expect(await setSteps($, ['K4.10 Kiểm kê kho hàng'])).toContain(`${MISSING}: Việc 1: Kiểm kê kho hàng`)
  })
})

describe('W1: stepCovers', () => {
  test('khác dấu và dấu câu: phủ việc 1', () => {
    expect(R.stepCovers([fakeTask(1, 'Sửa hàm tính phí')], 'sửa hàm tính phí.')?.index).toBe(1)
  })

  test('"Sửa" không phủ "Sửa form đăng ký"', () => {
    expect(R.stepCovers([fakeTask(1, 'Sửa form đăng ký')], 'Sửa')).toBeUndefined()
  })

  test('đồng hạng: không phủ việc nào', () => {
    expect(R.stepCovers([fakeTask(1, 'Sửa form đăng ký'), fakeTask(2, 'Sửa form đăng nhập')], 'Sửa form')).toBeUndefined()
  })

  test('chứa nhau, phần ngắn từ 12 ký tự: phủ', () => {
    expect(R.stepCovers([fakeTask(1, 'Cập nhật bảng giá vùng miền Nam')], 'Cập nhật bảng giá')?.index).toBe(1)
  })

  test('mã bước khớp trước tên', () => {
    expect(R.stepCovers([fakeTask(1, 'Sửa form'), fakeTask(2, 'Sửa form đăng ký')], 'Việc 2: Sửa form')?.index).toBe(2)
  })
})

describe('W2: câu dặn cuối của dòng việc chưa có bước', () => {
  test('câu dặn nói tiêu đề mở đầu "Việc N: " và không thêm bước trùng', () => {
    const line = T.missingTasksNotice([fakeTask(2, 'Viết test đăng ký')])
    expect(line).toContain('bằng action "add", tiêu đề mở đầu "Việc N: ", hoặc ghi lý do bỏ')
    expect(line).toContain('không thêm bước trùng')
    expect(line.endsWith('lần set sau đặt tiêu đề mở đầu "Việc N: ".')).toBe(true)
  })

  test('12 việc tiêu đề dài: không quá 500 ký tự, còn ít nhất một việc', () => {
    const line = T.missingTasksNotice(Array.from({ length: 12 }, (_, i) => fakeTask(i + 1, `Việc dài số ${i + 1} ${'chữ '.repeat(30)}`)))
    expect(line.length).toBeLessThanOrEqual(T.MISSING_TASKS_CHARS)
    expect(line).toContain('Việc 1: Việc dài số 1')
  })
})
