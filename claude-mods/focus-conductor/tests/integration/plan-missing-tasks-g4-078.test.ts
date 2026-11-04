// 0.7.8 G4: plan set và add báo các việc router đã phân mà checklist chưa có bước nào khớp (cùng luật khớp với description của
// Agent: "Việc N", mã mục, mã bước). Không thiếu việc nào thì kết quả giữ nguyên như 0.7.7.

import { describe, expect, test } from 'claude-code/testing'
import * as T from '../../hooks/lib/text'
import type { Task } from '../../types'
import { base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MISSING = 'Việc chưa có bước trong checklist'
const THREE = plan({
  goal: 'Ba việc',
  depth: 'light',
  volume: 'medium',
  tasks: [task('Sửa form đăng ký', 'main', 'sonnet', 'medium'), task('Viết test đăng ký', 'agent', 'sonnet', 'medium'), task('Cập nhật README', 'agent', 'sonnet', 'low')],
})

function fakeTask(index: number, title: string): Task {
  return { index, title, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }
}

describe('0.7.8 G4: plan set và add báo việc chưa có bước', () => {
  test('ba việc, checklist có Việc 1 và Việc 3: báo thiếu Việc 2', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    const out = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: sửa form' }, { title: 'Việc 3: README' }] })).result)
    expect(out).toContain(`${MISSING}: Việc 2: Viết test đăng ký`)
    expect(out).not.toContain('Việc 1: Sửa form đăng ký')
    expect(out).not.toContain('Việc 3: Cập nhật README')
    expect(out).toContain('action "add"')
  })

  test('mã mục so nguyên: bước "K4.1 ..." khớp việc K4.1, bước "K4.10 ..." không khớp K4.1', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'K4', depth: 'light', volume: 'medium', tasks: [task('K4.1 Kiểm kê', 'main', 'sonnet', 'medium'), task('K4.10 Kiểm số liệu', 'main', 'sonnet', 'medium')] }) })
    await submit($, 'Làm K4')
    const one = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'K4.10 chạy kiểm' }] })).result)
    expect(one).toContain(`${MISSING}: Việc 1: K4.1 Kiểm kê`)
    expect(one).not.toContain('Việc 2: K4.10')
    const both = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'K4.1 kiểm kê bước' }, { title: 'K4.10 chạy kiểm' }] })).result)
    expect(both).not.toContain(MISSING)
  })

  test('checklist đủ bước cho mọi việc: kết quả giữ nguyên chữ như 0.7.7', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    const out = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: form' }, { title: 'Việc 2: test' }, { title: 'Việc 3: README' }] })).result)
    expect(out).toBe('Đã lưu 3 bước. Bước tiếp theo: 1. Việc 1: form')
  })

  test('bước skipped vẫn tính là có bước cho việc đó', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    const out = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: form' }, { title: 'Việc 2: test', status: 'skipped', note: 'người dùng bỏ' }, { title: 'Việc 3: README' }] })).result)
    expect(out).not.toContain(MISSING)
  })

  test('brief không có việc thì không thêm dòng', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Một việc', depth: 'light', volume: 'medium' }) })
    await submit($, 'Làm một việc')
    expect(String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })).result)).not.toContain(MISSING)
  })

  test('brief isReference không thêm dòng', {}, async ($, on) => {
    base(on, { router: () => ({ ...THREE, reference: true }) })
    await submit($, 'Xem cách điều phối prompt đính kèm')
    expect(String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đọc' }] })).result)).not.toContain(MISSING)
  })

  test('action add cũng báo việc còn thiếu; update thì không', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 3: README' }] })
    const added = String((await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'Việc 1: form' }] })).result)
    expect(added).toContain(`${MISSING}: Việc 2: Viết test đăng ký`)
    expect(added).not.toContain('Việc 1: Sửa form đăng ký')
    const updated = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })).result)
    expect(updated).not.toContain(MISSING)
  })

  test('12 việc thiếu trong tích hợp: liệt kê 8 và "và 4 việc nữa"', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Mười hai việc', depth: 'light', volume: 'medium', tasks: Array.from({ length: 12 }, (_, i) => task(`Phần ${i + 1}`, 'main', 'sonnet', 'medium')) }) })
    await submit($, 'Làm mười hai việc')
    const out = String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đọc trước' }] })).result)
    expect(out).toContain('Việc 8: Phần 8')
    expect(out).not.toContain('Việc 9: Phần 9')
    expect(out).toContain('và 4 việc nữa')
  })
})

describe('0.7.8 G4: hàm thuần', () => {
  test('missingTasks so theo index của việc khớp', () => {
    const tasks = [fakeTask(1, 'Sửa form'), fakeTask(2, 'Viết test')]
    const steps = [{ id: 1, title: 'Việc 2: test', status: 'todo' as const }]
    expect(T.missingTasks(tasks, steps).map(t => t.index)).toEqual([1])
  })

  test('12 việc tiêu đề dài: tối đa 8 việc, không quá 500 ký tự, câu dặn cuối giữ nguyên', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => fakeTask(i + 1, `Việc dài số ${i + 1} ${'chữ '.repeat(30)}`))
    const line = T.missingTasksNotice(tasks)
    expect(line.length).toBeLessThanOrEqual(T.MISSING_TASKS_CHARS)
    expect(line).toContain('việc nữa')
    expect(line.endsWith('(bước skipped kèm note).')).toBe(true)
    expect(line).not.toContain('Việc 9: ')
  })
})
