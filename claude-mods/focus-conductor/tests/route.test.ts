// Chọn model và effort (hooks/lib/route, router): khớp lời gọi Agent với việc đã phân, quyết định có tính cache, chính sách model của phiên.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { decideMain, liftPick, matchTask, resolveModelId, taskMatch } from '../hooks/lib/route'
import { fitPick, taskRoute } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import type { ModelFamily, Route, Task } from '../types'

function route(family: Route['family'], effort: Route['effort']): Route {
  return { family, effort, tier: 'complex', goalId: 1, reason: '' }
}

function task(index: number, title: string, over: Partial<Task> = {}): Task {
  return {
    index,
    title,
    run: 'agent',
    agentType: 'general-purpose',
    pick: { family: 'sonnet', effort: 'medium' },
    depth: 'light',
    volume: 'small',
    kind: 'edit',
    why: '',
    ...over,
  }
}

const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }

describe('06: chính sách model của phiên giữ nguyên sau khi tránh họ bị chặn', () => {
  test('ceiling=opus, opus bị chặn, cho phép fable: không lên fable', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'ceiling' } }
    const fitted = fitPick({ family: 'opus', effort: 'high' }, 'edit', policy)
    expect(fitted.pick.family).toBe('sonnet')
  })

  test('ceiling=sonnet, sonnet bị chặn, việc sửa file: không nhảy lên opus', () => {
    const policy: Policy = { allowFable: false, blocked: new Set(['sonnet']), session: { family: 'sonnet', policy: 'ceiling' } }
    const fitted = fitPick({ family: 'opus', effort: 'high' }, 'edit', policy)
    expect(fitted.pick.family).not.toBe('opus')
    expect(fitted.notes.join('; ')).toContain('không có họ thay thế')
  })

  test('fixed=opus, opus bị chặn: giữ opus theo cấu hình và ghi rõ', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'fixed' } }
    const fitted = fitPick({ family: 'sonnet', effort: 'medium' }, 'edit', policy)
    expect(fitted.pick.family).toBe('opus')
    expect(fitted.notes.join('; ')).toContain('model cố định')
  })

  test('không bật allowFable thì đường lên khi các họ thấp hơn bị chặn không ra fable', () => {
    const policy: Policy = { allowFable: false, blocked: new Set(['haiku', 'sonnet', 'opus']), session: null }
    expect(fitPick({ family: 'sonnet', effort: 'low' }, 'answer', policy).pick.family).not.toBe('fable')
  })

  test('auto vẫn tránh họ bị chặn như trước', () => {
    const policy: Policy = { ...OPEN, blocked: new Set(['opus']) }
    expect(fitPick({ family: 'opus', effort: 'high' }, 'edit', policy).pick.family).toBe('sonnet')
    expect(fitPick({ family: 'opus', effort: 'high' }, 'edit', { ...policy, allowFable: true }).pick.family).toBe('fable')
  })
})

describe('06: mọi đường chọn model đều giữ chính sách phiên', () => {
  test('việc đã phân (taskRoute) và lựa chọn đã nâng (lift) không vượt trần khi họ bị chặn', () => {
    const policy: Policy = { allowFable: true, blocked: new Set(['opus']), session: { family: 'opus', policy: 'ceiling' } }
    const task = { index: 1, title: 't', run: 'agent' as const, agentType: 'general-purpose', pick: { family: 'opus' as const, effort: 'high' as const }, depth: 'hard' as const, volume: 'medium' as const, kind: 'edit' as const, why: '' }
    expect(taskRoute(task, policy).pick.family).toBe('sonnet')
    const lifted = liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 0 }, true)
    expect(lifted.family).toBe('fable')
    expect(fitPick(lifted, 'edit', policy).pick.family).toBe('sonnet')
  })
})

describe('khớp lời gọi Agent với việc đã phân (chỉ theo cấu trúc)', () => {
  const tasks = [
    task(1, 'Tìm chỗ gọi charge'),
    task(2, 'Đổi tên userId thành accountId'),
    task(5, 'Cập nhật README'),
  ]
  const coded = [task(1, 'K4.1. Kiểm kê dữ liệu'), task(10, 'K4.10. Kiểm trên số liệu thật'), task(9, 'K4.9 Báo cáo')]

  test('"Việc N" và "Task N" khớp theo số; "Bước N" không khớp', () => {
    expect(matchTask(tasks, 'Việc 2: đổi tên userId')?.index).toBe(2)
    expect(matchTask(tasks, 'viec 2 doi ten')?.index).toBe(2)
    expect(matchTask(tasks, 'Task 5')?.index).toBe(5)
    expect(matchTask(tasks, 'Task #5: README')?.index).toBe(5)
    expect(matchTask(tasks, 'Bước 2: chạy test')).toBeUndefined()
    expect(matchTask(tasks, 'Việc 7: không có')).toBeUndefined()
  })

  test('không đoán theo ý: mô tả cùng ý mà không có số hay mã thì không khớp', () => {
    expect(matchTask(tasks, 'Đổi tên userId thành accountId')).toBeUndefined()
    expect(matchTask(tasks, '3 file controller cần đổi tên')).toBeUndefined()
  })

  test('không khớp mà có dấu hiệu nhắm một việc thì có lý do để ghi log (vẫn không khớp)', () => {
    expect(taskMatch(tasks, 'Bước 2: chạy test')).toEqual({ miss: '"Bước 2" là số bước của checklist, không phải số việc' })
    expect(taskMatch(tasks, 'Việc 7: không có').miss).toBe('không có việc 7')
    const near = taskMatch(tasks, 'Đổi tên userId thành accountId')
    expect(near.task).toBeUndefined()
    expect(near.miss).toContain('tên gần giống việc 2')
    expect(taskMatch(tasks, 'Viết tài liệu kiến trúc')).toEqual({})
    expect(taskMatch([], 'Việc 1')).toEqual({})
  })

  test('mã mục so nguyên mã: K4.1 không khớp K4.10', () => {
    expect(matchTask(coded, 'K4.10 kiểm trên số liệu thật')?.index).toBe(10)
    expect(matchTask(coded, 'K4.1 kiểm kê')?.index).toBe(1)
    expect(matchTask([...coded].reverse(), 'K4.1 kiểm kê')?.index).toBe(1)
    expect(matchTask(coded, 'K4.9')?.index).toBe(9)
  })
})

