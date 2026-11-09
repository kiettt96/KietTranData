// 0.8.2 N1: router phân loại ý của tin nhắn tiếp nối (trường intent): status (hỏi tiến độ), resume (bảo chạy tiếp), approve (đồng ý kế
// hoạch đang chờ duyệt), amend (bổ sung yêu cầu), task (còn lại). status không đổi brief, checklist, việc hay yêu cầu, không phải turn thực
// thi với các cổng Stop, khối context ngắn; resume không thêm việc; amend và intent thiếu đi đường tiếp nối như cũ. Kẹp: intent thiếu hay
// sai là task, relation new luôn là task, approve khi không có kế hoạch chờ duyệt là resume.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { parseRoute } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { base, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const OPTIONS = { options: { enforceChecklist: true, decisionLog: '/tmp/fc-intent-n1-082.jsonl' } }
const FIRST = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'light',
  volume: 'medium',
  requirements: ['Sửa hàm tính phí'],
  tasks: [task('Đọc mã thanh toán', 'main', 'sonnet', 'medium'), task('Sửa hàm tính phí', 'main', 'sonnet', 'medium')],
})
const TWO = [task('Thêm báo cáo doanh thu', 'main', 'sonnet', 'medium'), task('Xuất báo cáo ra CSV', 'main', 'sonnet', 'medium')]
const follow = (over: Json) => plan({ relation: 'continue', goal: '', ...over })

function setup(on: On, later: Array<Json | null>) {
  let call = 0
  const seen = base(on, { router: () => (call++ === 0 ? FIRST : (later[Math.min(call - 2, later.length - 1)] ?? null)) })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

/** Mục tiêu có checklist ba bước, turn t1 đã chạy xong step đầu. */
async function started($: Engine, seen: Seen) {
  await submit($, 'Sửa luồng thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 1: đọc mã' }, { title: 'Việc 2: sửa phí' }, { title: 'Kiểm lại' }] })
  await $.turn.start({ text: 'Sửa luồng thanh toán', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}

const lastContext = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const interject = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const intentOf = (over: Json) => (parseRoute(JSON.stringify(plan(over)), OPEN) as unknown as { intent?: string } | null)?.intent

describe('0.8.2 N1: kẹp intent', () => {
  test('intent thiếu hay sai: task', () => {
    expect(intentOf({ relation: 'continue', goal: '' })).toBe('task')
    expect(intentOf({ relation: 'continue', goal: '', intent: 'hỏi' })).toBe('task')
  })
  test('relation new với intent status: task', () => expect(intentOf({ intent: 'status' })).toBe('task'))
  test('relation continue với intent status: status', () => expect(intentOf({ relation: 'continue', goal: '', intent: 'status' })).toBe('status'))
})

describe('0.8.2 N1: tin tiếp nối sau khi turn kết thúc', () => {
  test('intent status kèm hai việc: checklist, việc, yêu cầu giữ nguyên; context là khối ngắn; Stop không chặn', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [follow({ intent: 'status', tasks: TWO, requirements: ['Yêu cầu lạ của câu hỏi'] }), follow({ intent: 'amend', tasks: [task('Ghi tài liệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await $.turn.complete({ turnId: 't1' } as never).catch(() => undefined)
    await submit($, 'tới đâu rồi')
    const context = lastContext(seen)
    expect(context).toContain('tiến độ')
    expect(context).not.toContain('Thêm báo cáo doanh thu')
    expect(context.length).toBeLessThanOrEqual(300 + 400)
    const block = (seen.contexts.at(-1) ?? []).find(c => c.includes('tiến độ')) ?? ''
    expect(block.length).toBeLessThanOrEqual(300)
    expect(await shown($)).toContain('Kiểm lại')
    await $.turn.start({ text: 'tới đâu rồi', turnId: 't2' })
    await step($, seen, { turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: 'src/phi.ts' } as never)
    expect(await stop($)).toBe('')
    // Hai việc của câu hỏi không vào Phân việc: việc kế tiếp đánh số 3.
    await submit($, 'thêm phần ghi tài liệu')
    expect(lastContext(seen)).toContain('3. Ghi tài liệu')
  })

  test('intent status qua tin chen ngang: không ghi interject, turn đã sửa file vẫn bị cổng Stop xét như cũ', OPTIONS, async ($, on) => {
    const { seen, lines } = setup(on, [follow({ intent: 'status', tasks: TWO })])
    await started($, seen)
    await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
    await interject($, 'xong chưa')
    expect(lastContext(seen)).not.toContain('Thêm báo cáo doanh thu')
    expect(seen.toasts.some(t => t.includes('chen ngang'))).toBe(false)
    expect(lines().some(l => l['kind'] === 'interject')).toBe(false)
    expect(await shown($)).toContain('Kiểm lại')
    expect(await stop($)).not.toBe('')
  })

  test('intent resume kèm một việc: không thêm việc', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [follow({ intent: 'resume', tasks: [task('Việc lạ', 'main', 'sonnet', 'medium')] }), follow({ intent: 'amend', tasks: [task('Ghi tài liệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'chạy tiếp đi')
    const block = (seen.contexts.at(-1) ?? []).find(c => c.includes('chạy tiếp')) ?? ''
    expect(block).not.toBe('')
    expect(block.length).toBeLessThanOrEqual(300)
    expect(lastContext(seen)).not.toContain('Việc lạ')
    await submit($, 'thêm phần ghi tài liệu')
    expect(lastContext(seen)).toContain('3. Ghi tài liệu')
  })

  test('intent amend kèm một việc: thêm việc đánh số tiếp theo', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [follow({ intent: 'amend', tasks: [task('Ghi tài liệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'thêm phần ghi tài liệu')
    expect(lastContext(seen)).toContain('3. Ghi tài liệu')
  })

  test('intent thiếu: thêm việc như tiếp nối cũ', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [follow({ tasks: [task('Ghi tài liệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'thêm phần ghi tài liệu')
    expect(lastContext(seen)).toContain('3. Ghi tài liệu')
  })

  test('intent approve khi không có kế hoạch chờ duyệt: như resume, không thêm việc', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [follow({ intent: 'approve', tasks: [task('Việc lạ', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'ok duyệt')
    expect(lastContext(seen)).not.toContain('Việc lạ')
    expect((seen.contexts.at(-1) ?? []).some(c => c.includes('chạy tiếp'))).toBe(true)
  })

  test('relation new với intent status: lập mục tiêu mới', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [plan({ goal: 'Viết trang giới thiệu', intent: 'status', tasks: [task('Viết trang giới thiệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'Viết trang giới thiệu mới')
    expect(lastContext(seen)).toContain('Viết trang giới thiệu')
    expect(await shown($)).not.toContain('Kiểm lại')
  })

  test('nhật ký route ghi intent', OPTIONS, async ($, on) => {
    const { seen, lines } = setup(on, [follow({ intent: 'amend', tasks: [task('Ghi tài liệu', 'main', 'sonnet', 'medium')] })])
    await started($, seen)
    await submit($, 'thêm phần ghi tài liệu')
    expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['intent']).toBe('amend')
  })
})
