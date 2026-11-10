// 0.8.2 N5: đóng bước mở cuối thì liệt kê file đã đổi của mục tiêu (luồng chính và subagent) và dặn ghép mỗi file với bước hay yêu cầu,
// file không ghép được thì ghi vào mục "Ngoài yêu cầu". Một lần mỗi mục tiêu (Core.changedNoticed), sau G2, không chặn Stop.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import * as T from '../../hooks/lib/text'
import type { Json } from '../support/engine'
import { base, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MARK = 'File đã đổi trong mục tiêu này'
const ASK = 'Ngoài yêu cầu'
const G2 = 'Đối chiếu từng yêu cầu'
const OFF = { options: { planApproval: 'off' } }

function setup(on: On, brief: Json = plan({ goal: 'Thêm bộ lọc ngày cho trang đơn hàng' })) {
  const seen = base(on, { router: () => brief })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  return seen
}

const edit = ($: Engine, path: string, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId !== undefined ? { agentId } : {}) } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

/** Mục tiêu một bước: `work` rồi đóng bước; trả kết quả của tool plan. */
async function goal($: Engine, work: () => Promise<unknown>): Promise<string> {
  await submit($, 'Thêm bộ lọc ngày cho trang đơn hàng')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Thêm bộ lọc' }] })
  await work()
  return String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
}

const lineOf = (out: string) => out.split('\n').find(l => l.includes(MARK)) ?? ''

describe('0.8.2 N5: liệt kê file đã đổi khi đóng bước mở cuối', () => {
  test('ba file đổi: có đủ ba đường dẫn tương đối và câu dặn', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, async () => {
      await edit($, '/repo/src/orders/filter.ts')
      await edit($, 'src/orders/page.tsx')
      await bash($, 'cd docs && echo x > note.md')
    })
    const line = lineOf(out)
    expect(line).toContain('src/orders/filter.ts')
    expect(line).toContain('src/orders/page.tsx')
    expect(line).toContain('docs/note.md')
    expect(line).not.toContain('/repo/')
    expect(line).toContain(ASK)
    expect(line).not.toContain('file nữa')
  })

  test('mở lại rồi đóng lần hai cùng mục tiêu: không nhắc lần hai', OFF, async ($, on) => {
    setup(on)
    expect(await goal($, () => edit($, 'src/a.ts'))).toContain(MARK)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await edit($, 'src/b.ts')
    const again = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(again).not.toContain(MARK)
  })

  test('25 file: liệt kê 20, "và 5 file nữa", không quá 1.200 ký tự', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, async () => {
      for (let i = 1; i <= 25; i++) await edit($, `src/f${i}.ts`)
    })
    const line = lineOf(out)
    expect(line).toContain('src/f20.ts')
    expect(line).not.toContain('src/f21.ts')
    expect(line).toContain('và 5 file nữa')
    expect(line.length).toBeLessThanOrEqual(T.CHANGED_NOTICE_CHARS)
  })

  test('205 file: lưu 200, overflow 5, thông báo "và 185 file nữa"', OFF, async ($, on) => {
    setup(on)
    const names = Array.from({ length: 205 }, (_, i) => `g${i + 1}`)
    const out = await goal($, () => bash($, `rm ${names.join(' ')}`))
    expect(lineOf(out)).toContain('g20;')
    expect(lineOf(out)).not.toContain('g21')
    expect(lineOf(out)).toContain('và 185 file nữa')
    // Trạng thái lưu: 200 đường dẫn, phần vượt chỉ đếm.
    const changed = S.withChanged(7, names, false)(S.EMPTY_CORE).changed
    expect(changed.paths.length).toBe(S.CHANGED_LIMIT)
    expect(changed.paths.length).toBe(200)
    expect(changed.overflow).toBe(5)
  })

  test('lệnh ghi không rõ đích: thêm dòng "và N lệnh ghi không rõ đích"', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, async () => {
      await edit($, 'src/a.ts')
      await bash($, 'python3 gen.py')
      await bash($, 'python3 gen2.py')
    })
    expect(lineOf(out)).toContain('và 2 lệnh ghi không rõ đích')
  })

  test('mục tiêu chỉ đọc: không nhắc', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, () => $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never))
    expect(out).not.toContain(MARK)
  })

  test('brief isReference: không nhắc', OFF, async ($, on) => {
    setup(on, plan({ goal: 'Xem prompt', reference: true }))
    expect(await goal($, () => edit($, 'src/a.ts'))).not.toContain(MARK)
  })

  test('ghi .claude/plans/a.md và .focus-conductor/x: không liệt kê', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, async () => {
      await edit($, '.claude/plans/a.md')
      await bash($, 'echo x > .focus-conductor/x')
      await edit($, 'src/a.ts')
    })
    const line = lineOf(out)
    expect(line).toContain('src/a.ts')
    expect(line).not.toContain('.claude/plans')
    expect(line).not.toContain('.focus-conductor/x')
  })

  test('chỉ ghi file kế hoạch và file của mod: không nhắc', OFF, async ($, on) => {
    setup(on)
    const out = await goal($, async () => {
      await edit($, '.claude/plans/a.md')
      await bash($, 'echo x > .focus-conductor/x')
    })
    expect(out).not.toContain(MARK)
  })

  test('G2 vẫn ra như cũ, thứ tự G2 rồi N5; file subagent sửa cũng được liệt kê', OFF, async ($, on) => {
    setup(on, plan({ goal: 'Thêm bộ lọc ngày', requirements: ['Dùng tiếng Việt', 'Có test'] }))
    const out = await goal($, async () => {
      await edit($, 'src/main.ts')
      await edit($, 'src/agent.ts', 'a-1')
    })
    expect(out).toContain(G2)
    expect(out).toContain('(1) Dùng tiếng Việt')
    expect(out.indexOf(G2)).toBeLessThan(out.indexOf(MARK))
    const line = lineOf(out)
    expect(line).toContain('src/main.ts')
    expect(line).toContain('src/agent.ts')
  })

  test('mục tiêu mới đặt lại danh sách và nhắc lại', OFF, async ($, on) => {
    setup(on)
    expect(await goal($, () => edit($, 'src/a.ts'))).toContain(MARK)
    await submit($, 'Viết hàm slugify có unit test')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết hàm' }] })
    await edit($, 'src/slug.ts')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(lineOf(out)).toContain('src/slug.ts')
    expect(lineOf(out)).not.toContain('src/a.ts')
  })
})

