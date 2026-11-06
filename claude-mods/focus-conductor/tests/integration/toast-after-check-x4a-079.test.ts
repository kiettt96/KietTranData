// 0.7.9 X4a: cảnh báo nhánh "sau lần kiểm cuối" toast một lần cho mỗi lý do loại của lệnh kiểm gần nhất trong một mục tiêu. Khóa là
// `after-check:<lý do>` (failed, ran-nothing, pipe, ...; lệnh gần nhất đạt thì `after-check:passed`). Band và pane vẫn ghi mọi lần.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { JS } from '../fixtures/runner-output'
import { DEFAULT_ROUTER, base, conductor, plan, submit } from '../support/engine'
import type { Responder } from '../support/engine'

const router: Responder = request => (request.startsWith('làm tiếp') ? plan({ relation: 'continue', kind: 'mixed' }) : DEFAULT_ROUTER(request))
const isAfterCheck = (t: string) => t.includes('sau lần kiểm tra cuối')
const RESULTS: Record<string, { result: string; isError?: boolean }> = {
  'bun test': { result: JS.bun_pass },
  'bun test tests/a.test.ts': { result: JS.bun_fail, isError: true },
  'bun test tests/b.test.ts 2>&1 | tail -5': { result: 'log' },
}

function setup(on: Parameters<typeof base>[0]) {
  const seen = base(on, { router })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => (RESULTS[String((e as { command?: unknown }).command ?? '')] ?? { result: 'log' }) as never)
  on('turn.complete', () => ({ text: '' }))
  return seen
}

const edit = ($: Engine, path: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)

/** Một turn: sửa, kiểm đạt, sửa tiếp, rồi (nếu có) một lệnh kiểm bị loại; cảnh báo cuối turn thuộc nhánh sau lần kiểm cuối. */
async function turn($: Engine, n: number, last: string | null) {
  const text = `làm tiếp lần ${n}`
  await submit($, text)
  await $.turn.start({ text, turnId: `t${n}` })
  await edit($, `src/a${n}.ts`)
  await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
  await edit($, `src/b${n}.ts`)
  if (last !== null) await $.tool.call({ tool: 'Bash', command: last } as never)
  await $.turn.complete({ turnId: `t${n}`, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

describe('0.7.9 X4a: khóa toast của nhánh sau lần kiểm cuối gồm lý do', () => {
  test('hai turn cùng lý do (lệnh kiểm gần nhất lỗi): một toast', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'bun test tests/a.test.ts')
    await turn($, 2, 'bun test tests/a.test.ts')
    expect(seen.toasts.filter(isAfterCheck).length).toBe(1)
  })

  test('hai turn khác lý do (lỗi, rồi chạy qua ống): hai toast', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'bun test tests/a.test.ts')
    await turn($, 2, 'bun test tests/b.test.ts 2>&1 | tail -5')
    expect(seen.toasts.filter(isAfterCheck).length).toBe(2)
  })

  test('lệnh kiểm gần nhất đạt, rồi turn sau có lệnh lỗi: hai toast', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, null)
    await turn($, 2, 'bun test tests/a.test.ts')
    expect(seen.toasts.filter(isAfterCheck).length).toBe(2)
  })

  test('mục tiêu mới: toast lại cùng lý do', {}, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa module thanh toán')
    await turn($, 1, 'bun test tests/a.test.ts')
    await conductor($, 'goal Làm việc khác hẳn')
    await turn($, 2, 'bun test tests/a.test.ts')
    expect(seen.toasts.filter(isAfterCheck).length).toBe(2)
  })
})
