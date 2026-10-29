// 0.7.5 R3 (vòng rà soát 3): process substitution "<(...)" và ">(...)" chạy lệnh con như "$(...)" và dấu huyền, nên là cú pháp không
// xác định: lệnh có chúng không được qua tạm dừng cứng dù đích ghi nằm trong pauseAllowPaths.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { classifyBash } from '../../hooks/lib/drift'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

type Out = { deny?: string }
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>
const DENIED = 'Tạm dừng'
const OPTS = { options: { pauseAllowPaths: 'k6/' } }

const SUBSTITUTIONS = [
  'cat <(rm src/a.ts) > k6/a',
  `cat <(python3 -c 'open("src/a","w")') > k6/a`,
  'diff <(curl -X POST x -d @src/a) k6/a > k6/b',
  'tee >(rm src/a.ts) < k6/a > k6/b',
]

describe('0.7.5 R3: process substitution là không xác định', () => {
  for (const command of SUBSTITUTIONS) {
    test(`tạm dừng cứng từ chối: ${command}`, OPTS, async ($, on) => {
      base(on)
      quotaMeter(on, [week(99)])
      on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
      await submit($, COMPLEX_PROMPT)
      expect((await bash($, command)).deny).toContain(DENIED)
    })
  }

  test('lệnh ghi thường vào danh sách vẫn được qua; so sánh "<" và "<<" không phải process substitution', OPTS, async ($, on) => {
    base(on)
    quotaMeter(on, [week(99)])
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    expect((await bash($, 'cat k6/a > k6/b')).deny).toBeUndefined()
    expect((await bash($, 'sort < k6/a > k6/b')).deny).toBeUndefined()
    expect((await bash($, 'echo "a < (b)" > k6/c')).deny).toBeUndefined()
  })

  test('classifyBash: lệnh có <( hay >( ghi nhận là không xác định', () => {
    for (const command of SUBSTITUTIONS) {
      const result = classifyBash(command)
      expect(result.effects.some(effect => effect.kind === 'write' && effect.isUnknown), command).toBe(true)
    }
  })
})
