// 0.7.5 R9 (vòng rà soát 3): khi tạm dừng cứng, mọi đường dẫn ghi trong pauseAllowPaths (Write, Edit, MultiEdit, NotebookEdit và đích
// ghi của Bash: redirect, tee, cp, mv) phải đáp thật vào trong danh sách: $.fs.stat(path, { resolve: true }) cho đường dẫn thật, đi lên
// tới thư mục tồn tại gần nhất cho file hay thư mục chưa có. Symlink dẫn ra ngoài bị từ chối. Câu từ chối nêu Read trong các tool được
// phép trên các đường dẫn đó.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { quotaDenyText } from '../../hooks/lib/text'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

type Out = { deny?: string }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Out>
const bash = ($: Engine, command: string) => call($, { tool: 'Bash', command })
const DENIED = 'Tạm dừng'
const OPTS = { options: { pauseAllowPaths: 'k6/' } }

/** Hệ tệp giả: mỗi đường dẫn tồn tại có đường dẫn thật (symlink trỏ nơi khác), 'dangling' là liên kết trỏ vào hư không; còn lại ENOENT. */
type Entry = string | 'dangling'
function fsStat(on: On, files: Record<string, Entry>): void {
  on('fs.stat', (_$, e) => {
    const entry = files[e.path]
    // `{ deny }` làm lời gọi $.fs.stat của mod bị từ chối (rejects), như engine từ chối đường dẫn không có.
    if (entry === undefined) return { deny: `ENOENT: no such file or directory, stat '${e.path}'` } as never
    const isLink = entry === 'dangling' || entry !== e.path
    const stat = { kind: entry === 'dangling' ? ('other' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink }
    return { value: entry === 'dangling' || !e.resolve ? stat : { ...stat, realPath: entry } } as never
  })
}
const PLAIN = { '/repo': '/repo', '/repo/k6': '/repo/k6', '/repo/src': '/repo/src', '/repo/k6/a': '/repo/k6/a', '/repo/k6/l': '/repo/src', '/repo/k6/d': 'dangling' } satisfies Record<string, Entry>

async function paused($: Engine, on: On, files: Record<string, Entry> = PLAIN) {
  const seen = base(on)
  quotaMeter(on, [week(99)])
  fsStat(on, files)
  on('tool.call', { tool: /^(?:Write|Edit|MultiEdit|NotebookEdit|Bash|Read)$/ }, () => ({ result: 'ok' }))
  await submit($, COMPLEX_PROMPT)
  return seen
}

describe('0.7.5 R9: symlink trong danh sách dẫn ra ngoài bị từ chối', () => {
  test('k6/l trỏ sang src: Write, Edit, MultiEdit, NotebookEdit vào k6/l/a.ts đều bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      expect((await call($, { tool, file_path: '/repo/k6/l/a.ts', content: 'x' })).deny, tool).toContain(DENIED)
      expect((await call($, { tool, file_path: 'k6/l/a.ts', content: 'x' })).deny, tool).toContain(DENIED)
    }
    expect((await call($, { tool: 'NotebookEdit', notebook_path: '/repo/k6/l/n.ipynb' })).deny).toContain(DENIED)
  })

  test('đích ghi của Bash qua k6/l: redirect, tee, cp, mv đều bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    for (const command of ['echo x > k6/l/a', 'echo x >> k6/l/a', 'echo x | tee k6/l/a', 'cp k6/a k6/l/b', 'mv k6/a k6/l/b']) {
      expect((await bash($, command)).deny, command).toContain(DENIED)
    }
  })

  test('liên kết trỏ vào hư không (k6/d): ghi vào sẽ tạo file ngoài danh sách nên bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/d', content: 'x' })).deny).toContain(DENIED)
    expect((await bash($, 'echo x > k6/d')).deny).toContain(DENIED)
  })

  test('Read qua symlink ra ngoài cũng bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Read', file_path: '/repo/k6/l/a.ts' })).deny).toContain(DENIED)
  })

  test('hệ tệp báo lỗi khác ENOENT (từ chối quyền): từ chối, không đoán', OPTS, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    on('fs.stat', () => ({ deny: 'EACCES: permission denied' }) as never)
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/a.md', content: 'x' })).deny).toContain(DENIED)
  })
})

