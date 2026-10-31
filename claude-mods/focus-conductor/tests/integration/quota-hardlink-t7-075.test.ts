// 0.7.5 T7 (vòng rà soát 5): khi tạm dừng cứng, các dạng cp tạo liên kết còn lọt bị từ chối: nháy hay gạch chéo trong cờ (cp -"l",
// cp -'l', cp -\l), mở rộng ngoặc nhọn (cp {-l,src/a.ts} k6/h), lệnh bọc (timeout 5, stdbuf, ionice, doas, chronic), rsync --link-dest và
// install -l. cp thường vẫn qua.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { flatFs, quotaMeter, week } from '../support/quota'
import { makesLink } from '../../hooks/lib/quota'

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

const LEAKS = [
  'cp -"l" src/a.ts k6/h',
  "cp -'l' src/a.ts k6/h",
  'cp -\\l src/a.ts k6/h',
  'cp {-l,src/a.ts} k6/h',
  'timeout 5 cp -l src/a.ts k6/h',
  'timeout -s KILL 5s cp -l src/a.ts k6/h',
  'stdbuf -oL cp -l src/a.ts k6/h',
  'ionice -c 3 cp -l src/a.ts k6/h',
  'ionice -c3 cp -l src/a.ts k6/h',
  'doas cp -l src/a.ts k6/h',
  'doas -u root cp -l src/a.ts k6/h',
  'chronic cp -l src/a.ts k6/h',
  'rsync -a --link-dest=../prev src/ k6/snap',
  'rsync -a --link-dest ../prev src/ k6/snap',
  'install -l h src/a.ts k6/h',
  'install -cl h src/a.ts k6/h',
]

describe('0.7.5 T7: các dạng cp tạo liên kết còn lọt', () => {
  test('tạm dừng cứng từ chối từng dạng', OPTS, async ($, on) => {
    await paused($, on)
    for (const command of LEAKS) expect((await bash($, command)).deny, command).toContain(DENIED)
  })

  test('cp thường vẫn qua: cp src/a k6/', OPTS, async ($, on) => {
    await paused($, on)
    expect((await bash($, 'cp src/a k6/')).deny).toBeUndefined()
  })
})

describe('0.7.5 T7: makesLink', () => {
  test('nhận mọi dạng của đặc tả', () => {
    for (const command of LEAKS) expect(makesLink(command), command).toBe(true)
  })

  test('không nhận cp thường (cả sau lệnh bọc), rsync không --link-dest, install không -l', () => {
    for (const command of ['cp src/a k6/', 'timeout 5 cp src/a.ts k6/a', 'stdbuf -oL cp -r src k6/src', 'rsync -a src/ k6/snap', 'install -m 644 src/a.ts k6/a', 'cp -S .bak src/a.ts k6/a']) {
      expect(makesLink(command), command).toBe(false)
    }
  })
})
