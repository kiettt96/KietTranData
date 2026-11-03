// 0.7.7 X3: câu cảnh báo "không chạy bước kiểm tra nào" nêu lệnh kiểm bị loại và lý do khi turn có chạy lệnh kiểm mà không được tính.
// Không có lệnh kiểm bị loại thì giữ đúng câu cũ. Có lệnh kiểm đạt thì giữ câu "chưa được kiểm tra lại".

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, observe, summarize, trackVerification } from '../hooks/lib/drift'
import * as output from '../hooks/lib/drift/output'
import { classifyBash } from '../hooks/lib/drift/classify'
import type { CheckEffect } from '../hooks/lib/drift/classify'
import { bash, edit, makeBrief } from './support/commands'

const brief = makeBrief()
type Call = ReturnType<typeof bash> | ReturnType<typeof edit>

function textOf(calls: readonly Call[]): string | undefined {
  const tracker = newTracker('t')
  for (const call of calls) observe(tracker, call, brief, [])
  return summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.text
}
const EDIT = edit('/p/a.ts')
const HEAD = 'Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào được tính: '

describe('0.7.7 X3: câu cảnh báo nêu lệnh kiểm bị loại', () => {
  test('qua ống không đọc được kết quả', () => {
    expect(textOf([EDIT, bash('npm test 2>&1 | tail -20', 'log')])).toBe(`${HEAD}"npm test" chạy qua ống, mod không đọc được kết quả`)
  })

  test('mã thoát bị lệnh đứng sau che', () => {
    expect(textOf([EDIT, bash('npm test; echo done', '12 passing (3ms)')])).toBe(`${HEAD}"npm test" bị lệnh đứng sau che mã thoát`)
  })

  test('lệnh có thay thế lệnh', () => {
    expect(textOf([EDIT, bash('cd "$(git rev-parse --show-toplevel)" && npm test', '12 passing (3ms)')])).toBe(
      `${HEAD.replace('có 1', 'có 2')}"npm test" nằm trong lệnh có $( ), backtick, eval, sh -c hoặc đứng sau ||`,
    )
  })

  test('lệnh kiểm lỗi', () => {
    expect(textOf([EDIT, bash('npm test', true)])).toBe(`${HEAD}"npm test" chưa đạt`)
    expect(textOf([EDIT, bash('npm test', 'FAIL src/a.test.ts')])).toBe(`${HEAD}"npm test" chưa đạt`)
  })

  test('không có phép kiểm nào chạy', () => {
    expect(textOf([EDIT, bash('npm test', '0 passed in 0.01s')])).toBe(`${HEAD}"npm test" không có phép kiểm nào chạy`)
  })

  test('nhiều lệnh bị loại: nêu mục cuối cùng', () => {
    expect(textOf([EDIT, bash('npm test; echo done', '12 passing (3ms)'), bash('npm test', true)])).toBe(`${HEAD}"npm test" chưa đạt`)
  })

  test('lệnh dài quá 60 ký tự bị cắt, kết bằng dấu ba chấm', () => {
    const long = `npm test -- --reporter=${'x'.repeat(80)}`
    const text = textOf([EDIT, bash(long, true)]) ?? ''
    expect(text).toBe(`${HEAD}"${long.slice(0, 60)}…" chưa đạt`)
  })

  test('không có lệnh kiểm bị loại: giữ nguyên câu cũ', () => {
    expect(textOf([EDIT])).toBe('Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào')
    expect(textOf([EDIT, bash('ls')])).toBe('Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào')
  })

  test('script kiểm chưa khai đã chạy đạt (không phải lệnh kiểm được nhận): câu giữ nguyên, gợi ý đi theo toast riêng của 0.7.3', () => {
    expect(textOf([EDIT, bash('python3 tests/check_all.py', 'RESULT: 47 passed, 0 failed')])).toBe('Turn có 2 thay đổi nhưng không chạy bước kiểm tra nào')
  })

  test('đã có lệnh kiểm đạt: giữ câu chưa được kiểm tra lại, kể cả khi trước đó có lệnh bị loại', () => {
    const text = textOf([EDIT, bash('npm test; echo done', '12 passing (3ms)'), bash('npm test', '12 passing (3ms)'), edit('/p/b.ts')])
    expect(text).toBe('1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại')
  })

  test('lệnh kiểm bị loại của subagent cùng mục tiêu cũng được nêu', () => {
    const tracker = newTracker('t')
    observe(tracker, EDIT, brief, [])
    trackVerification(tracker, bash('npm test 2>&1 | tail -20', 'log'), 'agent-1')
    expect(summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.text).toBe(`${HEAD}"npm test" chạy qua ống, mod không đọc được kết quả`)
  })

  test('chỉ giữ năm lệnh bị loại gần nhất', () => {
    const tracker = newTracker('t')
    observe(tracker, EDIT, brief, [])
    for (let i = 1; i <= 7; i++) observe(tracker, bash(`npm test -- --n${i}`, true), brief, [])
    expect(tracker.rejected.length).toBe(5)
    expect(tracker.rejected[0]?.command).toBe('npm test -- --n3')
  })
})

describe('0.7.7 X3: rejectReason', () => {
  const effectOf = (command: string): CheckEffect => classifyBash(command).effects.find((e): e is CheckEffect => e.kind === 'check') as CheckEffect
  const reason = (command: string, extra: Parameters<typeof bash>[1]) => (output as unknown as { rejectReason: (e: CheckEffect, o: ReturnType<typeof bash>) => string | null }).rejectReason(effectOf(command), bash(command, extra))

  test('đạt thì null', () => {
    expect(reason('npm test', '12 passing (3ms)')).toBeNull()
  })

  test('thứ tự: lỗi trước, rồi không chạy gì, lệnh lạ, che mã thoát, ống', () => {
    expect(reason('cd "$(pwd)" && npm test', 'FAIL a')).toBe('failed')
    expect(reason('npm test; echo done', '0 passed in 0.01s')).toBe('ran-nothing')
    expect(reason('cd "$(pwd)" && npm test', '12 passing (3ms)')).toBe('untrusted')
    expect(reason('npm test; echo done', '12 passing (3ms)')).toBe('hidden')
    expect(reason('npm test 2>&1 | tail -20', 'log')).toBe('pipe')
  })
})
