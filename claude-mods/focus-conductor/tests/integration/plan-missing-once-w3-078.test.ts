// 0.7.8 vòng sửa 3, W3: dòng "Việc chưa có bước trong checklist" chỉ báo lại khi tập việc thiếu đổi. Khóa (các index thiếu xếp tăng)
// ghi trong Core cùng goalId (missingNoticed), nên giữ qua hot reload; phủ đủ thì ghi khóa rỗng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { base, plan, step, submit, task } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MISSING = 'Việc chưa có bước trong checklist'
const THREE = plan({
  goal: 'Ba việc',
  depth: 'light',
  volume: 'medium',
  main: { model: 'sonnet', effort: 'medium' },
  tasks: [task('Sửa form đăng ký', 'main', 'sonnet', 'medium'), task('Viết test đăng ký', 'agent', 'sonnet', 'medium'), task('Cập nhật README', 'agent', 'sonnet', 'low')],
})
const out = async ($: Engine, action: 'set' | 'add', titles: string[]) => String((await $.tool.call({ tool: PLAN, action, steps: titles.map(title => ({ title })) })).result)

describe('W3: báo việc thiếu một lần cho mỗi tập việc thiếu', () => {
  test('set thiếu 1, 2 thì báo; add không liên quan thì không; add Việc 1 thì chỉ báo Việc 2; add không liên quan thì không', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    const first = await out($, 'set', ['Việc 3: README'])
    expect(first).toContain(`${MISSING}: Việc 1: Sửa form đăng ký; Việc 2: Viết test đăng ký`)
    expect(await out($, 'add', ['Đọc mã trước'])).not.toContain(MISSING)
    const second = await out($, 'add', ['Việc 1: form'])
    expect(second).toContain(`${MISSING}: Việc 2: Viết test đăng ký`)
    expect(second).not.toContain('Việc 1: Sửa form đăng ký')
    expect(await out($, 'add', ['Ghi chú'])).not.toContain(MISSING)
  })

  test('phủ đủ rồi set lại thiếu đúng tập cũ: báo lại', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    expect(await out($, 'set', ['Việc 1: form', 'Việc 3: README'])).toContain(`${MISSING}: Việc 2`)
    expect(await out($, 'add', ['Việc 2: test'])).not.toContain(MISSING)
    expect(await out($, 'set', ['Việc 1: form', 'Việc 3: README'])).toContain(`${MISSING}: Việc 2`)
  })

  test('phủ đủ, chen ngang thêm Việc 4, rồi add không liên quan: báo Việc 4', {}, async ($, on) => {
    const later = plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Thêm báo cáo doanh thu', 'main', 'sonnet', 'medium')] })
    const seen: Seen = base(on, { router: request => (request.startsWith('Làm ba việc') ? THREE : later) })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Làm ba việc')
    expect(await out($, 'set', ['Việc 1: form', 'Việc 2: test', 'Việc 3: README'])).not.toContain(MISSING)
    await $.turn.start({ text: 'Làm ba việc', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.prompt.submit({ text: 'Thêm luôn báo cáo doanh thu', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
    expect(await out($, 'add', ['Ghi chú'])).toContain(`${MISSING}: Việc 4: Thêm báo cáo doanh thu`)
  })

  test('mục tiêu mới cùng tập việc thiếu: báo lại', {}, async ($, on) => {
    base(on, { router: () => THREE })
    await submit($, 'Làm ba việc')
    expect(await out($, 'set', ['Việc 3: README'])).toContain(MISSING)
    await submit($, 'Làm ba việc khác')
    expect(await out($, 'set', ['Việc 3: README'])).toContain(MISSING)
  })
})

describe('W3: khóa trong Core', () => {
  test('missingNoticed còn sau vòng JSON; trạng thái cũ mặc định goalId -1, khóa rỗng', () => {
    const core = S.withMissingNoticed(4, '1,2')(S.EMPTY_CORE)
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).missingNoticed).toEqual({ goalId: 4, key: '1,2' })
    expect(S.normalizeCore({} as Partial<Core>).missingNoticed).toEqual({ goalId: -1, key: '' })
  })
})