describe('0.8.2 N5: hàm thuần và trạng thái', () => {
  test('mỗi đường dẫn cắt 100 ký tự', () => {
    const line = T.changedFilesNotice({ paths: ['a'.repeat(150)], unknown: 0, overflow: 0 })
    expect(line).not.toContain('a'.repeat(101))
  })

  test('đường dẫn dài: tổng không quá 1.200 ký tự, có "và M file nữa"', () => {
    const line = T.changedFilesNotice({ paths: Array.from({ length: 20 }, (_, i) => `${i}${'p'.repeat(120)}`), unknown: 1, overflow: 0 })
    expect(line.length).toBeLessThanOrEqual(T.CHANGED_NOTICE_CHARS)
    expect(line).toMatch(/và \d+ file nữa/)
    expect(line).toContain('và 1 lệnh ghi không rõ đích')
  })

  test('changed và changedNoticed còn sau vòng JSON; trạng thái cũ có mặc định', () => {
    const core = S.withChangedNoticed(4)(S.withChanged(4, ['src/a.ts', 'src/a.ts'], true)(S.EMPTY_CORE))
    const back = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(back.changed).toEqual({ goalId: 4, paths: ['src/a.ts'], unknown: 1, overflow: 0 })
    expect(back.changedNoticed).toBe(4)
    const old = S.normalizeCore({} as Partial<Core>)
    expect(old.changed).toEqual({ goalId: -1, paths: [], unknown: 0, overflow: 0 })
    expect(old.changedNoticed).toBe(-1)
  })

  test('mục tiêu khác thì đặt lại', () => {
    const core = S.withChanged(5, ['src/b.ts'], false)(S.withChanged(4, ['src/a.ts'], true)(S.EMPTY_CORE))
    expect(S.normalizeCore(core).changed).toEqual({ goalId: 5, paths: ['src/b.ts'], unknown: 0, overflow: 0 })
  })
})
