// 0.7.1: "Đã kiểm chứng" cho danh sách việc phản chiếu. Claude chỉ dùng TaskCreate, TaskUpdate, TodoWrite (không dùng tool plan):
// lệnh test chạy đạt sau thay đổi cuối nâng các bước đã xong thành verified, thay đổi mới hạ về done, nâng lại khi test đạt lần sau.
// Danh sách phản chiếu vẫn chỉ để theo dõi.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, spawnTool, submit } from '../support/engine'

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })
const PLAN = 'mcp__focus-conductor__plan'

/** Edit, Bash, Agent và ba tool danh sách việc do "engine" trả lời: `npm test` đạt, `--fail` lỗi, kiểm tĩnh đạt. */
function hooks(on: On) {
  let next = 0
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => (String((e as { command?: string }).command).includes('--fail') ? { result: '2 fail', isError: true } : { result: '12 pass' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: Todo[] }).todos } }) as never)
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
    next += 1
    return { result: { task: { id: String(next), subject: (e as unknown as { subject: string }).subject } } } as never
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: (e as unknown as { taskId: string }).taskId, updatedFields: ['status'] } }) as never)
}

const edit = ($: Engine, path = 'src/a.ts', agentId?: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const create = ($: Engine, subject: string) => $.tool.call({ tool: 'TaskCreate', subject, description: 'd' } as never)
const done = ($: Engine, taskId: string) => $.tool.call({ tool: 'TaskUpdate', taskId, status: 'completed' } as never)
const write = ($: Engine, todos: Todo[]) => $.tool.call({ tool: 'TodoWrite', todos } as never)

async function twoTasks($: Engine, on: On) {
  const seen = base(on)
  hooks(on)
  await submit($, COMPLEX_PROMPT)
  await create($, 'Sửa')
  await create($, 'Kiểm')
  return seen
}
const last = (seen: { statuses: string[] }) => seen.statuses.at(-1) ?? ''

describe('0.7.1: tự nâng verified cho danh sách phản chiếu', () => {
  test('đóng cả hai việc rồi test đạt: nâng; sửa tiếp: hạ; test lại: nâng lại', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await done($, '2')
    expect(last(seen)).toContain('2/2')
    expect(last(seen)).not.toContain('✓')
    await bash($, 'npm test')
    expect(last(seen)).toContain('2/2 · 2✓')
    await edit($, 'src/b.ts')
    expect(last(seen)).toContain('2/2')
    expect(last(seen)).not.toContain('✓')
    await bash($, 'npm test')
    expect(last(seen)).toContain('2/2 · 2✓')
  })

  test('test đã đạt rồi mới đóng việc: nâng ngay khi đóng, bước chưa đóng giữ nguyên', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await bash($, 'npm test')
    await done($, '1')
    expect(last(seen)).toContain('1/2 · 1✓')
  })

  test('tình huống phiên thật (a): gọi lại TaskUpdate completed sau khi sửa file thì về done, test đạt thì nâng lại', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await bash($, 'npm test')
    expect(last(seen)).toContain('1/2 · 1✓')
    await edit($, 'src/c.ts')
    await done($, '1')
    expect(last(seen)).toContain('1/2')
    expect(last(seen)).not.toContain('✓')
    await bash($, 'npm test')
    expect(last(seen)).toContain('1/2 · 1✓')
  })

  test('tình huống phiên thật (a): gọi lại TaskUpdate completed khi test vẫn phủ thay đổi cuối thì vẫn verified', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await bash($, 'npm test')
    await done($, '1')
    expect(last(seen)).toContain('1/2 · 1✓')
  })

  test('tình huống phiên thật (b): TodoWrite ghi lại cả danh sách khi chưa sửa gì thêm thì bước vẫn verified, không thoáng hiện done', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await write($, [todo('Sửa', 'completed'), todo('Kiểm', 'in_progress')])
    await bash($, 'npm test')
    expect(last(seen)).toContain('1/2 · 1✓')
    const before = seen.statuses.length
    await write($, [todo('Sửa', 'completed'), todo('Kiểm', 'in_progress')])
    expect(last(seen)).toContain('1/2 · 1✓')
    // Không có lần đặt status nào ở giữa hiện bước đã hạ.
    expect(seen.statuses.slice(before).every(s => s.includes('✓'))).toBe(true)
  })
})

describe('0.7.1: điều kiện để tự nâng', () => {
  test('kiểm tĩnh (type-check) không bao giờ tự nâng', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await bash($, 'tsc --noEmit')
    expect(last(seen)).not.toContain('✓')
  })

  test('lệnh test lỗi không nâng', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await bash($, 'npm test -- --fail')
    expect(last(seen)).not.toContain('✓')
  })

  test('mục tiêu chưa có sửa file (chỉ tra cứu): test đạt không nâng', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' })
    await done($, '1')
    await bash($, 'npm test')
    expect(last(seen)).not.toContain('✓')
  })

  test('subagent sửa file trong mục tiêu cũng hạ bước đã nâng', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await spawnTool($, 'u1', 'Sửa file phụ', 'Sửa src/x.ts')
    await edit($)
    await done($, '1')
    await bash($, 'npm test')
    expect(last(seen)).toContain('1/2 · 1✓')
    await edit($, 'src/x.ts', 'a-u1')
    expect(last(seen)).not.toContain('✓')
  })

  test('mode off: không theo dõi, không nâng', {}, async ($, on) => {
    const seen = base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.command.run({ command: 'conductor', args: 'mode off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
    await create($, 'Sửa')
    await edit($)
    await done($, '1')
    await bash($, 'npm test')
    expect(last(seen)).not.toContain('✓')
  })
})

describe('0.7.1: tool plan luôn thắng, mirror chỉ để theo dõi', () => {
  test('tool plan có bước sau khi đã có mirror: test đạt chỉ nâng bước plan, bảng hiển thị là của plan', {}, async ($, on) => {
    const seen = await twoTasks($, on)
    await edit($)
    await done($, '1')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'A' }, { title: 'B' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(last(seen)).toContain('1/2 · 1✓')
  })

  test('cổng Stop không đọc mirror: việc đã nâng verified hay chưa đều không thay đổi việc được phép kết thúc', {}, async ($, on) => {
    await twoTasks($, on)
    await edit($)
    await done($, '1')
    const stop = await $.turn.complete({ turnId: 't1', answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await bash($, 'npm test')
    const stop2 = await $.turn.complete({ turnId: 't2', answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(JSON.stringify(stop2 ?? null)).toBe(JSON.stringify(stop ?? null))
  })
})

describe('0.7.1: nhật ký quyết định', () => {
  test('nâng mirror ghi verify-auto với at "mirror", tách khỏi nâng của tool plan', { options: { decisionLog: '/tmp/fc-mirror-verify.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await twoTasks($, on)
    await edit($)
    await done($, '1')
    await bash($, 'npm test')
    const lines = (writes.at(-1) ?? '').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.find(line => line['kind'] === 'verify-auto')).toMatchObject({ kind: 'verify-auto', at: 'mirror' })
  })
})
