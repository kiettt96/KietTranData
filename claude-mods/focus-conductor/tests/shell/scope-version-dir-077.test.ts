// 0.7.7 (phạm vi): mục phạm vi không có "/" mà kết thúc bằng ".chữ-số" (thư mục có số phiên bản như tool-v1.0.0, lib-2.5) bị đọc là tên file,
// nên mọi file bên trong thư mục đó bị báo "Sửa ngoài phạm vi đã nêu". Mục không có "/" giờ khớp khi trùng tên file, hoặc khi file nằm dưới
// gốc/mục như một thư mục. Không nới luật: thư mục cùng tên ở chỗ khác trong gốc, hay ngoài gốc, vẫn là ngoài phạm vi.

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, observe, scopeStatus } from '../../hooks/lib/drift'
import { edit } from '../support/commands'

const ROOT = '/w'

describe('0.7.7: thư mục phạm vi có đuôi dạng phiên bản', () => {
  for (const scope of ['tool-v1.0.0', 'tool-v1.0.0/', 'lib-2.5']) {
    const dir = scope.replace(/\/$/, '')
    test(`file trong ${scope} là trong phạm vi`, () => {
      expect(scopeStatus(`${ROOT}/${dir}/tool/SKILL.md`, [scope], ROOT)).toBe('in')
      expect(scopeStatus(`${dir}/a.md`, [scope], ROOT)).toBe('in')
    })
  }

  test('Edit trong thư mục phạm vi có số phiên bản: không cảnh báo ngoài phạm vi', () => {
    const tracker = newTracker('t')
    const findings = observe(tracker, edit(`${ROOT}/tool-v1.0.0/tool/SKILL.md`), { goal: 'Sửa skill', scopePaths: ['tool-v1.0.0'], tier: 'complex', root: ROOT }, [])
    expect(findings.some(f => f.kind === 'scope')).toBe(false)
  })

  test('không nới luật: thư mục cùng tên ở chỗ khác trong gốc, hay ngoài gốc, vẫn ngoài phạm vi', () => {
    expect(scopeStatus(`${ROOT}/other/tool-v1.0.0/a.md`, ['tool-v1.0.0'], ROOT)).toBe('out')
    expect(scopeStatus('/x/tool-v1.0.0/a.md', ['tool-v1.0.0'], ROOT)).toBe('out')
    expect(scopeStatus(`${ROOT}/tool-v1.0.0x/a.md`, ['tool-v1.0.0'], ROOT)).toBe('out')
  })

  test('mục là tên file vẫn khớp theo tên file bên trong gốc như cũ', () => {
    expect(scopeStatus(`${ROOT}/a/gen.py`, ['gen.py'], ROOT)).toBe('in')
    expect(scopeStatus(`${ROOT}/a/other.py`, ['gen.py'], ROOT)).toBe('out')
  })
})
