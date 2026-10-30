// 0.7.5 S4 (vòng rà soát 4): khi tạm dừng cứng, cp tạo liên kết (-l, --link, -s, --symbolic-link, kể cả gộp cờ như -al, -sf) và lệnh
// link bị từ chối như ln: ghi vào liên kết cứng trong danh sách sẽ sửa file gốc ngoài danh sách mà realpath không thấy.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { flatFs, quotaMeter, week } from '../support/quota'

type Out = { deny?: string }
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>
const DENIED = 'Tạm dừng'
const OPTS = { options: { pauseAllowPaths: 'k6/' } }

async function paused($: Engine, on: Parameters<typeof base>[0]) {
  base(on)
  flatFs(on)
  quotaMeter(on, [week(99)])
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  await submit($, COMPLEX_PROMPT)
}

describe('0.7.5 S4: cp tạo liên kết và link bị từ chối khi tạm dừng cứng', () => {
  test('bốn dạng của đặc tả: cp -l, cp --link, cp -s, cp --symbolic-link', OPTS, async ($, on) => {
    await paused($, on)
    for (const command of ['cp -l src/a.ts k6/h', 'cp --link src/a.ts k6/h', 'cp -s src/a.ts k6/h', 'cp --symbolic-link src/a.ts k6/h']) {
      expect((await bash($, command)).deny, command).toContain(DENIED)
    }
  })

  test('cờ gộp và dạng viết tắt: -al, -sf, -rl, --li, --sym, cờ đứng sau đường dẫn', OPTS, async ($, on) => {
    await paused($, on)
    for (const command of ['cp -al src k6/h', 'cp -sf src/a.ts k6/h', 'cp -rl src k6/h', 'cp --li src/a.ts k6/h', 'cp --sym src/a.ts k6/h', 'cp src/a.ts k6/h -l', 'sudo cp -l src/a.ts k6/h']) {
      expect((await bash($, command)).deny, command).toContain(DENIED)
    }
  })

  test('lệnh link bị từ chối', OPTS, async ($, on) => {
    await paused($, on)
    expect((await bash($, 'link src/a.ts k6/h')).deny).toContain(DENIED)
  })

  test('cp thường vẫn được qua: cp, cp -r, cp -f, cp -p, cp -S .bak', OPTS, async ($, on) => {
    await paused($, on)
    for (const command of ['cp src/a.ts k6/a.bak', 'cp -r src k6/src', 'cp -f src/a.ts k6/a', 'cp -p src/a.ts k6/a', 'cp -S .bak src/a.ts k6/a']) {
      expect((await bash($, command)).deny, command).toBeUndefined()
    }
  })
})
