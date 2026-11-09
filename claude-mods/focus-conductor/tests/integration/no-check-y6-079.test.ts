// 0.7.9 Y6: mục tiêu đã sửa file (luồng chính hay subagent) mà chưa có lần kiểm nào chạy sau thay đổi cuối thì cổng Stop chặn đúng một lần
// mỗi mục tiêu, khi dự án có lệnh kiểm rõ ràng (checkCommands, checkTools, lần kiểm đạt từng có, hay script trong package.json). Không chặn
// turn chỉ sửa tài liệu đã đọc lại, tier trivial, lúc dừng vì hạn mức, enforceChecklist false. Thứ tự: W4, rồi Y6, rồi G1 và checklist.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { JS } from '../fixtures/runner-output'
import { base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const TRIVIAL = plan({ goal: 'Sửa một chữ', depth: 'none', volume: 'small', main: { model: 'sonnet', effort: 'low' } })
const DECLARED = { options: { checkCommands: 'bun test' } }
const DECLARED_PA_OFF = { ...DECLARED, options: { ...DECLARED.options, planApproval: 'off' } }
const NUDGE = 'chưa chạy lần kiểm nào'

type Files = Record<string, string>

function setup(on: On, files: Files = {}, router: (request: string) => Json = () => GOAL) {
  const passing = new Set<string>(['bun test'])
  const seen = base(on, { router })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.read', (_$, e) => (files[e.path] !== undefined ? ({ value: files[e.path] } as never) : ({ deny: `ENOENT: no such file or directory, open '${e.path}'` } as never)))
  on('fs.stat', (_$, e) => (files[e.path] !== undefined ? ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } } as never) : ({ deny: `ENOENT: ${e.path}` } as never)))
  return { seen, passing }
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const edit = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
const read = ($: Engine, path: string) => $.tool.call({ tool: 'Read', file_path: path } as never)
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')

/** Mục tiêu một bước, turn t1, `work` (mặc định sửa src/a.ts), rồi bước đóng done. */
async function goal($: Engine, seen: Seen, work: () => Promise<unknown> = () => edit($), text = 'Sửa hàm tính phí') {
  await submit($, text)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: text }] })
  await $.turn.start({ text, turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await work()
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.7.9 Y6: chặn một lần khi đã sửa mà chưa kiểm', () => {
  test('1. sửa src/a.ts, không chạy kiểm, checkCommands có bun test: chặn một lần, lý do có bun test; lần sau qua', DECLARED_PA_OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    const reason = await stop($)
    expect(reason).toContain(NUDGE)
    expect(reason).toContain('bun test')
    expect(reason.length).toBeLessThanOrEqual(600)
    expect(await stop($)).toBe('')
  })

  test('2. đã chạy bun test đạt sau thay đổi cuối: không chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($)
      await bash($, 'bun test')
    })
    expect(await stop($)).toBe('')
  })

  test('3. dự án không có lệnh kiểm nào: không chặn', {}, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    expect(await stop($)).toBe('')
  })

  test('4. package.json có script test: chặn, lý do nêu npm test; có bun.lock thì bun run test', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) })
    await goal($, seen)
    expect(await stop($)).toContain('npm test')
  })

  test('4b. package.json có script typecheck và bun.lock: lý do nêu bun run typecheck', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on, { '/repo/package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }), '/repo/bun.lock': '{}' })
    await goal($, seen)
    expect(await stop($)).toContain('bun run typecheck')
  })

  test('lần kiểm đạt từng có trong mục tiêu là nguồn lệnh: sửa tiếp mà không kiểm lại thì chặn, nêu đúng lệnh đó', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($)
      await bash($, 'bun test')
      await edit($, 'src/b.ts')
    })
    expect(await stop($)).toContain('bun test')
  })

  test('5. turn chỉ sửa tài liệu đã đọc lại: không chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, '/repo/docs/a.md')
      await read($, '/repo/docs/a.md')
    })
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('6. brief tier trivial: không chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on, {}, () => TRIVIAL)
    await goal($, seen, () => edit($), 'Sửa một chữ')
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('7. mục tiêu mới: chặn lại được một lần', DECLARED_PA_OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    expect(await stop($)).toContain(NUDGE)
    await conductor($, 'goal Sửa hàm tính thuế')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính thuế' }] })
    await edit($, 'src/c.ts')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toContain(NUDGE)
  })

  test('8a. enforceChecklist false: không chặn', { options: { checkCommands: 'bun test', enforceChecklist: false } }, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    expect(await stop($)).toBe('')
  })

  test('8b. đang tạm dừng (người dùng hay hạn mức): không chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    await conductor($, 'pause')
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('stop_hook_active: không chặn trong cùng chuỗi dừng, khóa không bị dùng', DECLARED_PA_OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen)
    expect(await stop($, true)).toBe('')
    expect(await stop($)).toContain(NUDGE)
  })

  test('9. có lệnh chưa đạt (W4) và bước mở: lý do gộp theo thứ tự W4, Y6, checklist, không quá 1.200 ký tự', DECLARED_PA_OFF, async ($, on) => {
    const { seen, passing } = setup(on)
    passing.clear()
    await submit($, 'Sửa hàm tính phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }, { title: 'Viết test' }] })
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await edit($)
    await bash($, 'npx vitest run')
    await edit($, 'src/b.ts')
    const reason = await stop($)
    const w4 = reason.indexOf('Còn lệnh kiểm chưa đạt')
    const y6 = reason.indexOf(NUDGE)
    const open = reason.indexOf('Viết test')
    expect(w4).toBeGreaterThanOrEqual(0)
    expect(y6).toBeGreaterThan(w4)
    expect(open).toBeGreaterThan(y6)
    expect(reason.length).toBeLessThanOrEqual(1200)
  })
})

describe('0.7.9 Y6: khóa trong Core', () => {
  test('noCheckNudged còn sau vòng JSON; Core cũ mặc định -1', () => {
    const core = S.withNoCheckNudged(5)(S.EMPTY_CORE)
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).noCheckNudged).toBe(5)
    expect(S.normalizeCore({} as Partial<Core>).noCheckNudged).toBe(-1)
  })
})
