// 0.7.5 M6 (vòng sửa 2): pauseAllowPaths chặt hơn. Mọi tác động ghi của lệnh Bash phải có đường dẫn và mọi đường dẫn nằm trong
// danh sách (nguồn của mv tính là ghi); ln và lệnh có tác động không đường dẫn (git commit, git push...) bị từ chối; mục "." và
// "./" trong option bị bỏ kèm một cảnh báo; tool Read đọc được các đường dẫn được phép.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

type Out = { deny?: string; context?: string[] }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Out>
const bash = ($: Engine, command: string) => call($, { tool: 'Bash', command })
const tools = (on: Parameters<typeof base>[0]) => {
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
}
const DENIED = 'Tạm dừng'
const OPTS = { options: { pauseAllowPaths: 'k6/' } }

async function paused($: Engine, on: Parameters<typeof base>[0]) {
  const seen = base(on)
  quotaMeter(on, [week(99)])
  tools(on)
  await submit($, COMPLEX_PROMPT)
  return seen
}

describe('0.7.5 M6: tác động ghi phải có đường dẫn và nằm trong danh sách', () => {
  test('mv: nguồn ngoài danh sách bị từ chối; chuyển trong danh sách được qua', OPTS, async ($, on) => {
    await paused($, on)
    expect((await bash($, 'mv src/a.ts k6/')).deny).toContain(DENIED)
    expect((await bash($, 'mv k6/a.md src/')).deny).toContain(DENIED)
    expect((await bash($, 'mv k6/a.md k6/b.md')).deny).toBeUndefined()
    expect((await bash($, 'cp src/a.ts k6/a.ts.bak')).deny).toBeUndefined()
  })

  test('ghi vào danh sách rồi git push hay git commit: bị từ chối (tác động không có đường dẫn)', OPTS, async ($, on) => {
    await paused($, on)
    expect((await bash($, 'echo x > k6/a && git push')).deny).toContain(DENIED)
    expect((await bash($, 'echo x > k6/a; git commit -m x')).deny).toContain(DENIED)
    expect((await bash($, 'git add k6/a')).deny).toContain(DENIED)
    expect((await bash($, 'echo x > k6/a && echo y >> k6/b')).deny).toBeUndefined()
  })

  test('ln bị từ chối dù đích nằm trong danh sách', OPTS, async ($, on) => {
    await paused($, on)
    expect((await bash($, 'ln -s /etc/passwd k6/p')).deny).toContain(DENIED)
    expect((await bash($, 'ln src/a.ts k6/a.ts')).deny).toContain(DENIED)
  })
})

describe('0.7.5 M6: mục "." và "./" trong option', () => {
  for (const entry of ['.', './', '/', '..', 'k6/, .']) {
    test(`pauseAllowPaths "${entry}": mục "." bị bỏ, ghi ra ngoài danh sách vẫn bị từ chối, cảnh báo một lần`, { options: { pauseAllowPaths: entry } }, async ($, on) => {
      const seen = await paused($, on)
      expect((await call($, { tool: 'Write', file_path: '/repo/src/a.ts', content: 'x' })).deny).toContain(DENIED)
      expect((await call($, { tool: 'Write', file_path: '/repo/src/b.ts', content: 'x' })).deny).toContain(DENIED)
      expect(seen.toasts.filter(t => t.includes('pauseAllowPaths')).length).toBe(1)
    })
  }

  test('"k6/, ." vẫn cho ghi vào k6/; cảnh báo chỉ nêu mục bị bỏ', { options: { pauseAllowPaths: 'k6/, .' } }, async ($, on) => {
    const seen = await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/k6/DIEM-DUNG.md', content: 'x' })).deny).toBeUndefined()
    const warning = seen.toasts.find(t => t.includes('pauseAllowPaths')) ?? ''
    expect(warning).toContain('"."')
    expect(warning).not.toContain('"k6/"')
  })
})

describe('0.7.5 M6: đọc các đường dẫn được phép', () => {
  test('Read trong danh sách được qua; Read ngoài danh sách bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Read', file_path: '/repo/k6/DIEM-DUNG.md' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Read', file_path: 'k6/DIEM-DUNG.md' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Read', file_path: '/repo/src/a.ts' })).deny).toContain(DENIED)
    expect((await call($, { tool: 'Read' })).deny).toContain(DENIED)
  })
})
