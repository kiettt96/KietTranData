// 0.7.8 G9: yêu cầu người dùng gửi chen ngang khi luồng chính đang chạy (prompt.submit có turnId của turn đang chạy). Mod giữ mục tiêu
// và checklist, việc mới đánh số tiếp, khối context dặn plan add. Việc run: main cần model cao hơn luồng chính đang chạy chỉ chuyển sang
// subagent khi engine chèn tin vào turn đang chạy (attachment queued_command của luồng chính); tin thành turn mới thì không chuyển.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, conductor, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = { options: { decisionLog: '/tmp/fc-interject-078.jsonl' } }
const MARK = 'Yêu cầu chen ngang khi đang làm'
const FIRST = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'light',
  volume: 'medium',
  main: { model: 'sonnet', effort: 'medium' },
  tasks: [task('Đọc mã thanh toán', 'main', 'sonnet', 'medium'), task('Sửa hàm tính phí', 'main', 'sonnet', 'medium'), task('Viết test phí', 'agent', 'sonnet', 'medium')],
})

/** Router: prompt đầu lập mục tiêu FIRST; prompt chen ngang trả `later`. */
function routerWith(later: Json | null): (request: string) => Json | null {
  return request => (request.startsWith('Sửa luồng thanh toán') ? FIRST : later)
}

function hooks(on: On) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.append', () => ({}) as never)
}

/** Mục tiêu có checklist 3 bước, luồng chính đang chạy turn t1 (đã qua step đầu). */
async function running($: Engine, seen: Seen) {
  await submit($, 'Sửa luồng thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: đọc mã' }, { title: 'Việc 2: sửa phí' }, { title: 'Việc 3: test phí' }] })
  await $.turn.start({ text: 'Sửa luồng thanh toán', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}

const interject = ($: Engine, text: string, turnId: string | undefined = 't1', kind = 'composer') =>
  $.prompt.submit({ text, wait: false, origin: { kind } as never, ...(turnId !== undefined ? { turnId } : {}) })

/** Engine chèn tin chen ngang vào turn đang chạy: một dòng attachment queued_command của luồng chính. */
const delivered = ($: Engine, text: string) =>
  $.session.append({ message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text }] }, door: 'attachment', origin: { kind: 'engine' }, uuid: 'q1' } as never)

const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')

