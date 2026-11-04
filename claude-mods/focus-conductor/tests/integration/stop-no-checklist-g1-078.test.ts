// 0.7.8 G1: mục tiêu từ moderate (hoặc có việc đã phân) mà chưa có checklist của tool plan thì cổng Stop chặn một lần mỗi mục tiêu.
// Lý do chặn liệt kê việc đã phân (hoặc yêu cầu router trích) và dặn gọi plan set. Khóa "đã chặn" nằm trong Core cùng goalId.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { base, conductor, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MODERATE = plan({ goal: 'Sửa luồng đăng ký', depth: 'light', volume: 'medium' })
const SIMPLE = plan({ goal: 'Sửa một chữ', depth: 'light', volume: 'small' })

const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })
const stop = async ($: Engine) => (await $.classic.Stop({ stop_hook_active: false })).block

function setup(on: On, reply: Json | ((request: string) => Json)) {
  const seen = base(on, { router: typeof reply === 'function' ? reply : () => reply })
  on('classic.Stop', () => ({}))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  return seen
}

describe('0.7.8 G1: không có checklist thì cổng Stop chặn một lần', () => {
  test('mục tiêu moderate có Edit, không plan set: chặn, lý do có việc đã phân; lần hai cùng mục tiêu cho qua', {}, async ($, on) => {
    setup(on, plan({ goal: 'Sửa luồng đăng ký', depth: 'light', volume: 'medium', tasks: [task('Sửa form đăng ký', 'main', 'sonnet', 'medium'), task('Viết test', 'agent', 'sonnet', 'medium')] }))
    await submit($, 'Sửa luồng đăng ký và viết test')
    await edit($)
    const first = await stop($)
    expect(first).toContain('chưa có checklist')
    expect(first).toContain('Việc 1: Sửa form đăng ký')
    expect(first).toContain('Việc 2: Viết test')
    expect(first).toContain('action "set"')
    expect(await stop($)).toBeUndefined()
  })

  test('mục tiêu mới thì chặn lại được', {}, async ($, on) => {
    setup(on, request => plan({ goal: request.split('\n')[0], depth: 'light', volume: 'medium' }))
    await submit($, 'Sửa luồng đăng ký')
    await edit($)
    expect(await stop($)).toContain('chưa có checklist')
    expect(await stop($)).toBeUndefined()
    await submit($, 'Viết hàm slugify có unit test')
    await edit($)
    expect(await stop($)).toContain('chưa có checklist')
  })

  test('tier simple không có việc đã phân thì cho qua; có việc đã phân thì chặn', {}, async ($, on) => {
    setup(on, request => (request.includes('hai việc') ? plan({ ...SIMPLE, tasks: [task('Đổi chữ', 'main', 'sonnet', 'low')] }) : SIMPLE))
    await submit($, 'Sửa một chữ trong README')
    await edit($)
    expect(await stop($)).toBeUndefined()
    await submit($, 'Làm hai việc nhỏ khác')
    await edit($)
    expect(await stop($)).toContain('Việc 1: Đổi chữ')
  })

  test('không có việc đã phân thì liệt kê yêu cầu router trích', {}, async ($, on) => {
    setup(on, plan({ ...MODERATE, requirements: ['Dùng tiếng Việt', 'Có bảng so sánh'] }))
    await submit($, 'Viết báo cáo so sánh')
    await edit($)
    const reason = await stop($)
    expect(reason).toContain('(1) Dùng tiếng Việt')
    expect(reason).toContain('(2) Có bảng so sánh')
  })

  test('brief isReference cho qua', {}, async ($, on) => {
    setup(on, plan({ ...MODERATE, reference: true, tasks: [task('Việc đính kèm', 'main', 'sonnet', 'medium')] }))
    await submit($, 'Xem cách điều phối prompt đính kèm, không chạy')
    await edit($)
    expect(await stop($)).toBeUndefined()
  })

  test('turn hỏi đáp (không thực thi) cho qua', {}, async ($, on) => {
    setup(on, plan({ ...MODERATE, kind: 'answer' }))
    await submit($, 'Giải thích luồng đăng ký')
    expect(await stop($)).toBeUndefined()
  })

  test('enforceChecklist false cho qua', { options: { enforceChecklist: false } }, async ($, on) => {
    setup(on, MODERATE)
    await submit($, 'Sửa luồng đăng ký')
    await edit($)
    expect(await stop($)).toBeUndefined()
  })

  test('đang tạm dừng (hạn mức hay /conductor pause) cho qua', {}, async ($, on) => {
    setup(on, MODERATE)
    await submit($, 'Sửa luồng đăng ký')
    await edit($)
    await conductor($, 'pause')
    expect(await stop($)).toBeUndefined()
  })

  test('có checklist đã đóng hết thì cho qua như cũ', {}, async ($, on) => {
    setup(on, MODERATE)
    await submit($, 'Sửa luồng đăng ký')
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa form' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBeUndefined()
  })

  test('có danh sách phản chiếu từ TodoWrite thì nói danh sách đó chỉ để hiển thị', {}, async ($, on) => {
    setup(on, MODERATE)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa luồng đăng ký')
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Sửa form', status: 'in_progress', activeForm: 'Đang sửa form' }] })
    await edit($)
    expect(await stop($)).toContain('chỉ để hiển thị')
  })

  test('lý do không quá 1.200 ký tự với 20 việc tiêu đề dài; chỉ liệt kê 8 việc', {}, async ($, on) => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(`Việc số ${i + 1} ${'rất dài '.repeat(20)}`, 'main', 'sonnet', 'medium'))
    setup(on, plan({ ...MODERATE, tasks }))
    await submit($, 'Làm hai mươi việc')
    await edit($)
    const reason = await stop($)
    expect(reason).toBeDefined()
    expect((reason ?? '').length).toBeLessThanOrEqual(1200)
    expect(reason).toContain('Việc 8: ')
    expect(reason).not.toContain('Việc 9: ')
    expect(reason).toContain('và 12 việc nữa')
  })
})

describe('0.7.8 G1: khóa đã chặn nằm trong Core, giữ qua hot reload', () => {
  test('stopNudged còn sau vòng JSON (như sau hot reload); mục tiêu khác thì chưa chặn', () => {
    const core = S.withStopNudged(7)(S.EMPTY_CORE)
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(reloaded.stopNudged).toBe(7)
    expect(S.normalizeCore({} as Partial<Core>).stopNudged).toBe(-1)
  })
})
