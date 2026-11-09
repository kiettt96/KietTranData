// Test bắt các mẫu đột biến 078- sống sót ở lượt đột biến của 0.7.8: 078-G1d, 078-G1e (cổng Stop khi chưa có checklist) và 078-G9f,
// 078-G9i, 078-G9j, 078-G9l, 078-G9m (tin chen ngang chuyển việc sang subagent); 078-G9o (khối chen ngang bớt việc cho vừa trần); và 077-X6i (sống sót từ trước, cả trên 0.7.7).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { FOUR, SEARCH, base, plan, spawnTool, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { quotaMeter, week } from '../support/quota'
import { newTracker, observe, summarize } from '../../hooks/lib/drift'
import { INTERJECT_CHARS, interjectContext, missingTasksNotice } from '../../hooks/lib/text'
import { bash as bashCall, edit as editCall, makeBrief } from '../support/commands'

const PLAN = 'mcp__focus-conductor__plan'
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false })) as { block?: string }).block ?? '')
const edit = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'x', new_string: 'y' } as never) as Promise<{ context?: string[] }>
const noteOf = async ($: Engine, path = 'src/a.ts') => ((await edit($, path)).context ?? []).join('\n')

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
}

describe('078-G1d, 078-G1e: cổng Stop khi chưa có checklist', () => {
  test('không có danh sách phản chiếu: lý do không nói danh sách chỉ để hiển thị', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa luồng đăng ký', depth: 'light', volume: 'medium' }) })
    hooks(on)
    await submit($, 'Sửa luồng đăng ký')
    await edit($)
    const reason = await stop($)
    expect(reason).toContain('chưa có checklist')
    expect(reason).not.toContain('chỉ để hiển thị')
  })

  test('turn đã nhận báo hạn mức mềm, cửa sổ còn trong vùng báo: không chặn vì thiếu checklist', { options: { planApproval: 'off', noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const seen = base(on)
    hooks(on)
    const meter = quotaMeter(on, [week(50)])
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await $.turn.start({ text: FOUR, turnId: 't1' })
    meter.set([week(81)])
    await seen.clock.advance(10_000)
    const out = await edit($, '/repo/src/a.ts')
    expect((out.context ?? []).some(c => c.includes('Hạn mức tuần còn 19%'))).toBe(true)
    expect(await stop($)).toBe('')
  })
})

const FIRST = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'light',
  volume: 'medium',
  main: { model: 'sonnet', effort: 'medium' },
  tasks: [task('Đọc mã thanh toán', 'main', 'sonnet', 'medium'), task('Sửa hàm tính phí', 'main', 'sonnet', 'medium'), task('Viết test phí', 'agent', 'sonnet', 'medium')],
})
const routerWith = (later: Json) => (request: string) => (request.startsWith('Sửa luồng thanh toán') ? FIRST : later)
const RACE = plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Sửa race condition ghi cache', 'main', 'opus', 'high', { depth: 'hard' })] })

async function running($: Engine, seen: Seen) {
  await submit($, 'Sửa luồng thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: đọc mã' }, { title: 'Việc 2: sửa phí' }, { title: 'Việc 3: test phí' }] })
  await $.turn.start({ text: 'Sửa luồng thanh toán', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const interject = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, turnId: 't1' })
/** Hàng attachment như engine báo (vòng sửa 2, V1): door delivery, origin của người gõ tin. */
const appended = ($: Engine, name: string, agentId?: string) =>
  $.session.append({ message: { type: 'attachment', name, content: [{ type: 'text', text: 'x' }] }, door: 'delivery', origin: { kind: 'composer' }, uuid: `u-${name}`, ...(agentId !== undefined ? { agentId } : {}) } as never)