function logLines(on: On): () => Array<Record<string, unknown>> {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('0.7.8 G9: tiếp nhận yêu cầu chen ngang', () => {
  test('router xếp new với 2 việc: giữ mục tiêu và checklist, thêm Việc 4 và Việc 5, context dặn plan add, toast thêm 2 việc', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ goal: 'Thêm báo cáo doanh thu', tasks: [task('Thêm báo cáo doanh thu', 'main', 'sonnet', 'medium'), task('Xuất báo cáo ra CSV', 'main', 'sonnet', 'medium')] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Thêm luôn báo cáo doanh thu và xuất CSV')
    const context = lastContext(seen)
    expect(context).toContain(`${MARK}: Sửa luồng thanh toán`)
    expect(context).toContain('Việc 4: Thêm báo cáo doanh thu')
    expect(context).toContain('Việc 5: Xuất báo cáo ra CSV')
    expect(context).toContain('plan add')
    expect(seen.toasts.some(t => t.includes('Đã nhận yêu cầu chen ngang: thêm 2 việc'))).toBe(true)
    const shown = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(shown).toContain('Việc 1: đọc mã')
    expect(shown).toContain('Việc 3: test phí')
    expect((await $.tool.call({ tool: PLAN, action: 'restore' })).deny).toContain('Không có mục tiêu cũ')
  })

  test('router xếp refine với một ràng buộc mới: ràng buộc vào brief, context có "Ràng buộc mới"', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ relation: 'refine', goal: '', constraints: ['Không đổi API công khai'] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Nhớ là không đổi API công khai')
    const context = lastContext(seen)
    expect(context).toContain(MARK)
    expect(context).toContain('Ràng buộc mới: Không đổi API công khai')
    expect(seen.toasts.some(t => t.includes('Đã nhận yêu cầu chen ngang: chỉ thêm ràng buộc'))).toBe(true)
  })

  test('chèn vào turn đang chạy: việc run: main opus/high thành subagent general-purpose; turn đang chạy giữ sonnet; turn sau theo router', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Sửa race condition ghi cache', 'main', 'opus', 'high', { depth: 'hard' })] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await delivered($, 'Sửa luôn race condition ghi cache')
    const note = ((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })).context ?? []).join('\n')
    expect(note).toContain('Việc 4')
    expect(note).toContain('general-purpose')
    expect(note).toContain('opus/high')
    expect((await step($, seen, { turnId: 't1', index: 1 }))?.model).toContain('sonnet')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await $.turn.start({ text: 'tiếp', turnId: 't2' })
    expect((await step($, seen, { turnId: 't2' }))?.model).toContain('opus')
  })

  test('tin thành turn mới (không có queued_command): việc run: main giữ ở luồng chính, turn mới chạy opus', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' }, tasks: [task('Sửa race condition ghi cache', 'main', 'opus', 'high', { depth: 'hard' })] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition ghi cache')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await $.turn.start({ text: 'Sửa luôn race condition ghi cache', turnId: 't2' })
    expect((await step($, seen, { turnId: 't2' }))?.model).toContain('opus')
    const note = ((await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })).context ?? []).join('\n')
    expect(note).not.toContain('general-purpose')
  })

  test('gửi khi không có turn đang chạy: xử lý như 0.7.7 (router new thì mục tiêu mới, cất checklist)', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ goal: 'Thêm báo cáo doanh thu' })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Thêm báo cáo doanh thu', undefined)
    expect(lastContext(seen)).not.toContain(MARK)
    expect(lastContext(seen)).toContain('Checklist cũ còn 3 bước mở đã được lưu')
  })

  test('router lỗi khi chen ngang: mục tiêu, phân việc, checklist giữ nguyên; context vẫn dặn thêm bước', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(null) })
    hooks(on)
    await running($, seen)
    await interject($, 'Thêm luôn báo cáo doanh thu')
    const context = lastContext(seen)
    expect(context).toContain('plan add')
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('Việc 1: đọc mã')
  })

  test('tin của subagent hay plugin (origin khác người) không bị coi là chen ngang', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ goal: 'Thêm báo cáo doanh thu', tasks: [task('Thêm báo cáo', 'main', 'sonnet', 'medium')] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Thông báo nền: tác vụ xong', 't1', 'task-notification')
    expect(lastContext(seen)).not.toContain(MARK)
  })

  test('đang tạm dừng: luật hạn mức áp như cũ, không đọc chen ngang', {}, async ($, on) => {
    const seen = base(on, { router: routerWith(plan({ goal: 'Thêm báo cáo', tasks: [task('Thêm báo cáo', 'main', 'sonnet', 'medium')] })) })
    hooks(on)
    await running($, seen)
    await conductor($, 'pause')
    const routed = seen.routed.length
    await interject($, 'Thêm luôn báo cáo doanh thu')
    expect(seen.routed.length).toBe(routed)
    expect(lastContext(seen)).not.toContain(MARK)
  })

  test('20 việc mới tiêu đề dài: khối context không quá 1.500 ký tự', {}, async ($, on) => {
    const many = Array.from({ length: 20 }, (_, i) => task(`Phần mới số ${i + 1} ${'rất dài '.repeat(15)}`, 'main', 'sonnet', 'medium'))
    const seen = base(on, { router: routerWith(plan({ relation: 'continue', goal: '', tasks: many })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Làm thêm hai mươi phần')
    const block = (seen.contexts.at(-1) ?? []).find(c => c.includes(MARK)) ?? ''
    expect(block.length).toBeGreaterThan(0)
    expect(block.length).toBeLessThanOrEqual(1500)
  })

  test('decisionLog có dòng interject đúng trường; chèn vào turn thì có dòng interject-deliver', LOG, async ($, on) => {
    const lines = logLines(on)
    const seen = base(on, { router: routerWith(plan({ relation: 'continue', goal: '', constraints: ['Giữ API'], tasks: [task('Sửa race condition', 'main', 'opus', 'high', { depth: 'hard' })] })) })
    hooks(on)
    await running($, seen)
    await interject($, 'Sửa luôn race condition, giữ API')
    expect(lines().find(l => l['kind'] === 'interject')).toMatchObject({ kind: 'interject', relation: 'continue', tasks: 1, constraints: 1, toAgent: 0, liftable: 1 })
    await delivered($, 'Sửa luôn race condition, giữ API')
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })
    expect(lines().find(l => l['kind'] === 'interject-deliver')).toMatchObject({ kind: 'interject-deliver', toAgent: 1 })
  })
})
