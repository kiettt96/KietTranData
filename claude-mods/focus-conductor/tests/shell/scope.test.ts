// Phạm vi ghi file (hooks/lib/drift/scope): lệnh Bash ghi file đối chiếu với phạm vi, phạm vi theo thư mục gốc.
// Gom từ các tệp test theo vòng review cũ; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { isInScope, newTracker, observe } from '../../hooks/lib/drift'
import { bash, edit, makeBrief } from '../support/commands'

describe('02: lệnh Bash ghi file bị đối chiếu với phạm vi', () => {
  const brief = { ...makeBrief({ scopePaths: ['src'] }), root: '/repo' }
  const scopeOf = (command: string) => observe(newTracker('t'), bash(command), brief, []).filter(f => f.kind === 'scope')

  test('sed -i, chuyển hướng, tee, cp, mv, rm, touch ngoài phạm vi thì cảnh báo', () => {
    for (const command of [
      'sed -i s/a/b/ config/app.json',
      'echo x > config/app.json',
      'echo x >> /repo/config/app.json',
      'printf x | tee -a config/app.json',
      'cp src/a.ts config/a.ts',
      'mv src/a.ts lib/a.ts',
      'rm -f config/old.json',
      'touch config/new.json',
      "sed -i -e 's/a/b/' config/app.json",
    ]) {
      const found = scopeOf(command)
      expect(found.length, command).toBeGreaterThan(0)
      expect(found[0]?.text, command).toMatch(/config\/|lib\//)
    }
  })

  test('ghi trong phạm vi (kể cả đường dẫn tương đối, sau cd) thì không cảnh báo', () => {
    for (const command of ['sed -i s/a/b/ src/app.ts', 'echo x > src/gen.ts', 'cd src && sed -i s/a/b/ app.ts', 'cp config/a.ts src/a.ts', 'echo "a > config/x" > src/y.ts', 'npm test > /dev/null 2>&1']) {
      expect(scopeOf(command).length, command).toBe(0)
    }
  })

  test('không xác định được file đích thì cảnh báo riêng, mỗi lệnh khác nhau một lần (vòng cuối), không coi là đã kiểm soát', () => {
    const tracker = newTracker('t')
    // 0.7.5 B1: cảnh báo này có loại riêng 'scope-unknown' (mức vàng), không còn là 'scope'.
    const first = observe(tracker, bash('python scripts/gen.py'), brief, []).filter(f => f.kind === 'scope-unknown')
    expect(first[0]?.text).toContain('không xác định được file đích')
    expect(observe(tracker, bash('python scripts/gen.py'), brief, []).some(f => f.kind === 'scope-unknown')).toBe(false)
    expect(observe(tracker, bash('node build.js'), brief, []).some(f => f.kind === 'scope-unknown')).toBe(true)
  })

  test('không giới hạn phạm vi thì không cảnh báo; mỗi đường dẫn chỉ báo một lần', () => {
    expect(observe(newTracker('t'), bash('echo x > config/a.json'), makeBrief(), []).some(f => f.kind === 'scope')).toBe(false)
    const tracker = newTracker('t')
    expect(observe(tracker, bash('echo x > config/a.json'), brief, []).some(f => f.kind === 'scope')).toBe(true)
    expect(observe(tracker, bash('echo y > config/a.json'), brief, []).some(f => f.kind === 'scope')).toBe(false)
  })

  test('isInScope neo theo thư mục gốc, nhận đường dẫn tương đối và chuẩn hóa ./ và ..', () => {
    expect(isInScope('src/a.ts', ['src'], '/repo')).toBe(true)
    expect(isInScope('./src/a.ts', ['src/'], '/repo')).toBe(true)
    expect(isInScope('src/../config/a.json', ['src'], '/repo')).toBe(false)
    expect(isInScope('/repo/src/a.ts', ['src'], '/repo')).toBe(true)
    expect(isInScope('config/a.json', ['src'], '/repo')).toBe(false)
    // Không có thư mục gốc thì không khẳng định trong phạm vi.
    expect(isInScope('/repo/src/a.ts', ['src'])).toBe(false)
  })
})

describe('vòng cuối: phạm vi theo thư mục gốc', () => {
  const focus = (root: string | null) => ({ goal: 'g', scopePaths: ['src/'], tier: 'complex' as const, root })
  const scopeTexts = (root: string | null, path: string) =>
    observe(newTracker('t'), edit(path), focus(root) as never, []).filter(f => f.kind === 'scope').map(f => f.text)

  test('có thư mục gốc: dự án khác có src là ngoài phạm vi; trong gốc là trong phạm vi', () => {
    expect(scopeTexts('/repo', '/tmp/another-project/src/x.ts').length).toBe(1)
    expect(scopeTexts('/repo', '/repo/src/x.ts')).toEqual([])
    expect(scopeTexts('/repo', 'src/x.ts')).toEqual([])
    expect(scopeTexts('/repo', 'src/../config/a.json').length).toBe(1)
  })

  test('lệnh Bash: đường dẫn sau cd nối với thư mục gốc', () => {
    const run = (command: string) => observe(newTracker('t'), bash(command), focus('/repo') as never, []).filter(f => f.kind === 'scope').map(f => f.text)
    expect(run('cd src && touch a.ts')).toEqual([])
    expect(run('cd .. && touch other/x').length).toBe(1)
  })

  test('không có thư mục gốc: không khẳng định trong phạm vi', () => {
    expect(scopeTexts(null, '/tmp/another-project/src/x.ts').join('\n')).toMatch(/không xác định được phạm vi/i)
    expect(scopeTexts(null, '/repo/src/x.ts').join('\n')).toMatch(/không xác định được phạm vi/i)
  })
})
