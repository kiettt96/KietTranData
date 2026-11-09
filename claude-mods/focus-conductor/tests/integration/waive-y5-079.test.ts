// 0.7.9 Y5: chủ mod miễn một lệnh kiểm chưa đạt bằng /conductor waive <số|lệnh> <lý do từ 10 ký tự>. Chỉ nhận lệnh do người gõ. Mục được
// miễn không chặn Stop, không tăng lượt, không đặt sàn; bước blocked của lệnh đó thành skipped; nhật ký quyết định có dòng waive; band và
// pane ghi "đã miễn"; Stop kế tiếp chặn đúng một lần đòi mục "Lệnh kiểm được miễn". Mục tiêu mới hay lệnh chạy đạt thì lệnh miễn hết hiệu lực.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { JS } from '../fixtures/runner-output'
import { PANE, RUN, base, conductor, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const LOG = '/tmp/fc-waive-079.jsonl'
const REASON = 'test này hỏng sẵn từ trước'
const SECTION = 'Lệnh kiểm được miễn'

function setup(on: On) {
  const passing = new Set<string>()
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, passing, lines }
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const say = async ($: Engine, args: string) => String((await conductor($, args)).text ?? '')

/** Mục tiêu một bước, turn t1, sửa file, `bun test` lỗi, bước đóng done. */
async function failing($: Engine, seen: Seen, text = 'Sửa hàm tính phí') {
  await submit($, text)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: text }] })
  await $.turn.start({ text, turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await edit($)
  await bash($, 'bun test')
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.7.9 Y5: /conductor waive', () => {
  test('1. lượt 2, waive 1 kèm lý do: Stop chặn một lần đòi mục "Lệnh kiểm được miễn", lần sau qua; nhật ký có waive', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await failing($, seen)
    expect(await stop($)).toContain('2/3')
    expect(await say($, `waive 1 ${REASON}`)).toContain('Đã miễn')
    const asked = await stop($)
    expect(asked).toContain(SECTION)
    expect(asked).toContain('bun test')
    expect(asked).not.toContain('3/3')
    expect(await stop($)).toBe('')
    expect(lines().find(l => l['kind'] === 'waive')).toMatchObject({ signature: 'test:bun test', reason: REASON, round: 2 })
  })

  test('waive theo lệnh thay cho số thứ tự cũng được', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    expect(await say($, `waive bun test ${REASON}`)).toContain('Đã miễn')
    expect(await stop($)).toContain(SECTION)
    expect(await stop($)).toBe('')
  })

  test('2. thiếu lý do hay lý do dưới 10 ký tự: không miễn, có hướng dẫn', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    expect(await say($, 'waive 1')).toContain('Cách dùng')
    expect(await say($, 'waive 1 hỏng rồi')).toContain('Cách dùng')
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($)).toContain('3/3')
  })

  test('3. lệnh do plugin phát (origin không phải người): không miễn', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    const out = await $.command.run({ command: 'conductor', args: `waive 1 ${REASON}`, origin: { kind: 'plugin', name: 'khác' }, presentation: RUN.presentation } as never)
    expect(String((out as { text?: string }).text ?? '')).toContain('người gõ')
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($)).toContain('3/3')
  })

  test('4. đã hết lượt, có bước blocked: miễn thì bước thành skipped kèm note', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($)).toContain('hết 3 lượt')
    expect(await shown($)).toContain('[b] 1.')
    await say($, `waive 1 ${REASON}`)
    const text = await shown($)
    expect(text).toContain('[-] 1.')
    expect(text).toContain(`miễn bởi chủ mod: ${REASON}`)
  })

  test('5. mục tiêu mới: lệnh miễn cũ không áp', {}, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    await stop($)
    await conductor($, 'goal Sửa hàm tính thuế')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính thuế' }] })
    await edit($)
    await bash($, 'bun test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const reason = await stop($)
    expect(reason).toContain('bun test')
    expect(reason).toContain('2/3')
    expect(reason).not.toContain(SECTION)
  })

  test('6. miễn xong chạy lại vẫn lỗi: không chặn; chạy đạt: lệnh miễn bị xóa', {}, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    await stop($)
    await bash($, 'bun test')
    expect(await stop($)).toBe('')
    expect(await say($, 'status')).toContain(SECTION)
    passing.add('bun test')
    await bash($, 'bun test')
    expect(await say($, 'status')).not.toContain(SECTION)
  })

  test('7. waive undo: lệnh quay lại lượt lúc miễn, Stop chặn như trước khi miễn', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    await stop($)
    expect(await say($, 'waive undo 1')).toContain('Đã bỏ')
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($)).toContain('3/3')
  })

  test('/conductor không đối số liệt kê "Lệnh kiểm được miễn": số thứ tự, lệnh, lý do, lượt lúc miễn', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    const text = await say($, '')
    expect(text).toContain(`${SECTION}:`)
    expect(text).toContain(`1. bun test: ${REASON} (lượt 2)`)
  })

  test('/conductor status đánh số lệnh chưa đạt để waive dùng', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    expect(await say($, 'status')).toContain('1. bun test: lượt 2/3')
  })

  test('pane ghi "đã miễn" cạnh lệnh', {}, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /đã miễn: `bun test`/ })).toBeDefined()
    await pane.unmount()
  })

  test('pane tiếng Anh ghi "waived"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await say($, `waive 1 ${REASON}`)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /waived: `bun test`/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('0.7.9 Y5: lệnh miễn trong Core', () => {
  test('8. còn sau vòng JSON (như sau hot reload); Core cũ không có trường thì mặc định rỗng', () => {
    const waiver = { sig: 'test:bun test', command: 'bun test', reason: REASON, round: 2, asked: false, step: null }
    const core = S.withWaivers({ goalId: 3, items: [waiver] })(S.EMPTY_CORE)
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).waivers).toEqual({ goalId: 3, items: [waiver] })
    expect(S.normalizeCore({} as Partial<Core>).waivers).toEqual({ goalId: -1, items: [] })
  })
})
