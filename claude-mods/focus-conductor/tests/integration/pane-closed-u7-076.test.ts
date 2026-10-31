// 0.7.6 U7: dòng tóm tắt bước đã đóng tách số đã kiểm chứng và bỏ qua ("4 bước đã đóng (2 đã kiểm chứng, 1 bỏ qua)"); chú giải ký
// hiệu chỉ hiện khi các bước mở đang thấy có từ hai loại ký hiệu, và chỉ ghi các loại đang thấy; bỏ đoạn giải thích nút Đặt lại (toast
// vẫn giữ); mục Nhật ký điều phối ẩn khi chưa có quyết định nào.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, spawnTool, submit } from '../support/engine'
import { labels } from '../../hooks/ui/labels'

const PLAN = 'mcp__focus-conductor__plan'
const STEPS = ['Đọc', 'Sửa', 'Bỏ qua phần cũ', 'Ghi', 'Kiểm', 'Gửi', 'Báo', 'Đóng']

function hooks(on: On) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
}

async function paneTexts($: Engine, rows = 40): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return texts
}

/** Checklist 8 bước: bước 1, 2 đã kiểm chứng (lệnh test đạt sau thay đổi), bước 3 bỏ qua, bước 4 xong, bước 5 đang làm. */
async function eight($: Engine, on: On) {
  base(on)
  hooks(on)
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS.map(title => ({ title })) } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  for (const step of [1, 2]) await $.tool.call({ tool: PLAN, action: 'update', step, status: 'done' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'skipped', note: 'không còn dùng' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 4, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 5, status: 'doing' } as never)
}

describe('0.7.6 U7: dòng tóm tắt bước đã đóng', () => {
  test('vi: "4 bước đã đóng (2 đã kiểm chứng, 1 bỏ qua)"', async ($, on) => {
    await eight($, on)
    expect(await paneTexts($)).toContain('4 bước đã đóng (2 đã kiểm chứng, 1 bỏ qua)')
  })

  test('en: "4 steps closed (2 verified, 1 skipped)"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    await eight($, on)
    expect(await paneTexts($)).toContain('4 steps closed (2 verified, 1 skipped)')
  })

  test('chỉ có bước xong: không có phần trong ngoặc', async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS.map(title => ({ title })) } as never)
    for (const step of [1, 2, 3]) await $.tool.call({ tool: PLAN, action: 'update', step, status: 'done' } as never)
    const texts = await paneTexts($)
    expect(texts).toContain('3 bước đã đóng')
    expect(texts.some(t => t.startsWith('3 bước đã đóng ('))).toBe(false)
  })
})

describe('0.7.6 U7: chú giải ký hiệu', () => {
  test('bước mở đang thấy có hai loại (đang làm, chờ): chú giải chỉ ghi hai loại đó', async ($, on) => {
    await eight($, on)
    const texts = await paneTexts($)
    const l = labels('vi')
    expect(texts).toContain(` ${l.legend.doing}`)
    expect(texts).toContain(` ${l.legend.todo}`)
    for (const other of [l.legend.blocked, l.legend.waiting, l.legend.verified, l.legend.skipped]) expect(texts, other).not.toContain(` ${other}`)
  })

  test('bước mở chỉ một loại: không có chú giải', async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
    const texts = await paneTexts($)
    const l = labels('vi')
    for (const word of Object.values(l.legend)) expect(texts, word).not.toContain(` ${word}`)
  })
})

describe('0.7.6 U7: nút Đặt lại và nhật ký điều phối', () => {
  test('không còn đoạn giải thích phạm vi của nút Đặt lại', async ($, on) => {
    await eight($, on)
    const texts = await paneTexts($)
    expect(texts.some(t => t.startsWith('Đặt lại xóa:'))).toBe(false)
  })

  test('chưa có quyết định: không có mục Nhật ký điều phối; có lời gọi Agent thì có', async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    let texts = await paneTexts($)
    expect(texts.some(t => /^Nhật ký điều phối/.test(t))).toBe(false)
    expect(texts).not.toContain(labels('vi').noLog)
    await spawnTool($, 'u1', 'Tìm chỗ gọi charge', 'tìm')
    texts = await paneTexts($)
    expect(texts.some(t => /^Nhật ký điều phối/.test(t))).toBe(true)
  })
})
