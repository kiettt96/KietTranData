// 0.6.1, thanh tiến độ 2.1: phản chiếu danh sách việc của Claude Code (TodoWrite, TaskCreate, TaskUpdate) vào checklist
// hiển thị. Checklist phản chiếu chỉ để vẽ: cổng Stop, nhắc checkpoint và bảo vệ hạn mức vẫn chỉ dựa vào tool plan.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, conductor, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

/** Tool danh sách việc của Claude Code như engine trả: TodoWrite trả cả danh sách, TaskCreate cấp id tăng dần. */
function taskTools(on: On) {
  let next = 0
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: Todo[] }).todos } }) as never)
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
    next += 1
    return { result: { task: { id: String(next), subject: (e as unknown as { subject: string }).subject } } } as never
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: (e as unknown as { taskId: string }).taskId, updatedFields: ['status'] } }) as never)
}

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }

async function bandOf($: Engine) {
  const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  const out = {
    bar: (await band.findAll({ type: 'Text', text: /^[━╌◐■◇]+$/ })).length > 0,
    count: (await band.find({ type: 'Text', text: /^\d+\/\d+$/ }))?.text,
    source: (await band.find({ type: 'Text', text: /danh sách việc|task list/ }))?.text,
  }
  await band.unmount()
  return out
}

const write = ($: Engine, todos: Todo[], agentId?: string) => $.tool.call({ tool: 'TodoWrite', todos, ...(agentId ? { agentId } : {}) } as never)

describe('0.6.1 2.1: phản chiếu danh sách việc của Claude Code', () => {
  test('router không tách việc, Claude chỉ dùng TodoWrite: band có thanh và đúng số bước, ghi nguồn phản chiếu', {}, async ($, on) => {
    const seen = base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    expect((await bandOf($)).bar).toBe(false)
    await write($, [todo('Đọc mã', 'completed'), todo('Sửa', 'in_progress'), todo('Kiểm', 'pending')])
    expect(seen.statuses.at(-1)).toContain('1/3')
    expect(await bandOf($)).toMatchObject({ bar: true, count: '1/3' })
    expect((await bandOf($)).source).toBeDefined()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Sửa/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /danh sách việc của Claude Code/ })).toBeDefined()
    await pane.unmount()
  })

  test('TaskCreate rồi TaskUpdate: đúng trạng thái từng bước; deleted thì bỏ bước', {}, async ($, on) => {
    base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Phân tích', description: 'd' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Viết test', description: 'd' } as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Bỏ đi', description: 'd' } as never)
    expect((await bandOf($)).count).toBe('0/3')
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' } as never)
    expect((await bandOf($)).count).toBe('1/2')
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('[x] 1. Phân tích')
    expect(status).toContain('[~] 2. Viết test')
  })

  test('plan set sau phản chiếu: checklist theo tool plan, TodoWrite sau đó không ghi đè', {}, async ($, on) => {
    base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending'), todo('B', 'pending')])
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Một' }, { title: 'Hai' }, { title: 'Ba' }, { title: 'Bốn' }] })
    await write($, [todo('A', 'completed'), todo('B', 'completed')])
    const band = await bandOf($)
    expect(band.count).toBe('0/4')
    expect(band.source).toBeUndefined()
  })

  test('Stop không bị chặn bởi checklist phản chiếu; checklist của tool plan vẫn chặn', { options: { enforceChecklist: true } }, async ($, on) => {
    base(on)
    taskTools(on)
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'in_progress'), todo('B', 'pending')])
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Một' }] })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 1 bước mở')
  })

  test('subagent gọi TodoWrite: checklist của luồng chính không đổi', {}, async ($, on) => {
    base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending')], 'agent-1')
    expect((await bandOf($)).bar).toBe(false)
  })

  test('tool vắng mặt trong phiên: không phản chiếu, không ném lỗi', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending')]).catch(() => undefined)
    expect((await bandOf($)).bar).toBe(false)
  })

  test('TodoWrite báo lỗi (đầu vào vẫn có danh sách): không phản chiếu từ đầu vào', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ isError: true, result: 'lỗi', text: 'lỗi' }) as never)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending')])
    expect((await bandOf($)).bar).toBe(false)
  })

  test('mục tiêu mới xóa phản chiếu cũ', {}, async ($, on) => {
    base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending'), todo('B', 'pending')])
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect((await bandOf($)).bar).toBe(false)
  })

  test('uiLanguage en: nhãn nguồn tiếng Anh', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on)
    taskTools(on)
    await submit($, COMPLEX_PROMPT)
    await write($, [todo('A', 'pending')])
    expect((await bandOf($)).source).toMatch(/task list/)
  })
})