describe('0.7.5 R9: lỗi khác ENOENT không được coi là file chưa có', () => {
  test('stat báo EACCES ở file nhưng thư mục cha đọc được: từ chối, không đi lên thư mục cha', OPTS, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    on('fs.stat', (_$, e) => {
      if (e.path === '/repo' || e.path === '/repo/k6') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } as never
      return { deny: 'EACCES: permission denied' } as never
    })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/a.md', content: 'x' })).deny).toContain(DENIED)
  })
})

describe('0.7.5 R9: đường dẫn hợp lệ vẫn được ghi', () => {
  test('file có sẵn, file mới, thư mục con chưa tạo (k6/moi/a.md với k6/moi chưa có) đều được qua', OPTS, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/a', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/DIEM-DUNG.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/moi/a.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: 'k6/moi/sau/hon/a.md', content: 'x' })).deny).toBeUndefined()
    expect((await bash($, 'echo x > k6/moi/a.md')).deny).toBeUndefined()
    expect((await bash($, 'cp src/a.ts k6/moi/a.ts.bak')).deny).toBeUndefined()
  })

  test('thư mục gốc nằm sau một symlink (/repo thật là /real/repo): vẫn được ghi trong danh sách', OPTS, async ($, on) => {
    await paused($, on, { '/repo': '/real/repo', '/repo/k6': '/real/repo/k6' })
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/x.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/moi/x.md', content: 'x' })).deny).toBeUndefined()
  })

  test('ghi ngoài danh sách vẫn bị từ chối như cũ', OPTS, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/src/a.ts', content: 'x' })).deny).toContain(DENIED)
    expect((await bash($, 'echo x > src/a.ts')).deny).toContain(DENIED)
  })
})

describe('0.7.5 R9: mục tuyệt đối ngoài thư mục gốc', () => {
  test('/tmp/ck: ghi vào /tmp/ck/a được; /tmp/ck/l là symlink ra /etc thì bị từ chối', { options: { pauseAllowPaths: '/tmp/ck' } }, async ($, on) => {
    await paused($, on, { '/repo': '/repo', '/tmp': '/tmp', '/tmp/ck': '/tmp/ck', '/tmp/ck/l': '/etc' })
    expect((await call($, { tool: 'Write', file_path: '/tmp/ck/a', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/tmp/ck/l/passwd', content: 'x' })).deny).toContain(DENIED)
  })

  test('symlink sang thư mục có tên bắt đầu giống mục (/tmp/ckevil) không được coi là nằm trong /tmp/ck', { options: { pauseAllowPaths: '/tmp/ck' } }, async ($, on) => {
    await paused($, on, { '/repo': '/repo', '/tmp': '/tmp', '/tmp/ck': '/tmp/ck', '/tmp/ck/l': '/tmp/ckevil' })
    expect((await call($, { tool: 'Write', file_path: '/tmp/ck/l/x', content: 'x' })).deny).toContain(DENIED)
  })
})

describe('0.7.5 R9: câu từ chối nêu Read', () => {
  test('danh sách tool được phép trên các đường dẫn có Read, lý do Claude Code cần Read trước Edit', () => {
    const text = quotaDenyText([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], false, false, ['.checkpoint/'])
    expect(text).toContain('Read')
    expect(text).toContain('Read trước Edit')
    expect(text).toContain('Không gọi tool nào khác ngoài việc ghi và Read các đường dẫn đó và tool plan')
  })

  test('không có pauseAllowPaths và subagent: không nhắc Read', () => {
    expect(quotaDenyText([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], false, false)).not.toContain('Read')
    expect(quotaDenyText([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], false, true, ['.checkpoint/'])).not.toContain('Read')
  })
})
