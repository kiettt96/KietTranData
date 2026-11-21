// 0.9.0 B (thay C1): vai do mod suy, router không trả vai. Việc trong danh sách của router: Explore là search, Plan là design, general-purpose
// có sửa file là build; model router chấm giữ nguyên, mod chỉ kẹp sàn theo bảng vai. Lời gọi Agent theo tiền tố description (không phân
// biệt hoa thường, tiền tố dài trước) mang vai review, audit, design; các lời gọi này không qua lượt router chấm khi giao, mod đặt model
// mặc định của vai.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import * as R from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { prefixRole } from '../../hooks/parts/agents'
import { base, plan, submit, task } from '../support/engine'
import { labels, stepTaskMeta } from '../../hooks/ui/labels'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
type Roled = { role?: string; pick: { family: string } }
const tasksOf = (tasks: unknown[]): Roled[] => ((R.parseRoute(JSON.stringify(plan({ tasks })), OPEN)?.tasks ?? []) as unknown as Roled[])

describe('0.9.0 B1: vai của việc trong danh sách do mod suy', () => {
  test('Explore là search, Plan là design, general-purpose sửa file là build; luồng chính và general-purpose không sửa file không mang vai', () => {
    const out = tasksOf([
      task('Tra mã', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate' }),
      task('Thiết kế', 'agent', 'opus', 'high', { agent: 'Plan', kind: 'answer' }),
      task('Sửa hàm', 'agent', 'sonnet', 'medium'),
      task('Đánh giá', 'agent', 'haiku', 'low', { kind: 'investigate' }),
      task('Làm trực tiếp', 'main', 'sonnet', 'medium'),
    ])
    expect(out.map(t => t.role)).toEqual(['search', 'design', 'build', undefined, undefined])
  })
  test('trường role router trả bị bỏ qua: vai vẫn do mod suy', () => {
    expect(tasksOf([task('Tra mã', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate', role: 'review' })]).map(t => t.role)).toEqual(['search'])
  })
  test('model router chấm giữ nguyên; search haiku giữ haiku; design fable về opus khi chưa bật allowFable', () => {
    const out = tasksOf([task('Tra mã', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate' }), task('Thiết kế', 'agent', 'fable', 'medium', { agent: 'Plan', kind: 'answer' }), task('Sửa hàm', 'agent', 'opus', 'high')])
    expect(out.map(t => t.pick.family)).toEqual(['haiku', 'opus', 'opus'])
  })
  test('lời dặn router không còn trường role và luật đội hình', () => {
    expect(R.routerSystem()).not.toContain('"role"')
    expect(R.routerSystem()).not.toContain('Team roles')
    expect(R.agentSystem()).not.toContain('"role"')
  })
})

describe('0.9.0 B2: vai theo tiền tố description', () => {
  test('tiền tố dài trước, không phân biệt hoa thường', () => {
    expect(['Kiểm độc lập: rà phí', 'kiểm độc lập: rà phí', 'Duyệt: phí', 'REVIEW: x', 'Independent check: x', 'Kiểm: bun test', 'audit: lint', 'Sẵn sàng: phát hành', 'readiness: x', 'Kiểm tra lại phí', 'Việc 2: Duyệt'].map(prefixRole)).toEqual([
      'review', 'review', 'review', 'review', 'review', 'audit', 'audit', 'design', 'design', undefined, undefined,
    ])
  })

  const GOAL = plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', tasks: [task('Sửa hàm phí', 'agent', 'sonnet', 'medium')] })
  function setup(on: On) {
    const seen = base(on, { router: () => GOAL, agent: () => ({ why: 'x', task: null, model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }) })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    return { seen, models }
  }
  for (const [description, family] of [['Duyệt: thay đổi phí', 'opus'], ['Kiểm: bun test', 'haiku'], ['Sẵn sàng: phát hành', 'opus']] as const) {
    test(`"${description}": không qua router chấm khi giao, model mặc định của vai là ${family}`, { options: { planApproval: 'off' } }, async ($, on) => {
      const { seen, models } = setup(on)
      await submit($, 'Sửa luồng phí')
      const before = seen.requests.filter(r => r.kind === 'agent').length
      await $.tool.call({ tool: 'Agent', description, prompt: 'Làm.' } as never)
      expect(seen.requests.filter(r => r.kind === 'agent').length).toBe(before)
      expect(models.at(-1) ?? '').toContain(family)
    })
  }
  test('Sẵn sàng khi allowFable bật: fable', { options: { planApproval: 'off', allowFable: true } }, async ($, on) => {
    const { models } = setup(on)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: 'Agent', description: 'Sẵn sàng: phát hành', prompt: 'Làm.' } as never)
    expect(models.at(-1) ?? '').toContain('fable')
  })
  test('số lượt gọi router không tăng: lời gọi không tiền tố vẫn một lượt chấm như 0.8.9, lời gọi có tiền tố không lượt nào', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await submit($, 'Sửa luồng phí')
    const before = seen.requests.filter(r => r.kind === 'agent').length
    await $.tool.call({ tool: 'Agent', description: 'Rà race condition', prompt: 'Phân tích.' } as never)
    await $.tool.call({ tool: 'Agent', description: 'Duyệt: race condition', prompt: 'Rà.' } as never)
    expect(seen.requests.filter(r => r.kind === 'agent').length - before).toBe(1)
  })
  test('lời gọi ngoài danh sách được router chấm là Explore: subagent mang vai search, Edit bị từ chối', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => GOAL, agent: () => ({ why: 'tra', task: null, model: 'haiku', effort: 'low', agent: 'Explore', depth: 'none', volume: 'small', kind: 'investigate' }) })
    on('tool.call', { tool: /^(?:Agent|Edit)$/ }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-tra' }) as never)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u-tra', description: 'Tìm chỗ gọi phí', prompt: 'Tìm.' } as never)
    await $.agent.spawn({ prompt: 'Tìm.', description: 'Tìm chỗ gọi phí', tool_use_id: 'u-tra' } as never)
    const out = (await $.tool.call({ tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b', agentId: 'a-tra' } as never)) as { deny?: string }
    expect(out.deny ?? '').toContain('tra')
  })
})

describe('0.9.0 B: nhãn vai trên chip của dòng bước', () => {
  test('việc có vai của đội hình (review, audit, design): chip ghi nhãn vai sau model; build không có nhãn (diệt mẫu 090-C1e)', () => {
    const l = labels('vi')
    const base = { kind: 'agent' as const, pick: { family: 'opus', effort: 'high' }, state: 'running' as const }
    for (const role of ['review', 'audit', 'design'] as const) expect(stepTaskMeta(l, { ...base, role })).toContain(`[${l.roleNames[role]}]`)
    expect(stepTaskMeta(l, { ...base, role: 'build' })).not.toContain('[')
  })
})
