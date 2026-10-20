// 0.7.0 điểm 2: phạm vi và ranh giới thư mục. Đường dẫn nằm ngoài gốc phiên (worktree hay checkout khác) vẫn là trong phạm vi khi
// nằm dưới một mục phạm vi tuyệt đối; mục tương đối chỉ neo theo gốc phiên. Mọi so khớp theo ranh giới thư mục sau khi chuẩn hóa.

import { describe, expect, test } from 'claude-code/testing'
import { isInScope, newTracker, observe, scopeStatus } from '../../hooks/lib/drift'
import { edit } from '../support/commands'

describe('0.7.0 2: mục phạm vi tuyệt đối ngoài gốc phiên', () => {
  test('đường dẫn dưới mục phạm vi tuyệt đối là trong phạm vi dù nằm ngoài gốc phiên', () => {
    expect(isInScope('/wt/proj/src/a.ts', ['/wt/proj/src'], '/repo')).toBe(true)
    expect(isInScope('/wt/proj/src/deep/b.ts', ['/wt/proj/src'], '/repo')).toBe(true)
    expect(isInScope('/wt/proj/src', ['/wt/proj/src'], '/repo')).toBe(true)
    expect(scopeStatus('/wt/proj/src/a.ts', ['/wt/proj/src'], '/repo')).toBe('in')
  })

  test('đường dẫn ngoài gốc phiên mà không dưới mục phạm vi tuyệt đối nào vẫn là ngoài phạm vi', () => {
    expect(isInScope('/wt/proj/other/a.ts', ['/wt/proj/src'], '/repo')).toBe(false)
    expect(isInScope('/elsewhere/src/a.ts', ['/wt/proj/src'], '/repo')).toBe(false)
    expect(scopeStatus('/wt/proj/other/a.ts', ['/wt/proj/src'], '/repo')).toBe('out')
  })

  test('mục phạm vi tương đối chỉ neo theo gốc phiên: không kéo đường dẫn ngoài gốc vào phạm vi', () => {
    expect(isInScope('/wt/proj/src/a.ts', ['src'], '/repo')).toBe(false)
    expect(isInScope('/repo/src/a.ts', ['src'], '/repo')).toBe(true)
  })

  test('không có gốc phiên thì vẫn không khẳng định gì, kể cả với mục tuyệt đối', () => {
    expect(scopeStatus('/wt/proj/src/a.ts', ['/wt/proj/src'])).toBe('unknown')
  })

  test('phạm vi nhiều mục: chỉ cần một mục tuyệt đối khớp', () => {
    expect(isInScope('/wt/proj/src/a.ts', ['docs', '/wt/proj/src'], '/repo')).toBe(true)
    expect(isInScope('/repo/docs/a.md', ['docs', '/wt/proj/src'], '/repo')).toBe(true)
  })
})

describe('0.7.0 2: so khớp theo ranh giới thư mục sau khi chuẩn hóa', () => {
  test('thư mục có tên là tiền tố của nhau không bị nhận nhầm, cả hai chiều', () => {
    expect(isInScope('/wt/ab/x.ts', ['/wt/a'], '/repo')).toBe(false)
    expect(isInScope('/wt/a/x.ts', ['/wt/ab'], '/repo')).toBe(false)
    expect(isInScope('/repo/ab/x.ts', ['a'], '/repo')).toBe(false)
    expect(isInScope('/repo/a/x.ts', ['ab'], '/repo')).toBe(false)
    expect(isInScope('/repo/a', ['a'], '/repo')).toBe(true)
  })

  test('.., dấu / lặp và dấu / cuối được chuẩn hóa trước khi so', () => {
    expect(isInScope('/wt/a/../ab/x.ts', ['/wt/a'], '/repo')).toBe(false)
    expect(isInScope('/wt/a/../ab/x.ts', ['/wt/ab'], '/repo')).toBe(true)
    expect(isInScope('/wt//a///x.ts', ['/wt/a/'], '/repo')).toBe(true)
    expect(isInScope('/wt/a/x.ts', ['/wt/a///'], '/repo')).toBe(true)
    expect(isInScope('/wt/a/./x.ts', ['/wt/./a'], '/repo')).toBe(true)
    expect(isInScope('/repo/src/../ab/x.ts', ['a'], '/repo')).toBe(false)
    expect(isInScope('/repo/src//a.ts', ['src/'], '/repo')).toBe(true)
  })

  test('đường dẫn thoát khỏi mục phạm vi bằng .. là ngoài phạm vi', () => {
    expect(isInScope('/wt/a/../x.ts', ['/wt/a'], '/repo')).toBe(false)
    expect(isInScope('/wt/a/x/../../y.ts', ['/wt/a'], '/repo')).toBe(false)
  })
})

describe('0.7.0 2: cảnh báo phạm vi của tool sửa file', () => {
  const focus = (scopePaths: string[]) => ({ goal: 'g', scopePaths, tier: 'complex' as const, root: '/repo' })
  const warned = (scopePaths: string[], path: string) => observe(newTracker('t'), edit(path), focus(scopePaths) as never, []).filter(f => f.kind === 'scope')

  test('sửa file trong worktree khác nhưng dưới mục phạm vi tuyệt đối: không cảnh báo', () => {
    expect(warned(['/wt/proj/src'], '/wt/proj/src/a.ts')).toEqual([])
  })

  test('sửa file trong worktree khác ngoài mục phạm vi tuyệt đối: vẫn cảnh báo', () => {
    expect(warned(['/wt/proj/src'], '/wt/proj/other/a.ts').length).toBe(1)
  })
})
