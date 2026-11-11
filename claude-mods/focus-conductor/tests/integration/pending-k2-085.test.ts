// 0.8.5 K2: mục tiêu đang dở chưa có checklist (mục tiêu lớn vừa lập, cổng duyệt đang planning) bị một mục tiêu mới thay thì được cất như
// checklist còn bước mở: một dòng báo đã lưu, tin bảo chạy tiếp hay plan action restore lấy lại được. Router trả new tin cậy thấp khi mục
// tiêu đang dở thì giữ mục tiêu như luật cũ của checklist còn bước mở. /conductor goal đi cùng đường adoptGoal. Mục tiêu không dở (light
// chưa có checklist, mục tiêu lớn đã đóng hết) thì như 0.8.4. Áp cho conductor mặc định và conductor fable, planApproval mặc định.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, conductor, plan, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-pending-k2-085.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const RULE = 'Không đổi API công khai'
const REQ = 'Sửa hàm phí'
const BIG = (over: Json = {}) => plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, requirements: [REQ], constraints: [RULE], ...over })
const NEW = (goal: string, confidence = 0.97, over: Json = {}) => plan({ relation: 'new', intent: 'task', confidence, goal, depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' }, ...over })
const RESUME = plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const OPTIONS = [
  ['conductor mặc định', { decisionLog: LOG }],
  ['conductor fable', { conductor: 'fable', decisionLog: LOG }],
] as const
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)
const restore = ($: Engine, index?: number) => $.tool.call({ tool: PLAN, action: 'restore', ...(index !== undefined ? { index } : {}) } as never) as Promise<{ deny?: string; result?: string }>
const lastContext = (seen: Seen) => seen.contexts.at(-1) ?? []
const setPlan = ($: Engine, titles: string[]) => $.tool.call({ tool: PLAN, action: 'set', steps: titles.map(title => ({ title })) } as never)
const mark = ($: Engine, id: number, status: string) => $.tool.call({ tool: PLAN, action: 'update', step: id, status } as never) as Promise<{ result?: string }>
/** Dòng báo đã lưu mục tiêu cũ (checklist còn bước mở hay mục tiêu chưa có checklist). */
const savedLines = (seen: Seen) => lastContext(seen).filter(c => c.startsWith('[focus-conductor]') && c.includes('đã được lưu'))

/** Router giả trả lần lượt các câu trả lời (câu cuối lặp lại); lượt rà kế hoạch trả sạch. */
function setup(on: On, replies: Json[]) {
  let n = 0
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : (replies[Math.min(n++, replies.length - 1)] ?? null)),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
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

describe('0.8.5 K2: mục tiêu đang dở chưa có checklist bị thay thì được cất', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: tin cậy 0,97: mục tiêu mới lập, mục tiêu lớn được cất với một dòng báo; B đóng hết, tiếp tục đưa mục tiêu lớn trở lại giữ goal, yêu cầu, ràng buộc`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME, NEW('Câu hỏi thử', 0.97)])
      await submit($, A)
      await submit($, 'Sửa chú thích README')
      expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
      expect(savedLines(seen).length).toBe(1)
      await setPlan($, ['Sửa chú thích'])
      await mark($, 1, 'done')
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      expect(lastContext(seen).some(c => c.startsWith('[focus-conductor] Tin bảo chạy tiếp: đã quay lại'))).toBe(true)
      // Brief của mục tiêu lớn giữ nguyên: router của prompt kế tiếp đọc lại goal và ràng buộc; lần đóng bước cuối nhắc yêu cầu.
      await submit($, 'việc sau')
      const request = seen.routed.at(-1) ?? ''
      expect(request).toContain(A)
      expect(request).toContain(RULE)
    })

    test(`${name}: tiếp tục khôi phục mục tiêu lớn: yêu cầu của nó còn nguyên`, { options: opts }, async ($, on) => {
      setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      await submit($, A)
      await submit($, 'Sửa chú thích README')
      await setPlan($, ['Sửa chú thích'])
      await mark($, 1, 'done')
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      await setPlan($, ['Sửa hàm phí'])
      expect(String((await mark($, 1, 'done')).result ?? '')).toContain(REQ)
    })

    test(`${name}: tin cậy 0,5: mục tiêu lớn được giữ, không lập mục tiêu mới`, { options: opts }, async ($, on) => {
      const { lines } = setup(on, [BIG(), NEW('Sửa chú thích', 0.5)])
      await submit($, A)
      await submit($, 'Sửa chú thích README')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      expect(lines().filter(l => l['kind'] === 'route').at(-1)?.['relation']).toBe('new')
      expect(String((await restore($)).deny ?? '')).toBe('Không có mục tiêu cũ nào đang được lưu để khôi phục.')
    })

    test(`${name}: /conductor goal Việc khác: mục tiêu lớn được cất, plan restore lấy lại được`, { options: opts }, async ($, on) => {
      setup(on, [BIG(), NEW('Việc khác')])
      await submit($, A)
      await conductor($, 'goal Việc khác')
      expect(await show($)).toContain('Mục tiêu: Việc khác')
      const back = await restore($)
      expect(back.deny).toBeUndefined()
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
    })
  }

  test('mục tiêu light chưa có checklist, không thuộc diện duyệt: bị thay thì không cất', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [plan({ goal: 'Sửa phí', depth: 'light', volume: 'small', kind: 'edit' }), NEW('Sửa chú thích')])
    await submit($, 'Sửa phí')
    await submit($, 'Sửa chú thích README')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(savedLines(seen).length).toBe(0)
    expect(String((await restore($)).deny ?? '')).toBe('Không có mục tiêu cũ nào đang được lưu để khôi phục.')
  })

  test('mục tiêu lớn đã đóng hết checklist: bị thay thì không cất', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích')])
    await submit($, A)
    await setPlan($, ['Sửa hàm phí'])
    await mark($, 1, 'done')
    await submit($, 'Sửa chú thích README')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(savedLines(seen).length).toBe(0)
    expect(String((await restore($)).deny ?? '')).toBe('Không có mục tiêu cũ nào đang được lưu để khôi phục.')
  })

  test('bốn mục tiêu đang dở lần lượt bị thay: danh sách đã cất giữ 3 mục gần nhất', { options: OPTIONS[0][1] }, async ($, on) => {
    const goals = ['Việc một', 'Việc hai', 'Việc ba', 'Việc bốn']
    setup(on, [...goals.map(goal => BIG({ goal })), NEW('Việc năm')])
    for (const goal of goals) await submit($, goal)
    await submit($, 'Việc năm')
    expect(await show($)).toContain('Mục tiêu: Việc năm')
    expect(String((await restore($, 4)).deny ?? '')).toContain('Chỉ có 3 mục tiêu đã lưu')
    expect((await restore($, 1)).deny).toBeUndefined()
    expect(await show($)).toContain('Mục tiêu: Việc bốn')
  })
})
