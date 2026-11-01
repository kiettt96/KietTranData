// 0.7.2 điểm 2: router lỗi hay tạm ngừng khi chưa có mục tiêu thì mod lập mục tiêu tối thiểu (bareBrief), không để brief rỗng.
// Band, pane, danh sách phản chiếu, verified và giám sát chạy như mục tiêu thường; không cảnh báo ngân sách theo tier đoán.
// Lần router đọc được tiếp theo nâng cấp brief nhưng giữ goalId, checklist và bằng chứng.
// Từ 0.7.5 (B13) router hết giờ được hỏi lại một lần: ca "lần đầu hết giờ rồi đọc được" dùng ++n <= 2 (hai lần hết giờ liên tiếp), nếu không
// lần hỏi lại đọc được ngay và mục tiêu tối thiểu không được lập (các mẫu 072-B6, B7, B8 sống sót vì thế ở lượt đột biến cuối).

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, ROUTER_TIMEOUT, base, conductor, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }

function hooks(on: On) {
  let next = 0
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
    next += 1
    return { result: { task: { id: String(next), subject: (e as unknown as { subject: string }).subject } } } as never
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: (e as unknown as { taskId: string }).taskId, updatedFields: ['status'] } }) as never)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: Todo[] }).todos } }) as never)
}
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'focus-conductor', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const last = (seen: { statuses: (string | undefined)[] }) => seen.statuses.at(-1) ?? ''

describe('0.7.2 2: router lỗi ở prompt đầu lập mục tiêu tối thiểu', () => {
  test('band có mục tiêu và nút Chi tiết dù router hết giờ', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
    expect(await band.find({ key: 'details' })).toBeDefined()
    await band.unmount()
  })

  test('pane có mục tiêu và ghi router chưa đọc', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /router chưa đọc/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
    await pane.unmount()
  })

  test('router lỗi liên tiếp ở prompt thứ hai: mục tiêu tối thiểu được giữ, cùng goalId', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Router lỗi gần nhất')
    expect(status).toContain('Refactor module thanh toán')
  })

  test('danh sách phản chiếu và verified chạy trên mục tiêu tối thiểu', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Sửa', description: 'd' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Kiểm', description: 'd' } as never)
    await edit($)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as never)
    expect(last(seen)).toContain('2/2')
    await bash($, 'npm test')
    expect(last(seen)).toContain('2/2 · 2✓')
  })

  test('tool plan chạy trên mục tiêu tối thiểu: set giữ mục tiêu, verified tự nâng', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('[v] 1. Sửa')
  })

  test('không cảnh báo ngân sách tool call theo tier đoán: 35 lần đọc file không sinh cảnh báo vượt mức', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    const contexts: string[] = []
    for (let i = 0; i < 35; i++) {
      const out = await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` } as never)
      contexts.push(...((out as { context?: string[] }).context ?? []))
    }
    expect(contexts.join('\n')).not.toContain('vượt mức dự kiến')
  })
})

describe('0.7.2 2: Claude được báo về mục tiêu tối thiểu', () => {
  test('router lỗi ở prompt đầu: ngữ cảnh nhắc mục tiêu tối thiểu và /conductor reroute', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    await submit($, COMPLEX_PROMPT)
    const context = (seen.contexts[0] ?? []).join('\n')
    expect(context).toContain('Router không đọc được prompt này')
    expect(context).toContain('mục tiêu tối thiểu')
    expect(context).toContain('/conductor reroute')
  })

  test('router lỗi khi đã có mục tiêu do router đọc: không nhắc mục tiêu tối thiểu', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : ROUTER_TIMEOUT) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    expect((seen.contexts[1] ?? []).join('\n')).not.toContain('mục tiêu tối thiểu')
  })
})

describe('0.7.2 2: nâng cấp khi router đọc được', () => {
  test('/conductor reroute: giữ goalId, checklist và verified; mục tiêu lấy theo router; pane hết ghi chưa đọc', {}, async ($, on) => {
    let fail = true
    base(on, { router: () => (fail ? ROUTER_TIMEOUT : plan({ goal: 'Refactor thanh toán sang sự kiện' })) })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    fail = false
    await conductor($, 'reroute')
    const shown = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(shown).toContain('[v] 1. Sửa')
    expect(shown).toContain('Mục tiêu:')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /router chưa đọc/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Refactor thanh toán sang sự kiện/ })).toBeDefined()
    await pane.unmount()
    const status = String((await conductor($, 'status')).text)
    expect(status).not.toContain('Router lỗi gần nhất')
  })

  test('prompt kế được đọc là tiếp nối: cùng goalId, nguồn thành router, mục tiêu lấy theo router', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n <= 2 ? ROUTER_TIMEOUT : plan({ relation: 'continue', goal: 'Refactor thanh toán sang sự kiện' })) })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await submit($, 'Làm tiếp phần còn lại')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /router chưa đọc/ })).toBeUndefined()
    // 0.7.6: mục tiêu đầy đủ nằm ở pane; band ghi bước hiện tại ở dòng 1.
    expect(await pane.find({ type: 'Text', text: /Refactor thanh toán sang sự kiện/ })).toBeDefined()
    await pane.unmount()
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('1. Sửa')
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: /^Sửa$/ })).toBeDefined()
    await band.unmount()
  })

  test('sau khi nâng cấp bằng prompt kế, tier theo router (không còn sàn của mục tiêu tối thiểu) và ngân sách tool call hoạt động lại', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => (++n <= 2 ? ROUTER_TIMEOUT : plan({ relation: 'continue', goal: 'Sửa nhỏ', depth: 'light', volume: 'small' })) })
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Chỉ sửa một dòng nhỏ')
    expect(last(seen)).not.toContain('moderate')
    const contexts: string[] = []
    for (let i = 0; i < 20; i++) {
      const out = await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` } as never)
      contexts.push(...((out as { context?: string[] }).context ?? []))
    }
    expect(contexts.join('\n')).toContain('vượt mức dự kiến')
  })

  test('prompt kế được đọc là mục tiêu mới: lập mục tiêu mới bình thường', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n <= 2 ? ROUTER_TIMEOUT : plan({ relation: 'new', goal: 'Việc hoàn toàn khác' })) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Chuyển sang việc khác')
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: /Việc hoàn toàn khác/ })).toBeDefined()
    await band.unmount()
  })
})

describe('0.7.2 2: giữ hành vi cũ khi đã có mục tiêu', () => {
  test('router lỗi ở prompt thứ hai khi mục tiêu đã do router đọc: mục tiêu cũ được giữ', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : ROUTER_TIMEOUT) })
    await submit($, COMPLEX_PROMPT)
    await submit($, 'Làm tiếp phần còn lại')
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: /Sửa lớn/ })).toBeDefined()
    await band.unmount()
  })
})
