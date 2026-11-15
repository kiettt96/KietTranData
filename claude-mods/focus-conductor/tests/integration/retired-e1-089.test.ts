// 0.8.9 vòng 3 E1 (tích hợp): bỏ việc thì yêu cầu chỉ việc đó phủ rời kế hoạch. Context của chính prompt đó có dòng "Đã bỏ" mà không có
// dòng "chưa có việc nào phủ" cho các yêu cầu ấy; tin chen ngang và tin kế tiếp cũng vậy.

import { describe, expect, test } from 'claude-code/testing'
import { base, plan, step, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const OPTS = { options: { planApproval: 'off' } }
const GAP = 'chưa có việc nào phủ'
const REQS = ['Xuất báo cáo tháng', 'Gửi thư tổng kết', 'Lưu bản sao lên kho', 'Ghi nhật ký thay đổi']
const FIRST = plan({
  goal: 'Hoàn thiện quy trình cuối tháng',
  depth: 'hard',
  volume: 'medium',
  kind: 'edit',
  requirements: REQS,
  tasks: REQS.map((r, i) => task(`Phần ${i + 1}: ${r}`, 'main', 'sonnet', 'medium', { covers: [i + 1] })),
})
const DROP = plan({ relation: 'refine', intent: 'amend', goal: '', arrange: { order: [], drop: [{ task: 2, why: 'không gửi thư nữa' }, { task: 3, why: 'không lưu bản sao nữa' }], merge: [] } })
const MORE = plan({ relation: 'refine', intent: 'amend', goal: '', constraints: ['Giữ định dạng cũ của báo cáo'] })
const router = (request: string): Json => (request.includes('thôi phần') ? DROP : request.includes('giữ định dạng') ? MORE : FIRST)

describe('0.8.9 vòng 3 E1: yêu cầu của việc đã bỏ không còn bị nhắc là chưa phủ', () => {
  test('prompt bỏ việc 2 và 3: context có dòng Đã bỏ, không có dòng chưa có việc nào phủ', OPTS, async ($, on) => {
    const seen = base(on, { router })
    await submit($, 'Hoàn thiện quy trình cuối tháng')
    await submit($, 'thôi phần gửi thư và phần lưu bản sao')
    const context = (seen.contexts.at(-1) ?? []).join('\n')
    expect(context).toContain('Đã bỏ:')
    expect(context).not.toContain(GAP)
    await submit($, 'giữ định dạng cũ của báo cáo')
    expect((seen.contexts.at(-1) ?? []).join('\n')).not.toContain(GAP)
  })

  test('tin chen ngang bỏ hai việc khi luồng chính đang chạy: context của tin đó và tin kế tiếp không nhắc hai yêu cầu là chưa phủ', OPTS, async ($, on) => {
    const seen = base(on, { router })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Hoàn thiện quy trình cuối tháng')
    await $.turn.start({ text: 'làm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.prompt.submit({ text: 'thôi phần gửi thư và phần lưu bản sao', wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
    const first = (seen.contexts.at(-1) ?? []).join('\n')
    expect(first).toContain('Yêu cầu chen ngang')
    expect(first).toContain('Đã bỏ:')
    expect(first).not.toContain(GAP)
    await $.prompt.submit({ text: 'giữ định dạng cũ của báo cáo', wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
    const next = (seen.contexts.at(-1) ?? []).join('\n')
    expect(next).toContain('Yêu cầu chen ngang')
    expect(next).not.toContain(GAP)
  })
})
