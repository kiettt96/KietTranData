// Test tích hợp: band và pane qua engine.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, FOUR, PANE, base, step, submit } from '../support/engine'

describe('giao diện', () => {
  test('band hiện mục tiêu trên terminal và desktop', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'focus-conductor',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
      })
      expect(await ui.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
      expect(await ui.find({ key: 'details' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pane hiện lý do của router, checklist, và đổi chế độ bằng nút', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng' }] })
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /độ sâu hard\s+khối lượng large\s+loại mixed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^việc vừa$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeDefined()
    await ui.press({ key: 'mode-suggest' })
    expect(await ui.find({ type: 'Text', text: /Danh sách bước 0\/1/ })).toBeDefined()
    await ui.unmount()
  })

  /** Những gì band và pane vẽ cho thanh tiến độ: màu phần đã đóng, đầu thanh, số bước đã đóng và tên giai đoạn (0.7.6, U6: tên giai đoạn chỉ còn ở pane, `word` của band luôn trống). */
  async function progressOf($: Engine, columns = 120) {
    const band = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: columns, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    // Text ngoài chứa các đoạn tô màu nên cũng khớp khi cả thanh chỉ có một đoạn (đầy); lấy đoạn có màu.
    const fill = (await band.findAll({ type: 'Text', text: /^━+$/ })).find(e => e.props.color !== undefined)
    const head = await band.find({ type: 'Text', text: /^[◐■]$/ })
    const count = await band.find({ type: 'Text', text: /^\d+\/\d+$/ })
    const word = await band.find({ type: 'Text', text: /^(chưa bắt đầu|mới bắt đầu|đang thực hiện|sắp xong)$/ })
    // 0.7.6 U10: xong hết thì band một dòng "Hoàn thành: <mục tiêu>" thay cho "Đã xong mọi bước".
    const closedAll = await band.find({ type: 'Text', text: /^Hoàn thành: / })
    await band.unmount()
    const pane = await $.ui.mount(PANE)
    const paneFill = (await pane.findAll({ type: 'Text', text: /^━+$/ })).find(e => e.props.color !== undefined)
    const paneWord = await pane.find({ type: 'Text', text: /^(chưa bắt đầu|mới bắt đầu|đang thực hiện|sắp xong|hoàn thành)$/ })
    await pane.unmount()
    return {
      fill: fill?.props.color,
      cells: fill?.text.length ?? 0,
      head: head?.text,
      headColor: head?.props.color,
      count: count?.text,
      word: word?.text,
      isAllClosed: closedAll !== undefined,
      paneFill: paneFill?.props.color,
      paneWord: paneWord?.text,
    }
  }

  test('thanh tiến độ đổi màu theo bốn giai đoạn ở cả band và pane: xanh dương, cam, vàng, xanh lá', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const PLAN = 'mcp__focus-conductor__plan'
    const titles = ['Phân tích luồng', 'Thiết kế kiến trúc', 'Migrate webhook', 'Migrate refund', 'Kiểm tra bảo mật', 'Đo lại hiệu năng']
    await $.tool.call({ tool: PLAN, action: 'set', steps: titles.map(title => ({ title })) })
    const mark = (step: number, status: string) => $.tool.call({ tool: PLAN, action: 'update', step, status })

    // Chưa bước nào bắt đầu: thanh trống, chưa có màu.
    expect(await progressOf($)).toMatchObject({ fill: undefined, head: undefined, count: '0/6', word: undefined, paneWord: 'chưa bắt đầu' })

    // Bước 1 đang làm, chưa đóng bước nào: đầu thanh xanh dương, mới bắt đầu.
    await mark(1, 'doing')
    expect(await progressOf($)).toMatchObject({ fill: undefined, head: '◐', headColor: 'ide', count: '0/6', word: undefined, paneWord: 'mới bắt đầu' })

    // 1/6: phần đã đóng xanh dương.
    await mark(1, 'done')
    await mark(2, 'doing')
    expect(await progressOf($)).toMatchObject({ fill: 'ide', headColor: 'ide', count: '1/6', word: undefined, paneFill: 'ide', paneWord: 'mới bắt đầu' })

    // 3/6: cam, đang thực hiện.
    await mark(2, 'done')
    await mark(3, 'done')
    await mark(4, 'doing')
    expect(await progressOf($)).toMatchObject({ fill: 'claude', headColor: 'claude', count: '3/6', word: undefined, paneFill: 'claude', paneWord: 'đang thực hiện' })

    // 5/6: vàng, sắp xong.
    await mark(4, 'done')
    await mark(5, 'done')
    await mark(6, 'doing')
    expect(await progressOf($)).toMatchObject({ fill: 'warning', headColor: 'warning', count: '5/6', word: undefined, paneFill: 'warning', paneWord: 'sắp xong' })

    // 6/6: thanh đầy màu xanh lá; band ghi "Hoàn thành: <mục tiêu>" (U10), pane ghi hoàn thành.
    await mark(6, 'done')
    const done = await progressOf($)
    expect(done).toMatchObject({ fill: 'success', head: undefined, count: '6/6', word: undefined, isAllClosed: true, paneFill: 'success', paneWord: 'hoàn thành' })
    expect(done.cells).toBeGreaterThanOrEqual(6)
  })

  test('bước bị chặn: đầu thanh là ■ vàng, phần đã đóng vẫn theo giai đoạn', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const PLAN = 'mcp__focus-conductor__plan'
    await $.tool.call({ tool: PLAN, action: 'set', steps: ['Một', 'Hai', 'Ba', 'Bốn'].map(title => ({ title })) })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'blocked', note: 'chờ khóa API' })
    expect(await progressOf($)).toMatchObject({ fill: 'claude', head: '■', headColor: 'warning', count: '1/4', word: undefined })
  })

  test('terminal hẹp: vẫn tô màu theo giai đoạn, chỉ bỏ tên giai đoạn trên band', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const PLAN = 'mcp__focus-conductor__plan'
    await $.tool.call({ tool: PLAN, action: 'set', steps: ['Một', 'Hai', 'Ba', 'Bốn', 'Năm'].map(title => ({ title })) })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    const wide = await progressOf($, 120)
    const narrow = await progressOf($, 60)
    expect(wide).toMatchObject({ fill: 'claude', count: '2/5', word: undefined })
    expect(narrow).toMatchObject({ fill: 'claude', count: '2/5', word: undefined })
    expect(narrow.cells).toBeGreaterThan(0)
    expect(narrow.cells).toBeLessThan(wide.cells)
  })

  test('chưa có checklist: band không vẽ thanh, chỉ các ô ○ của việc router dự kiến', {}, async ($, on) => {
    base(on)
    await submit($, FOUR)
    const band = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await band.find({ type: 'Text', text: /^━+$/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /^(○ )*○ ?$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /4 bước dự kiến/ })).toBeDefined()
    await band.unmount()
  })
})
