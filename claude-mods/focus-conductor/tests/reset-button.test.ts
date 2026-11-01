// Nút Đặt lại của pane hai bước: lần bấm đầu chỉ chờ xác nhận (nhãn đổi, toast, hết hạn sau 10 giây), lần bấm thứ hai trong
// hạn mới xóa. Câu trả lời của /conductor reset ghi đúng phạm vi bị xóa; từ 0.7.6 (U7) không còn dòng chú thích dưới nút.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMPLEX_PROMPT, PANE, base, conductor, submit } from './support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const SCOPE_VI = /Đặt lại xóa: mục tiêu, checklist, cảnh báo, mục tiêu đã cất, sổ chi phí, danh sách model bị chặn\. Giữ nhật ký điều phối và hệ số hiệu chỉnh đã học\./

/** Có mục tiêu và checklist để thấy được việc xóa. */
async function withGoal($: Engine): Promise<void> {
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Phân tích luồng' }] })
}

const statusText = async ($: Engine) => String((await conductor($, 'status')).text)

describe('nút Đặt lại hai bước', () => {
  test('bấm lần đầu chỉ chờ xác nhận: nhãn đổi, có toast, mục tiêu và checklist còn nguyên', {}, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Đặt lại mục tiêu')
    const statuses = seen.statuses.length
    await ui.press({ key: 'reset' })
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    expect(seen.toasts.some(text => text.includes('lần nữa') && text.includes('10 giây'))).toBe(true)
    expect(await statusText($)).toContain('Refactor module thanh toán')
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeDefined()
    expect(seen.statuses.length).toBe(statuses)
    await ui.unmount()
  })

  test('bấm lần hai trong hạn thì xóa và cập nhật dòng trạng thái; lần bấm kế tiếp lại phải xác nhận', {}, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    const statuses = seen.statuses.length
    await seen.clock.advance(9_999)
    await ui.press({ key: 'reset' })
    expect(await statusText($)).toContain('Chưa có mục tiêu')
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeUndefined()
    expect(seen.statuses.length).toBeGreaterThan(statuses)
    expect(seen.toasts.some(text => text.includes('Đã đặt lại'))).toBe(true)
    // Không còn mục tiêu thì pane không có nút. Có mục tiêu mới thì mốc chờ cũ đã xóa: nút về nhãn ban đầu, bấm là bắt đầu lại.
    expect(await ui.find({ key: 'reset' })).toBeUndefined()
    await submit($, COMPLEX_PROMPT)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Đặt lại mục tiêu')
    await ui.press({ key: 'reset' })
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    expect(await statusText($)).toContain('Refactor module thanh toán')
    await ui.unmount()
  })

  test('hết 10 giây thì nhãn về như cũ, có toast hủy, mục tiêu còn nguyên; bấm tiếp là xác nhận lại', {}, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    await seen.clock.advance(9_999)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    await seen.clock.advance(1)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Đặt lại mục tiêu')
    expect(seen.toasts.some(text => text.includes('Đã hủy yêu cầu đặt lại'))).toBe(true)
    expect(await statusText($)).toContain('Refactor module thanh toán')
    await ui.press({ key: 'reset' })
    expect(await statusText($)).toContain('Refactor module thanh toán')
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    await ui.unmount()
  })

  test('đã xóa bằng lần bấm thứ hai thì hết hạn sau đó không toast hủy', {}, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'reset' })
    await seen.clock.advance(20_000)
    expect(seen.toasts.some(text => text.includes('Đã hủy yêu cầu đặt lại'))).toBe(false)
    await ui.unmount()
  })

  test('bấm xác nhận rồi chờ lại: hẹn giờ cũ chạy khi nút đã chờ lại thì không hủy mốc mới', {}, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'reset' })
    await submit($, COMPLEX_PROMPT)
    await seen.clock.advance(5_000)
    await ui.press({ key: 'reset' })
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    // Hẹn giờ của lần chờ đầu hết hạn ở giây thứ 10 tính từ lần bấm đầu; mốc mới còn 5 giây nữa.
    await seen.clock.advance(5_000)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Bấm lại để xóa')
    expect(seen.toasts.some(text => text.includes('Đã hủy yêu cầu đặt lại'))).toBe(false)
    await seen.clock.advance(5_000)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Đặt lại mục tiêu')
    expect(seen.toasts.filter(text => text.includes('Đã hủy yêu cầu đặt lại')).length).toBe(1)
    await ui.unmount()
  })

  test('bấm lần hai xóa cả trạng thái cục bộ như /conductor reset: độ trễ router đã đo không còn', {}, async ($, on) => {
    base(on)
    await withGoal($)
    expect(await statusText($)).toContain('Độ trễ router')
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'reset' })
    const after = await statusText($)
    expect(after).toContain('Chưa có mục tiêu')
    expect(after).not.toContain('Độ trễ router')
    await ui.unmount()
  })

  // 0.7.6 U7: bỏ đoạn chú thích dưới nút; phạm vi xóa và phần được giữ vẫn có ở câu trả lời của /conductor reset, toast giữ nguyên.
  test('không còn dòng chú thích phạm vi xóa dưới nút', {}, async ($, on) => {
    base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: SCOPE_VI })).toBeUndefined()
    await ui.unmount()
  })

  test('uiLanguage en: nhãn và toast bằng tiếng Anh, không còn chú thích dưới nút', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Reset goal')
    expect(await ui.find({ type: 'Text', text: /Reset clears: goal, checklist, warnings, stashed goals, cost ledger, blocked-model list/ })).toBeUndefined()
    await ui.press({ key: 'reset' })
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Press again to clear')
    expect(seen.toasts.some(text => text.includes('Press'))).toBe(true)
    await seen.clock.advance(10_000)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Reset goal')
    await ui.unmount()
  })

  test('/conductor reset nêu đủ phạm vi và phần được giữ, và bỏ trạng thái chờ xác nhận của nút', {}, async ($, on) => {
    base(on)
    await withGoal($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'reset' })
    const reply = String((await conductor($, 'reset')).text)
    expect(reply).toBe('Đã xóa mục tiêu, checklist, cảnh báo, mục tiêu đã cất, sổ chi phí và danh sách model bị chặn. Giữ nhật ký điều phối và hệ số hiệu chỉnh đã học.')
    // Mốc chờ của nút đã xóa: mục tiêu mới trong vòng 10 giây vẫn thấy nhãn ban đầu.
    await submit($, COMPLEX_PROMPT)
    expect((await ui.find({ key: 'reset' }))?.text).toBe('Đặt lại mục tiêu')
    await ui.unmount()
  })
})
