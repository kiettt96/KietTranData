// 0.9.0 B11 (tích hợp): một mục của checkCommands khai thêm được phạm vi đường dẫn bằng glob, sau dấu `@@` (glob nối bằng `;`), ví dụ
// `bun test @@ src/**`. Mục không có phạm vi giữ hành vi 0.8.9. Lệnh có phạm vi chạy đạt chỉ là bằng chứng cho thay đổi có đường dẫn khớp
// phạm vi, chỉ tự nâng bước khi mọi thay đổi không nhẹ từ lần kiểm trước đều khớp; cổng Stop chỉ gợi ý lệnh có phạm vi phủ ít nhất một file
// đã sửa.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyCheckCommands, parseCheckCommands } from '../../hooks/lib/drift'
import { isCustomCheck } from '../../hooks/lib/drift/verify'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa module', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const SCOPED = { options: { planApproval: 'off', checkCommands: 'bun test @@ src/**' } }
const TWO = { options: { planApproval: 'off', checkCommands: 'bun test @@ src/**,npm run lint:docs @@ docs/**' } }
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}
async function run($: Engine, seen: Seen, path: string, check: boolean) {
  await submit($, 'Sửa module')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
  await $.turn.start({ text: 'Sửa module', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
  if (check) await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.9.0 B11: cú pháp phạm vi', () => {
  test('lệnh khai có @@: phần trước là lệnh, khớp như lệnh khai thường; mục không có @@ giữ nguyên', () => {
    applyCheckCommands(parseCheckCommands('bun test @@ src/**,make ci'))
    try {
      expect(isCustomCheck('bun test')).toBe(true)
      expect(isCustomCheck('bun test src/a.test.ts')).toBe(true)
      expect(isCustomCheck('make ci')).toBe(true)
      expect(isCustomCheck('@@')).toBe(false)
    } finally {
      applyCheckCommands([])
    }
  })
})

describe('0.9.0 B11: toàn luồng', () => {
  test('sửa docs/a.ts, bun test @@ src/** đạt: bước không lên verified, cổng Stop không gợi ý bun test', SCOPED, async ($, on) => {
    const seen = setup(on)
    await run($, seen, 'docs/a.ts', true)
    expect(await show($)).toContain('[x] 1. Sửa')
    expect(await stop($)).not.toContain('bun test')
  })
  test('sửa src/a.ts, bun test @@ src/** đạt: bước lên verified', SCOPED, async ($, on) => {
    const seen = setup(on)
    await run($, seen, 'src/a.ts', true)
    expect(await show($)).toContain('[v] 1. Sửa')
  })
  test('sửa src/a.ts, chưa chạy kiểm: cổng Stop gợi ý `bun test` (không kèm @@)', SCOPED, async ($, on) => {
    const seen = setup(on)
    await run($, seen, 'src/a.ts', false)
    const reason = await stop($)
    expect(reason).toContain('`bun test`')
    expect(reason).not.toContain('@@')
  })
  test('hai lệnh có phạm vi, sửa docs/x.ts: gợi ý lệnh phủ docs, không phải lệnh đầu tiên', TWO, async ($, on) => {
    const seen = setup(on)
    await run($, seen, 'docs/x.ts', false)
    const reason = await stop($)
    expect(reason).toContain('npm run lint:docs')
    expect(reason).not.toContain('`bun test`')
  })
  test('đối chứng: lệnh khai không có phạm vi như 0.8.9', { options: { planApproval: 'off', checkCommands: 'bun test' } }, async ($, on) => {
    const seen = setup(on)
    await run($, seen, 'docs/a.ts', true)
    expect(await show($)).toContain('[v] 1. Sửa')
  })
})
