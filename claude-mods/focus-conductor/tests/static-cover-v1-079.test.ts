// 0.7.9 vòng 2 V1: lần kiểm tĩnh đạt chỉ phủ lần lỗi cùng công cụ khi lần đạt thật sự kiểm: không có cờ chỉ in thông tin (--version,
// --help, --showConfig...), cùng subcommand (ruff check khác ruff format), cùng phạm vi (giá trị -p, --project; các đường dẫn của lần đạt
// chứa các đường dẫn của lần lỗi). Khóa so giữ tiền tố bọc (npx, bunx, pnpm exec) như hợp đồng danh tính của lệnh kiểm.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { coversFailure } from '../hooks/lib/drift/evidence'
import { base, plan, step, submit } from './support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const run = (command: string) => ({ check: 'static' as const, command })
const covers = (pass: string, fail: string) => coversFailure(run(pass), run(fail))

describe('0.7.9 V1: lần đạt không kiểm gì hay kiểm phạm vi khác không phủ', () => {
  const cases: Array<[string, string]> = [
    ['tsc --version', 'tsc --noEmit'],
    ['tsc --help', 'tsc --noEmit'],
    ['tsc -p tsconfig.small.json', 'tsc --noEmit'],
    ['ruff format --check .', 'ruff check .'],
    ['mypy --version', 'mypy .'],
    ['eslint --version', 'eslint .'],
    ['eslint src/ui', 'eslint .'],
    ['tsc --showConfig', 'tsc --noEmit'],
    ['biome format .', 'biome lint .'],
    ['tsc --noEmit', 'npx tsc --noEmit'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt không phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(false))
  }
})

describe('0.7.9 V1: các ca phủ giữ nguyên', () => {
  const cases: Array<[string, string]> = [
    ['tsc -p .', 'tsc --noEmit'],
    ['tsc -p tsconfig.json', 'tsc --noEmit'],
    ['npx tsc --noEmit --pretty false', 'npx tsc --noEmit'],
    ['eslint .', 'eslint src/ui'],
    ['ruff check .', 'ruff check src'],
    ['npx tsc --noEmit', 'npx tsc --noEmit'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(true))
  }
})

function hooks(on: On, passing: Set<string>) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: 'Version 5.4.5' } : { result: 'src/a.ts(3,7): error TS2322: Type string is not assignable to type number.', isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

/** Mục tiêu một bước, sửa src/a.ts, lệnh kiểm tĩnh `fail` lỗi, bước ghi done, rồi `pass` đạt. */
async function scenario($: Engine, on: On, fail: string, pass: string): Promise<string> {
  const passing = new Set<string>([pass])
  const seen = base(on, { router: () => plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } }) })
  hooks(on, passing)
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  await bash($, fail)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
  await bash($, pass)
  return stop($)
}

describe('0.7.9 V1: đầu cuối', () => {
  test('npx tsc --noEmit lỗi rồi npx tsc --version đạt: Stop vẫn chặn', {}, async ($, on) => {
    expect(await scenario($, on, 'npx tsc --noEmit', 'npx tsc --version')).toContain('npx tsc --noEmit')
  })
  test('npx eslint . lỗi rồi npx eslint src/ui đạt: Stop vẫn chặn', {}, async ($, on) => {
    expect(await scenario($, on, 'npx eslint .', 'npx eslint src/ui')).toContain('npx eslint .')
  })
})
