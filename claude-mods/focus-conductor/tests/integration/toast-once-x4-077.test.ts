// 0.7.7 X4: cảnh báo cuối turn "không chạy bước kiểm tra nào" chỉ toast một lần cho mỗi nguyên nhân trong một mục tiêu. Khóa gồm nhánh câu,
// lý do và đoạn lệnh bị loại (không gồm số thay đổi), lưu trong Core cùng goalId nên giữ qua hot reload (`$.state`). Band và pane vẫn ghi.
// Kit test 2.1.296 không cho hook của test đọc `$.state`, nên khóa trong Core được kiểm bằng hàm của state.ts.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { DEFAULT_ROUTER, PANE, base, conductor, plan, submit } from '../support/engine'
import type { Responder } from '../support/engine'

const router: Responder = request => (request.startsWith('làm tiếp') ? plan({ relation: 'continue', kind: 'mixed' }) : DEFAULT_ROUTER(request))
const isUnverified = (t: string) => t.includes('không chạy bước kiểm tra nào')

function setup(on: Parameters<typeof base>[0]) {
  const seen = base(on, { router })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'log' }))
  on('turn.complete', () => ({ text: '' }))
  return seen
}

async function turn($: Engine, n: number, command: string, text = `làm tiếp lần ${n}`) {
  await submit($, text)
  await $.turn.start({ text, turnId: `t${n}` })
  for (let i = 0; i < n; i++) await $.tool.call({ tool: 'Edit', file_path: `src/a${i}.ts`, old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command } as never)
  await $.turn.complete({ turnId: `t${n}`, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

describe('0.7.7 X4: một toast cho mỗi nguyên nhân trong mục tiêu', () => {
  test('hai turn cùng nguyên nhân (số thay đổi khác nhau): một toast; pane vẫn ghi cảnh báo của turn hai', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'npm test 2>&1 | tail -20')
    await turn($, 2, 'npm test 2>&1 | tail -20')
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Turn có 2 thay đổi/ })).toBeDefined()
    await pane.unmount()
  })

  test('turn hai đổi lệnh bị loại: hai toast', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'npm test 2>&1 | tail -20')
    await turn($, 2, 'npm test; echo done')
    expect(seen.toasts.filter(isUnverified).length).toBe(2)
  })

  test('mục tiêu mới: toast lại cùng nguyên nhân', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'npm test 2>&1 | tail -20')
    await conductor($, 'goal Làm việc khác hẳn')
    await turn($, 2, 'npm test 2>&1 | tail -20')
    expect(seen.toasts.filter(isUnverified).length).toBe(2)
  })

  test('khóa đã toast nằm trong Core cùng goalId, còn sau vòng JSON (như sau hot reload); mục tiêu khác thì chưa toast', () => {
    const core = S.withToasted(7, 'rejected:pipe:npm test')(S.EMPTY_CORE)
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(S.isToasted(reloaded, 7, 'rejected:pipe:npm test')).toBe(true)
    expect(S.isToasted(reloaded, 7, 'rejected:hidden:npm test')).toBe(false)
    expect(S.isToasted(reloaded, 8, 'rejected:pipe:npm test')).toBe(false)
    expect(S.withToasted(8, 'no-check')(reloaded).toasted).toEqual({ goalId: 8, keys: ['no-check'] })
  })

  test('Core từ 0.7.6 (không có trường toasted): mặc định rỗng', () => {
    expect(S.normalizeCore({} as Partial<Core>).toasted).toEqual({ goalId: -1, keys: [] })
  })
})
