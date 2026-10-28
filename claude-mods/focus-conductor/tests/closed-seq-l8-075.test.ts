// 0.7.5 L8 (vòng sửa 2): danh sách phản chiếu (TodoWrite, khóa todo-N theo vị trí) nhận dạng bước theo nội dung khi tính mốc đóng
// (closedSeq): bước mới đóng ở vị trí của bước cũ không mang mốc cũ nên được nâng ở lần kiểm đạt kế tiếp; bước chỉ đổi vị trí
// (cùng nội dung) giữ mốc cũ nên không bị nâng nhầm.

import { describe, expect, test } from 'claude-code/testing'
import type { Core, MirrorStep } from '../types'
import * as S from '../hooks/lib/state'
import { makeBrief } from './support/commands'

const todo = (n: number, title: string, status: MirrorStep['status']): MirrorStep => ({ key: `todo-${n}`, title, status })
const coreOf = (): Core => ({ ...S.normalizeCore({}), brief: makeBrief({ goalId: 1 }) })
const pass = (c: Core): Core => S.withAutoVerified('npm test', undefined, true)(c)
const statusOf = (c: Core, title: string) => c.mirror.steps.find(s => s.title === title)?.status
/** Đã có một lần kiểm đạt (mốc lastPassSeq > 0), và bước `title` đóng TRƯỚC lần đó nhưng chưa được nâng (mốc đóng 0), ở vị trí `n`. */
function afterPassWithOldDone(title: string, n: number): Core {
  const c = pass(S.withMirror(1, [todo(9, 'Bước nền', 'done')])(coreOf()))
  return { ...c, mirror: { ...c.mirror, steps: [...c.mirror.steps, { ...todo(n, title, 'done'), closedSeq: 0 } as MirrorStep] } }
}

describe('0.7.5 L8: mốc đóng của danh sách phản chiếu theo nội dung', () => {
  test('TodoWrite thay bước cũ bằng bước mới ở cùng vị trí: bước mới đóng sau lần kiểm đạt được nâng ở lần kiểm đạt kế tiếp', () => {
    let c = afterPassWithOldDone('Lọc tin lô 1', 1)
    c = S.withMirror(1, [todo(1, 'Lọc tin lô 2', 'done')])(c)
    c = pass(c)
    expect(statusOf(c, 'Lọc tin lô 2')).toBe('verified')
  })

  test('bước chỉ đổi vị trí (cùng nội dung): giữ mốc cũ, lần kiểm đạt kế tiếp không nâng nhầm', () => {
    let c = afterPassWithOldDone('Lọc tin lô 1', 1)
    c = S.withMirror(1, [todo(1, 'Việc mới thêm', 'doing'), todo(2, 'Lọc tin lô 1', 'done')])(c)
    c = pass(c)
    expect(statusOf(c, 'Lọc tin lô 1')).toBe('done')
  })

  test('TodoWrite gửi lại đúng danh sách cũ: mốc không đổi, bước đóng trước lần kiểm đạt không bị nâng', () => {
    let c = afterPassWithOldDone('Lọc tin lô 1', 1)
    c = S.withMirror(1, [todo(1, 'Lọc tin lô 1', 'done')])(c)
    c = pass(c)
    expect(statusOf(c, 'Lọc tin lô 1')).toBe('done')
  })
})
