// 0.9.0 B5 (tích hợp, nối tiếp quota-allow-075 và quota-realpath-r9-075): khi dừng cứng vì hạn mức, tệp trạng thái router đọc từ prompt
// (B1) ghi được như một mục của pauseAllowPaths, cùng phép kiểm đường dẫn đáp thật và symlink. Nơi ghi phụ không được miễn.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'
import { flatFs, quotaMeter, week } from '../support/quota'

type Out = { deny?: string }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Out>
const DENIED = 'Tạm dừng'
const GOAL = plan({ goal: 'Sửa thống kê', depth: 'substantial', volume: 'medium', kind: 'edit', stateFiles: ['/repo/run/TIEN-DO.md', '/repo/link/DIEM-DUNG.md'], sideWrites: ['/repo/backup'] })

async function paused($: Engine, on: On, real = true) {
  base(on, { router: () => GOAL })
  quotaMeter(on, [week(99)])
  if (real) flatFs(on)
  else {
    // /repo/link trỏ sang /etc: tệp trạng thái dưới đó đáp ra ngoài.
    on('fs.stat', (_$, e) => {
      const target = e.path.startsWith('/repo/link') ? e.path.replace('/repo/link', '/etc') : e.path
      return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: target !== e.path, ...(e.resolve ? { realPath: target } : {}) } } as never
    })
  }
  on('tool.call', { tool: /^(?:Write|Edit|Bash)$/ }, () => ({ result: 'ok' }))
  await submit($, 'Sửa thống kê')
}

describe('0.9.0 B5: tệp trạng thái ghi được khi dừng cứng vì hạn mức', () => {
  test('không đặt pauseAllowPaths: Write và echo >> vào TIEN-DO.md qua; src và nơi sao lưu vẫn bị từ chối', {}, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/run/TIEN-DO.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Bash', command: 'echo "- dừng" >> /repo/run/TIEN-DO.md' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/src/a.ts', content: 'x' })).deny).toContain(DENIED)
    expect((await call($, { tool: 'Write', file_path: '/repo/backup/a.md', content: 'x' })).deny).toContain(DENIED)
  })
  test('có pauseAllowPaths: cả mục option lẫn tệp trạng thái đều qua', { options: { pauseAllowPaths: '.checkpoint/' } }, async ($, on) => {
    await paused($, on)
    expect((await call($, { tool: 'Write', file_path: '/repo/.checkpoint/a.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/run/TIEN-DO.md', content: 'x' })).deny).toBeUndefined()
  })
  test('tệp trạng thái dưới symlink dẫn ra ngoài: bị từ chối', {}, async ($, on) => {
    await paused($, on, false)
    expect((await call($, { tool: 'Write', file_path: '/repo/link/DIEM-DUNG.md', content: 'x' })).deny).toContain(DENIED)
  })
})