describe('078-G9f, 078-G9i, 078-G9j, 078-G9l, 078-G9m: chuyển việc của tin chen ngang', () => {
  test('cùng họ, effort cao hơn luồng chính đang chạy (sonnet/high trên sonnet/medium): cũng chuyển sang subagent', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Sửa lỗi tính thuế', 'main', 'sonnet', 'high')] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn lỗi tính thuế')
    await appended($, 'queued_command')
    const note = await noteOf($)
    expect(note).toContain('Việc 4')
    expect(note).toContain('sonnet/high')
  })

  test('attachment khác queued_command không chuyển việc; queued_command sau đó mới chuyển', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await appended($, 'nested_memory')
    expect(await noteOf($, 'src/a.ts')).not.toContain('general-purpose')
    await appended($, 'queued_command')
    expect(await noteOf($, 'src/b.ts')).toContain('general-purpose')
  })

  test('queued_command của subagent không chuyển việc của luồng chính', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await spawnTool($, 'u1', 'Việc 3: viết test phí', 'Viết test cho hàm phí')
    await interject($, 'Sửa luôn race condition ghi cache')
    await appended($, 'queued_command', 'a-u1')
    expect(await noteOf($)).not.toContain('general-purpose')
  })

  test('việc vừa chuyển được theo dõi như việc ghi giao: luồng chính tự sửa file thì được nhắc giao Việc 4', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await appended($, 'queued_command')
    expect(await noteOf($)).toContain('chưa giao: Việc 4')
  })

  test('turn mới bắt đầu thì bỏ việc chờ chuyển: queued_command sau đó không chuyển', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await $.turn.start({ text: 'Sửa luôn race condition ghi cache', turnId: 't2' })
    await appended($, 'queued_command')
    expect(await noteOf($)).not.toContain('general-purpose')
  })
})

describe('077-X6i: ghi tài liệu bằng đường dẫn tương đối không nối được', () => {
  const read = (path: string) => ({ tool: 'Read', input: { file_path: path }, isError: false, isReadOnly: true })
  test('một lần ghi tương đối không biết thư mục làm việc cùng một Edit tuyệt đối đã đọc lại: vẫn là cảnh báo thường', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    for (const call of [bashCall("cat > a.md <<'EOF'\nx\nEOF"), editCall('/p/b.md'), read('/p/b.md'), read('a.md')]) observe(tracker, call, brief, [])
    expect(summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.isSoft).toBeUndefined()
  })
})

describe('078-G9o: khối chen ngang bớt việc cho vừa trần', () => {
  test('20 việc mới tiêu đề dài: khối không quá trần, câu dặn plan add ở cuối còn nguyên, có "và M việc nữa"', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({ index: i + 4, title: `Phần mới số ${i + 1} ${'rất dài '.repeat(15)}`, run: 'main' as const, pick: { family: 'sonnet' as const, effort: 'medium' as const }, depth: 'light' as const, volume: 'small' as const, kind: 'edit' as const, why: '' }))
    const block = interjectContext(makeBrief({ goal: 'Sửa luồng thanh toán' }), [], tasks, [], { main: 'sonnet/medium', mayReplace: false, isRouted: true })
    expect(block.length).toBeLessThanOrEqual(INTERJECT_CHARS)
    expect(block.endsWith('giữ nguyên các bước đang có.')).toBe(true)
    expect(block).toMatch(/và \d+ việc nữa/)
  })
})

describe('078-G4j, 078-G9r', () => {
  test('dòng việc chưa có bước cắt tiêu đề dài ở 60 ký tự', () => {
    const long = `Việc có tiêu đề rất dài ${'x'.repeat(100)}`
    const line = missingTasksNotice([{ index: 2, title: long, run: 'main', pick: { family: 'sonnet', effort: 'medium' }, depth: 'light', volume: 'small', kind: 'edit', why: '' }])
    expect(line).toContain('Việc 2: Việc có tiêu đề rất dài')
    expect(line).not.toContain(long)
  })

  test('request router của tin chen ngang nói tin đến khi luồng chính đang làm, kèm bước đang mở', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(RACE) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    const request = seen.routed.at(-1) ?? ''
    expect(request).toContain('while the main model was still working on the current goal')
    expect(request).toContain('Việc 1: đọc mã')
  })
})
