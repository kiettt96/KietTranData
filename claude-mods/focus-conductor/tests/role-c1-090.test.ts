// 0.9.0 C1: router trả `role` cho mỗi việc (design, review, build, search, audit); vắng hay sai thì suy từ loại agent và kind. Mod kẹp ở chỗ
// kẹp chính sách: sàn model theo vai (review, build sàn sonnet), fable về opus khi chưa bật allowFable. Việc ngoài danh sách được router chấm
// khi giao cũng nhận vai. Nhật ký quyết định và pane mang vai (nhãn vi, en), pane ở 80 và 44 cột.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as R from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { PANE, base, plan, submit, task } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
type Roled = { role?: string; pick: { family: string } }
const tasksOf = (tasks: unknown[]): Roled[] => ((R.parseRoute(JSON.stringify(plan({ tasks })), OPEN)?.tasks ?? []) as unknown as Roled[])

describe('0.9.0 C1: parseRoute đọc vai', () => {
  test('vai hợp lệ giữ nguyên', () => {
    const out = tasksOf([task('Duyệt thay đổi', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' }), task('Tra mã', 'agent', 'haiku', 'low', { role: 'search', agent: 'Explore', kind: 'investigate' })])
    expect(out.map(t => t.role)).toEqual(['review', 'search'])
  })
  test('vai vắng hay sai: Explore là search, Plan là design, general-purpose sửa file là build, general-purpose không sửa là review', () => {
    const out = tasksOf([
      task('Tra mã', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate' }),
      task('Thiết kế', 'agent', 'opus', 'high', { agent: 'Plan', kind: 'answer', role: 'kiến trúc sư' }),
      task('Sửa hàm', 'agent', 'sonnet', 'medium'),
      task('Đánh giá', 'agent', 'sonnet', 'medium', { kind: 'investigate' }),
    ])
    expect(out.map(t => t.role)).toEqual(['search', 'design', 'build', 'review'])
  })
  test('sàn model theo vai: review và build không dưới sonnet; search và audit giữ haiku; design fable về opus khi chưa bật allowFable', () => {
    const out = tasksOf([
      task('Duyệt', 'agent', 'haiku', 'low', { role: 'review', kind: 'investigate' }),
      task('Làm', 'agent', 'haiku', 'low', { role: 'build', kind: 'answer' }),
      task('Tra', 'agent', 'haiku', 'low', { role: 'search', agent: 'Explore', kind: 'investigate' }),
      task('Kiểm', 'agent', 'haiku', 'low', { role: 'audit', kind: 'investigate' }),
      task('Thiết kế', 'agent', 'fable', 'high', { role: 'design', agent: 'Plan', kind: 'answer' }),
    ])
    expect(out.map(t => t.pick.family)).toEqual(['sonnet', 'sonnet', 'haiku', 'haiku', 'opus'])
  })
  test('router chấm subagent: vai đọc được từ câu trả lời; vắng thì suy', () => {
    const parse = (R as unknown as { parseAgentRoute?: (reply: string, policy: Policy) => { role?: string } | null }).parseAgentRoute
    expect(typeof parse).toBe('function')
    const reply = (over: Record<string, unknown>) => JSON.stringify({ why: 'w', confidence: 1, task: null, model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'investigate', ...over })
    expect(parse?.(reply({ role: 'audit' }), OPEN)?.role).toBe('audit')
    expect(parse?.(reply({}), OPEN)?.role).toBe('review')
  })
})

const LOG = '/tmp/fc-role-c1-090.jsonl'
const GOAL = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'substantial',
  volume: 'medium',
  kind: 'edit',
  tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium', { role: 'build' }), task('Kiểm độc lập', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' })],
})

async function paneTexts($: Engine, columns: number): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, columns } } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '')
  await ui.unmount()
  return texts.join('\n')
}

describe('0.9.0 C1: nhật ký và pane mang vai', () => {
  test('dòng route ghi vai của từng việc; pane có nhãn vai ở 80 và 44 cột', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    base(on, { router: () => GOAL })
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, 'Sửa luồng thanh toán')
    const route = (writes.at(-1) ?? '').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).find(l => l['kind'] === 'route')
    expect((route?.['tasks'] as Array<{ role?: string }>).map(t => t.role)).toEqual(['build', 'review'])
    for (const columns of [80, 44]) {
      const text = await paneTexts($, columns)
      expect(text, String(columns)).toContain('[làm]')
      expect(text, String(columns)).toContain('[duyệt]')
    }
  })
  test('nhãn tiếng Anh', { options: { planApproval: 'off', uiLanguage: 'en' } }, async ($, on) => {
    base(on, { router: () => GOAL })
    await submit($, 'Sửa luồng thanh toán')
    const text = await paneTexts($, 80)
    expect(text).toContain('[build]')
    expect(text).toContain('[review]')
  })
})
