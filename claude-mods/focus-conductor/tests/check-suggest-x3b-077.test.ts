// 0.7.7 X3 (nhánh gợi ý): không có lệnh kiểm nào được tính và không có lệnh kiểm bị loại, nhưng đã chạy một script kiểm chưa khai thì câu cảnh
// báo nêu script đó. Câu không chứa tên option: toast riêng của 0.7.3 (offerCheckHint) đã nêu option và lệnh cần khai trong cùng turn.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { newTracker, observe, summarize } from '../hooks/lib/drift'
import { bash, edit, makeBrief } from './support/commands'
import { COMPLEX_PROMPT, base, submit } from './support/engine'

const brief = makeBrief()
const HEAD = 'Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào được tính: '
const textOf = (calls: Array<ReturnType<typeof bash> | ReturnType<typeof edit>>, suggestions: readonly string[]) => {
  const tracker = newTracker('t')
  for (const call of calls) observe(tracker, call, brief, [])
  return summarize(tracker, brief, [], suggestions).find(f => f.kind === 'unverified')?.text
}

describe('0.7.7 X3: câu nêu script kiểm chưa được khai', () => {
  test('câu đúng nguyên văn với gợi ý đầu tiên', () => {
    expect(textOf([edit('/p/a.ts')], ['python3 tests/check_all.py', 'bash scripts/verify.sh'])).toBe(`${HEAD}script kiểm "python3 tests/check_all.py" chưa được khai là lệnh kiểm`)
  })

  test('câu không chứa tên option', () => {
    expect(textOf([edit('/p/a.ts')], ['python3 tests/check_all.py'])).not.toContain('checkCommands')
  })

  test('có lệnh kiểm bị loại: nêu lệnh bị loại, không nêu gợi ý', () => {
    expect(textOf([edit('/p/a.ts'), bash('npm test', true)], ['python3 tests/check_all.py'])).toBe(`${HEAD}"npm test" chưa đạt`)
  })

  test('không có gợi ý: giữ câu cũ', () => {
    expect(textOf([edit('/p/a.ts')], [])).toBe('Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào')
  })
})

describe('0.7.7 X3: tích hợp với toast gợi ý của 0.7.3', () => {
  test('cuối turn: câu nêu script kiểm chưa khai, và vẫn đúng một toast có chữ checkCommands', { options: { planApproval: 'off' } }, async ($: Engine, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Bash', command: 'cd /repo && /usr/bin/python3 -B tests/check-a.py' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.toasts.some(t => t.includes('script kiểm "python3 tests/check-a.py" chưa được khai là lệnh kiểm'))).toBe(true)
    expect(seen.toasts.filter(t => t.includes('checkCommands')).length).toBe(1)
  })
})
