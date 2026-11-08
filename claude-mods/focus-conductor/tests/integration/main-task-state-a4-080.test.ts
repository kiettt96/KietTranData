// 0.8.0 A4: trạng thái việc của luồng chính. Việc main không có bước của riêng nó chỉ "đang làm" khi là việc của bước doing (theo stepCovers)
// hoặc là việc duy nhất của đợt; còn lại là chưa gắn bước ("chưa gắn bước" / "no step"), mờ, không ◐. Việc có bước riêng tính theo bước như cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, step, submit, task } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const FIVE = Array.from({ length: 5 }, (_, i) => task(`Việc ${i + 1}: phần ${i + 1}`, 'main', 'sonnet', 'medium'))

async function paneText($: Engine, columns = 80): Promise<string> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
  await pane.unmount()
  return texts
}
const count = (text: string, part: string) => text.split(part).length - 1

async function start($: Engine, seen: Seen, steps: Array<{ title: string; status: string }>) {
  await submit($, 'Làm năm phần')
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(s => ({ title: s.title })) })
  for (const [i, s] of steps.entries()) if (s.status !== 'todo') await $.tool.call({ tool: PLAN, action: 'update', step: i + 1, status: s.status })
  await $.turn.start({ text: 'Làm năm phần', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}

describe('0.8.0 A4: việc main không có bước riêng', () => {
  test('5 việc main, một bước doing mang mã việc 3: bốn việc kia là chưa gắn bước', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Làm năm phần', depth: 'substantial', volume: 'large', tasks: FIVE }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'Việc 3: chạy lại', status: 'doing' }])
    expect(count(await paneText($), 'chưa gắn bước')).toBe(4)
  })

  test('checklist không bước nào mang mã: không việc nào đang làm, cả năm việc chưa gắn bước', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Làm năm phần', depth: 'substantial', volume: 'large', tasks: FIVE }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'Làm tiếp', status: 'doing' }])
    const texts = await paneText($)
    expect(count(texts, 'chưa gắn bước')).toBe(5)
    expect(texts).not.toContain('đang làm')
  })

  test('bước doing không mang mã nhưng phủ việc 2 theo tên (stepCovers): việc 2 đang làm, bốn việc kia chưa gắn bước', {}, async ($, on) => {
    const tasks = FIVE.map((t, i) => (i === 1 ? task('Việc 2: kiểm kho hàng tồn', 'main', 'sonnet', 'medium') : t))
    const seen = base(on, { router: () => plan({ goal: 'Làm năm phần', depth: 'substantial', volume: 'large', tasks }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'Kiểm kho hàng tồn lô mới', status: 'doing' }])
    expect(count(await paneText($), 'chưa gắn bước')).toBe(4)
  })

  test('chỉ một việc main: việc đó vẫn đang làm', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Làm một phần', depth: 'substantial', volume: 'medium', tasks: FIVE.slice(0, 1) }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'Làm tiếp', status: 'doing' }])
    const texts = await paneText($)
    expect(texts).not.toContain('chưa gắn bước')
  })

  test('nhãn tiếng Anh "no step"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Làm năm phần', depth: 'substantial', volume: 'large', tasks: FIVE }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'Làm tiếp', status: 'doing' }])
    expect(count(await paneText($), 'no step')).toBe(5)
  })
})