describe('điều phối có tính cache', () => {
  const quiet = { haiku: 1, sonnet: 1, opus: 1, fable: 1 }
  // Mặc định: opus/xhigh đang chạy, ngữ cảnh 100k, một turn còn lại; mỗi test chỉ đổi một ý.
  const decide = (over: Partial<Parameters<typeof decideMain>[0]>) =>
    decideMain({
      current: route('opus', 'xhigh'),
      wanted: { family: 'sonnet', effort: 'medium' },
      volume: 'small',
      tier: 'moderate',
      goalId: 1,
      context: 100_000,
      window: 200_000,
      turnsLeft: 1,
      isFree: false,
      calib: quiet,
      ...over,
    })

  test('hạ cấp giữa chừng khi ngữ cảnh dài: chi phí ghi lại cache lớn hơn lợi ích nên giữ lại', () => {
    const d = decide({})
    expect(d.isHeld).toBe(true)
    expect(d.route.family).toBe('opus')
  })

  test('hạ cấp ở hội thoại ngắn với nhiều turn còn lại: lợi ích vượt chi phí ghi lại nên đổi', () => {
    const d = decide({ context: 5_000, turnsLeft: 2 })
    expect(d.isHeld).toBe(false)
    expect(d.route.family).toBe('sonnet')
  })

  test('nâng cấp luôn được đổi, kể cả khi ngữ cảnh dài', () => {
    expect(decide({ current: route('sonnet', 'low'), wanted: { family: 'opus', effort: 'xhigh' } }).route.family).toBe('opus')
  })

  test('cache đã nguội thì đổi không mất chi phí ghi lại', () => {
    expect(decide({ isFree: true }).route.family).toBe('sonnet')
  })

  test('ngữ cảnh gần đầy thì không đổi sang model khác, kể cả khi đổi không tốn chi phí cache', () => {
    const d = decide({ context: 180_000, isFree: true })
    expect(d.isHeld).toBe(true)
    expect(d.route.family).toBe('opus')
  })

  test('cùng model, chỉ khác effort: đổi effort khi ngữ cảnh dài không đáng để ghi lại cache', () => {
    expect(decide({ wanted: { family: 'opus', effort: 'high' } }).isHeld).toBe(true)
  })

  test('model ID giữ tiền tố nhà cung cấp và giữ nguyên khi cùng họ', () => {
    expect(resolveModelId('sonnet', 'claude-opus-5-5', {})).toBe('claude-sonnet-5-5')
    expect(resolveModelId('opus', 'claude-opus-5-5[1m]', {})).toBe('claude-opus-5-5[1m]')
    expect(resolveModelId('haiku', 'us.anthropic.claude-opus-5-5', {})).toBe('us.anthropic.claude-haiku-5-5')
    expect(resolveModelId('haiku', 'claude-opus-5-5', { haiku: 'my-haiku' })).toBe('my-haiku')
  })

  test('nâng theo bằng chứng: lặp lỗi nâng họ model, vượt ngân sách nâng effort; fable chỉ khi được phép', () => {
    expect(liftPick({ family: 'sonnet', effort: 'medium' }, { depth: 1, effort: 0 }, false)).toEqual({ family: 'opus', effort: 'medium' })
    expect(liftPick({ family: 'haiku', effort: 'low' }, { depth: 2, effort: 1 }, false)).toEqual({ family: 'opus', effort: 'medium' })
    expect(liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 1 }, false)).toEqual({ family: 'opus', effort: 'xhigh' })
    expect(liftPick({ family: 'opus', effort: 'high' }, { depth: 1, effort: 0 }, true)).toEqual({ family: 'fable', effort: 'high' })
    expect(liftPick({ family: 'sonnet', effort: 'xhigh' }, { depth: 0, effort: 2 }, false)).toEqual({ family: 'sonnet', effort: 'xhigh' })
  })
})
